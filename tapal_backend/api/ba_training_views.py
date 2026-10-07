"""Training videos, ambassadors, and public BA assessment APIs."""

from __future__ import annotations

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .assessment import aggregate_answers, apply_session_result
from .engine import EngineError, analyze_audio, engine_health, transcribe_media
from .models import (
    Ambassador,
    AssessmentAnswer,
    AssessmentQuestion,
    AssessmentSession,
    Store,
    TrainingVideo,
)
from .serializers import (
    AmbassadorCreateSerializer,
    AmbassadorSerializer,
    AssessmentAnswerSerializer,
    AssessmentQuestionSerializer,
    TrainingVideoSerializer,
)
from .training_questions import parse_questions_payload


def active_training_video() -> TrainingVideo | None:
    return TrainingVideo.objects.filter(is_active=True).first()


class TrainingVideoViewSet(viewsets.ModelViewSet):
    """HO: list upload history + upload new video (latest becomes active)."""

    serializer_class = TrainingVideoSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        return TrainingVideo.objects.select_related('uploaded_by').all()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def initial(self, request, *args, **kwargs):
        # The training video is shared by every city: city Head Office users can view, not change it.
        from rest_framework.exceptions import PermissionDenied
        from rest_framework.permissions import SAFE_METHODS

        from .city_scope import scope_for

        super().initial(request, *args, **kwargs)
        if request.method not in SAFE_METHODS and not scope_for(request.user).is_all:
            raise PermissionDenied('Only the all-city Head Office can change the training video.')

    def create(self, request, *args, **kwargs):
        upload = request.FILES.get('file') or request.FILES.get('video')
        if not upload:
            return Response({'detail': 'video file required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            questions = parse_questions_payload(
                request.data.get('questions') or request.data.get('questions_json')
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if not questions:
            return Response(
                {
                    'detail': (
                        'At least one assessment question is required. '
                        'Pass questions as JSON: [{question, description?}].'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        video = TrainingVideo(
            file=upload,
            original_name=getattr(upload, 'name', '') or '',
            uploaded_by=request.user,
            is_active=True,
            questions_json=questions,
        )
        video.save()
        TrainingVideo.objects.exclude(pk=video.pk).filter(is_active=True).update(is_active=False)

        transcript_error = None
        try:
            transcript = transcribe_media(
                video.file.path,
                original_name=video.original_name or 'training-video.mp4',
                content_type=getattr(upload, 'content_type', None) or 'video/mp4',
            )
            video.transcript = transcript
            video.save(update_fields=['transcript'])
        except EngineError as exc:
            transcript_error = str(exc)

        data = TrainingVideoSerializer(video, context={'request': request}).data
        payload = {
            'ok': True,
            'video': data,
            'engine': engine_health(),
            'question_count': len(questions),
        }
        if transcript_error:
            # Questions are saved; transcript is optional for scoring context.
            payload['transcript_error'] = transcript_error
            payload['warning'] = (
                'Video and questions saved. Transcription failed — '
                'answers still score against your questions; re-transcribe later for video relevance.'
            )
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch', 'post'], url_path='questions')
    def set_questions(self, request, pk=None):
        """Replace HO assessment questions on an existing training video."""
        video = self.get_object()
        try:
            questions = parse_questions_payload(
                request.data.get('questions') or request.data.get('questions_json') or request.data
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if not questions:
            return Response(
                {'detail': 'At least one question with a title is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        video.questions_json = questions
        video.save(update_fields=['questions_json'])
        return Response(TrainingVideoSerializer(video, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='retranscribe')
    def retranscribe(self, request, pk=None):
        """Re-run speech-to-text on an existing uploaded video."""
        video = self.get_object()
        if not video.file:
            return Response({'detail': 'Video file missing.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            transcript = transcribe_media(
                video.file.path,
                original_name=video.original_name or 'training-video.mp4',
            )
            video.transcript = transcript
            video.save(update_fields=['transcript'])
        except EngineError as exc:
            return Response(
                {
                    'ok': False,
                    'error': str(exc),
                    'video': TrainingVideoSerializer(video, context={'request': request}).data,
                },
                status=exc.status_code if 400 <= exc.status_code < 600 else 502,
            )
        return Response(
            {
                'ok': True,
                'video': TrainingVideoSerializer(video, context={'request': request}).data,
            }
        )


class AmbassadorViewSet(viewsets.ModelViewSet):
    """HO: ambassador roster + create (returns invite training_url)."""

    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        from .city_scope import scope_for

        qs = scope_for(self.request.user).ambassadors(Ambassador.objects.select_related('created_by', 'store').all(), 'id')
        status_q = self.request.query_params.get('status')
        if status_q:
            qs = qs.filter(status__iexact=status_q)
        store_id = self.request.query_params.get('store')
        if store_id:
            qs = qs.filter(store_id=store_id)
        return qs

    def get_serializer_class(self):
        if self.action == 'create':
            return AmbassadorCreateSerializer
        return AmbassadorSerializer

    def create(self, request, *args, **kwargs):
        serializer = AmbassadorCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from .city_scope import scope_for

        # A city Head Office user's new BAs belong to their city (so they stay visible to them).
        city = scope_for(request.user).city
        ambassador = serializer.save(
            created_by=request.user, status=Ambassador.Status.PENDING, **({'city': city} if city else {})
        )
        out = AmbassadorSerializer(ambassador, context={'request': request})
        return Response(out.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        ambassador = self.get_object()
        before = {
            'name': ambassador.name,
            'email': ambassador.email,
            'city': ambassador.city,
            'phone': ambassador.phone,
            'is_active': ambassador.is_active,
            'is_demo': ambassador.is_demo,
            'is_backup': ambassador.is_backup,
            'status': ambassador.status,
        }
        changed = []
        for field in ('name', 'email', 'city', 'phone'):
            if field in request.data:
                value = str(request.data.get(field) or '').strip()
                if field == 'name' and not value:
                    return Response({'detail': 'Name is required.'}, status=status.HTTP_400_BAD_REQUEST)
                if field == 'email' and value and (
                    '@' not in value
                    or Ambassador.objects.filter(email__iexact=value).exclude(pk=ambassador.pk).exists()
                ):
                    return Response(
                        {'detail': 'Enter a valid email that no other ambassador uses.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                setattr(ambassador, field, value)
                changed.append(field)
        if 'is_active' in request.data:
            ambassador.is_active = str(request.data.get('is_active')).lower() in ('true', '1', 'yes')
            changed.append('is_active')
        if 'is_demo' in request.data:
            is_demo = str(request.data.get('is_demo')).lower() in ('true', '1', 'yes')
            ambassador.is_demo = is_demo
            changed.append('is_demo')
            # Demo accounts cannot be backups.
            if is_demo and ambassador.is_backup:
                ambassador.is_backup = False
                changed.append('is_backup')
        if 'is_backup' in request.data:
            is_backup = str(request.data.get('is_backup')).lower() in ('true', '1', 'yes')
            if is_backup and (not ambassador.is_active or ambassador.is_demo):
                return Response(
                    {'detail': 'Only available non-demo ambassadors can join the backup pool.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            ambassador.is_backup = is_backup
            changed.append('is_backup')
        if changed:
            ambassador.save(update_fields=[*changed, 'updated_at'])
        new_status = request.data.get('status')
        if new_status:
            allowed = {c.value for c in Ambassador.Status}
            if new_status not in allowed:
                return Response({'detail': 'Invalid status.'}, status=status.HTTP_400_BAD_REQUEST)
            if new_status == Ambassador.Status.DEPLOYED:
                return Response(
                    {'detail': 'Use POST /api/ambassadors/{id}/deploy/ with store_id.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            ambassador.status = new_status
            ambassador.save(update_fields=['status', 'updated_at'])
            if 'status' not in changed:
                changed.append('status')
        after = {
            'name': ambassador.name,
            'email': ambassador.email,
            'city': ambassador.city,
            'phone': ambassador.phone,
            'is_active': ambassador.is_active,
            'is_demo': ambassador.is_demo,
            'is_backup': ambassador.is_backup,
            'status': ambassador.status,
        }
        from .audit import changed_fields, log_mis_action
        from .models import MisAuditLog

        diff = changed_fields(before, after)
        if diff['before'] or diff['after']:
            log_mis_action(
                actor=request.user,
                action=MisAuditLog.Action.AMBASSADOR_EDIT,
                entity_type='ambassador',
                entity_id=ambassador.id,
                summary=f"Updated {', '.join(changed) or 'profile'} for {ambassador.name}",
                before=diff['before'],
                after=diff['after'],
                meta={'baName': ambassador.name, 'baCode': ambassador.ba_code or '', 'fields': changed},
                request=request,
            )
        return Response(AmbassadorSerializer(ambassador, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='deploy')
    def deploy(self, request, pk=None):
        """Deploy a certified (or already deployed) ambassador to a store."""
        ambassador = self.get_object()
        if ambassador.status not in (
            Ambassador.Status.CERTIFIED,
            Ambassador.Status.DEPLOYED,
        ):
            return Response(
                {'detail': 'Only certified ambassadors can be deployed to a store.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        store_id = request.data.get('store_id') or request.data.get('store')
        if not store_id:
            return Response({'detail': 'store_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        from .city_scope import scope_for

        store = scope_for(request.user).stores(Store.objects.all(), 'id').filter(pk=store_id).first()
        if not store:
            return Response({'detail': 'Store not found.'}, status=status.HTTP_404_NOT_FOUND)

        previous_store_id = ambassador.store_id
        ambassador.store = store
        ambassador.status = Ambassador.Status.DEPLOYED
        ambassador.deployed_at = timezone.now()
        ambassador.save(update_fields=['store', 'status', 'deployed_at', 'updated_at'])

        # Keep Store.bas roughly in sync with assigned ambassadors
        if previous_store_id and previous_store_id != store.id:
            prev = Store.objects.filter(pk=previous_store_id).first()
            if prev:
                prev.bas = Ambassador.objects.filter(
                    store_id=prev.id,
                    status=Ambassador.Status.DEPLOYED,
                ).count()
                prev.save(update_fields=['bas', 'updated_at'])

        store.bas = Ambassador.objects.filter(
            store_id=store.id,
            status=Ambassador.Status.DEPLOYED,
        ).count()
        store.save(update_fields=['bas', 'updated_at'])

        return Response(AmbassadorSerializer(ambassador, context={'request': request}).data)


@api_view(['GET'])
@permission_classes([AllowAny])
def ba_invite_lookup(request, token):
    ambassador = Ambassador.objects.filter(invite_token=token, is_active=True).first()
    if not ambassador:
        return Response({'detail': 'Invalid or expired invite link.'}, status=status.HTTP_404_NOT_FOUND)

    if ambassador.status == Ambassador.Status.PENDING:
        ambassador.status = Ambassador.Status.TRAINING
        ambassador.save(update_fields=['status', 'updated_at'])

    video = active_training_video()
    questions = video.normalized_questions() if video else []
    return Response(
        {
            'ambassador': AmbassadorSerializer(ambassador, context={'request': request}).data,
            'training': {
                'ready': bool(video and video.file and questions),
                'has_video': bool(video and video.file),
                'has_transcript': bool(video and (video.transcript or '').strip()),
                'has_questions': bool(questions),
                'question_count': len(questions),
                'original_name': video.original_name if video else None,
                'uploaded_at': video.created_at.isoformat() if video else None,
                'transcript_preview': ((video.transcript or '')[:280] if video else ''),
            },
            'certified': ambassador.status
            in (Ambassador.Status.CERTIFIED, Ambassador.Status.DEPLOYED),
        }
    )


@api_view(['GET'])
@permission_classes([AllowAny])
def ba_training_video(request):
    video = active_training_video()
    if not video or not video.file:
        return Response({'detail': 'No active training video.'}, status=status.HTTP_404_NOT_FOUND)
    return FileResponse(video.file.open('rb'), as_attachment=False, filename=video.original_name or 'training.mp4')


@api_view(['POST'])
@permission_classes([AllowAny])
def ba_create_session(request):
    token = (request.data.get('token') or '').strip()
    if not token:
        return Response({'detail': 'token is required'}, status=status.HTTP_400_BAD_REQUEST)

    ambassador = Ambassador.objects.filter(invite_token=token, is_active=True).first()
    if not ambassador:
        return Response({'detail': 'Invalid invite token.'}, status=status.HTTP_404_NOT_FOUND)

    video = active_training_video()
    if not video or not video.file:
        return Response(
            {'detail': 'No active training video. Head Office must upload one first.'},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    questions = video.normalized_questions()
    if not questions:
        return Response(
            {
                'detail': (
                    'Active training video has no assessment questions. '
                    'Head Office must upload questions with the video.'
                )
            },
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    # Questions are returned immediately. Transcription runs on upload and again
    # when the first answer is scored, so the BA is not left waiting here.
    transcript = (video.transcript or '').strip()

    if ambassador.status in (Ambassador.Status.PENDING,):
        ambassador.status = Ambassador.Status.TRAINING
        ambassador.save(update_fields=['status', 'updated_at'])

    session = AssessmentSession.objects.create(ambassador=ambassador)
    for i, q in enumerate(questions):
        AssessmentQuestion.objects.create(
            session=session,
            question_id=str(q['id']),
            question_type=q.get('type') or 'verbal',
            title=q.get('question') or '',
            description=q.get('description') or '',
            sort_order=i,
        )

    qs = AssessmentQuestion.objects.filter(session=session)
    return Response(
        {
            'sessionId': str(session.id),
            'candidateName': ambassador.name,
            'brand': 'Tapal',
            'questions': AssessmentQuestionSerializer(qs, many=True).data,
            'trainingReady': True,
            'transcriptLength': len(transcript),
            'questionSource': 'head_office',
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([AllowAny])
def ba_get_session(request, session_id):
    session = get_object_or_404(
        AssessmentSession.objects.prefetch_related('questions', 'answers__question'),
        pk=session_id,
    )
    answers = {
        a.question.question_id: AssessmentAnswerSerializer(a).data for a in session.answers.all()
    }
    return Response(
        {
            'sessionId': str(session.id),
            'candidateName': session.ambassador.name,
            'brand': 'Tapal',
            'status': session.status,
            'questions': AssessmentQuestionSerializer(session.questions.all(), many=True).data,
            'answers': answers,
        }
    )


@api_view(['POST'])
@permission_classes([AllowAny])
@parser_classes([MultiPartParser, FormParser])
def ba_submit_answer(request, session_id):
    session = get_object_or_404(
        AssessmentSession.objects.select_related('ambassador').prefetch_related('questions'),
        pk=session_id,
    )
    if session.status == AssessmentSession.Status.COMPLETED:
        return Response({'detail': 'Session already completed.'}, status=status.HTTP_400_BAD_REQUEST)

    audio = request.FILES.get('audio')
    if not audio:
        return Response({'detail': 'audio file required'}, status=status.HTTP_400_BAD_REQUEST)

    question_id = str(request.data.get('questionId') or request.data.get('question_id') or '')
    question = session.questions.filter(question_id=question_id).first()
    if not question:
        return Response({'detail': 'Invalid questionId'}, status=status.HTTP_400_BAD_REQUEST)

    video = active_training_video()
    training_script = ''
    if video:
        training_script = (video.transcript or '').strip()
        if not training_script and video.file:
            try:
                training_script = transcribe_media(
                    video.file.path,
                    original_name=video.original_name or 'training-video.mp4',
                )
                video.transcript = training_script
                video.save(update_fields=['transcript'])
            except EngineError:
                training_script = ''

    # Persist audio first
    answer, _created = AssessmentAnswer.objects.update_or_create(
        session=session,
        question=question,
        defaults={'question_title': question.title},
    )
    answer.audio_file.save(audio.name, audio, save=True)

    try:
        data = analyze_audio(
            answer.audio_file.path,
            question_id=question.question_id,
            question_title=question.title,
            question_description=question.description,
            training_script=training_script,
            original_name=audio.name,
            content_type=getattr(audio, 'content_type', None) or 'audio/webm',
        )
    except EngineError as exc:
        return Response({'detail': str(exc)}, status=exc.status_code)

    answer.transcript = data.get('transcript') or ''
    answer.communication_quality = data.get('communication_quality')
    answer.speaking_speed_wpm = data.get('speaking_speed_wpm')
    answer.filler_rate = data.get('filler_rate')
    answer.nervousness_pct = data.get('nervousness_pct')
    answer.dominant_mood = data.get('dominant_mood') or ''
    answer.affect_breakdown = data.get('affect_breakdown') or {}
    answer.speech_metrics = data.get('speech_metrics') or {}
    answer.linguistic_metrics = data.get('linguistic_metrics') or {}
    answer.question_relevance = data.get('question_relevance') or {}
    answer.video_relevance = data.get('video_relevance') or {}
    answer.analyzed_at = timezone.now()
    answer.save()

    if session.ambassador.status == Ambassador.Status.TRAINING:
        session.ambassador.status = Ambassador.Status.ASSESSED
        session.ambassador.save(update_fields=['status', 'updated_at'])

    return Response({'ok': True, 'answer': AssessmentAnswerSerializer(answer).data})


@api_view(['POST'])
@permission_classes([AllowAny])
def ba_finish_session(request, session_id):
    session = get_object_or_404(
        AssessmentSession.objects.select_related('ambassador').prefetch_related(
            'answers__question',
        ),
        pk=session_id,
    )
    answers = list(session.answers.all())
    if not answers:
        return Response({'detail': 'No answers submitted.'}, status=status.HTTP_400_BAD_REQUEST)

    report = aggregate_answers(answers)
    ambassador = apply_session_result(session, report)
    from .assessment import certification_threshold

    return Response(
        {
            'sessionId': str(session.id),
            'candidateName': ambassador.name,
            'brand': 'Tapal',
            'status': session.status,
            'ambassador_status': ambassador.status,
            'certified': ambassador.status
            in (Ambassador.Status.CERTIFIED, Ambassador.Status.DEPLOYED),
            'overall_score': ambassador.overall_score,
            'certification_threshold': certification_threshold(),
            **report,
        }
    )


@api_view(['GET'])
@permission_classes([AllowAny])
def ba_session_report(request, session_id):
    session = get_object_or_404(
        AssessmentSession.objects.select_related('ambassador').prefetch_related(
            'answers__question',
        ),
        pk=session_id,
    )
    if session.status != AssessmentSession.Status.COMPLETED:
        return Response({'detail': 'Report not ready.'}, status=status.HTTP_404_NOT_FOUND)

    report = session.report_json or aggregate_answers(list(session.answers.all()))
    ambassador = session.ambassador
    return Response(
        {
            'sessionId': str(session.id),
            'candidateName': ambassador.name,
            'brand': 'Tapal',
            'status': session.status,
            'ambassador_status': ambassador.status,
            'certified': ambassador.status
            in (Ambassador.Status.CERTIFIED, Ambassador.Status.DEPLOYED),
            'overall_score': ambassador.overall_score,
            **report,
        }
    )

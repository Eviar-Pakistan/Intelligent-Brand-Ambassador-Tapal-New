"""Assessment helpers: questions, report aggregation, certification."""

from __future__ import annotations

from django.conf import settings
from django.utils import timezone

from .models import Ambassador, AssessmentAnswer, AssessmentSession


def fallback_questions(training_transcript: str = '') -> list[dict]:
    snippet = ' '.join((training_transcript or '').split())[:350]
    if snippet:
        return [
            {
                'id': '1',
                'type': 'verbal',
                'question': 'Training takeaways',
                'description': (
                    '60 se 90 seconds mein training video ke ahem points bataiye. '
                    'Video mein yeh baatein cover hui thin — unhein yaad karke customers ko kya batana chahiye: '
                    f'{snippet}'
                ),
            },
        ]
    return [
        {
            'id': '1',
            'type': 'verbal',
            'question': 'Introduce Tapal',
            'description': (
                '60 se 90 seconds mein apne aap ko Tapal ke Brand Ambassador ke tor par introduce kijiye. '
                'Aap ke nazdeek Tapal khaas kyun hai?'
            ),
        },
    ]


def aggregate_answers(answers: list[AssessmentAnswer]) -> dict:
    if not answers:
        return {
            'communication_quality': 0,
            'speaking_speed_wpm': 0,
            'filler_rate': 0,
            'filler_percentage': 0,
            'nervousness_pct': 0,
            'dominant_mood': 'Neutral',
            'relevance_pct': 0,
            'video_relevance_pct': 0,
            'weakest_question_id': None,
            'transcript_sample': '',
            'answer_count': 0,
            'per_question': [],
        }

    def avg(key: str) -> float:
        return sum(float(getattr(a, key) or 0) for a in answers) / len(answers)

    moods: dict[str, int] = {}
    weakest = answers[0]
    for a in answers:
        m = a.dominant_mood or 'Neutral'
        moods[m] = moods.get(m, 0) + 1
        if float(a.communication_quality or 0) < float(weakest.communication_quality or 0):
            weakest = a

    dominant_mood = sorted(moods.items(), key=lambda x: x[1], reverse=True)[0][0]
    filler_rate = avg('filler_rate')
    relevance_pct = (
        sum(float((a.question_relevance or {}).get('relevance_pct') or 0) for a in answers)
        / len(answers)
    )
    video_relevance_pct = (
        sum(float((a.video_relevance or {}).get('relevance_pct') or 0) for a in answers)
        / len(answers)
    )

    per_question = []
    for a in answers:
        per_question.append(
            {
                'question_id': a.question.question_id,
                'question_title': a.question_title or a.question.title,
                'transcript': a.transcript,
                'communication_quality': a.communication_quality,
                'speaking_speed_wpm': a.speaking_speed_wpm,
                'filler_rate': a.filler_rate,
                'nervousness_pct': a.nervousness_pct,
                'dominant_mood': a.dominant_mood,
                'relevance_pct': (a.question_relevance or {}).get('relevance_pct'),
                'video_relevance_pct': (a.video_relevance or {}).get('relevance_pct'),
            }
        )

    return {
        'communication_quality': round(avg('communication_quality') * 10) / 10,
        'speaking_speed_wpm': round(avg('speaking_speed_wpm') * 10) / 10,
        'filler_rate': filler_rate,
        'filler_percentage': round(filler_rate * 1000) / 10,
        'nervousness_pct': round(avg('nervousness_pct') * 10) / 10,
        'relevance_pct': round(relevance_pct * 10) / 10,
        'video_relevance_pct': round(video_relevance_pct * 10) / 10,
        'dominant_mood': dominant_mood,
        'weakest_question_id': weakest.question.question_id,
        'transcript_sample': (weakest.transcript or '')[:180],
        'answer_count': len(answers),
        'per_question': per_question,
    }


def certification_threshold() -> float:
    """Live pass score from PlatformSettings (Admin UI), falling back to env default."""
    try:
        from .models import PlatformSettings

        return float(PlatformSettings.get_solo().certification_threshold)
    except Exception:
        return float(getattr(settings, 'BA_CERTIFICATION_THRESHOLD', 75))


def apply_session_result(session: AssessmentSession, report: dict) -> Ambassador:
    """Mark session completed and update ambassador status from overall score."""
    ambassador = session.ambassador
    score = float(report.get('communication_quality') or 0)
    threshold = certification_threshold()

    session.status = AssessmentSession.Status.COMPLETED
    session.report_json = report
    session.finished_at = timezone.now()
    session.save(update_fields=['status', 'report_json', 'finished_at'])

    ambassador.overall_score = score
    ambassador.report_json = report

    if ambassador.status != Ambassador.Status.DEPLOYED:
        if score >= threshold:
            ambassador.status = Ambassador.Status.CERTIFIED
            ambassador.certified_at = timezone.now()
        else:
            ambassador.status = Ambassador.Status.REJECTED
            ambassador.certified_at = None

    ambassador.save(
        update_fields=['overall_score', 'report_json', 'status', 'certified_at', 'updated_at'],
    )
    return ambassador

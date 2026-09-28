from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .ba_attendance_views import ba_check_in, ba_check_out, ba_leaderboard, ba_submit_complaint, ba_today_shift
from .ba_training_views import (
    AmbassadorViewSet,
    TrainingVideoViewSet,
    ba_create_session,
    ba_finish_session,
    ba_get_session,
    ba_invite_lookup,
    ba_session_report,
    ba_submit_answer,
    ba_training_video,
)
from .views import (
    ba_attendance,
    ba_targets,
    campaign_metrics,
    ConsumerViewSet,
    AmbassadorComplaintViewSet,
    MonthlyShiftViewSet,
    ShiftDayViewSet,
    StoreRewardViewSet,
    StoreViewSet,
    SurveyQuestionViewSet,
    intelligence_leaderboard,
    intelligence_overview,
    intelligence_store_map,
    manager_overview,
    platform_settings,
    shopper_create_consumer,
    shopper_store_lookup,
    shopper_store_rewards,
    shopper_survey_questions,
    shopper_update_consumer_feedback,
)

router = DefaultRouter()
router.register('stores', StoreViewSet, basename='store')
router.register('consumers', ConsumerViewSet, basename='consumer')
router.register('store-rewards', StoreRewardViewSet, basename='store-reward')
router.register('survey-questions', SurveyQuestionViewSet, basename='survey-question')
router.register('ambassador-complaints', AmbassadorComplaintViewSet, basename='ambassador-complaint')
router.register('training-videos', TrainingVideoViewSet, basename='training-video')
router.register('ambassadors', AmbassadorViewSet, basename='ambassador')
router.register('shifts', MonthlyShiftViewSet, basename='shift')
router.register('shift-days', ShiftDayViewSet, basename='shift-day')

urlpatterns = [
    path('intelligence/overview/', intelligence_overview, name='intelligence-overview'),
    path('intelligence/campaign-metrics/', campaign_metrics, name='campaign-metrics'),
    path('intelligence/store-map/', intelligence_store_map, name='intelligence-store-map'),
    path('intelligence/leaderboard/', intelligence_leaderboard, name='intelligence-leaderboard'),
    path('manager/overview/', manager_overview, name='manager-overview'),
    path('attendance/', ba_attendance, name='ba-attendance'),
    path('platform-settings/', platform_settings, name='platform-settings'),
    path('ba-targets/', ba_targets, name='ba-targets'),
    path('shopper/store/<slug:slug>/', shopper_store_lookup, name='shopper-store-lookup'),
    path(
        'shopper/store/<slug:slug>/rewards/',
        shopper_store_rewards,
        name='shopper-store-rewards',
    ),
    path('shopper/questions/', shopper_survey_questions, name='shopper-survey-questions'),
    path('shopper/consumers/', shopper_create_consumer, name='shopper-create-consumer'),
    path(
        'shopper/consumers/<int:pk>/feedback/',
        shopper_update_consumer_feedback,
        name='shopper-consumer-feedback',
    ),
    path('ba/invite/<str:token>/', ba_invite_lookup, name='ba-invite-lookup'),
    path('ba/today-shift/', ba_today_shift, name='ba-today-shift'),
    path('ba/check-in/', ba_check_in, name='ba-check-in'),
    path('ba/check-out/', ba_check_out, name='ba-check-out'),
    path('ba/complaints/', ba_submit_complaint, name='ba-submit-complaint'),
    path('ba/leaderboard/', ba_leaderboard, name='ba-leaderboard'),
    path('ba/training/video/', ba_training_video, name='ba-training-video'),
    path('ba/sessions/', ba_create_session, name='ba-create-session'),
    path('ba/sessions/<uuid:session_id>/', ba_get_session, name='ba-get-session'),
    path('ba/sessions/<uuid:session_id>/answers/', ba_submit_answer, name='ba-submit-answer'),
    path('ba/sessions/<uuid:session_id>/finish/', ba_finish_session, name='ba-finish-session'),
    path('ba/sessions/<uuid:session_id>/report/', ba_session_report, name='ba-session-report'),
    path('', include(router.urls)),
]

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .ba_attendance_views import (
    ba_check_in,
    ba_check_out,
    ba_footfall,
    ba_leaderboard,
    ba_submit_complaint,
    ba_today_shift,
    ba_undo_check_in,
)
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
from . import portal_views as portal
from . import push_views
from .views import (
    ba_attendance,
    ba_targets,
    sku_catalogue,
    ba_targets_template,
    ba_targets_upload,
    campaign_metrics,
    mis_audit_logs,
    mis_edit_attendance,
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
    path('attendance/mis-edit/', mis_edit_attendance, name='mis-edit-attendance'),
    path('mis-audit-logs/', mis_audit_logs, name='mis-audit-logs'),
    path('platform-settings/', platform_settings, name='platform-settings'),
    path('ba-targets/', ba_targets, name='ba-targets'),
    path('sku-catalogue/', sku_catalogue, name='sku-catalogue'),
    path('ba-targets/upload/', ba_targets_upload, name='ba-targets-upload'),
    path('ba-targets/template/', ba_targets_template, name='ba-targets-template'),
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
    path('ba/undo-check-in/', ba_undo_check_in, name='ba-undo-check-in'),
    path('ba/check-out/', ba_check_out, name='ba-check-out'),
    path('ba/footfall/', ba_footfall, name='ba-footfall'),
    path('ba/complaints/', ba_submit_complaint, name='ba-submit-complaint'),
    path('ba/leaderboard/', ba_leaderboard, name='ba-leaderboard'),
    path('ba/training/video/', ba_training_video, name='ba-training-video'),
    path('ba/sessions/', ba_create_session, name='ba-create-session'),
    path('ba/sessions/<uuid:session_id>/', ba_get_session, name='ba-get-session'),
    path('ba/sessions/<uuid:session_id>/answers/', ba_submit_answer, name='ba-submit-answer'),
    path('ba/sessions/<uuid:session_id>/finish/', ba_finish_session, name='ba-finish-session'),
    path('ba/sessions/<uuid:session_id>/report/', ba_session_report, name='ba-session-report'),
    # Supervisors (Head Office management, sign-in, portal)
    path('supervisors/', portal.supervisors, name='supervisors'),
    path('supervisors/overviews/', portal.supervisor_overviews, name='supervisor-overviews'),
    path('supervisors/<str:pk>/', portal.supervisor_detail, name='supervisor-detail'),
    path('supervisors/<str:pk>/password/', portal.supervisor_password, name='supervisor-password'),
    path('supervisor/login/', portal.supervisor_login, name='supervisor-login'),
    path('supervisor/logout/', portal.supervisor_logout, name='supervisor-logout'),
    path('supervisor/me/', portal.supervisor_me, name='supervisor-me'),
    path('supervisor/overview/', portal.supervisor_overview, name='supervisor-overview'),
    path('supervisor/notifications/', portal.supervisor_notifications, name='supervisor-notifications'),
    path('journey-plans/', portal.journey_plans, name='journey-plans'),
    path('journey-visits/', portal.journey_visits, name='journey-visits'),
    # Field data
    path('complaints/', portal.complaints, name='complaints'),
    path('complaints/<str:pk>/', portal.complaint_detail, name='complaint-detail'),
    path('daily-reports/', portal.daily_reports, name='daily-reports'),
    path('stock-board/', portal.stock_board, name='stock-board'),
    path('interceptions/', portal.interceptions, name='interceptions'),
    path('early-checkouts/', portal.early_checkouts, name='early-checkouts'),
    path('kpi-config/', portal.kpi_config, name='kpi-config'),
    path('ba/stores/', portal.ba_stores, name='ba-stores'),
    path('competitor-fields/', portal.competitor_fields, name='competitor-fields'),
    path('ba/me/', portal.ba_me, name='ba-me'),
    path('ba/training/practice/', portal.training_practice, name='ba-training-practice'),
    path('shopper/sessions/', portal.shopper_session, name='shopper-session'),
    path('ba/training/modules/', portal.training_modules, name='ba-training-modules'),
    path('push/register', push_views.push_register, name='push-register'),
    path('push/send', push_views.push_send, name='push-send'),
    path('push/inbox', push_views.push_inbox, name='push-inbox'),
    path('', include(router.urls)),
]

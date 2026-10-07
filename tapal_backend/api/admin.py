from django.contrib import admin

from .models import (
    Ambassador,
    AmbassadorComplaint,
    AmbassadorMonthTarget,
    BackupCoverage,
    AssessmentAnswer,
    AssessmentQuestion,
    AssessmentSession,
    CitySku,
    Consumer,
    MisAuditLog,
    PlatformSettings,
    MonthlyShift,
    ShiftAssignment,
    Store,
    StoreReward,
    SupervisorPushEvent,
    SupervisorPushToken,
    SurveyQuestion,
    TrainingVideo,
)


@admin.register(Store)
class StoreAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'store_code',
        'name',
        'city',
        'footfall',
        'status',
        'qr_slug',
        'coverage',
        'created_by',
        'created_at',
    )
    list_filter = ('city', 'footfall', 'status')
    search_fields = ('store_code', 'name', 'city', 'address', 'contact_name', 'contact_phone', 'qr_slug')
    readonly_fields = ('qr_slug', 'qr_image', 'created_at', 'updated_at')


@admin.register(StoreReward)
class StoreRewardAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'store',
        'label',
        'win_amount',
        'promo_code',
        'is_active',
        'is_featured',
        'sort_order',
    )
    list_filter = ('is_active', 'is_featured', 'store')
    search_fields = ('label', 'promo_code', 'store__name')
    list_editable = ('is_active', 'is_featured', 'sort_order')
    raw_id_fields = ('store',)


@admin.register(SurveyQuestion)
class SurveyQuestionAdmin(admin.ModelAdmin):
    list_display = ('store', 'order', 'text', 'is_active', 'created_at')
    list_editable = ('is_active',)
    ordering = ('order',)
    list_filter = ('store', 'is_active')
    search_fields = ('text', 'store__name')


@admin.register(Consumer)
class ConsumerAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'store',
        'name',
        'phone',
        'consent',
        'feedback_rating',
        'created_at',
    )
    list_filter = ('consent', 'store', 'created_at')
    search_fields = ('name', 'phone', 'store__name', 'store__qr_slug')
    readonly_fields = ('created_at', 'updated_at')
    raw_id_fields = ('store',)


@admin.register(AmbassadorComplaint)
class AmbassadorComplaintAdmin(admin.ModelAdmin):
    list_display = ('id', 'ambassador', 'store', 'status', 'created_at')
    list_filter = ('status', 'store', 'created_at')
    search_fields = ('complaint', 'ambassador__name', 'store__name')
    list_editable = ('status',)


@admin.register(PlatformSettings)
class PlatformSettingsAdmin(admin.ModelAdmin):
    list_display = ('id', 'certification_threshold', 'a_plus_threshold', 'updated_at', 'updated_by')
    readonly_fields = ('updated_at',)

    def has_add_permission(self, request):
        return not PlatformSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(TrainingVideo)
class TrainingVideoAdmin(admin.ModelAdmin):
    list_display = ('id', 'original_name', 'is_active', 'uploaded_by', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('original_name',)
    readonly_fields = ('created_at',)


@admin.register(AmbassadorMonthTarget)
class AmbassadorMonthTargetAdmin(admin.ModelAdmin):
    list_display = ('id', 'month', 'ambassador', 'store', 'target_total', 'sales_total')
    list_filter = ('month',)
    search_fields = ('ambassador__name', 'ambassador__ba_code', 'store__name', 'store__store_code')
    raw_id_fields = ('ambassador', 'store')


@admin.register(Ambassador)
class AmbassadorAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'ba_code',
        'name',
        'city',
        'status',
        'is_backup',
        'is_demo',
        'store',
        'overall_score',
        'invite_token',
        'created_at',
    )
    list_filter = ('status', 'city', 'store', 'is_backup', 'is_demo')
    search_fields = ('name', 'email', 'phone', 'ba_code', 'invite_token')
    readonly_fields = ('ba_code', 'invite_token', 'created_at', 'updated_at', 'certified_at', 'deployed_at')
    raw_id_fields = ('store', 'created_by')


@admin.register(AssessmentSession)
class AssessmentSessionAdmin(admin.ModelAdmin):
    list_display = ('id', 'ambassador', 'status', 'created_at', 'finished_at')
    list_filter = ('status',)
    raw_id_fields = ('ambassador',)


@admin.register(AssessmentQuestion)
class AssessmentQuestionAdmin(admin.ModelAdmin):
    list_display = ('id', 'session', 'question_id', 'title', 'sort_order')
    raw_id_fields = ('session',)


@admin.register(AssessmentAnswer)
class AssessmentAnswerAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'session',
        'question',
        'communication_quality',
        'dominant_mood',
        'analyzed_at',
    )
    raw_id_fields = ('session', 'question')


@admin.register(MonthlyShift)
class MonthlyShiftAdmin(admin.ModelAdmin):
    list_display = ('id', 'month', 'store', 'shift_label', 'ambassador', 'status')
    list_filter = ('status', 'month')
    search_fields = ('store__name', 'store__store_code', 'ambassador__name', 'ambassador__ba_code')
    raw_id_fields = ('store', 'ambassador', 'created_by')


@admin.register(ShiftAssignment)
class ShiftAssignmentAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'date',
        'day_key',
        'store',
        'shift_label',
        'ambassador',
        'covered_by',
        'report_owner',
        'status',
        'peak_recommended',
    )
    list_filter = ('status', 'day_key', 'peak_recommended', 'date')
    search_fields = ('store__name', 'ambassador__name', 'shift_label')
    raw_id_fields = ('store', 'ambassador', 'covered_by', 'coverage_of', 'report_owner', 'coverage_assigned_by', 'created_by')
    readonly_fields = ('checked_in_at', 'checked_out_at', 'check_in_lat', 'check_in_lng', 'check_in_accuracy_m')


@admin.register(BackupCoverage)
class BackupCoverageAdmin(admin.ModelAdmin):
    list_display = ('id', 'original_ba', 'backup_ba', 'store', 'starts_on', 'ends_on', 'assigned_by', 'ended_by')
    list_filter = ('store__city', 'store', 'starts_on', 'ends_on')
    search_fields = ('original_ba__name', 'backup_ba__name', 'store__name', 'store__store_code')
    raw_id_fields = ('monthly_shift', 'original_ba', 'backup_ba', 'store', 'assigned_by', 'ended_by')


from .models import (  # noqa: E402
    DailyReport,
    JourneyPlan,
    JourneyVisit,
    KpiConfig,
    Supervisor,
    SupervisorNotification,
    UserInterception,
)


@admin.register(Supervisor)
class SupervisorAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'email', 'city', 'created_at')
    search_fields = ('name', 'email', 'city')
    exclude = ('password',)


@admin.register(JourneyPlan)
class JourneyPlanAdmin(admin.ModelAdmin):
    list_display = ('id', 'supervisor', 'week_start', 'updated_at')
    list_filter = ('week_start',)


@admin.register(JourneyVisit)
class JourneyVisitAdmin(admin.ModelAdmin):
    list_display = ('id', 'supervisor', 'store', 'week_start', 'day', 'completed_at')
    list_filter = ('week_start', 'day')


@admin.register(SupervisorNotification)
class SupervisorNotificationAdmin(admin.ModelAdmin):
    list_display = ('id', 'supervisor', 'message', 'created_at')


@admin.register(DailyReport)
class DailyReportAdmin(admin.ModelAdmin):
    list_display = ('id', 'ba_name', 'submitted_by', 'store', 'source', 'submitted_at')
    list_filter = ('source',)
    search_fields = ('ba_name',)
    exclude = ('no_sales_confirmed',)  # for checking in the database only, not shown anywhere


@admin.register(UserInterception)
class UserInterceptionAdmin(admin.ModelAdmin):
    list_display = ('id', 'ba_name', 'store_name', 'name', 'contact', 'created_at')
    search_fields = ('ba_name', 'name', 'contact')


admin.site.register(KpiConfig)


@admin.register(SupervisorPushToken)
class SupervisorPushTokenAdmin(admin.ModelAdmin):
    list_display = ('id', 'supervisor_id', 'updated_at')
    search_fields = ('supervisor_id', 'token')


@admin.register(SupervisorPushEvent)
class SupervisorPushEventAdmin(admin.ModelAdmin):
    list_display = ('id', 'event_id', 'supervisor_id', 'title', 'created_at')
    search_fields = ('event_id', 'supervisor_id', 'title')
    list_filter = ('supervisor_id',)


@admin.register(CitySku)
class CitySkuAdmin(admin.ModelAdmin):
    list_display = ('sku', 'brand', 'city')
    list_filter = ('city',)
    search_fields = ('sku', 'brand', 'city')


@admin.register(MisAuditLog)
class MisAuditLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'created_at', 'actor_email', 'action', 'entity_type', 'entity_id', 'summary')
    list_filter = ('action', 'entity_type', 'created_at')
    search_fields = ('actor_email', 'actor_name', 'summary', 'entity_id')
    readonly_fields = (
        'actor',
        'actor_email',
        'actor_name',
        'action',
        'entity_type',
        'entity_id',
        'summary',
        'before',
        'after',
        'meta',
        'ip_address',
        'created_at',
    )

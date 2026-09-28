from django.contrib import admin

from .models import (
    Ambassador,
    AmbassadorComplaint,
    AmbassadorMonthTarget,
    AssessmentAnswer,
    AssessmentQuestion,
    AssessmentSession,
    Consumer,
    PlatformSettings,
    MonthlyShift,
    ShiftAssignment,
    Store,
    StoreReward,
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
        'store',
        'overall_score',
        'invite_token',
        'created_at',
    )
    list_filter = ('status', 'city', 'store')
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
        'status',
        'peak_recommended',
    )
    list_filter = ('status', 'day_key', 'peak_recommended', 'date')
    search_fields = ('store__name', 'ambassador__name', 'shift_label')
    raw_id_fields = ('store', 'ambassador', 'created_by')
    readonly_fields = ('checked_in_at', 'checked_out_at', 'check_in_lat', 'check_in_lng', 'check_in_accuracy_m')

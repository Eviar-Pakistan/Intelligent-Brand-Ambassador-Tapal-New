"""Keep each BA's store (their deployment) in step with their monthly shift for the current month."""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.utils import timezone

from .models import MonthlyShift


def _this_month(shift) -> bool:
    return shift.ambassador_id is not None and shift.month == timezone.localdate().strftime('%Y-%m')


@receiver(post_save, sender=MonthlyShift)
def shift_saved(sender, instance, **kwargs):
    if _this_month(instance):
        from .shifts import assign_ba_stores

        assign_ba_stores(instance.month, [instance.ambassador_id])


@receiver(post_delete, sender=MonthlyShift)
def shift_deleted(sender, instance, **kwargs):
    # Another shift this month (if any) becomes the BA's store; with none left the store is kept.
    if _this_month(instance):
        from .shifts import assign_ba_stores

        assign_ba_stores(instance.month, [instance.ambassador_id])

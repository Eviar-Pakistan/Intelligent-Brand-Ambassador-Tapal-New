"""A BA's month target total is whole kg (334.44 -> 334); SKU lines keep their exact kg."""

from decimal import ROUND_HALF_UP, Decimal

from django.db import migrations


def round_totals(apps, schema_editor):
    Target = apps.get_model('api', 'AmbassadorMonthTarget')
    for target in Target.objects.all():
        whole = Decimal(str(target.target_total)).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
        if whole != target.target_total:
            target.target_total = whole
            target.save(update_fields=['target_total'])


class Migration(migrations.Migration):
    dependencies = [('api', '0029_round_target_kg')]
    operations = [migrations.RunPython(round_totals, migrations.RunPython.noop)]

"""Round saved SKU target kg to 2 decimals (Excel formulas left values like 0.6000000000000001)."""

from decimal import ROUND_HALF_UP, Decimal

from django.db import migrations


def _kg2(value):
    try:
        return float(Decimal(str(float(value))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
    except (TypeError, ValueError):
        return value


def round_targets(apps, schema_editor):
    Target = apps.get_model('api', 'AmbassadorMonthTarget')
    for target in Target.objects.all():
        lines = []
        for line in target.lines or []:
            line = dict(line)
            for key in ('qty', 'sales'):
                if line.get(key) is not None:
                    line[key] = _kg2(line[key])
            if line.get('qty') is not None and line.get('grammage'):
                line['count'] = round(line['qty'] / float(line['grammage']), 2)
            lines.append(line)
        if lines != (target.lines or []):
            target.lines = lines
            target.save(update_fields=['lines'])


class Migration(migrations.Migration):
    dependencies = [('api', '0028_supervisor_password_copy')]
    operations = [migrations.RunPython(round_targets, migrations.RunPython.noop)]

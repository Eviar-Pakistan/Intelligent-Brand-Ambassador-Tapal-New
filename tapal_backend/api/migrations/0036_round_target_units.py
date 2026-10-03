"""Round saved SKU target units (pack counts) to whole numbers."""

from django.db import migrations


def round_units(apps, schema_editor):
    Target = apps.get_model('api', 'AmbassadorMonthTarget')
    for target in Target.objects.all():
        lines = []
        for line in target.lines or []:
            line = dict(line)
            if line.get('count') is not None:
                line['count'] = round(float(line['count']))
            lines.append(line)
        if lines != (target.lines or []):
            target.lines = lines
            target.save(update_fields=['lines'])


class Migration(migrations.Migration):
    dependencies = [('api', '0035_dailyreport_no_sales_confirmed')]
    operations = [migrations.RunPython(round_units, migrations.RunPython.noop)]

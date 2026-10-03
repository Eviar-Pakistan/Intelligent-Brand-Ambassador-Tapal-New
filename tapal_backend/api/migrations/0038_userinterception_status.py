"""Interception outcome: productive / trialist / non_productive (existing rows: productive when a SKU was bought)."""

from django.db import migrations, models


def fill_status(apps, schema_editor):
    Interception = apps.get_model('api', 'UserInterception')
    Interception.objects.filter(current_sku='').update(status='non_productive')


class Migration(migrations.Migration):
    dependencies = [('api', '0037_target_lines_kg_unit')]
    operations = [
        migrations.AddField(
            model_name='userinterception',
            name='status',
            field=models.CharField(
                choices=[('productive', 'Productive'), ('trialist', 'Trialist'), ('non_productive', 'Non-Productive')],
                default='productive',
                max_length=20,
            ),
        ),
        migrations.RunPython(fill_status, migrations.RunPython.noop),
    ]

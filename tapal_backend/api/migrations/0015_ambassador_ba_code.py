import secrets

from django.db import migrations, models

ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


def fill_ba_codes(apps, schema_editor):
    Ambassador = apps.get_model('api', 'Ambassador')
    used = set(Ambassador.objects.exclude(ba_code='').values_list('ba_code', flat=True))
    for row in Ambassador.objects.filter(ba_code=''):
        while True:
            code = 'BA-' + ''.join(secrets.choice(ALPHABET) for _ in range(6))
            if code not in used:
                used.add(code)
                row.ba_code = code
                row.save(update_fields=['ba_code'])
                break


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0014_ambassadorcomplaint'),
    ]

    operations = [
        migrations.AddField(
            model_name='ambassador',
            name='ba_code',
            field=models.CharField(blank=True, max_length=16),
        ),
        migrations.RunPython(fill_ba_codes, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='ambassador',
            name='ba_code',
            field=models.CharField(blank=True, max_length=16, unique=True),
        ),
    ]

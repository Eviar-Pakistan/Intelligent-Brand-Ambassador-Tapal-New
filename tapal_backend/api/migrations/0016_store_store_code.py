import secrets

from django.db import migrations, models

ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


def fill_store_codes(apps, schema_editor):
    Store = apps.get_model('api', 'Store')
    used = set(Store.objects.exclude(store_code='').values_list('store_code', flat=True))
    for row in Store.objects.filter(store_code=''):
        while True:
            code = 'ST-' + ''.join(secrets.choice(ALPHABET) for _ in range(6))
            if code not in used:
                used.add(code)
                row.store_code = code
                row.save(update_fields=['store_code'])
                break


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0015_ambassador_ba_code'),
    ]

    operations = [
        migrations.AddField(
            model_name='store',
            name='store_code',
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.RunPython(fill_store_codes, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='store',
            name='store_code',
            field=models.CharField(blank=True, max_length=32, unique=True),
        ),
    ]

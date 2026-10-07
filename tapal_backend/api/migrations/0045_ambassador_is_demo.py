from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0044_persistent_backup_coverage'),
    ]

    operations = [
        migrations.AddField(
            model_name='ambassador',
            name='is_demo',
            field=models.BooleanField(
                default=False,
                help_text='Demo account metadata; demo activity is kept in the browser and is not recorded as BA attendance.',
            ),
        ),
    ]

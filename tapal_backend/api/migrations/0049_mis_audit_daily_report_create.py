from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0048_userinterception_current_sku_text'),
    ]

    operations = [
        migrations.AlterField(
            model_name='misauditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('daily_report.edit', 'Edit daily report'),
                    ('daily_report.create', 'Create daily report'),
                    ('attendance.edit', 'Edit attendance'),
                    ('ambassador.edit', 'Edit ambassador'),
                ],
                db_index=True,
                max_length=64,
            ),
        ),
    ]

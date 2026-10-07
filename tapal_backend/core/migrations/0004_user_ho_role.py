from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0003_user_city'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='ho_role',
            field=models.CharField(
                choices=[('standard', 'Standard'), ('mis', 'MIS')],
                db_index=True,
                default='standard',
                help_text='Head Office only: standard (full UI) or mis (hides Dashboard & Stock).',
                max_length=20,
            ),
        ),
    ]

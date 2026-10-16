from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0050_mis_audit_ambassador_replace'),
    ]

    operations = [
        migrations.AddField(
            model_name='store',
            name='subtown',
            field=models.CharField(blank=True, max_length=100),
        ),
    ]

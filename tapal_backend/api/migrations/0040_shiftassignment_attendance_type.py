from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0039_competitorfieldconfig'),
    ]

    operations = [
        migrations.AddField(
            model_name='shiftassignment',
            name='attendance_type',
            field=models.CharField(
                choices=[('store', 'Store'), ('training', 'Training')],
                default='store',
                max_length=12,
            ),
        ),
    ]

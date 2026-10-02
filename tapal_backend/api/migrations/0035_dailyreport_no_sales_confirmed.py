from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0034_one_day_per_monthly_shift_mysql'),
    ]

    operations = [
        migrations.AddField(
            model_name='dailyreport',
            name='no_sales_confirmed',
            field=models.BooleanField(default=False),
        ),
    ]

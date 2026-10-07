from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0033_city_sku_not_unique'),
    ]

    operations = [
        migrations.AddField(
            model_name='citysku',
            name='brand',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
    ]

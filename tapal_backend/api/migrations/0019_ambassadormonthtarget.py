import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0018_monthly_shift'),
    ]

    operations = [
        migrations.CreateModel(
            name='AmbassadorMonthTarget',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('month', models.CharField(help_text='YYYY-MM', max_length=7)),
                ('target_total', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('sales_total', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('lines', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'ambassador',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='month_targets',
                        to='api.ambassador',
                    ),
                ),
                (
                    'store',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='month_targets',
                        to='api.store',
                    ),
                ),
            ],
            options={
                'ordering': ['store__name', 'ambassador__name'],
            },
        ),
        migrations.AddConstraint(
            model_name='ambassadormonthtarget',
            constraint=models.UniqueConstraint(
                fields=('ambassador', 'month'),
                name='unique_ambassador_month_target',
            ),
        ),
    ]

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0042_merge_20261006_1619'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='ambassador',
            name='is_backup',
            field=models.BooleanField(
                default=False,
                help_text='Available in the backup BA pool for covering another BA’s scheduled shift.',
            ),
        ),
        migrations.AddField(
            model_name='shiftassignment',
            name='covered_by',
            field=models.ForeignKey(
                blank=True,
                help_text='Backup BA assigned to cover this absent BA’s scheduled shift.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='covered_absences',
                to='api.ambassador',
            ),
        ),
        migrations.AddField(
            model_name='shiftassignment',
            name='coverage_of',
            field=models.OneToOneField(
                blank=True,
                help_text='The absent BA’s daily shift covered by this backup attendance record.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='backup_assignment',
                to='api.shiftassignment',
            ),
        ),
        migrations.AddField(
            model_name='shiftassignment',
            name='report_owner',
            field=models.ForeignKey(
                blank=True,
                help_text='BA whose targets and reports receive credit for this covered shift.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='credited_shift_reports',
                to='api.ambassador',
            ),
        ),
        migrations.AddField(
            model_name='shiftassignment',
            name='coverage_assigned_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='assigned_ba_coverages',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='shiftassignment',
            name='coverage_assigned_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='dailyreport',
            name='submitted_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='submitted_daily_reports',
                to='api.ambassador',
            ),
        ),
    ]

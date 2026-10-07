from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
from django.utils import timezone


def preserve_existing_daily_coverages(apps, schema_editor):
    ShiftAssignment = apps.get_model('api', 'ShiftAssignment')
    BackupCoverage = apps.get_model('api', 'BackupCoverage')
    db = schema_editor.connection.alias
    backups = (
        ShiftAssignment.objects.using(db)
        .filter(coverage_of__isnull=False)
        .select_related('coverage_of')
        .iterator()
    )
    for backup in backups:
        original = backup.coverage_of
        if not original or not original.monthly_shift_id or not backup.ambassador_id:
            continue
        coverage = BackupCoverage.objects.using(db).create(
            monthly_shift_id=original.monthly_shift_id,
            original_ba_id=original.ambassador_id,
            backup_ba_id=backup.ambassador_id,
            store_id=original.store_id,
            starts_on=backup.date,
            ends_on=backup.date,
            assigned_by_id=backup.coverage_assigned_by_id,
            assigned_at=backup.coverage_assigned_at,
            ended_at=backup.coverage_assigned_at or timezone.now(),
        )
        ShiftAssignment.objects.using(db).filter(pk=original.pk).update(coverage_assignment_id=coverage.pk)
        ShiftAssignment.objects.using(db).filter(pk=backup.pk).update(coverage_assignment_id=coverage.pk)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0043_backup_ba_coverage'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='BackupCoverage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('starts_on', models.DateField()),
                ('ends_on', models.DateField(blank=True, help_text='Last day the backup covers; blank means ongoing.', null=True)),
                ('assigned_at', models.DateTimeField(auto_now_add=True)),
                ('ended_at', models.DateTimeField(blank=True, null=True)),
                ('assigned_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='ba_backup_coverages', to=settings.AUTH_USER_MODEL)),
                ('backup_ba', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='backup_coverage_assignments', to='api.ambassador')),
                ('ended_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='ended_ba_coverages', to=settings.AUTH_USER_MODEL)),
                ('monthly_shift', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='backup_coverages', to='api.monthlyshift')),
                ('original_ba', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='backup_coverage_absences', to='api.ambassador')),
                ('store', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='ba_coverages', to='api.store')),
            ],
            options={'ordering': ['-starts_on', '-id']},
        ),
        migrations.AddIndex(
            model_name='backupcoverage',
            index=models.Index(fields=['original_ba', 'store', 'starts_on', 'ends_on'], name='api_bacov_orig_store_dates'),
        ),
        migrations.AddField(
            model_name='shiftassignment',
            name='coverage_assignment',
            field=models.ForeignKey(blank=True, help_text='Persistent coverage assignment that produced this daily attendance row.', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='daily_assignments', to='api.backupcoverage'),
        ),
        migrations.AddField(
            model_name='shiftassignment',
            name='coverage_cancelled',
            field=models.BooleanField(default=False, help_text='The planned backup attendance row was ended before the BA checked in; keep it as an audit record.'),
        ),
        migrations.RunPython(preserve_existing_daily_coverages, migrations.RunPython.noop),
    ]

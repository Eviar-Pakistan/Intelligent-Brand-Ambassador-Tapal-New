"""Rename SKU target line keys: qty -> kg, count -> unit."""

from django.db import migrations


def _rename(lines, old_to_new):
    out = []
    for line in lines or []:
        line = dict(line)
        for old, new in old_to_new.items():
            if old in line:
                line.setdefault(new, line[old])
                del line[old]
        out.append(line)
    return out


def _apply(apps, mapping):
    Target = apps.get_model('api', 'AmbassadorMonthTarget')
    for target in Target.objects.all():
        lines = _rename(target.lines, mapping)
        if lines != (target.lines or []):
            target.lines = lines
            target.save(update_fields=['lines'])


def forwards(apps, schema_editor):
    _apply(apps, {'qty': 'kg', 'count': 'unit'})


def backwards(apps, schema_editor):
    _apply(apps, {'kg': 'qty', 'unit': 'count'})


class Migration(migrations.Migration):
    dependencies = [('api', '0036_round_target_units')]
    operations = [migrations.RunPython(forwards, backwards)]

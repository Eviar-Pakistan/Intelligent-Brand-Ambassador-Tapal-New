from django.db import migrations, models


def ensure_is_demo_column(apps, schema_editor):
    """Repair half-applied 0045: add is_demo if missing, and set an explicit DEFAULT 0."""
    table = 'api_ambassador'
    connection = schema_editor.connection
    vendor = connection.vendor
    with connection.cursor() as cursor:
        if vendor == 'mysql':
            cursor.execute(
                """
                SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = %s
                  AND COLUMN_NAME = 'is_demo'
                """,
                [table],
            )
            exists = cursor.fetchone()[0] > 0
            if not exists:
                cursor.execute(
                    f'ALTER TABLE `{table}` ADD COLUMN `is_demo` bool NOT NULL DEFAULT 0'
                )
            else:
                cursor.execute(
                    f'ALTER TABLE `{table}` MODIFY COLUMN `is_demo` bool NOT NULL DEFAULT 0'
                )
            return

        # SQLite / others: only add when the column is missing.
        columns = {col.name for col in connection.introspection.get_table_description(cursor, table)}
        if 'is_demo' not in columns:
            cursor.execute(
                f'ALTER TABLE "{table}" ADD COLUMN "is_demo" bool NOT NULL DEFAULT 0'
            )


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0045_ambassador_is_demo'),
    ]

    operations = [
        migrations.RunPython(ensure_is_demo_column, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='ambassador',
            name='is_demo',
            field=models.BooleanField(
                default=False,
                help_text='Demo account metadata only. Demo activity is session-only and is not stored in the database.',
            ),
        ),
    ]

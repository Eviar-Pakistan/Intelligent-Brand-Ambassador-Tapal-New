from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0021_field_operations'),
    ]

    operations = [
        migrations.CreateModel(
            name='SupervisorPushToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('supervisor_id', models.CharField(db_index=True, max_length=64)),
                ('token', models.CharField(max_length=512)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['-updated_at'],
            },
        ),
        migrations.CreateModel(
            name='SupervisorPushEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_id', models.CharField(max_length=120, unique=True)),
                ('supervisor_id', models.CharField(db_index=True, max_length=64)),
                ('title', models.CharField(max_length=200)),
                ('body', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='supervisorpushtoken',
            constraint=models.UniqueConstraint(
                fields=('supervisor_id', 'token'),
                name='unique_supervisor_push_token',
            ),
        ),
    ]

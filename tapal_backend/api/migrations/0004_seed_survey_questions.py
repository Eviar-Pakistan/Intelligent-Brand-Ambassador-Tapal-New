from django.db import migrations


QUESTIONS = [
    {
        'order': 1,
        'text': 'Which tea do you currently use?',
        'options': ['Tapal Tea', 'Lipton', 'Supreme', 'Other / Local brand'],
    },
    {
        'order': 2,
        'text': 'How often do you drink tea at home?',
        'options': ['Daily', 'A few times a week', 'Once a week', 'Rarely'],
    },
    {
        'order': 3,
        'text': 'How many people in your household drink tea?',
        'options': ['1–2', '3–4', '5–6', '7 or more'],
    },
    {
        'order': 4,
        'text': 'What matters most when choosing tea?',
        'options': ['Taste & aroma', 'Price', 'Brand trust', 'Health benefits'],
    },
    {
        'order': 5,
        'text': 'Would you consider switching to Tapal Tea?',
        'options': ['Yes, definitely', 'Maybe', 'Not sure', 'No'],
    },
]


def seed_questions(apps, schema_editor):
    SurveyQuestion = apps.get_model('api', 'SurveyQuestion')
    for q in QUESTIONS:
        SurveyQuestion.objects.update_or_create(
            order=q['order'],
            defaults={
                'text': q['text'],
                'options': q['options'],
                'is_active': True,
            },
        )


def unseed_questions(apps, schema_editor):
    SurveyQuestion = apps.get_model('api', 'SurveyQuestion')
    SurveyQuestion.objects.filter(order__in=[1, 2, 3, 4, 5]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0003_surveyquestion_consumer'),
    ]

    operations = [
        migrations.RunPython(seed_questions, unseed_questions),
    ]

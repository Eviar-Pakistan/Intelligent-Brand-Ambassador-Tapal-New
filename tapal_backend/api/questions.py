"""Generate BA verbal questions from the active training video transcript."""

from __future__ import annotations

import json
import logging
import re

import httpx
from django.conf import settings

from .assessment import fallback_questions

logger = logging.getLogger(__name__)


def _brand() -> str:
    return getattr(settings, 'BRAND_NAME', None) or 'Tapal'


def _build_prompts(candidate_name: str, count: int, training_transcript: str) -> tuple[str, str]:
    brand = _brand()
    has_training = bool((training_transcript or '').strip())

    system_prompt = f"""
You are an interview coach hiring Brand Ambassadors for the brand "{brand}" (Tapal Tea).
Generate EXACTLY {count} spoken (verbal-only) interview questions.
No coding. No technical engineering questions. Audio answers only.

LANGUAGE (CRITICAL):
- "question": short title in ENGLISH only (e.g. "Importance of knowing Tapal Tea").
- "description": full spoken prompt in ROMAN URDU only (Latin alphabet), NOT Urdu/Arabic script.
  Example style: "60 se 90 seconds mein Tapal Tea ke baare mein bataiye ke BA ko kya jaanna chahiye?"
- Do NOT use Nastaliq/Arabic Urdu script anywhere in the JSON values.
- Candidates answer out loud in Urdu; keep the Roman Urdu prompt clear and speakable for 60–90 seconds.
- Prefer the brand name "Tapal" / "Tapal Tea" (not garbled spellings).

{
        'CRITICAL: Questions MUST be based on the TRAINING VIDEO transcript below (usually Urdu script). '
        'Ask about specific facts, product points, brand messages, or BA behaviors taught in that video. '
        'Do not invent product claims that are not supported by the transcript.'
        if has_training
        else f'Focus areas: Brand storytelling for {brand}, product appeal, customer engagement, BA presence.'
    }

REQUIRED JSON (raw, no markdown):
{{
  "questions": [
    {{
      "id": 1,
      "type": "verbal",
      "question": "Short English title",
      "description": "Poora sawal Roman Urdu mein jo candidate 60-90 seconds mein zabani jawab de"
    }}
  ]
}}
""".strip()

    if has_training:
        user_prompt = f"""
Candidate name: {candidate_name}
Brand: {brand}

TRAINING VIDEO TRANSCRIPT:
\"\"\"
{training_transcript[:12000]}
\"\"\"

Generate {count} spoken Brand Ambassador question(s): English title + Roman Urdu description, checking whether the candidate learned this training video.
""".strip()
    else:
        user_prompt = f"""
Candidate name: {candidate_name}
Brand: {brand}
Generate {count} Brand Ambassador interview questions: English title + Roman Urdu description.
""".strip()

    return system_prompt, user_prompt


def _parse_questions(raw: str) -> list[dict]:
    cleaned = (raw or '').strip()
    if cleaned.startswith('```'):
        cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)
    parsed = json.loads(cleaned or '{}')
    questions = parsed.get('questions') if isinstance(parsed, dict) else None
    if not isinstance(questions, list) or not questions:
        raise ValueError('No questions generated')
    return [
        {
            'id': str(q.get('id', i + 1)),
            'type': 'verbal',
            'question': q.get('question') or f'Question {i + 1}',
            'description': q.get('description') or q.get('question') or '',
        }
        for i, q in enumerate(questions)
        if isinstance(q, dict)
    ]


def _generate_openai(candidate_name: str, count: int, transcript: str) -> list[dict]:
    api_key = (getattr(settings, 'OPENAI_API_KEY', None) or '').strip()
    if not api_key or 'your_openai' in api_key:
        raise RuntimeError('OPENAI_API_KEY not configured')

    model = getattr(settings, 'OPENAI_MODEL', None) or 'gpt-4o-mini'
    system_prompt, user_prompt = _build_prompts(candidate_name, count, transcript)

    with httpx.Client(timeout=90.0) as client:
        res = client.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            json={
                'model': model,
                'temperature': 0.7,
                'response_format': {'type': 'json_object'},
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt},
                ],
            },
        )
    if res.status_code >= 400:
        raise RuntimeError(f'OpenAI error {res.status_code}: {res.text[:300]}')
    raw = res.json().get('choices', [{}])[0].get('message', {}).get('content') or '{}'
    return _parse_questions(raw)


def _generate_groq(candidate_name: str, count: int, transcript: str) -> list[dict]:
    api_key = (getattr(settings, 'GROQ_API_KEY', None) or '').strip()
    if not api_key or api_key.startswith('your_'):
        raise RuntimeError('GROQ_API_KEY not configured')

    model = getattr(settings, 'GROQ_CHAT_MODEL', None) or 'llama-3.3-70b-versatile'
    system_prompt, user_prompt = _build_prompts(candidate_name, count, transcript)

    with httpx.Client(timeout=90.0) as client:
        res = client.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            json={
                'model': model,
                'temperature': 0.7,
                'response_format': {'type': 'json_object'},
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt},
                ],
            },
        )
    if res.status_code >= 400:
        raise RuntimeError(f'Groq chat error {res.status_code}: {res.text[:300]}')
    raw = res.json().get('choices', [{}])[0].get('message', {}).get('content') or '{}'
    return _parse_questions(raw)


def generate_assessment_questions(
    candidate_name: str = 'Candidate',
    training_transcript: str = '',
    count: int = 1,
) -> list[dict]:
    """
    Prefer OpenAI (Tapal BA Linguistic), then Groq chat (BA Linguistic),
    then transcript-aware fallback.
    """
    errors: list[str] = []
    for label, fn in (
        ('openai', _generate_openai),
        ('groq', _generate_groq),
    ):
        try:
            questions = fn(candidate_name, count, training_transcript)
            if questions:
                logger.info('Generated %s assessment question(s) via %s', len(questions), label)
                return questions[:count]
        except Exception as exc:
            errors.append(f'{label}: {exc}')
            logger.warning('Question generation via %s failed: %s', label, exc)

    if errors:
        logger.warning('Using fallback questions (%s)', '; '.join(errors))
    return fallback_questions(training_transcript)[:count]

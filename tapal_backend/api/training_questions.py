"""Normalize HO-authored assessment questions from upload payloads."""

from __future__ import annotations

import json
from typing import Any


def parse_questions_payload(raw: Any) -> list[dict]:
    """
    Accept list / JSON string / form field and return normalized questions.
    Each item: {id, type, question, description}
    """
    if raw is None or raw == '':
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError('questions must be valid JSON') from exc
    if not isinstance(raw, list):
        raise ValueError('questions must be a list')

    out: list[dict] = []
    for i, item in enumerate(raw):
        if isinstance(item, str):
            title = item.strip()
            if not title:
                continue
            out.append(
                {
                    'id': f'q{i + 1}',
                    'type': 'verbal',
                    'question': title,
                    'description': '',
                }
            )
            continue
        if not isinstance(item, dict):
            continue
        title = str(item.get('question') or item.get('title') or '').strip()
        if not title:
            continue
        qid = str(item.get('id') or f'q{i + 1}').strip() or f'q{i + 1}'
        out.append(
            {
                'id': qid,
                'type': str(item.get('type') or 'verbal').strip() or 'verbal',
                'question': title,
                'description': str(item.get('description') or '').strip(),
            }
        )
    return out

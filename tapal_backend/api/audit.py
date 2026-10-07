"""Record MIS Head Office mutations for the audit log."""

from __future__ import annotations

from typing import Any

from .models import MisAuditLog


def _client_ip(request) -> str | None:
    if request is None:
        return None
    forwarded = (request.META.get('HTTP_X_FORWARDED_FOR') or '').split(',')[0].strip()
    return forwarded or request.META.get('REMOTE_ADDR') or None


def changed_fields(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Return only keys whose values differ (for compact before/after payloads)."""
    keys = set(before) | set(after)
    out_before: dict[str, Any] = {}
    out_after: dict[str, Any] = {}
    for key in keys:
        if before.get(key) != after.get(key):
            out_before[key] = before.get(key)
            out_after[key] = after.get(key)
    return {'before': out_before, 'after': out_after}


def log_mis_action(
    *,
    actor,
    action: str,
    entity_type: str = '',
    entity_id: str | int = '',
    summary: str = '',
    before: dict | None = None,
    after: dict | None = None,
    meta: dict | None = None,
    request=None,
) -> MisAuditLog | None:
    """Persist one MIS action. No-op unless the actor is an MIS Head Office user."""
    if not actor or not getattr(actor, 'is_authenticated', False):
        return None
    if not getattr(actor, 'is_mis', False):
        return None

    email = (getattr(actor, 'email', None) or '').strip()
    try:
        name = (actor.get_full_name() or '').strip()
    except Exception:
        name = ''
    if not name:
        name = email or str(getattr(actor, 'pk', ''))

    return MisAuditLog.objects.create(
        actor=actor,
        actor_email=email[:254],
        actor_name=name[:200],
        action=action,
        entity_type=(entity_type or '')[:64],
        entity_id=str(entity_id or '')[:64],
        summary=(summary or '')[:500],
        before=before or {},
        after=after or {},
        meta=meta or {},
        ip_address=_client_ip(request),
    )

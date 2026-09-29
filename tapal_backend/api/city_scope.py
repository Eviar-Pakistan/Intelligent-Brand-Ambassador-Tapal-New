"""
City-scoped Head Office users.

A Head Office user with no city sees everything. A Head Office user with a city (e.g. Lahore)
sees the same screens but only that city's data:
  stores       — stores in that city
  ambassadors  — BAs whose city is that city, who are deployed to one of those stores,
                 or who have a monthly shift at one of them
  everything else (shifts, attendance, shoppers, complaints, reports, supervisors, dashboards)
  follows from those stores and BAs.

Every Head Office endpoint applies this on the server, so it cannot be bypassed from the browser.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db.models import Q


@dataclass(frozen=True)
class CityScope:
    city: str = ''
    store_ids: frozenset[int] | None = None
    ambassador_ids: frozenset[int] | None = None

    @property
    def is_all(self) -> bool:
        return self.store_ids is None

    def stores(self, qs, field: str = 'store_id'):
        """Keep rows whose store is in scope. `field` is the store column, e.g. 'id' on Store."""
        return qs if self.store_ids is None else qs.filter(**{f'{field}__in': self.store_ids})

    def ambassadors(self, qs, field: str = 'ambassador_id'):
        return qs if self.ambassador_ids is None else qs.filter(**{f'{field}__in': self.ambassador_ids})

    def allows_store(self, store_id) -> bool:
        return self.store_ids is None or (store_id is not None and int(store_id) in self.store_ids)

    def allows_ambassador(self, ambassador_id) -> bool:
        return self.ambassador_ids is None or (ambassador_id is not None and int(ambassador_id) in self.ambassador_ids)


ALL = CityScope()


def user_city(user) -> str:
    return (getattr(user, 'city', '') or '').strip()


def scope_for_city(city: str) -> CityScope:
    from .models import Ambassador, Store

    city = (city or '').strip()
    if not city:
        return ALL
    store_ids = frozenset(Store.objects.filter(city__iexact=city).values_list('id', flat=True))
    ambassador_ids = frozenset(
        Ambassador.objects.filter(
            Q(city__iexact=city) | Q(store_id__in=store_ids) | Q(monthly_shifts__store_id__in=store_ids)
        )
        .values_list('id', flat=True)
        .distinct()
    )
    return CityScope(city=city, store_ids=store_ids, ambassador_ids=ambassador_ids)


def scope_for(user) -> CityScope:
    """The scope of a signed-in Head Office user (everything when they have no city)."""
    if not user or not getattr(user, 'is_authenticated', False):
        return ALL
    return scope_for_city(user_city(user))


def scope_for_supervisor(supervisor) -> CityScope:
    """A supervisor sees their own stores and the BAs working there (shifts or deployment)."""
    from .models import Ambassador

    store_ids = frozenset(supervisor.stores.values_list('id', flat=True))
    ambassador_ids = frozenset(
        Ambassador.objects.filter(Q(store_id__in=store_ids) | Q(monthly_shifts__store_id__in=store_ids))
        .values_list('id', flat=True)
        .distinct()
    )
    return CityScope(city='', store_ids=store_ids, ambassador_ids=ambassador_ids)


def viewer_scope(request) -> tuple[CityScope, bool] | None:
    """(scope, is_supervisor) for a signed-in supervisor (X-Supervisor-Token) or Head Office; None otherwise."""
    from .portal_views import _supervisor_from_header

    supervisor = _supervisor_from_header(request)
    if supervisor:
        return scope_for_supervisor(supervisor), True
    user = getattr(request, 'user', None)
    if user and user.is_authenticated:
        preview = (request.query_params.get('supervisor') or '').strip()
        if preview:  # Head Office previewing a supervisor's portal (only supervisors in their city)
            from .portal_views import _visible_supervisors

            found = _visible_supervisors(scope_for(user)).filter(pk=preview).first()
            return (scope_for_supervisor(found), False) if found else None
        return scope_for(user), False
    return None


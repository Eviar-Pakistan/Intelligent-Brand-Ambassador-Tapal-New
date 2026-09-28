"""Match BA targets.xlsx columns to stores and save September targets."""

from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from django.db import transaction

from .models import Ambassador, AmbassadorMonthTarget, Store

MONTH = '2026-09'

# (name fragment, area fragment, needle inside the store name)
# Longer name+area wins when a column could match more than one rule.
RULES: list[tuple[str, str, str]] = [
    ('hamza mart', 'walton', 'hamza mart'),
    ('victoria', 'model', 'victoria'),
    ('al fatah', 'gold crest', 'gold crest'),
    ('al fatah', 'hussain', 'hussain chowk'),
    ('al fatah', 'johar', 'johar'),
    ('al fatah', 'valencia', 'valencia'),
    ('fine', 'walton', 'fine store'),
    ('4 seasons', 'raiwind', '4 seasons'),
    ('rainbow', 'defence', 'defence'),
    ('raja', 'wapda', 'raja sahib'),
    ('rahim', 'wapda', 'rahim store (wapda'),
    ('altaf', 'baldia', 'altaf'),
    ('punjab', 'askari 10', 'askari x'),
    ('punjab', 'askari xi', 'carry xl'),
    ('luft', '', 'luft'),
    ('rise', 'dha', 'dha lahore'),
    ('rise', 'fateh', 'fateh'),
    ('rise', 'sharqpur', 'sharqpur'),
    ('naimat', '', 'naimat'),
    ('rise', 'manawan', '(manawa)'),
    ('rise', 'shad', 'shad bagh'),
    ('rise', 'gajumatta', 'gajumatta'),
    ('decent', 'wahdat', 'decent'),
    ('imperia', '', 'imperia'),
    ('naqshbandi', 'multan', 'naqshbandi'),
    ('rahim', 'iqbal', 'iqbal'),
    ('rise', 'sabzazar', 'sabzazar'),
    ('rise', 'thokar', 'thokar'),
    ('euro', 'garhi', 'garhi'),
    ('swera', 'link', 'baghbanpura'),
    ('swera', 'shadman', 'shadman'),
    ('punjab super', '', 'punjab super'),
    ('shehzad', 'jinnah', 'shehzad'),
    ('mega mall', '', 'mega mall'),
    ('rainbow', 'eme', 'eme'),
    ('umer', '', 'umer'),
    ('punjab', 'kataria', 'carry manawan'),
    ('alfatah', 'dolmen', 'dolmen'),
    ('al fatah', 'dolmen', 'dolmen'),
    ('rainbow', 'wapda', 'rainbow (wapda'),
    ('alfazal', '', 'alfazal'),
]


def light(value: str) -> str:
    text = (value or '').lower().replace('&', ' and ')
    text = re.sub(r'[-/]+', ' ', text)
    for old, new in (
        ('risen', 'rise'),
        ('raheem', 'rahim'),
        ('shaahzad', 'shehzad'),
        ('naqashbandi', 'naqshbandi'),
        ('naqsbandi', 'naqshbandi'),
        ('neamat', 'naimat'),
        ('lutf', 'luft'),
        ('gharhi', 'garhi'),
        ('sharaqpur', 'sharqpur'),
        ('fathe', 'fateh'),
        ('gajjumata', 'gajumatta'),
        ('askri', 'askari'),
        ('raod', 'road'),
    ):
        text = text.replace(old, new)
    return re.sub(r'\s+', ' ', text).strip()


def compact(value: str) -> str:
    return light(value).replace(' ', '')


def _contains(haystack: str, needle: str) -> bool:
    if not needle:
        return True
    return needle in haystack or needle.replace(' ', '') in haystack.replace(' ', '')


def rule_for_column(label: str, area: str) -> tuple[str, str, str] | None:
    lab = light(label)
    ar = light(area)
    matches = [
        rule
        for rule in RULES
        if _contains(lab, rule[0]) and _contains(ar, rule[1])
    ]
    if not matches:
        return None
    return max(matches, key=lambda rule: len(rule[0]) + len(rule[1]))


def stores_for_needle(stores: list[Store], needle: str) -> list[Store]:
    return [store for store in stores if _contains(light(store.name), needle)]


def _qty(value) -> Decimal | None:
    if value is None or value == '':
        return Decimal('0')
    if isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except Exception:
        return None
    return number.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def read_columns(path: Path) -> list[dict]:
    import openpyxl

    workbook = openpyxl.load_workbook(path, data_only=True)
    sheet = workbook.active
    columns = []
    for col in range(2, sheet.max_column + 1):
        label = sheet.cell(1, col).value
        area = sheet.cell(2, col).value
        if not label:
            continue
        lines = []
        for row in range(3, sheet.max_row):
            sku = sheet.cell(row, 1).value
            if sku is None or str(sku).strip() == '':
                continue
            qty = _qty(sheet.cell(row, col).value)
            if qty is None:
                continue
            lines.append({'sku': str(sku).strip(), 'qty': float(qty)})
        total = sum((Decimal(str(line['qty'])) for line in lines), Decimal('0'))
        total = total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        columns.append(
            {
                'label': str(label).strip(),
                'area': str(area or '').strip(),
                'lines': lines,
                'total': total,
            }
        )
    return columns


def match_columns(columns: list[dict], stores: list[Store]) -> tuple[list[dict], list[str], list[str]]:
    matched = []
    unmatched = []
    used_store_ids: set[int] = set()
    for column in columns:
        rule = rule_for_column(column['label'], column['area'])
        hits = stores_for_needle(stores, rule[2]) if rule else []
        title = f"{column['label']} / {column['area']}"
        if len(hits) != 1:
            unmatched.append(title)
            continue
        store = hits[0]
        used_store_ids.add(store.id)
        matched.append({**column, 'store': store, 'needle': rule[2]})
    unused = [store.name for store in stores if store.id not in used_store_ids]
    return matched, unmatched, unused


@transaction.atomic
def import_september_targets(path: Path) -> dict:
    stores = list(Store.objects.all())
    columns = read_columns(path)
    matched, unmatched, unused = match_columns(columns, stores)
    saved = 0
    skipped_no_ba = []
    for column in matched:
        store = column['store']
        ambassadors = list(Ambassador.objects.filter(store=store))
        if not ambassadors:
            skipped_no_ba.append(store.name)
            continue
        for ambassador in ambassadors:
            AmbassadorMonthTarget.objects.update_or_create(
                ambassador=ambassador,
                month=MONTH,
                defaults={
                    'store': store,
                    'target_total': column['total'],
                    'sales_total': Decimal('0'),
                    'lines': column['lines'],
                },
            )
            saved += 1
    return {
        'saved': saved,
        'matched_stores': len(matched),
        'unmatched_columns': unmatched,
        'unused_stores': unused,
        'skipped_no_ba': skipped_no_ba,
    }

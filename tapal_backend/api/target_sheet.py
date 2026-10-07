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
            lines.append({'sku': str(sku).strip(), 'kg': float(qty)})
        total = sum((Decimal(str(line['kg'])) for line in lines), Decimal('0'))
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



# ─── Store SKU target sheet (Region | City | Store name | Brand | SKU Name | KG Count | Count | Grammage) ──

SKU_SHEET_HEADERS = {
    'region': 'region',
    'city': 'city',
    'store name': 'store',
    'brand': 'brand',
    'sku name': 'sku',
    'kg count': 'kg',
    'grammage': 'grammage',
}


def _header(value) -> str:
    return re.sub(r'\s+', ' ', str(value or '').replace('*', '')).strip().lower()


def read_store_sku_sheet(file) -> tuple[dict[str, dict], list[str]]:
    """
    Reads the per-store SKU sheet. Returns {store name: {city, lines: [...]}} and row problems.
    KG Count is the target in kg; Count (packs) = KG / Grammage, worked out here.
    """
    import openpyxl

    try:
        workbook = openpyxl.load_workbook(file, data_only=True, read_only=True)
    except Exception:
        return {}, ['This file could not be read. Upload the .xlsx target sheet.']
    rows = workbook.active.iter_rows(values_only=True)
    header = next(rows, None) or ()
    columns = {SKU_SHEET_HEADERS[_header(h)]: i for i, h in enumerate(header) if _header(h) in SKU_SHEET_HEADERS}
    if any(name not in columns for name in ('store', 'sku', 'kg')):
        return {}, ['The sheet needs the columns: Store name, SKU Name and KG Count (plus Brand, City, Grammage).']

    def cell(row, key):
        index = columns.get(key)
        return row[index] if index is not None and index < len(row) else None

    stores: dict[str, dict] = {}
    problems: list[str] = []
    for number, row in enumerate(rows, start=2):
        store = str(cell(row, 'store') or '').strip()
        sku = str(cell(row, 'sku') or '').strip()
        if not store or not sku:
            continue
        kg = _qty(cell(row, 'kg'))
        if kg is None or kg < 0:
            problems.append(f'Row {number} ({sku}): KG Count must be a number.')
            continue
        try:
            grams = float(cell(row, 'grammage') or 0)
        except (TypeError, ValueError):
            grams = 0.0
        entry = stores.setdefault(store, {'city': str(cell(row, 'city') or '').strip(), 'lines': []})
        entry['lines'].append(
            {
                'sku': sku,
                'brand': str(cell(row, 'brand') or '').strip(),
                'kg': float(kg),
                'grammage': grams,
                # packs = kg / kg-per-pack (the sheet's Count column); None when grammage is 0
                'unit': round(float(kg) / grams) if grams > 0 else None,
            }
        )
    return stores, problems


def _without_city_suffix(name: str, city: str) -> str:
    """'Al Latif Super Store (Multan)' -> 'Al Latif Super Store' when Multan is the store's city."""
    match = re.fullmatch(r'(.*?)\s*\(([^()]*)\)\s*', name)
    if match and city and match.group(2).strip().lower() == city.strip().lower():
        return match.group(1)
    return name


def _find_store(name: str, city: str, candidates) -> Store | None:
    exact = [s for s in candidates if s.name.strip().lower() == name.strip().lower()]
    if len(exact) == 1:
        return exact[0]
    if city:
        in_city = [s for s in candidates if s.city.strip().lower() == city.strip().lower()]
        candidates = in_city or candidates
    # Spacing / hyphens / capitals ignored ("Al-Latif" = "Al Latif"), and a trailing "(City)" dropped.
    wanted = {compact(name), compact(_without_city_suffix(name, city))}
    loose = [s for s in candidates if compact(s.name) in wanted or compact(_without_city_suffix(s.name, s.city)) in wanted]
    return loose[0] if len(loose) == 1 else None


def store_bas_for_month(store: Store, month: str) -> list[Ambassador]:
    """The BAs of a store for a month: their monthly shift there, or their deployment to it."""
    from .models import MonthlyShift

    ids = set(
        MonthlyShift.objects.filter(store=store, month=month, ambassador__isnull=False).values_list(
            'ambassador_id', flat=True
        )
    )
    ids |= set(Ambassador.objects.filter(store=store).values_list('id', flat=True))
    return list(Ambassador.objects.filter(id__in=ids).order_by('name'))


@transaction.atomic
def import_store_sku_targets(file, month: str, scope=None) -> dict:
    """Save each store's SKU targets for `month` on every BA of that store."""
    sheet, problems = read_store_sku_sheet(file)
    candidates = list(scope.stores(Store.objects.all(), 'id') if scope is not None else Store.objects.all())
    saved, stores_done, unmatched, no_ba, empty = [], [], [], [], []
    for name, data in sheet.items():
        store = _find_store(name, data['city'], candidates)
        if not store:
            unmatched.append(name)
            continue
        total = sum((Decimal(str(line['kg'])) for line in data['lines']), Decimal('0'))
        total = total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if total == 0:
            empty.append(store.name)
            continue
        bas = store_bas_for_month(store, month)
        if not bas:
            no_ba.append(store.name)
            continue
        for ba in bas:
            AmbassadorMonthTarget.objects.update_or_create(
                ambassador=ba,
                month=month,
                defaults={
                    'store': store,
                    'target_total': total,
                    'lines': data['lines'],
                },
            )
            recompute_target_sales(ba.id, month)  # sales come from the BA's Daily Sales reports
            saved.append({'baName': ba.name, 'baCode': ba.ba_code, 'store': store.name, 'targetKg': float(total)})
        stores_done.append(store.name)
    return {
        'month': month,
        'saved': saved,
        'stores': stores_done,
        'unmatched_stores': unmatched,
        'stores_without_ba': no_ba,
        'stores_with_empty_kg': empty,
        'row_problems': problems,
    }



# ─── Downloadable SKU target template (same layout the upload reads) ────────

# The SKUs that exist: brand, SKU name, grammage (kg per pack). BA targets can only use these.
SKU_CATALOGUE: list[tuple[str, str, float]] = [
    ('Danedar', 'DD 100gm Tea Bag', 0.1),
    ('Danedar', 'DD 100gm Tea Bag Envelope', 0.1),
    ('Danedar', 'DD 1200gm Tea Bag OOH', 1.2),
    ('Danedar', 'DD 3IN1 Elaichi 200gm', 0.2),
    ('Danedar', 'DD 3IN1 Elachi Box 200gm', 0.2),
    ('Danedar', 'DD 170gm Hard Pack', 0.17),
    ('Danedar', 'DD 170gm Pouch', 0.17),
    ('Danedar', 'DD 1750gm Pouch', 1.75),
    ('Danedar', 'DD 200gm Jar Pack', 0.2),
    ('Danedar', 'DD 200gm RTB', 0.2),
    ('Danedar', 'DD 200gm Tea Bag', 0.2),
    ('Danedar', 'DD 200gm Tea Bag Envelope', 0.2),
    ('Danedar', 'DD 350gm Pouch', 0.35),
    ('Danedar', 'DD 3IN1 Elachi sachet 20gms', 0.02),
    ('Danedar', 'DD 40gm RTB', 0.04),
    ('Danedar', 'DD 400gm Pillow Pack', 0.4),
    ('Danedar', 'DD 430gm Pouch', 0.43),
    ('Danedar', 'DD 440gm Jar Pack New', 0.44),
    ('Danedar', 'DD 49gm Hard Pack', 0.049),
    ('Danedar', 'DD 50gm Tea Bag', 0.05),
    ('Danedar', 'DD 85gm Hard Pack', 0.085),
    ('Danedar', 'DD 900gm Pouch', 0.9),
    ('Danedar', 'DD 900gm Collectible Pack', 0.9),
    ('Danedar', 'DD Elaichi 170gm Hard Pack', 0.17),
    ('Danedar', 'DD Elaichi 80gm Hard Pack', 0.08),
    ('Danedar', 'DD Elaichi 100gm Tea Bag Envelope', 0.1),
    ('Green Tea', 'Elaichi 45gm', 0.045),
    ('Family Mixture', 'FM 170gm Hard Pack', 0.17),
    ('Family Mixture', 'FM 1750gm Pouch', 1.75),
    ('Family Mixture', 'FM 430gm Pouch', 0.43),
    ('Family Mixture', 'FM 440gm Jar Pack', 0.44),
    ('Family Mixture', 'FM 80gm Hard Pack', 0.08),
    ('Family Mixture', 'FM 85gm Hard Pack', 0.085),
    ('Family Mixture', 'FM 900gm Pouch', 0.9),
    ('Green Tea', 'Ginger Honey 45gm', 0.045),
    ('Green Tea', 'Gulbahar 80gm Hard Pack', 0.08),
    ('Green Tea', 'Jasmine 100gm', 0.1),
    ('Green Tea', 'Jasmine 45gm', 0.045),
    ('Green Tea', 'Lemon 135gm', 0.135),
    ('Green Tea', 'Lemon 45gm', 0.045),
    ('Green Tea', 'Lemon Grass 100gm', 0.1),
    ('Green Tea', 'Orange 45gm', 0.045),
    ('Green Tea', 'Pineapple 45gm', 0.045),
    ('Green Tea', 'Mango 45gm', 0.045),
    ('Green Tea', 'Mint 45gm', 0.045),
    ('Green Tea', 'Pure Green 45gm', 0.045),
    ('Green Tea', 'SOG 48gm', 0.048),
    ('Green Tea', 'Strawberry 45gm', 0.045),
    ('Tezdum', 'TD 170gm Hard Pack', 0.17),
    ('Tezdum', 'TD 170gm Pouch Pack', 0.17),
    ('Tezdum', 'TD 1750gm Pouch', 1.75),
    ('Tezdum', 'TD 290gm Pouch', 0.29),
    ('Tezdum', 'TD 430gm Pouch', 0.43),
    ('Tezdum', 'TD 80gm Hard Pack', 0.08),
    ('Tezdum', 'TD 900gm Pouch', 0.9),
    ('Green Tea', 'Tropical Peach 45gm', 0.045),
    ('Insta Brew', 'Tapal Insta Brew 750gm', 0.75),
]

TEMPLATE_HEADERS = ['Region', 'City', 'Store name', 'Brand', 'SKU Name', 'KG Count', 'Count', 'Grammage', 'BA']


def build_sku_target_template(month: str, scope=None) -> bytes:
    """
    Excel template in the store SKU sheet layout: one block of SKU rows per store (the user's
    city only), with that store's BA(s) for the month shown. Existing targets for the month are
    pre-filled in KG Count. Fill KG Count and upload it again.
    """
    from io import BytesIO

    import openpyxl
    from openpyxl.styles import Font, PatternFill

    stores = list((scope.stores(Store.objects.all(), 'id') if scope is not None else Store.objects.all()).order_by('city', 'name'))
    with_ba = [(store, store_bas_for_month(store, month)) for store in stores]
    # Stores that have a BA this month first; if none do, still list every store.
    blocks = [(s, bas) for s, bas in with_ba if bas] or with_ba

    existing: dict[int, dict[str, float]] = {}
    for target in AmbassadorMonthTarget.objects.filter(month=month, store_id__in=[s.id for s, _ in blocks]):
        existing.setdefault(target.store_id, {line.get('sku'): line.get('kg') for line in (target.lines or [])})

    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = 'Targets'
    sheet.append(TEMPLATE_HEADERS)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    yellow = PatternFill('solid', fgColor='FFFF00')
    for store, bas in blocks:
        ba_names = ', '.join(f'{b.name} ({b.ba_code})' for b in bas)
        filled = existing.get(store.id, {})
        for brand, sku, grams in SKU_CATALOGUE:
            row = sheet.max_row + 1
            sheet.append([
                store.city, store.city, store.name, brand, sku, filled.get(sku),
                f'=IFERROR(F{row}/H{row},0)', grams, ba_names,
            ])
            sheet.cell(row, 6).fill = yellow
    for column, width in zip('ABCDEFGHI', (12, 12, 34, 16, 34, 11, 9, 11, 36)):
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = 'A2'

    help_sheet = book.create_sheet('Instructions')
    for line in (
        [f'SKU targets for {month}'],
        [],
        ['1. Fill the yellow KG Count column for each store. Count (packs) = KG / Grammage is worked out for you.'],
        ['2. Leave a store\'s KG Count empty to skip it. Do not change Store name or SKU Name.'],
        ['3. The BA column shows who receives the store\'s target this month (from monthly shifts / deployment).'],
        ['4. Upload the file on Ambassadors -> Upload targets and choose the same month.'],
    ):
        help_sheet.append(line)
    help_sheet.column_dimensions['A'].width = 100

    out = BytesIO()
    book.save(out)
    return out.getvalue()



# ─── BA SKU target template (one row per BA per SKU, keyed by BA Code) ─────

BA_TEMPLATE_HEADERS = [
    'BA Code', 'SKU', 'Month', 'Brand', 'Target Kg', 'Grammage', 'Target Units', 'Sales Kg', 'Sales Units',
]
GRAMMAGE = {sku: grams for _brand, sku, grams in SKU_CATALOGUE}
BRAND = {sku: brand for brand, sku, _grams in SKU_CATALOGUE}
_CANONICAL_SKU = {sku.lower(): sku for _brand, sku, _grams in SKU_CATALOGUE}
_SKU_INPUT_ALIASES = {
    'danedar 3in1 elaichi 200gm': 'DD 3IN1 Elaichi 200gm',
    'danedar 170gm hard pack': 'DD 170gm Hard Pack',
    'danedar 85gm hard pack': 'DD 85gm Hard Pack',
    'danedar elaichi 170gm hard pack': 'DD Elaichi 170gm Hard Pack',
    'danedar elaichi 80gm hard pack': 'DD Elaichi 80gm Hard Pack',
    'danedar 440gm jar pack new': 'DD 440gm Jar Pack New',
    'danedar 350gm pouch': 'DD 350gm Pouch',
    'danedar 430gm pouch': 'DD 430gm Pouch',
    'danedar 900gm pouch': 'DD 900gm Pouch',
    'danedar 900gm collectible pack': 'DD 900gm Collectible Pack',
    'dd 900gm collectible pack': 'DD 900gm Collectible Pack',
    'danedar 170gm pouch': 'DD 170gm Pouch',
    'danedar 1750gm pouch': 'DD 1750gm Pouch',
    'danedar 200gm jar pack': 'DD 200gm Jar Pack',
    'danedar 49gm hard pack': 'DD 49gm Hard Pack',
    'danedar 3in1 elachi box 200gm': 'DD 3IN1 Elachi Box 200gm',
    'dd 3in1 elachi box 200gm': 'DD 3IN1 Elachi Box 200gm',
    'danedar 100gm tea bag (envelope)': 'DD 100gm Tea Bag Envelope',
    'danedar 100gmtea bag (envelope)': 'DD 100gm Tea Bag Envelope',
    'danedar 100gm tea bag': 'DD 100gm Tea Bag',
    'danedar 200gm rtb': 'DD 200gm RTB',
    'danedar 200gm tea bag': 'DD 200gm Tea Bag',
    'danedar 200gm tea bag (envelope)': 'DD 200gm Tea Bag Envelope',
    'danedar 40gm': 'DD 40gm RTB',
    'danedar 50gm tea bag': 'DD 50gm Tea Bag',
    'danedar elaichi 100gm tea bag (env)': 'DD Elaichi 100gm Tea Bag Envelope',
    'danedar 1200gm tea bag ooh': 'DD 1200gm Tea Bag OOH',
    'family mixture 170gm hard pack': 'FM 170gm Hard Pack',
    'family mixture 80gm hard pack': 'FM 80gm Hard Pack',
    'family mixture 85gm hard pack': 'FM 85gm Hard Pack',
    'fm 85gm hard pack': 'FM 85gm Hard Pack',
    'fm 85g': 'FM 85gm Hard Pack',
    'fm 85 g': 'FM 85gm Hard Pack',
    'fm 85gm': 'FM 85gm Hard Pack',
    'family mixture 85g': 'FM 85gm Hard Pack',
    'family mixture 440gm jar pack': 'FM 440gm Jar Pack',
    'family mixture 430gm pouch': 'FM 430gm Pouch',
    'family mixture 900gm pouch': 'FM 900gm Pouch',
    'family mixture 1750gm pouch': 'FM 1750gm Pouch',
    'elaichi 45gm green tea bag': 'Elaichi 45gm',
    'ginger honey 45gm green tea bag': 'Ginger Honey 45gm',
    'jasmine 100gm jar pack': 'Jasmine 100gm',
    'jasmine 45gm green tea bag': 'Jasmine 45gm',
    'lemon 135gm tea bag boxes': 'Lemon 135gm',
    'lemon 45gm green tea bag': 'Lemon 45gm',
    'lemon grass 100gm jar pack': 'Lemon Grass 100gm',
    'mango 45gm green tea bag': 'Mango 45gm',
    'mint 45gm green tea bag': 'Mint 45gm',
    'pure green 45gm green tea bag': 'Pure Green 45gm',
    'sog 48gm green tea bag': 'SOG 48gm',
    'stawberry 45gm green tea bag': 'Strawberry 45gm',
    'strawberry 45gm green tea bag': 'Strawberry 45gm',
    'tropical peach 45gm green tea bag': 'Tropical Peach 45gm',
    'tapal insta brew 750gm': 'Tapal Insta Brew 750gm',
    'tezdum 170gm hard pack': 'TD 170gm Hard Pack',
    'tezdum 80gm hard pack': 'TD 80gm Hard Pack',
    'tezdum 430gm pouch': 'TD 430gm Pouch',
    'tezdum 900gm pouch': 'TD 900gm Pouch',
    'tezdum 1750gm pouch': 'TD 1750gm Pouch',
    'tezdum 290gm pouch': 'TD 290gm Pouch',
    'tezdum 170gm pouch pack': 'TD 170gm Pouch Pack',
}


def canonical_sku(name) -> str | None:
    """The SKU's name as in the list (any case / extra spaces), or None when it is not one of the SKUs."""
    normalized = ' '.join(str(name or '').split()).lower()
    without_pack_count = re.sub(r'\s+x\s*\d+(?:\.\d+)?(?:\s+boxes?)?(?=\s|$)', ' ', normalized)
    without_pack_count = ' '.join(without_pack_count.split())
    canonical = _SKU_INPUT_ALIASES.get(normalized) or _SKU_INPUT_ALIASES.get(without_pack_count) or normalized
    canonical = canonical.lower()
    return _CANONICAL_SKU.get(canonical)


def ba_store_for_month(ambassador: Ambassador, month: str) -> Store | None:
    """The store a BA works at in a month: their monthly shift, else where they are deployed."""
    from .models import MonthlyShift

    shift = (
        MonthlyShift.objects.filter(ambassador=ambassador, month=month)
        .select_related('store')
        .order_by('start_time', 'id')
        .first()
    )
    return shift.store if shift else ambassador.store


def build_ba_sku_template(month: str, scope=None) -> bytes:
    """
    One row per BA per SKU: BA Code, SKU, Month, Brand, Target Kg. The month's saved targets are
    filled in (the user's city only); add a row for each further SKU a BA should sell. The SKU column
    is a drop-down of the SKU list (also on the "SKU List" sheet with each SKU's brand).
    """
    from io import BytesIO

    import openpyxl
    from openpyxl.styles import Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    bas = Ambassador.objects.exclude(ba_code='')
    if scope is not None:
        bas = scope.ambassadors(bas, 'id')
    saved = (
        AmbassadorMonthTarget.objects.filter(month=month, ambassador__in=bas)
        .select_related('ambassador')
        .order_by('ambassador__ba_code')
    )

    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = 'Targets'
    sheet.append(BA_TEMPLATE_HEADERS)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    for target in saved:
        for line in target.lines or []:
            sku = canonical_sku(line.get('sku'))
            if sku:
                sheet.append([target.ambassador.ba_code, sku, month, BRAND[sku], line.get('kg')])
                sheet.cell(sheet.max_row, 8).value = line.get('sales') or 0
    yellow = PatternFill('solid', fgColor='FFFF00')
    last = max(sheet.max_row, 1) + 500  # room to add rows
    list_end = len(SKU_CATALOGUE) + 1
    for row in range(2, last + 1):
        sheet.cell(row, 3).number_format = '@'  # Month stays text: 2026-10
        sheet.cell(row, 5).fill = yellow
        # Grammage (kg per unit) from the SKU list; Units = Target Kg / Grammage
        sheet.cell(row, 6).value = f"=IF(B{row}=\"\",\"\",IFERROR(VLOOKUP(B{row},'SKU List'!$A$2:$C${list_end},3,FALSE),\"\"))"
        sheet.cell(row, 7).value = f'=IF(OR(E{row}="",F{row}="",F{row}=0),"",ROUND(E{row}/F{row},0))'
        # Sales are not entered (they come from the BA's Daily Sales reports): 0 until the BA reports.
        if sheet.cell(row, 8).value is None:
            sheet.cell(row, 8).value = f'=IF(B{row}="","",0)'
        sheet.cell(row, 9).value = f'=IF(OR(H{row}="",F{row}="",F{row}=0),"",ROUND(H{row}/F{row},0))'
    for column, width in zip('ABCDEFGHI', (14, 30, 10, 16, 11, 10, 13, 10, 13)):
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = 'A2'

    skus = book.create_sheet('SKU List')
    skus.append(['SKU', 'Brand', 'Grammage (kg per unit)'])
    for cell in skus[1]:
        cell.font = Font(bold=True)
    for brand, sku, grams in SKU_CATALOGUE:
        skus.append([sku, brand, grams])
    skus.column_dimensions['C'].width = 22
    skus.column_dimensions['A'].width = 30
    skus.column_dimensions['B'].width = 16
    pick = DataValidation(
        type='list',
        formula1=f"='SKU List'!$A$2:$A${len(SKU_CATALOGUE) + 1}",
        allow_blank=True,
        showErrorMessage=True,
        errorTitle='Unknown SKU',
        error='Choose a SKU from the list.',
    )
    sheet.add_data_validation(pick)
    pick.add(f'B2:B{last}')

    help_sheet = book.create_sheet('Instructions')
    for line in (
        ['How to fill the BA target template'],
        [],
        ['1. One row = one SKU target for one BA. Add a row for every SKU a BA should sell (as many as needed).'],
        ['2. BA Code: the ambassador\'s code, e.g. BA-4K7M2Q.'],
        ['3. SKU: pick from the drop-down. Only the SKUs on the "SKU List" sheet can be used.'],
        [f'4. Month: YYYY-MM, e.g. {month}.'],
        ['5. Brand: optional — it is taken from the SKU (see the "SKU List" sheet).'],
        ['6. Target Kg (yellow): the target for that SKU in kg. Rows with no Target Kg are skipped.'],
        ['   Grammage and Target Units fill in by themselves: Target Units = Target Kg / Grammage (e.g. 0.6 kg / 0.1 = 6 units).'],
        ['   Sales Kg and Sales Units are 0 by default and are not uploaded; they fill from the BA\'s Daily Sales reports.'],
        ['7. Uploading replaces that BA\'s SKU targets for that month with the rows in the file.'],
        ['   Sales are not entered: they come from the BA\'s Daily Sales reports. Achievement = sales / target x 100.'],
    ):
        help_sheet.append(line)
    help_sheet.column_dimensions['A'].width = 110
    out = BytesIO()
    book.save(out)
    return out.getvalue()


def _num(value):
    if value in (None, ''):
        return None
    try:
        return float(str(value).replace(',', ''))
    except ValueError:
        return None


@transaction.atomic
def save_ba_sku_targets(rows: list[dict], scope=None) -> dict:
    """
    rows: [{baCode, month, lines: [{sku, kg}]}] — kg is the Target Kg (older callers may send qty); unit = kg / the SKU's grammage
    (a {sku, unit} line is also accepted: kg = unit x grammage). — sku must be one of SKU_CATALOGUE (brand and
    grammage are taken from the list).
    Replaces each BA's SKU targets for the month. Target = sum of kg. Sales are never set here:
    they are the kg the BA reports per SKU in their Daily Sales reports (recompute_target_sales).
    """
    from .shifts import parse_month

    saved, errors = [], []
    bas = Ambassador.objects.all()
    if scope is not None:
        bas = scope.ambassadors(bas, 'id')
    by_code = {b.ba_code.upper(): b for b in bas if b.ba_code}
    for row in rows:
        code = str(row.get('baCode') or '').strip().upper()
        parsed = parse_month(row.get('month'))
        ba = by_code.get(code)
        if not ba:
            errors.append(f'{code or "(no BA code)"}: no ambassador with this BA code.')
            continue
        if not parsed:
            errors.append(f'{code}: month must be YYYY-MM.')
            continue
        month = '%04d-%02d' % parsed
        lines, unknown, seen = [], [], set()
        for raw in row.get('lines') or []:
            name = str(raw.get('sku') or '').strip()
            units = _num(raw.get('unit', raw.get('units')))
            qty = _num(raw.get('kg', raw.get('qty')))
            if not name or (units is None and qty is None) or (units is not None and units < 0) or (qty is not None and qty < 0):
                continue
            sku = canonical_sku(name)
            if not sku:
                unknown.append(name)
                continue
            if sku in seen:
                continue
            seen.add(sku)
            grams = GRAMMAGE[sku]
            if units is not None:
                # Target Kg = Units x Grammage
                qty = round(units * grams, 3)
            lines.append({
                'sku': sku,
                'brand': BRAND[sku],
                'kg': qty,
                'grammage': grams,
                'unit': round(units) if units is not None else (round(qty / grams) if grams else None),
            })
        if unknown:
            errors.append(f'{code}: {", ".join(unknown)} — not in the SKU list, so not saved.')
            continue
        if not lines:
            errors.append(f'{code}: no SKU with a Target Kg for {month}.')
            continue
        existing = AmbassadorMonthTarget.objects.filter(ambassador=ba, month=month).first()
        target = Decimal(str(sum(line['kg'] for line in lines))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        AmbassadorMonthTarget.objects.update_or_create(
            ambassador=ba,
            month=month,
            defaults={
                'store': ba_store_for_month(ba, month) or (existing.store if existing else None),
                'target_total': target,
                'lines': lines,
            },
        )
        recompute_target_sales(ba.id, month)
        saved.append({'baCode': ba.ba_code, 'baName': ba.name, 'month': month, 'skus': len(lines), 'targetKg': float(target)})
    return {'saved': saved, 'errors': errors}


# ─── Sales achievement from the BA's Daily Sales reports ───────────────────

SALES_SKU_PREFIX = 'sku:'  # older reports: kg per SKU
SALES_UNIT_PREFIX = 'unit:'  # SKU sales in units (whole packs); kg = units x the SKU's grammage


def _kg(value) -> float | None:
    number = _num(value)
    return number if number is not None and number >= 0 else None


def reported_sku_sales(ambassador_id, month: str) -> dict[str, float]:
    """
    Kg sold per SKU (lower-case name) in a month, from the BA's Daily Sales reports (keys "sku:<SKU>").
    A day counts once: if the BA sends several reports with SKU sales on one day, the latest one is used.
    """
    from django.utils import timezone

    from .models import DailyReport

    year, mon = (int(part) for part in month.split('-'))
    by_day: dict = {}
    for report in DailyReport.objects.filter(
        ambassador_id=ambassador_id, submitted_at__year=year, submitted_at__month=mon
    ).order_by('submitted_at'):
        sold = {}
        for key, value in (report.sales or {}).items():
            kg = _kg(value)
            if kg is None:
                continue
            if str(key).startswith(SALES_SKU_PREFIX):
                name = str(key)[len(SALES_SKU_PREFIX):].strip()
                sku = canonical_sku(name)
                sold[(sku or name).lower()] = kg
            elif str(key).startswith(SALES_UNIT_PREFIX):
                name = str(key)[len(SALES_UNIT_PREFIX):].strip()
                sku = canonical_sku(name)
                grams = GRAMMAGE.get(sku or '', 0)
                if grams:
                    sold[(sku or name).lower()] = round(kg * grams, 3)
        if sold:
            by_day[timezone.localtime(report.submitted_at).date()] = sold
    totals: dict[str, float] = {}
    for sold in by_day.values():
        for sku, kg in sold.items():
            totals[sku] = totals.get(sku, 0.0) + kg
    return totals


def recompute_target_sales(ambassador_id, month: str):
    """Set each SKU line's sales (kg) and the month's sales total from the BA's Daily Sales reports."""
    target = AmbassadorMonthTarget.objects.filter(ambassador_id=ambassador_id, month=month).first()
    if not target:
        return None
    sold = reported_sku_sales(ambassador_id, month)
    lines, total = [], Decimal('0')
    for line in target.lines or []:
        kg = round(sold.get(str(line.get('sku') or '').strip().lower(), 0.0), 2)
        lines.append({**line, 'sales': kg})
        total += Decimal(str(kg))
    target.lines = lines
    target.sales_total = total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    target.save(update_fields=['lines', 'sales_total'])
    return target


# ─── SKUs a city's BAs report on (Stock Report and Daily Sales) ─────────────
# (brand, name shown to the BA, the matching SKU in SKU_CATALOGUE or None when it has no target SKU).
# Sales the BA reports are saved under the matching SKU, so they count towards that SKU's target.

_LAHORE_SKUS: list[tuple[str, str, str | None]] = [
    ('Danedar', 'Danedar 3IN1 Elaichi 200gm X 40 Boxes', 'DD 3IN1 Elaichi 200gm'),
    ('Danedar', 'Danedar 170gm X 60 Hard Pack', 'DD 170gm Hard Pack'),
    ('Danedar', 'Danedar 85gm X 120 Hard Pack', 'DD 85gm Hard Pack'),
    ('Danedar', 'Danedar Elaichi 170gm X 60 Hard Pack', 'DD Elaichi 170gm Hard Pack'),
    ('Danedar', 'Danedar Elaichi 80gm X 120 Hard Pack', 'DD Elaichi 80gm Hard Pack'),
    ('Danedar', 'Danedar 440gm x 30 Jar Pack New', 'DD 440gm Jar Pack New'),
    ('Danedar', 'Danedar 350gm X 30 Pouch', 'DD 350gm Pouch'),
    ('Danedar', 'Danedar 430gm X 24 Pouch', 'DD 430gm Pouch'),
    ('Danedar', 'Danedar 900gm X 12 Pouch', 'DD 900gm Pouch'),
    ('Danedar', 'Danedar 100gm X 36 Tea Bag (Envelope)', 'DD 100gm Tea Bag Envelope'),
    ('Danedar', 'Danedar 100gm X 40 Tea Bag', 'DD 100gm Tea Bag'),
    ('Danedar', 'Danedar 200gm X 20 RTB', 'DD 200gm RTB'),
    ('Danedar', 'Danedar 200gm X 20 Tea Bag', 'DD 200gm Tea Bag'),
    ('Danedar', 'Danedar 200gm X 20 Tea Bag (Envelope)', 'DD 200gm Tea Bag Envelope'),
    ('Danedar', 'Danedar 40gm X 80 RTB', 'DD 40gm RTB'),
    ('Danedar', 'Danedar 50gm x 80 Tea Bag', 'DD 50gm Tea Bag'),
    ('Danedar', 'Danedar Elaichi 100gm X 36 Tea Bag (Env)', 'DD Elaichi 100gm Tea Bag Envelope'),
    ('Danedar', 'Danedar 1200gm Tea Bag OOH', 'DD 1200gm Tea Bag OOH'),
    ('Family Mixture', 'Family Mixture 170gm X 60 Hard Pack', 'FM 170gm Hard Pack'),
    ('Family Mixture', 'Family Mixture 80gm X 120 Hard Pack', 'FM 80gm Hard Pack'),
    ('Family Mixture', 'Family Mixture 440gm X 30 Jar Pack', 'FM 440gm Jar Pack'),
    ('Family Mixture', 'Family Mixture 430gm X 24 Pouch', 'FM 430gm Pouch'),
    ('Family Mixture', 'Family Mixture 900gm X 12 Pouch', 'FM 900gm Pouch'),
    ('Green Tea', 'Elaichi 45gm X 40 Green Tea Bag', 'Elaichi 45gm'),
    ('Green Tea', 'Ginger Honey 45gm x 40 Green Tea Bag', 'Ginger Honey 45gm'),
    ('Green Tea', 'Jasmine 100gm X 40 Jar Pack', 'Jasmine 100gm'),
    ('Green Tea', 'Jasmine 45gm X 40 Green Tea Bag', 'Jasmine 45gm'),
    ('Green Tea', 'Lemon 135gm x 16 Tea Bag Boxes', 'Lemon 135gm'),
    ('Green Tea', 'Lemon 45gm X 40 Green Tea Bag', 'Lemon 45gm'),
    ('Green Tea', 'Lemon Grass 100gm X 40 Jar Pack', 'Lemon Grass 100gm'),
    ('Green Tea', 'Mango 45gm x 40 Green Tea Bag', 'Mango 45gm'),
    ('Green Tea', 'Mint 45gm X 40 Green Tea Bag', 'Mint 45gm'),
    ('Green Tea', 'Pure Green 45gm x 40 Green Tea Bag', 'Pure Green 45gm'),
    ('Green Tea', 'SOG 48gm X 40 Green Tea Bag', 'SOG 48gm'),
    ('Green Tea', 'Stawberry 45gm x 40 Green Tea Bag', 'Strawberry 45gm'),
    ('Green Tea', 'Tropical Peach 45gm x 40 Green Tea Bag', 'Tropical Peach 45gm'),
    ('Insta Brew', 'Tapal Insta Brew 750gm x 16 Boxes', 'Tapal Insta Brew 750gm'),
    ('Tezdum', 'Tezdum 170gm X 60 Hard Pack', 'TD 170gm Hard Pack'),
    ('Tezdum', 'Tezdum 80gm X 120 Hard Pack', 'TD 80gm Hard Pack'),
    ('Tezdum', 'Tezdum 430gm X 24 Pouch', 'TD 430gm Pouch'),
    ('Tezdum', 'Tezdum 900gm X 12 Pouch', 'TD 900gm Pouch'),
]

# Multan target / report SKUs (canonical catalogue names). Includes Multan-only sizes like 1750gm.
_MULTAN_CATALOGUE_SKUS = [
    'DD 100gm Tea Bag', 'DD 100gm Tea Bag Envelope', 'DD 170gm Hard Pack', 'DD 1750gm Pouch',
    'DD 200gm RTB', 'DD 200gm Tea Bag', 'DD 200gm Tea Bag Envelope', 'DD 350gm Pouch',
    'DD 3IN1 Elachi Box 200gm', 'DD 40gm RTB', 'DD 430gm Pouch', 'DD 440gm Jar Pack New',
    'DD 49gm Hard Pack', 'DD 50gm Tea Bag', 'DD 85gm Hard Pack', 'DD 900gm Pouch',
    'DD 900gm Collectible Pack',
    'DD Elaichi 100gm Tea Bag Envelope', 'DD Elaichi 170gm Hard Pack', 'DD Elaichi 80gm Hard Pack',
    'DD 200gm Jar Pack', 'DD 170gm Pouch',
    'TD 170gm Hard Pack', 'TD 170gm Pouch Pack', 'TD 430gm Pouch', 'TD 80gm Hard Pack', 'TD 900gm Pouch',
    'TD 1750gm Pouch', 'TD 290gm Pouch',
    'FM 170gm Hard Pack', 'FM 430gm Pouch', 'FM 440gm Jar Pack', 'FM 80gm Hard Pack', 'FM 85gm Hard Pack',
    'FM 900gm Pouch', 'FM 1750gm Pouch',
    'Elaichi 45gm', 'Ginger Honey 45gm', 'Jasmine 100gm', 'Jasmine 45gm', 'Lemon 135gm', 'Lemon 45gm',
    'Lemon Grass 100gm', 'Orange 45gm', 'Pineapple 45gm', 'Mango 45gm', 'Mint 45gm', 'Pure Green 45gm',
    'SOG 48gm', 'Strawberry 45gm', 'Tropical Peach 45gm', 'Gulbahar 80gm Hard Pack',
]
_BY_NAME = {name: (brand, name, sku) for brand, name, sku in _LAHORE_SKUS}
_BY_SQUASHED_NAME = {' '.join(name.lower().split()): row for name, row in _BY_NAME.items()}

CITY_REPORT_SKUS: dict[str, list[tuple[str, str, str | None]]] = {
    'lahore': _LAHORE_SKUS,
    'multan': [(BRAND[sku], sku, sku) for sku in _MULTAN_CATALOGUE_SKUS if sku in BRAND],
}


def _city_sku_row(name: str) -> tuple[str, str, str | None]:
    """(brand, name shown to the BA, target SKU) for a SKU typed into the City SKU table."""
    known = _BY_SQUASHED_NAME.get(' '.join(name.lower().split()))  # any case, extra spaces
    if known:
        return known
    sku = canonical_sku(name)
    return (BRAND[sku], sku, sku) if sku else ('Other', name, None)


def report_skus_for_city(city: str) -> list[dict] | None:
    """The SKUs a BA of this city reports on, or None when the city has no list of its own.

    The City SKU table (Django admin) wins; a city with no rows there uses the built-in list.
    """
    from .models import CitySku

    city = (city or '').strip()
    city_rows = CitySku.objects.filter(city__iexact=city).values_list('sku', 'brand')
    rows = []
    for raw_name, raw_brand in city_rows:
        name = (raw_name or '').strip()
        if not name:
            continue
        inferred_brand, label, sku = _city_sku_row(name)
        rows.append(((raw_brand or '').strip() or inferred_brand, label, sku))
    rows = rows or CITY_REPORT_SKUS.get(city.lower())
    if not rows:
        return None
    return [{'brand': brand, 'label': name, 'sku': sku or name} for brand, name, sku in rows]

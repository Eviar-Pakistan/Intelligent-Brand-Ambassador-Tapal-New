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
                'qty': float(kg),
                'grammage': grams,
                # packs = kg / kg-per-pack (the sheet's Count column); None when grammage is 0
                'count': round(float(kg) / grams, 2) if grams > 0 else None,
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
        total = sum((Decimal(str(line['qty'])) for line in data['lines']), Decimal('0'))
        total = total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if total == 0:
            empty.append(store.name)
            continue
        bas = store_bas_for_month(store, month)
        if not bas:
            no_ba.append(store.name)
            continue
        for ba in bas:
            existing = AmbassadorMonthTarget.objects.filter(ambassador=ba, month=month).first()
            AmbassadorMonthTarget.objects.update_or_create(
                ambassador=ba,
                month=month,
                defaults={
                    'store': store,
                    'target_total': total,
                    # the sheet has no sales: keep what was already recorded
                    'sales_total': existing.sales_total if existing else Decimal('0'),
                    'lines': data['lines'],
                },
            )
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

# Brand, SKU name, grammage (kg per pack), as in the store SKU target sheet.
SKU_CATALOGUE: list[tuple[str, str, float]] = [
    ('Danedar', 'DD 100gm Tea Bag', 0.1), ('Danedar', 'DD 100gm Tea Bag Envelope', 0.1),
    ('Danedar', 'DD 170gm Hard Pack', 0.17), ('Danedar', 'DD 1750gm Pouch', 1.65),
    ('Danedar', 'DD 200gm RTB', 0.2), ('Danedar', 'DD 200gm Tea Bag', 0.2),
    ('Danedar', 'DD 200gm Tea Bag Envelope', 0.2), ('Danedar', 'DD 350gm Pouch', 0.35),
    ('Danedar', 'DD 3IN1 Elachi Box 200gm', 0.2), ('Danedar', 'DD 40gm RTB', 0.04),
    ('Danedar', 'DD 430gm Pouch', 0.43), ('Danedar', 'DD 440gm Jar Pack New', 0.44),
    ('Danedar', 'DD 49gm Hard Pack', 0.2), ('Danedar', 'DD 50gm Tea Bag', 0.05),
    ('Danedar', 'DD 85gm Hard Pack', 0.085), ('Danedar', 'DD 900gm Pouch', 0.9),
    ('Danedar', 'DD Elaichi 100gm Tea Bag Envelope', 0.1), ('Danedar', 'DD Elaichi 170gm Hard Pack', 0.08),
    ('Danedar', 'DD Elaichi 80gm Hard Pack', 0.17), ('Danedar', 'DD 200gm Jar Pack', 0.2),
    ('Danedar', 'DD 170gm Pouch', 0.17),
    ('Tezdum', 'TD 170gm Hard Pack', 0.17), ('Tezdum', 'TD 170gm Pouch Pack', 0.17),
    ('Tezdum', 'TD 430gm Pouch', 0.43), ('Tezdum', 'TD 80gm Hard Pack', 0.08),
    ('Tezdum', 'TD 900gm Pouch', 0.9), ('Tezdum', 'TD 1750gm Pouch', 1.65), ('Tezdum', 'TD 290gm Pouch', 0),
    ('Familly Mixture', 'FM 170gm Hard Pack', 0.17), ('Familly Mixture', 'FM 430gm Pouch', 0.43),
    ('Familly Mixture', 'FM 440gm Jar Pack', 0.44), ('Familly Mixture', 'FM 80gm Hard Pack', 0.08),
    ('Familly Mixture', 'FM 900gm Pouch', 0.9), ('Familly Mixture', 'FM 1750gm Pouch', 1.65),
    ('Green Tea', 'Elaichi 45gm', 0.045), ('Green Tea', 'Ginger Honey 45gm', 0.045),
    ('Green Tea', 'Jasmine 100gm', 0.1), ('Green Tea', 'Jasmine 45gm', 0.045),
    ('Green Tea', 'Lemon 135gm', 0.135), ('Green Tea', 'Lemon 45gm', 0.045),
    ('Green Tea', 'Lemon Grass 100gm', 0.1), ('Green Tea', 'Mango 45gm', 0.045),
    ('Green Tea', 'Mint 45gm', 0.045), ('Green Tea', 'Pure Green 45gm', 0.045),
    ('Green Tea', 'SOG 48gm', 0.048), ('Green Tea', 'Strawberry 45gm', 0.045),
    ('Green Tea', 'Tropical Peach 45gm', 0.045),
    ('Gulbahar', 'Gulbahar 80gm Hard Pack', 0.08),
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
        existing.setdefault(target.store_id, {line.get('sku'): line.get('qty') for line in (target.lines or [])})

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
    'BA Code', 'BA Name', 'Store', 'Month', 'Brand', 'SKU Name', 'Target Kg', 'Sales Kg', 'Grammage', 'Count',
]
_BA_HEADER_KEYS = {
    'ba code': 'code', 'month': 'month', 'brand': 'brand', 'sku name': 'sku', 'sku': 'sku',
    'target kg': 'target', 'sales kg': 'sales', 'grammage': 'grammage',
}
GRAMMAGE = {sku: grams for _brand, sku, grams in SKU_CATALOGUE}
BRAND = {sku: brand for brand, sku, _grams in SKU_CATALOGUE}


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
    """Every BA (the user's city only) x every SKU. Existing targets for the month are pre-filled."""
    from io import BytesIO

    import openpyxl
    from openpyxl.styles import Font, PatternFill

    bas = Ambassador.objects.exclude(ba_code='').order_by('name')
    if scope is not None:
        bas = scope.ambassadors(bas, 'id')
    saved = {
        t.ambassador_id: {line.get('sku'): line for line in (t.lines or [])}
        for t in AmbassadorMonthTarget.objects.filter(month=month, ambassador__in=bas)
    }

    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = 'Targets'
    sheet.append(BA_TEMPLATE_HEADERS)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    yellow = PatternFill('solid', fgColor='FFFF00')
    for ba in bas:
        store = ba_store_for_month(ba, month)
        lines = saved.get(ba.id, {})
        skus = [(b, s, g) for b, s, g in SKU_CATALOGUE]
        skus += [(line.get('brand', ''), sku, line.get('grammage') or 0) for sku, line in lines.items() if sku not in GRAMMAGE]
        for brand, sku, grams in skus:
            line = lines.get(sku, {})
            row = sheet.max_row + 1
            sheet.append([
                ba.ba_code, ba.name, store.name if store else '', month, brand, sku,
                line.get('qty'), line.get('sales'), grams, f'=IFERROR(G{row}/I{row},0)',
            ])
            sheet.cell(row, 7).fill = yellow
            sheet.cell(row, 4).number_format = '@'
    for column, width in zip('ABCDEFGHIJ', (12, 24, 30, 10, 16, 34, 11, 10, 10, 9)):
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = 'A2'

    help_sheet = book.create_sheet('Instructions')
    for line in (
        ['How to fill the BA target template'],
        [],
        ['1. One row = one SKU target for one BA. A BA can have as many SKU rows as needed.'],
        ['2. BA Code identifies the ambassador (BA Name and Store are only for reference).'],
        ['3. Fill the yellow Target Kg. Sales Kg is optional. Count (packs) = Target Kg / Grammage.'],
        ['4. Month is YYYY-MM. Rows with no Target Kg are skipped.'],
        ['5. Uploading replaces that BA\'s SKU targets for that month with the rows in the file.'],
    ):
        help_sheet.append(line)
    help_sheet.column_dimensions['A'].width = 100
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
    rows: [{baCode, month, lines: [{sku, brand?, qty, sales?, grammage?}]}]
    Replaces each BA's SKU targets for the month. Target = sum of qty; sales = sum of sales when given.
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
        lines, any_sales = [], False
        for raw in row.get('lines') or []:
            sku = str(raw.get('sku') or '').strip()
            qty = _num(raw.get('qty'))
            if not sku or qty is None or qty < 0:
                continue
            sales = _num(raw.get('sales'))
            any_sales = any_sales or sales is not None
            grams = _num(raw.get('grammage'))
            if grams is None:
                grams = GRAMMAGE.get(sku, 0)
            lines.append({
                'sku': sku,
                'brand': str(raw.get('brand') or BRAND.get(sku, '')).strip(),
                'qty': qty,
                'sales': sales,
                'grammage': grams,
                'count': round(qty / grams, 2) if grams else None,
            })
        if not lines:
            errors.append(f'{code}: no SKU with a Target Kg for {month}.')
            continue
        existing = AmbassadorMonthTarget.objects.filter(ambassador=ba, month=month).first()
        target = Decimal(str(sum(line['qty'] for line in lines))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if any_sales:
            sales_total = Decimal(str(sum(line['sales'] or 0 for line in lines))).quantize(Decimal('0.01'))
        else:
            sales_total = existing.sales_total if existing else Decimal('0')
        AmbassadorMonthTarget.objects.update_or_create(
            ambassador=ba,
            month=month,
            defaults={
                'store': ba_store_for_month(ba, month) or (existing.store if existing else None),
                'target_total': target,
                'sales_total': sales_total,
                'lines': lines,
            },
        )
        saved.append({'baCode': ba.ba_code, 'baName': ba.name, 'month': month, 'skus': len(lines), 'targetKg': float(target)})
    return {'saved': saved, 'errors': errors}

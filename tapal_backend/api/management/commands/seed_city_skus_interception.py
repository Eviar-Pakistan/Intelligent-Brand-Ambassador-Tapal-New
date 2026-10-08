"""
Add the interception / report SKUs to CitySku for Lahore, Multan and Faisalabad.

BAs without a month target use CitySku (via report_skus_for_city). Run once:

    python manage.py seed_city_skus_interception
"""

from django.core.management.base import BaseCommand

from api.models import CitySku
from api.target_sheet import BRAND, _city_sku_row, report_skus_for_city

# Mapped from the business list (Danedar 85g, DD 40 g RTB, FM 440 g jar, …).
WANTED_SKUS = [
    'DD 85gm Hard Pack',
    'DD Elaichi 170gm Hard Pack',
    'DD 350gm Pouch',
    'DD 400gm Pillow Pack',
    'DD 430gm Pouch',
    'FM 430gm Pouch',
    'DD 900gm Pouch',
    'FM 900gm Pouch',
    'DD 40gm RTB',
    'DD 100gm Tea Bag Envelope',
    'DD 100gm Tea Bag',
    'Pure Green 45gm',
    'Mango 45gm',
    'Jasmine 45gm',
    'Lemon 135gm',
    'FM 85gm Hard Pack',
    'FM 440gm Jar Pack',
    'DD 900gm Collectible Pack',
    'Elaichi 80gm',
    'TD 170gm Pouch Pack',
    'Instant Tea 200gm',
}

CITIES = ['Lahore', 'Multan', 'Faisalabad']


def _covered(city: str) -> tuple[set[str], set[str]]:
    covered_canon: set[str] = set()
    covered_labels: set[str] = set()
    for sku, _brand in CitySku.objects.filter(city__iexact=city).values_list('sku', 'brand'):
        name = (sku or '').strip()
        if not name:
            continue
        covered_labels.add(' '.join(name.lower().split()))
        _b, label, canon = _city_sku_row(name)
        if canon:
            covered_canon.add(canon.lower())
        covered_labels.add(' '.join(label.lower().split()))
    return covered_canon, covered_labels


class Command(BaseCommand):
    help = 'Seed CitySku rows so BAs without targets see the shared interception SKU list.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be created without writing.',
        )

    def handle(self, *args, **options):
        dry = options['dry_run']
        created = 0
        for city in CITIES:
            covered_canon, covered_labels = _covered(city)
            for sku_name in WANTED_SKUS:
                brand = BRAND.get(sku_name)
                if not brand:
                    self.stdout.write(self.style.WARNING(f'skip (not in catalogue): {sku_name}'))
                    continue
                label_key = ' '.join(sku_name.lower().split())
                if sku_name.lower() in covered_canon or label_key in covered_labels:
                    continue
                if dry:
                    self.stdout.write(f'would create {city}: [{brand}] {sku_name}')
                else:
                    CitySku.objects.create(city=city, sku=sku_name, brand=brand)
                    self.stdout.write(self.style.SUCCESS(f'+ {city}: [{brand}] {sku_name}'))
                created += 1
                covered_canon.add(sku_name.lower())
                covered_labels.add(label_key)

        self.stdout.write(self.style.NOTICE(f'{"Would create" if dry else "Created"} {created} row(s).'))
        for city in CITIES:
            rows = report_skus_for_city(city) or []
            skus = {(r.get('sku') or '').lower() for r in rows}
            missing = [s for s in WANTED_SKUS if s.lower() not in skus]
            self.stdout.write(f'{city}: {len(rows)} SKUs; missing wanted: {missing or "none"}')

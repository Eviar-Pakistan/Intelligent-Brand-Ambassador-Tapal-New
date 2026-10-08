"""
Add SKUs to CitySku (all cities) and append them with 0 kg target to every BA
month-target that does not already include them.

    python manage.py add_zero_target_skus
"""

from django.core.management.base import BaseCommand

from api.models import AmbassadorMonthTarget, CitySku
from api.target_sheet import BRAND, GRAMMAGE, canonical_sku

# (display/city name, catalogue sku, brand override for CitySku)
NEW_SKUS = [
    ('Elaichi 80gm', 'Elaichi 80gm', 'Green Tea'),
    ('TD 170gm Pouch', 'TD 170gm Pouch Pack', 'Tezdum'),
    ('Instant Tea 200gm', 'Instant Tea 200gm', 'Danedar'),
]

CITIES = ['Lahore', 'Multan', 'Faisalabad']


class Command(BaseCommand):
    help = 'Add Elaichi 80gm / TD 170gm Pouch / Instant Tea 200gm to CitySku and BA targets at 0 kg.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        dry = options['dry_run']

        for city_label, catalogue_sku, brand in NEW_SKUS:
            if catalogue_sku not in BRAND:
                self.stderr.write(self.style.ERROR(f'{catalogue_sku} missing from SKU_CATALOGUE — deploy catalogue first.'))
                return

        city_created = 0
        for city in CITIES:
            existing = {
                ' '.join((s or '').lower().split())
                for s in CitySku.objects.filter(city__iexact=city).values_list('sku', flat=True)
            }
            # Also treat catalogue names already present as covered.
            covered_canon = set()
            for s in CitySku.objects.filter(city__iexact=city).values_list('sku', flat=True):
                canon = canonical_sku(s)
                if canon:
                    covered_canon.add(canon.lower())

            for city_label, catalogue_sku, brand in NEW_SKUS:
                label_key = ' '.join(city_label.lower().split())
                cat_key = catalogue_sku.lower()
                if label_key in existing or cat_key in existing or cat_key in covered_canon:
                    continue
                if dry:
                    self.stdout.write(f'would CitySku {city}: [{brand}] {city_label}')
                else:
                    CitySku.objects.create(city=city, sku=city_label, brand=brand)
                    self.stdout.write(self.style.SUCCESS(f'+ CitySku {city}: [{brand}] {city_label}'))
                city_created += 1
                existing.add(label_key)
                covered_canon.add(cat_key)

        target_updates = 0
        lines_added = 0
        for target in AmbassadorMonthTarget.objects.select_related('ambassador').all():
            lines = list(target.lines or [])
            have = set()
            for line in lines:
                canon = canonical_sku(line.get('sku')) or str(line.get('sku') or '').strip()
                if canon:
                    have.add(canon.lower())

            added_here = []
            for _city_label, catalogue_sku, brand in NEW_SKUS:
                if catalogue_sku.lower() in have:
                    continue
                grams = GRAMMAGE[catalogue_sku]
                added_here.append(
                    {
                        'sku': catalogue_sku,
                        'brand': brand or BRAND[catalogue_sku],
                        'kg': 0.0,
                        'grammage': grams,
                        'unit': 0,
                        'sales': 0.0,
                    }
                )
                have.add(catalogue_sku.lower())

            if not added_here:
                continue

            if dry:
                self.stdout.write(
                    f'would update target {target.ambassador.ba_code} {target.month}: '
                    f'+{[r["sku"] for r in added_here]}'
                )
            else:
                target.lines = lines + added_here
                # target_total stays the same (adding 0 kg).
                target.save(update_fields=['lines'])
                self.stdout.write(
                    self.style.SUCCESS(
                        f'+ target {target.ambassador.ba_code} {target.month}: '
                        f'{[r["sku"] for r in added_here]}'
                    )
                )
            target_updates += 1
            lines_added += len(added_here)

        self.stdout.write(
            self.style.NOTICE(
                f'{"Would create" if dry else "Created"} {city_created} CitySku row(s); '
                f'{"would update" if dry else "updated"} {target_updates} target(s) '
                f'({lines_added} line(s) at 0 kg).'
            )
        )

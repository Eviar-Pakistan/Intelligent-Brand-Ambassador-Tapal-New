"""
Set every BA's store (api_ambassador.store_id) from their monthly shift (deployment).

  python manage.py assign_ba_stores              # this month
  python manage.py assign_ba_stores --month 2026-11
"""

from django.core.management.base import BaseCommand

from api.shifts import assign_ba_stores


class Command(BaseCommand):
    help = "Assign each BA's store from their monthly shift for the month."

    def add_arguments(self, parser):
        parser.add_argument('--month', default='', help='YYYY-MM (default: this month)')

    def handle(self, *args, **opts):
        changed = assign_ba_stores(opts['month'] or None)
        self.stdout.write(self.style.SUCCESS(f'Updated the store of {changed} BA(s).'))

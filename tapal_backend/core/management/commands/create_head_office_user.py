"""
Create (or update) a Head Office login.

  python manage.py create_head_office_user zoraiz@tapaltea.com --name "Zoraiz"
  python manage.py create_head_office_user hassam@tapaltea.com --name "Hassam" --city Lahore

Without --city the user sees every city. With --city they see the same screens, but only that
city's stores, BAs, shifts, attendance, shoppers, complaints, reports and supervisors.

Use --role mis for an MIS login (same Head Office app; Dashboard and Stock hidden).
Default --role is standard.

The password is asked for (hidden). Use --password to pass it directly, or --generate to make
a random one that is printed once.
"""

import getpass
import secrets

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from core.models import HoRole, UserType


class Command(BaseCommand):
    help = 'Create or update a Head Office login (optionally limited to one city / MIS).'

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('--name', default='', help='Full name shown in the app')
        parser.add_argument('--city', default='', help='Limit to one city, e.g. Lahore. Omit for every city.')
        parser.add_argument(
            '--role',
            default=HoRole.STANDARD,
            choices=[c.value for c in HoRole],
            help='Head Office sub-role: standard (default) or mis',
        )
        parser.add_argument('--password', default='', help='Password (otherwise you are asked for it)')
        parser.add_argument('--generate', action='store_true', help='Generate a random password and print it')

    def handle(self, *args, **opts):
        User = get_user_model()
        email = opts['email'].strip().lower()
        if '@' not in email:
            raise CommandError('Give a valid email address.')

        if opts['generate']:
            password = secrets.token_urlsafe(9)
        elif opts['password']:
            password = opts['password']
        else:
            password = getpass.getpass(f'Password for {email}: ')
            if password != getpass.getpass('Again: '):
                raise CommandError('The passwords do not match.')
        if len(password) < 8:
            raise CommandError('Use a password of at least 8 characters.')

        user = User.objects.filter(email__iexact=email).first()
        created = user is None
        if created:
            user = User(email=email, username=email)
        first, _, last = opts['name'].strip().partition(' ')
        if first:
            user.first_name, user.last_name = first, last
        user.user_type = UserType.HEAD_OFFICE
        user.ho_role = opts['role']
        user.city = opts['city'].strip()
        user.is_active = True
        user.set_password(password)
        user.save()

        scope = f'city: {user.city}' if user.city else 'all cities'
        self.stdout.write(
            self.style.SUCCESS(
                f'{"Created" if created else "Updated"} {email} (Head Office, role={user.ho_role}, {scope})'
            )
        )
        if opts['generate']:
            self.stdout.write(f'Password: {password}')

from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    Ambassador,
    AmbassadorComplaint,
    Consumer,
    DailyReport,
    MonthlyShift,
    Store,
    Supervisor,
)
from .shifts import build_monthly_shift, parse_hhmm


class CityScopeTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.all_user = User.objects.create_user(username='ho', email='ho@x.com', password='pw', user_type=1)
        self.lahore_user = User.objects.create_user(
            username='hassam', email='hassam@x.com', password='pw', user_type=1, city='Lahore'
        )
        self.ho = APIClient()
        self.ho.force_authenticate(self.all_user)
        self.lhr = APIClient()
        self.lhr.force_authenticate(self.lahore_user)

        self.lahore = Store.objects.create(name='Metro LHR', store_code='L-1', city='Lahore', address='x')
        self.multan = Store.objects.create(name='Metro MUX', store_code='M-1', city='Multan', address='y')
        self.ba_l = Ambassador.objects.create(name='Ali', city='Lahore', status=Ambassador.Status.CERTIFIED)
        self.ba_m = Ambassador.objects.create(name='Zara', city='Multan', status=Ambassador.Status.CERTIFIED)
        month = timezone.localdate().strftime('%Y-%m')
        for store, ba in ((self.lahore, self.ba_l), (self.multan, self.ba_m)):
            build_monthly_shift(store=store, ambassador=ba, month=month, start=parse_hhmm('00:00'), end=parse_hhmm('23:59')).save()
            Consumer.objects.create(store=store, answers={})
            AmbassadorComplaint.objects.create(store=store, ambassador=ba, complaint='x', client_id=f'cmp-{store.id}')
            DailyReport.objects.create(
                id=f'rep-{store.id}', ambassador=ba, ba_name=ba.name, store=store, source='anytime',
                stock={'a': '1'}, submitted_at=timezone.now(),
            )
        self.sup_m = Supervisor.objects.create(id='sup-m', name='Mux', email='m@x.com', city='Multan')
        Store.objects.filter(pk=self.multan.pk).update(supervisor=self.sup_m)

    @staticmethod
    def rows(res):
        data = res.data
        return data['results'] if isinstance(data, dict) and 'results' in data else data

    def test_all_city_user_sees_everything(self):
        self.assertEqual(len(self.rows(self.ho.get('/api/stores/'))), 2)
        self.assertEqual(len(self.rows(self.ho.get('/api/ambassadors/'))), 2)

    def test_city_user_sees_only_their_city(self):
        self.assertEqual([s['id'] for s in self.rows(self.lhr.get('/api/stores/'))], [self.lahore.id])
        self.assertEqual([a['name'] for a in self.rows(self.lhr.get('/api/ambassadors/'))], ['Ali'])
        self.assertEqual([s['storeName'] for s in self.rows(self.lhr.get('/api/shifts/'))], ['Metro LHR'])
        self.assertEqual(len(self.rows(self.lhr.get('/api/consumers/'))), 1)
        self.assertEqual([c['storeId'] for c in self.rows(self.lhr.get('/api/complaints/'))], [self.lahore.id])
        self.assertEqual([r['baName'] for r in self.rows(self.lhr.get('/api/daily-reports/'))], ['Ali'])
        self.assertEqual([r['baName'] for r in self.lhr.get('/api/attendance/').data['results']], ['Ali'])
        self.assertEqual(self.rows(self.lhr.get('/api/supervisors/')), [])
        metrics = self.lhr.get('/api/intelligence/campaign-metrics/').data
        self.assertEqual([p['id'] for p in metrics['map_pins']], [self.lahore.id])
        self.assertEqual(metrics['kpis']['shoppers_engaged'], 1)
        self.assertEqual(metrics['operations']['scheduled_today'], 1)

    def test_city_user_cannot_open_or_change_other_city_records(self):
        self.assertEqual(self.lhr.get(f'/api/stores/{self.multan.id}/').status_code, 404)
        self.assertEqual(self.lhr.patch(f'/api/complaints/cmp-{self.multan.id}/', {'status': 'Resolved'}, format='json').status_code, 404)
        self.assertEqual(self.lhr.get('/api/supervisor/overview/?supervisor=sup-m').status_code, 401)
        self.assertEqual(self.lhr.patch('/api/supervisors/sup-m/', {'name': 'x'}, format='json').status_code, 404)
        res = self.lhr.post('/api/supervisors/', {'name': 'S', 'email': 's@x.com', 'storeIds': [self.multan.id]}, format='json')
        self.assertEqual(res.status_code, 403)
        shift = self.lhr.post(
            '/api/shifts/', {'store_id': self.multan.id, 'month': '2026-10', 'startTime': '10:00', 'endTime': '18:00'},
            format='json',
        )
        self.assertEqual(shift.status_code, 403)
        bulk = self.lhr.post('/api/shifts/bulk/', {'rows': [{
            'ba_code': self.ba_m.ba_code, 'store_code': 'M-1', 'start_time': '10:00', 'end_time': '14:00', 'month': '2026-10',
        }]}, format='json')
        self.assertEqual(bulk.status_code, 400)
        self.assertEqual(MonthlyShift.objects.filter(month='2026-10').count(), 0)

    def test_global_settings_are_for_all_city_head_office(self):
        self.assertEqual(self.lhr.put('/api/kpi-config/', {'basePay': 5}, format='json').status_code, 403)
        self.assertEqual(self.lhr.patch('/api/platform-settings/', {'certification_threshold': 50}, format='json').status_code, 403)
        self.assertEqual(self.ho.put('/api/kpi-config/', {'basePay': 5}, format='json').status_code, 200)

    def test_city_user_creations_land_in_their_city(self):
        res = self.lhr.post('/api/ambassadors/', {'name': 'New BA', 'city': 'Karachi', 'email': 'n@x.com'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Ambassador.objects.get(name='New BA').city, 'Lahore')
        self.assertIn('New BA', [a['name'] for a in self.rows(self.lhr.get('/api/ambassadors/'))])

    def test_me_reports_city(self):
        self.assertEqual(self.lhr.get('/auth/users/me/').data['city'], 'Lahore')


class CreateHeadOfficeUserCommandTests(TestCase):
    def test_creates_city_user_and_all_city_user(self):
        out = StringIO()
        call_command('create_head_office_user', 'hassam@tapaltea.com', name='Hassam', city='Lahore', password='Secret@123', stdout=out)
        call_command('create_head_office_user', 'zoraiz@tapaltea.com', name='Zoraiz', generate=True, stdout=out)
        User = get_user_model()
        hassam = User.objects.get(email='hassam@tapaltea.com')
        self.assertEqual((hassam.user_type, hassam.city), (1, 'Lahore'))
        self.assertTrue(hassam.check_password('Secret@123'))
        self.assertEqual(User.objects.get(email='zoraiz@tapaltea.com').city, '')
        self.assertIn('Password: ', out.getvalue())
        login = APIClient().post('/auth/jwt/create/', {'email': 'hassam@tapaltea.com', 'password': 'Secret@123'}, format='json')
        self.assertEqual(login.status_code, 200)


class AmbassadorWithoutEmailTests(TestCase):
    def test_create_ambassador_without_email(self):
        user = get_user_model().objects.create_user(username='ho2', email='ho2@x.com', password='pw', user_type=1)
        client = APIClient()
        client.force_authenticate(user)
        for body in ({'name': 'No Email', 'city': 'Lahore', 'phone': '0300'}, {'name': 'Blank Email', 'email': ''}):
            res = client.post('/api/ambassadors/', body, format='json')
            self.assertEqual(res.status_code, 201, res.data)
            self.assertTrue(res.data['ba_code'])
            self.assertTrue(res.data['invite_token'])

import base64
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    Ambassador,
    AmbassadorComplaint,
    Consumer,
    DailyReport,
    JourneyVisit,
    MonthlyShift,
    ShiftAssignment,
    Store,
    Supervisor,
    SupervisorNotification,
    SurveyQuestion,
    UserInterception,
)
from .shifts import build_monthly_shift, parse_hhmm

# 1x1 PNG
PIXEL = 'data:image/png;base64,' + base64.b64encode(
    bytes.fromhex(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
        '0000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082'
    )
).decode()
REPORT = {'stock': {'danedar_950g': '10'}, 'sales': {'danedar_950g': '2'}, 'otherBrands': []}

MEDIA = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA)
class PortalTestBase(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        user = get_user_model().objects.create_user(username='ho', email='ho@x.com', password='pw', user_type=1)
        self.ho = APIClient()
        self.ho.force_authenticate(user)
        self.anon = APIClient()
        self.store = Store.objects.create(name='Metro', store_code='ST-01', city='Lahore', address='x')
        self.other_store = Store.objects.create(name='Imtiaz', store_code='ST-02', city='Karachi', address='y')
        self.ba = Ambassador.objects.create(name='Ali', status=Ambassador.Status.CERTIFIED)
        self.today = timezone.localdate()

    def make_supervisor(self, **extra):
        body = {
            'id': 'sup-test',
            'name': 'Imran',
            'email': 'imran@x.com',
            'phone': '0300',
            'city': 'Lahore',
            'password': 'Secret@123',
            'storeIds': [self.store.id],
            **extra,
        }
        return self.ho.post('/api/supervisors/', body, format='json')

    def supervisor_client(self, email='imran@x.com', password='Secret@123'):
        res = self.anon.post('/api/supervisor/login/', {'email': email, 'password': password}, format='json')
        client = APIClient()
        client.credentials(HTTP_X_SUPERVISOR_TOKEN=res.data['token'])
        return client

    def schedule_ba_today(self, store=None):
        store = store or self.store
        build_monthly_shift(
            store=store,
            ambassador=self.ba,
            month=self.today.strftime('%Y-%m'),
            start=parse_hhmm('00:00'),
            end=parse_hhmm('23:59'),
        ).save()


class SupervisorTests(PortalTestBase):
    def test_head_office_creates_and_lists_without_exposing_password(self):
        res = self.make_supervisor()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['id'], 'sup-test')
        self.assertEqual(res.data['storeIds'], [self.store.id])
        self.assertEqual(res.data['passwordHash'], 'set')
        self.assertNotIn('Secret', str(self.ho.get('/api/supervisors/').data))
        self.assertTrue(Supervisor.objects.get().password.startswith('pbkdf2_'))

    def test_only_head_office_manages_supervisors(self):
        self.assertEqual(self.anon.get('/api/supervisors/').status_code, 401)
        self.assertEqual(self.anon.post('/api/supervisors/', {}, format='json').status_code, 401)

    def test_duplicate_email_refused(self):
        self.make_supervisor()
        self.assertEqual(self.make_supervisor(id='sup-2').status_code, 400)

    def test_store_moves_to_its_new_supervisor(self):
        self.make_supervisor()
        self.make_supervisor(id='sup-2', email='nadia@x.com', storeIds=[self.store.id])
        self.assertEqual(Store.objects.get(pk=self.store.id).supervisor_id, 'sup-2')
        self.assertEqual(self.ho.get('/api/supervisors/').data['results'][1]['storeIds'], [])

    def test_login_and_me(self):
        self.make_supervisor()
        bad = self.anon.post('/api/supervisor/login/', {'email': 'imran@x.com', 'password': 'nope'}, format='json')
        self.assertEqual(bad.status_code, 400)
        client = self.supervisor_client()
        self.assertEqual(client.get('/api/supervisor/me/').data['supervisor']['name'], 'Imran')

    def test_new_password_signs_out_old_sessions(self):
        self.make_supervisor()
        client = self.supervisor_client()
        self.ho.patch('/api/supervisors/sup-test/', {'password': 'Other@123'}, format='json')
        self.assertEqual(client.get('/api/supervisor/me/').status_code, 401)
        self.supervisor_client(password='Other@123')

    def test_head_office_preview(self):
        self.make_supervisor()
        res = self.ho.get('/api/supervisor/me/?supervisor=sup-test')
        self.assertTrue(res.data['preview'])

    def test_overview_lists_only_own_stores_and_live_ba_state(self):
        self.make_supervisor()
        self.schedule_ba_today()
        client = self.supervisor_client()
        data = client.get('/api/supervisor/overview/').data
        self.assertEqual([s['id'] for s in data['stores']], [self.store.id])
        self.assertEqual(data['bas'][0]['state'], 'Offline')
        self.anon.post('/api/ba/check-in/', {'token': self.ba.invite_token}, format='json')
        data = client.get('/api/supervisor/overview/').data
        self.assertEqual(data['bas'][0]['state'], 'Active')
        self.assertEqual(data['stores'][0]['assigned'][0]['name'], 'Ali')
        self.assertEqual(data['coverage'], 100.0)

    def test_check_in_and_out_notify_the_store_supervisor(self):
        self.make_supervisor()
        self.schedule_ba_today()
        self.anon.post('/api/ba/check-in/', {'token': self.ba.invite_token}, format='json')
        self.anon.post('/api/ba/check-out/', {'token': self.ba.invite_token, 'report': REPORT}, format='json')
        client = self.supervisor_client()
        messages = [n['message'] for n in client.get('/api/supervisor/notifications/').data['results']]
        self.assertEqual(len(messages), 2)
        self.assertTrue(any('checked in at Metro' in m for m in messages))
        today_shift = self.anon.get(f'/api/ba/today-shift/?token={self.ba.invite_token}').data
        self.assertEqual(today_shift['shift']['supervisorId'], 'sup-test')
        client.delete('/api/supervisor/notifications/')
        self.assertEqual(SupervisorNotification.objects.count(), 0)


class JourneyTests(PortalTestBase):
    def setUp(self):
        super().setUp()
        self.make_supervisor()
        self.week = (self.today - timezone.timedelta(days=self.today.weekday())).isoformat()

    def plan(self, stops):
        return self.ho.put(
            '/api/journey-plans/', {'supervisorId': 'sup-test', 'weekStart': self.week, 'stops': stops}, format='json'
        )

    def test_head_office_plans_and_supervisor_reads(self):
        res = self.plan([{'day': 'Wed', 'storeId': self.store.id}, {'day': 'Mon', 'storeId': self.store.id}])
        self.assertEqual([s['day'] for s in res.data['plan']['stops']], ['Mon', 'Wed'])
        plans = self.supervisor_client().get('/api/journey-plans/').data['results']
        self.assertEqual(len(plans), 1)
        self.assertEqual(self.plan([]).data['plan'], None)

    def test_supervisor_cannot_plan(self):
        client = self.supervisor_client()
        res = client.put(
            '/api/journey-plans/', {'supervisorId': 'sup-test', 'weekStart': self.week, 'stops': []}, format='json'
        )
        self.assertEqual(res.status_code, 403)

    def test_visit_needs_plan_and_three_photos(self):
        client = self.supervisor_client()
        body = {
            'weekStart': self.week, 'day': 'Mon', 'storeId': self.store.id,
            'latitude': 31.5, 'longitude': 74.3, 'accuracy': 12,
            'selfie': PIXEL, 'baPhoto': PIXEL, 'stockPhoto': PIXEL,
        }
        self.assertEqual(client.post('/api/journey-visits/', body, format='json').status_code, 400)
        self.plan([{'day': 'Mon', 'storeId': self.store.id}])
        self.assertEqual(client.post('/api/journey-visits/', {**body, 'stockPhoto': ''}, format='json').status_code, 400)
        res = client.post('/api/journey-visits/', body, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertIn('/media/journey/', res.data['selfie'])
        client.post('/api/journey-visits/', body, format='json')
        self.assertEqual(JourneyVisit.objects.count(), 1)
        self.assertEqual(len(self.ho.get('/api/journey-visits/').data['results']), 1)


class ComplaintTests(PortalTestBase):
    def file(self, **extra):
        body = {
            'token': self.ba.invite_token, 'id': 'cmp-abc', 'kind': 'customer', 'storeId': self.store.id,
            'brand': 'Tapal Danedar', 'sku': 'Danedar 90g', 'customerName': 'Sara', 'customerNumber': '0300',
            'complaint': 'Seal broken', 'image': PIXEL, **extra,
        }
        return self.anon.post('/api/complaints/', body, format='json')

    def test_ba_files_customer_complaint_with_photo(self):
        res = self.file()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['id'], 'cmp-abc')
        self.assertEqual(res.data['baId'], f'api-{self.ba.id}')
        self.assertIn('/media/complaints/', res.data['image'])
        self.assertEqual(self.file().status_code, 200)  # resending the same id does not duplicate
        self.assertEqual(AmbassadorComplaint.objects.count(), 1)

    def test_ba_issue_and_validation(self):
        res = self.file(id='cmp-2', kind='ba', category='Product stock', subject='No stock', details='Shelf empty')
        self.assertEqual(res.data['details'], 'Shelf empty')
        self.assertEqual(self.file(id='cmp-3', customerName='').status_code, 400)
        self.assertEqual(self.file(id='cmp-4', token='nope').status_code, 401)

    def test_head_office_updates_and_supervisor_sees_own_stores(self):
        self.file()
        self.file(id='cmp-other', storeId=self.other_store.id)
        res = self.ho.patch('/api/complaints/cmp-abc/', {'status': 'Rejected', 'hoNote': 'Duplicate'}, format='json')
        self.assertEqual(res.data['status'], 'Rejected')
        self.assertEqual(res.data['hoNote'], 'Duplicate')
        self.assertEqual(len(self.ho.get('/api/complaints/').data['results']), 2)
        self.make_supervisor()
        own = self.supervisor_client().get('/api/complaints/').data['results']
        self.assertEqual([c['id'] for c in own], ['cmp-abc'])

    def test_legacy_ba_complaint_endpoint_still_works(self):
        self.schedule_ba_today()
        res = self.anon.post(
            '/api/ba/complaints/', {'token': self.ba.invite_token, 'store_id': self.store.id, 'complaint': 'Old'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(self.ho.get('/api/complaints/').data['results'][0]['details'], 'Old')


class ReportAndInterceptionTests(PortalTestBase):
    def test_daily_reports(self):
        self.schedule_ba_today()
        body = {'token': self.ba.invite_token, 'id': 'rep-1', 'source': 'anytime', **REPORT}
        self.assertEqual(self.anon.post('/api/daily-reports/', body, format='json').status_code, 201)
        self.assertEqual(self.anon.post('/api/daily-reports/', body, format='json').status_code, 200)
        self.assertEqual(DailyReport.objects.get().store, self.store)
        self.assertEqual(self.ho.get('/api/daily-reports/').data['results'][0]['baId'], f'api-{self.ba.id}')
        own = self.anon.get(f'/api/daily-reports/?token={self.ba.invite_token}').data['results']
        self.assertEqual(len(own), 1)
        self.assertEqual(self.anon.get('/api/daily-reports/').status_code, 401)
        empty = {'token': self.ba.invite_token, 'id': 'rep-2', 'source': 'anytime', 'stock': {}}
        self.assertEqual(self.anon.post('/api/daily-reports/', empty, format='json').status_code, 400)

    def test_interceptions(self):
        body = {'token': self.ba.invite_token, 'id': 'int-1', 'name': 'Bilal', 'contact': '0321', 'currentSku': 'Danedar 90g'}
        self.assertEqual(self.anon.post('/api/interceptions/', body, format='json').status_code, 201)
        self.assertEqual(self.ho.get('/api/interceptions/').data['results'][0]['currentSku'], 'Danedar 90g')
        self.assertEqual(
            self.anon.post('/api/interceptions/', {**body, 'id': 'int-2', 'name': ''}, format='json').status_code, 400
        )
        self.assertEqual(UserInterception.objects.count(), 1)

    def test_early_checkouts(self):
        self.schedule_ba_today()
        self.anon.post('/api/ba/check-in/', {'token': self.ba.invite_token}, format='json')
        self.anon.post(
            '/api/ba/check-out/', {'token': self.ba.invite_token, 'report': REPORT, 'early_reason': 'Unwell'},
            format='json',
        )
        rows = self.ho.get('/api/early-checkouts/').data['results']
        self.assertEqual(rows[0]['reason'], 'Unwell')
        self.assertEqual(rows[0]['storeName'], 'Metro')

    def test_ba_stores(self):
        self.schedule_ba_today(self.other_store)
        data = self.anon.get(f'/api/ba/stores/?token={self.ba.invite_token}').data
        self.assertEqual([s['id'] for s in data['results']], [self.other_store.id])
        self.assertEqual(data['current_store_id'], self.other_store.id)


class KpiAndShopperTests(PortalTestBase):
    def test_kpi_config(self):
        self.assertEqual(self.anon.get('/api/kpi-config/').data['basePay'], 1000)
        res = self.ho.put('/api/kpi-config/', {'basePay': 1500, 'sessionTarget': 0, 'conversionAmount': -3}, format='json')
        self.assertEqual(res.data['basePay'], 1500)
        self.assertEqual(res.data['sessionTarget'], 50)  # targets must be > 0
        self.assertEqual(res.data['conversionAmount'], 500)
        self.assertEqual(self.anon.put('/api/kpi-config/', {'basePay': 1}, format='json').status_code, 401)

    def test_shopper_session_and_feedback(self):
        q1 = SurveyQuestion.objects.filter(order=1, store__isnull=True).first() or SurveyQuestion.objects.create(
            order=1, text='Which tea?', options=['Tapal Tea']
        )
        body = {
            'store': self.store.qr_slug, 'name': 'Hina', 'phone': '0333', 'gender': 'Female', 'age': '31',
            'currentBrand': 'Lipton', 'reasons': ['Better taste'], 'consent': True,
        }
        res = self.anon.post('/api/shopper/sessions/', body, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        consumer = Consumer.objects.get(pk=res.data['id'])
        self.assertEqual(consumer.answers, {str(q1.id): 'Lipton'})
        self.assertEqual(consumer.reasons, ['Better taste'])
        fb = self.anon.patch(f'/api/shopper/consumers/{consumer.id}/feedback/', {'feedback_rating': 5}, format='json')
        self.assertEqual(fb.status_code, 200)
        self.assertEqual(self.anon.post('/api/shopper/sessions/', {**body, 'consent': False}, format='json').status_code, 400)
        self.assertEqual(self.anon.post('/api/shopper/sessions/', {**body, 'store': 'nope'}, format='json').status_code, 400)
        self.assertEqual(self.anon.post('/api/shopper/sessions/', {**body, 'age': 'x'}, format='json').status_code, 400)

    def test_shopper_store_lookup(self):
        res = self.anon.get(f'/api/shopper/store/{self.store.qr_slug}/')
        self.assertEqual(res.data['name'], 'Metro')


class ShiftsStillWork(PortalTestBase):
    def test_monthly_shift_row_exists(self):
        self.schedule_ba_today()
        self.assertEqual(MonthlyShift.objects.count(), 1)
        self.anon.get(f'/api/ba/today-shift/?token={self.ba.invite_token}')
        self.assertEqual(ShiftAssignment.objects.count(), 1)


class UncertifiedBaCanUseAppTests(PortalTestBase):
    def test_pending_ba_has_full_access(self):
        ba = Ambassador.objects.create(name='New BA', status=Ambassador.Status.PENDING)
        build_monthly_shift(
            store=self.store, ambassador=ba, month=self.today.strftime('%Y-%m'),
            start=parse_hhmm('00:00'), end=parse_hhmm('23:59'),
        ).save()
        token = ba.invite_token
        self.assertTrue(self.anon.get(f'/api/ba/today-shift/?token={token}').data['has_shift'])
        self.assertEqual(self.anon.post('/api/ba/check-in/', {'token': token}, format='json').status_code, 200)
        out = self.anon.post('/api/ba/check-out/', {'token': token, 'report': REPORT}, format='json')
        self.assertEqual(out.status_code, 200)
        self.assertEqual(self.anon.get(f'/api/ba/leaderboard/?token={token}').status_code, 200)
        legacy = self.anon.post('/api/ba/complaints/', {'token': token, 'store_id': self.store.id, 'complaint': 'x'}, format='json')
        self.assertEqual(legacy.status_code, 201)

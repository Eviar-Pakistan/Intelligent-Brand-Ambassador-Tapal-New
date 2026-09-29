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


class AmbassadorManagementTests(PortalTestBase):
    def test_edit_details(self):
        res = self.ho.patch(f'/api/ambassadors/{self.ba.id}/', {'name': 'Ali Raza', 'phone': '0301', 'city': 'Multan'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual((res.data['name'], res.data['phone'], res.data['city']), ('Ali Raza', '0301', 'Multan'))
        self.assertEqual(self.ho.patch(f'/api/ambassadors/{self.ba.id}/', {'name': ' '}, format='json').status_code, 400)
        other = Ambassador.objects.create(name='B', email='b@x.com')
        self.assertEqual(self.ho.patch(f'/api/ambassadors/{self.ba.id}/', {'email': 'B@x.com'}, format='json').status_code, 400)
        self.assertTrue(other.pk)

    def test_deactivated_ba_is_locked_out(self):
        self.schedule_ba_today()
        token = self.ba.invite_token
        res = self.ho.patch(f'/api/ambassadors/{self.ba.id}/', {'is_active': False}, format='json')
        self.assertFalse(res.data['is_active'])
        self.assertEqual(self.anon.get(f'/api/ba/invite/{token}/').status_code, 404)
        self.assertEqual(self.anon.get(f'/api/ba/today-shift/?token={token}').status_code, 404)
        self.assertEqual(self.anon.post('/api/ba/check-in/', {'token': token}, format='json').status_code, 404)
        self.assertEqual(self.ho.get('/api/attendance/').data['results'], [])
        bulk = self.ho.post('/api/shifts/bulk/', {'rows': [{
            'ba_code': self.ba.ba_code, 'store_code': 'ST-01', 'start_time': '10:00', 'end_time': '14:00', 'month': '2026-11',
        }]}, format='json')
        self.assertEqual(bulk.status_code, 400)
        self.ho.patch(f'/api/ambassadors/{self.ba.id}/', {'is_active': True}, format='json')
        self.assertEqual(self.anon.get(f'/api/ba/today-shift/?token={token}').status_code, 200)

    def test_single_target_total(self):
        body = {'rows': [{'baCode': self.ba.ba_code, 'month': '2026-10', 'targetKg': 120, 'salesKg': 30}]}
        res = self.ho.post('/api/ba-targets/', body, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        row = self.ho.get('/api/ba-targets/?month=2026-10').data['results'][0]
        self.assertEqual((row['targetKg'], row['salesKg'], row['lines']), (120.0, 30.0, []))


class LiveStoreTests(PortalTestBase):
    def store_row(self, client=None, pk=None):
        return (client or self.ho).get(f'/api/stores/{pk or self.store.id}/').data

    def test_status_coverage_and_assigned_follow_shifts(self):
        row = self.store_row()
        self.assertEqual((row['status'], row['bas'], row['assigned']), ('Pending', 0, []))
        self.schedule_ba_today()
        row = self.store_row()
        self.assertEqual((row['status'], row['bas'], row['coverage']), ('PARTIAL', 1, 0))
        self.assertEqual(row['assigned'], [{'id': f'api-{self.ba.id}', 'name': 'Ali', 'state': 'Offline'}])
        self.anon.post('/api/ba/check-in/', {'token': self.ba.invite_token}, format='json')
        row = self.store_row()
        self.assertEqual((row['status'], row['coverage'], row['assigned'][0]['state']), ('LIVE', 100, 'Active'))

    def test_edit_deactivate_delete(self):
        res = self.ho.patch(f'/api/stores/{self.store.id}/', {'name': 'Metro Plus', 'contact_phone': '042'}, format='json')
        self.assertEqual((res.data['name'], res.data['contact_phone']), ('Metro Plus', '042'))
        self.assertEqual(self.ho.patch(f'/api/stores/{self.store.id}/', {'status': 'INACTIVE'}, format='json').data['status'], 'INACTIVE')
        self.assertEqual(self.ho.patch(f'/api/stores/{self.store.id}/', {'status': 'Pending'}, format='json').data['status'], 'Pending')
        self.assertEqual(self.ho.delete(f'/api/stores/{self.other_store.id}/').status_code, 204)
        self.assertFalse(Store.objects.filter(pk=self.other_store.id).exists())

    def test_footfall_by_head_office_and_ba_and_daily_reset(self):
        from datetime import timedelta
        from .models import StoreFootfall

        res = self.ho.post(f'/api/stores/{self.store.id}/footfall/', {'count': 200}, format='json')
        self.assertEqual(res.data['today_footfall'], 200)
        self.schedule_ba_today()
        token = self.ba.invite_token
        self.assertEqual(self.anon.get(f'/api/ba/footfall/?token={token}').data['todayFootfall'], 200)
        self.assertEqual(self.anon.post('/api/ba/footfall/', {'token': token, 'count': 250}, format='json').data['todayFootfall'], 250)
        self.assertEqual(StoreFootfall.objects.get(store=self.store).count, 250)
        self.assertEqual(self.anon.post('/api/ba/footfall/', {'token': token, 'count': -1}, format='json').status_code, 400)
        Store.objects.filter(pk=self.store.pk).update(footfall_date=self.today - timedelta(days=1))
        self.assertEqual(self.anon.get(f'/api/ba/footfall/?token={token}').data['todayFootfall'], 0)

    def test_conversion_and_engagement_include_interceptions(self):
        from .models import UserInterception

        for i, brand in enumerate(['Lipton', 'Supreme', 'Tapal Danedar', 'lipton']):
            UserInterception.objects.create(
                id=f'int-{i}', ambassador=self.ba, ba_name='Ali', store=self.store, name='S', contact='0300',
                previous_brand=brand, current_sku='DD 90g', created_at=timezone.now(),
            )
        self.ho.post(f'/api/stores/{self.store.id}/footfall/', {'count': 8}, format='json')
        row = self.store_row()
        self.assertEqual(row['conversion'], 75.0)   # 3 of 4 switched to Tapal
        self.assertEqual(row['engagement'], 50.0)   # 4 engaged / 8 walked in
        metrics = self.ho.get('/api/intelligence/campaign-metrics/').data
        self.assertEqual(metrics['kpis']['conversion_rate'], 75.0)
        pin = [p for p in metrics['map_pins'] if p['id'] == self.store.id][0]
        self.assertEqual(pin['conversion_rate'], 75.0)


class StoreShopperContentTests(PortalTestBase):
    def test_store_questions_and_rewards_reach_the_shopper(self):
        q = self.ho.post('/api/survey-questions/', {
            'store': self.store.id, 'order': 1, 'text': 'Your tea?', 'options': ['Tapal', 'Other'], 'is_active': True,
        }, format='json')
        self.assertEqual(q.status_code, 201, q.data)
        r = self.ho.post('/api/store-rewards/', {
            'store': self.store.id, 'label': 'Free sample', 'win_amount': 'Rs. 50 OFF', 'promo_code': 'MET50',
            'is_active': True, 'is_featured': True,
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        slug = self.store.qr_slug
        questions = self.anon.get(f'/api/shopper/questions/?store={slug}').data
        self.assertEqual([(x['text'], x['store']) for x in questions], [('Your tea?', self.store.id)])
        rewards = self.anon.get(f'/api/shopper/store/{slug}/rewards/').data
        self.assertEqual(rewards[0]['promo_code'], 'MET50')


class CheckInOutLocationTests(PortalTestBase):
    def test_location_saved_at_check_in_and_out(self):
        self.schedule_ba_today()
        token = self.ba.invite_token
        self.anon.post('/api/ba/check-in/', {'token': token, 'latitude': 31.5204, 'longitude': 74.3587, 'accuracy': 12}, format='json')
        self.anon.post('/api/ba/check-out/', {'token': token, 'report': REPORT, 'latitude': 31.5210, 'longitude': 74.3590, 'accuracy': 20}, format='json')
        row = self.ho.get('/api/attendance/').data['results'][0]
        self.assertEqual((row['checkInLat'], row['checkInLng'], row['checkInAccuracy']), (31.5204, 74.3587, 12.0))
        self.assertEqual((row['checkOutLat'], row['checkOutLng'], row['checkOutAccuracy']), (31.521, 74.359, 20.0))

    def test_missing_or_bad_location_is_not_stored(self):
        self.schedule_ba_today()
        token = self.ba.invite_token
        self.assertEqual(self.anon.post('/api/ba/check-in/', {'token': token, 'latitude': 999, 'longitude': 74}, format='json').status_code, 200)
        self.anon.post('/api/ba/check-out/', {'token': token, 'report': REPORT}, format='json')
        row = self.ho.get('/api/attendance/').data['results'][0]
        self.assertEqual((row['checkInLat'], row['checkOutLat'], row['status']), (None, None, 'Present'))


class BaAppDataTests(PortalTestBase):
    def test_me_summary(self):
        from .models import AmbassadorMonthTarget

        self.schedule_ba_today()
        token = self.ba.invite_token
        self.anon.post('/api/ba/check-in/', {'token': token}, format='json')
        AmbassadorMonthTarget.objects.create(
            ambassador=self.ba, store=self.store, month=self.today.strftime('%Y-%m'), target_total=100, sales_total=40
        )
        Consumer.objects.create(store=self.store, answers={}, feedback_rating=4)
        Consumer.objects.create(store=self.store, answers={}, feedback_rating=5)
        UserInterception.objects.create(
            id='int-me', ambassador=self.ba, ba_name='Ali', store=self.store, name='S', contact='0300',
            previous_brand='Lipton', current_sku='DD', created_at=timezone.now(),
        )
        me = self.anon.get(f'/api/ba/me/?token={token}').data
        self.assertEqual((me['rank'], me['daysWorked'], me['rating'], me['certified']), (1, 1, 4.5, True))
        self.assertEqual((me['monthTarget']['targetKg'], me['monthTarget']['salesKg']), (100.0, 40.0))
        self.assertEqual((me['today']['interceptions'], me['today']['switched'], me['today']['dailyGoal']), (1, 1, 9))
        self.assertEqual(me['storeName'], 'Metro')
        self.assertEqual(self.anon.get('/api/ba/me/?token=nope').status_code, 404)

    def test_check_in_selfie_is_saved(self):
        self.schedule_ba_today()
        self.anon.post('/api/ba/check-in/', {'token': self.ba.invite_token, 'selfie': PIXEL}, format='json')
        row = self.ho.get('/api/attendance/').data['results'][0]
        self.assertIn('/media/checkins/', row['checkInPhoto'])

    def test_retraining_answers_recorded(self):
        token = self.ba.invite_token
        res = self.anon.post('/api/ba/training/practice/', {
            'token': token, 'kind': 'scenario', 'title': 'Price objection', 'question': 'It is expensive', 'answer': 'Cost per cup is low',
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(self.anon.post('/api/ba/training/practice/', {'token': token, 'kind': 'x', 'question': 'q', 'answer': 'a'}, format='json').status_code, 400)
        rows = self.ho.get(f'/api/ba/training/practice/?ambassador={self.ba.id}').data['results']
        self.assertEqual((rows[0]['baName'], rows[0]['answer']), ('Ali', 'Cost per cup is low'))
        self.assertEqual(len(self.anon.get(f'/api/ba/training/practice/?token={token}').data['results']), 1)

    def test_ba_sees_own_complaints_with_status(self):
        other = Ambassador.objects.create(name='Zara')
        body = {'kind': 'ba', 'storeId': self.store.id, 'category': 'Other', 'subject': 'Shelf', 'details': 'Empty shelf'}
        self.anon.post('/api/complaints/', {**body, 'token': self.ba.invite_token, 'id': 'cmp-mine'}, format='json')
        self.anon.post('/api/complaints/', {**body, 'token': other.invite_token, 'id': 'cmp-other'}, format='json')
        self.ho.patch('/api/complaints/cmp-mine/', {'status': 'Resolved', 'hoNote': 'Restocked'}, format='json')
        mine = self.anon.get(f'/api/complaints/?token={self.ba.invite_token}').data['results']
        self.assertEqual([(c['id'], c['status'], c['hoNote']) for c in mine], [('cmp-mine', 'Resolved', 'Restocked')])

    def test_interception_date_filter(self):
        from datetime import timedelta

        for i, days in enumerate([0, 10]):
            UserInterception.objects.create(
                id=f'int-d{i}', ambassador=self.ba, ba_name='Ali', store=self.store, name='S', contact='0300',
                created_at=timezone.now() - timedelta(days=days),
            )
        rows = self.ho.get(f'/api/interceptions/?date_from={self.today.isoformat()}').data['results']
        self.assertEqual([r['id'] for r in rows], ['int-d0'])


class OncePerDayTests(PortalTestBase):
    def test_only_one_check_in_and_out_per_day_even_with_two_shifts(self):
        month = self.today.strftime('%Y-%m')
        for store, (start, end) in ((self.store, ('00:00', '11:00')), (self.other_store, ('12:00', '23:59'))):
            build_monthly_shift(store=store, ambassador=self.ba, month=month, start=parse_hhmm(start), end=parse_hhmm(end)).save()
        token = self.ba.invite_token
        self.assertEqual(self.anon.post('/api/ba/check-in/', {'token': token}, format='json').status_code, 200)
        self.assertEqual(self.anon.post('/api/ba/check-in/', {'token': token}, format='json').status_code, 200)  # same shift
        self.assertEqual(self.anon.post('/api/ba/check-out/', {'token': token, 'report': REPORT}, format='json').status_code, 200)
        again = self.anon.post('/api/ba/check-in/', {'token': token}, format='json')
        self.assertEqual(again.status_code, 400)
        self.assertIn('already checked in and out today', again.data['detail'])
        self.assertEqual(ShiftAssignment.objects.filter(checked_in_at__isnull=False).count(), 1)
        shift = self.anon.get(f'/api/ba/today-shift/?token={token}').data['shift']
        self.assertEqual((shift['checkedIn'], shift['checkedOut'], shift['reportSubmitted']), (True, True, True))


class LeaderboardTests(PortalTestBase):
    def test_every_active_ba_ranked_on_field_work(self):
        pending = Ambassador.objects.create(name='Pending BA', status=Ambassador.Status.PENDING)
        gone = Ambassador.objects.create(name='Gone', status=Ambassador.Status.CERTIFIED, is_active=False)
        self.schedule_ba_today()
        token = self.ba.invite_token
        self.anon.post('/api/ba/check-in/', {'token': token}, format='json')
        self.anon.post('/api/ba/check-out/', {'token': token, 'report': REPORT}, format='json')
        UserInterception.objects.create(
            id='int-lb', ambassador=pending, ba_name='Pending BA', store=self.store, name='S', contact='0300',
            previous_brand='Lipton', current_sku='DD', created_at=timezone.now(),
        )
        rows = self.ho.get('/api/intelligence/leaderboard/').data['results']
        names = [r['name'] for r in rows]
        self.assertNotIn('Gone', names)
        ali = next(r for r in rows if r['name'] == 'Ali')
        p = next(r for r in rows if r['name'] == 'Pending BA')
        self.assertEqual((ali['rank'], ali['days_present'], ali['points']), (1, 1, 50))
        self.assertEqual((p['interactions'], p['conversion'], p['points'], p['rank']), (1, 100.0, 25, 2))
        self.assertIsNone(p['customer_rating'])
        self.assertTrue(gone.pk)


class SupervisorPasswordTests(PortalTestBase):
    def test_head_office_can_see_and_edit(self):
        self.make_supervisor()
        self.assertEqual(self.ho.get('/api/supervisors/sup-test/password/').data['password'], 'Secret@123')
        self.ho.patch('/api/supervisors/sup-test/', {'password': 'New@12345', 'name': 'Imran K', 'phone': '0301', 'city': 'Multan'}, format='json')
        self.assertEqual(self.ho.get('/api/supervisors/sup-test/password/').data['password'], 'New@12345')
        row = self.ho.get('/api/supervisors/').data['results'][0]
        self.assertEqual((row['name'], row['phone'], row['city']), ('Imran K', '0301', 'Multan'))
        self.assertNotIn('New@12345', str(row))
        self.assertEqual(self.anon.get('/api/supervisors/sup-test/password/').status_code, 401)
        self.assertEqual(self.supervisor_client(password='New@12345').get('/api/supervisors/sup-test/password/').status_code, 401)

    def test_old_supervisor_without_copy(self):
        Supervisor.objects.create(id='sup-old', name='Old', email='old@x.com', password='pbkdf2_sha256$x')
        data = self.ho.get('/api/supervisors/sup-old/password/').data
        self.assertEqual((data['password'], data['hasLogin']), (None, True))


class ServerPushTests(PortalTestBase):
    def test_check_in_and_out_push_from_the_server(self):
        from unittest import mock

        self.make_supervisor()
        self.schedule_ba_today()
        token = self.ba.invite_token
        with mock.patch('api.push_views.send_push_later') as push:
            self.anon.post('/api/ba/check-in/', {'token': token}, format='json')
            self.anon.post('/api/ba/check-in/', {'token': token}, format='json')  # repeat: no second alert
            self.anon.post('/api/ba/check-out/', {'token': token, 'report': REPORT}, format='json')
        titles = [c.args[1] for c in push.call_args_list]
        self.assertEqual(titles, ['BA checked in', 'BA checked out'])
        self.assertEqual(push.call_args_list[0].args[0], 'sup-test')
        self.assertIn('Ali checked in at Metro', push.call_args_list[0].args[2])

    def test_register_needs_supervisor_sign_in_and_send_is_head_office_only(self):
        from .models import SupervisorPushToken

        self.make_supervisor()
        self.assertEqual(self.anon.post('/api/push/register', {'supervisorId': 'sup-test', 'token': 't1'}, format='json').status_code, 401)
        sup = self.supervisor_client()
        self.assertEqual(sup.post('/api/push/register', {'token': 't1'}, format='json').status_code, 200)
        self.assertEqual(SupervisorPushToken.objects.get().supervisor_id, 'sup-test')
        self.assertEqual(self.anon.post('/api/push/send', {'supervisorId': 'sup-test', 'title': 'x'}, format='json').status_code, 401)
        self.assertEqual(self.anon.get('/api/push/inbox').status_code, 401)

    def test_firebase_config_served(self):
        self.assertIn('vapidKey', self.anon.get('/firebase-config.json').data)
        self.assertEqual(self.anon.get('/firebase-messaging-sw.js')['Content-Type'], 'application/javascript')


class SupervisorAttendanceTargetsTests(PortalTestBase):
    def test_supervisor_sees_own_stores_only(self):
        from .models import AmbassadorMonthTarget

        self.make_supervisor()
        self.schedule_ba_today()
        other = Ambassador.objects.create(name='Zara', status=Ambassador.Status.CERTIFIED)
        build_monthly_shift(store=self.other_store, ambassador=other, month=self.today.strftime('%Y-%m'),
                            start=parse_hhmm('00:00'), end=parse_hhmm('23:59')).save()
        month = self.today.strftime('%Y-%m')
        AmbassadorMonthTarget.objects.create(ambassador=self.ba, store=self.store, month=month, target_total=100, sales_total=30)
        AmbassadorMonthTarget.objects.create(ambassador=other, store=self.other_store, month=month, target_total=50)
        sup = self.supervisor_client()
        self.anon.post('/api/ba/check-in/', {'token': self.ba.invite_token, 'selfie': PIXEL, 'latitude': 31.5, 'longitude': 74.3}, format='json')
        rows = sup.get('/api/attendance/').data['results']
        self.assertEqual([r['baName'] for r in rows], ['Ali'])
        self.assertTrue(rows[0]['checkInPhoto'])
        self.assertEqual(rows[0]['checkInLat'], 31.5)
        targets = sup.get(f'/api/ba-targets/?month={month}').data['results']
        self.assertEqual([(t['baName'], t['targetKg'], t['salesKg']) for t in targets], [('Ali', 100.0, 30.0)])
        self.assertEqual(sup.post('/api/ba-targets/', {'rows': [{'baCode': 'x'}]}, format='json').status_code, 403)
        self.assertEqual(self.anon.get('/api/attendance/').status_code, 401)
        self.assertEqual(len(self.ho.get('/api/attendance/').data['results']), 2)
        preview = self.ho.get(f'/api/attendance/?supervisor=sup-test').data['results']
        self.assertEqual([r['baName'] for r in preview], ['Ali'])

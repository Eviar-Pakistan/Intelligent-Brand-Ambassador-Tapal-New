from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Ambassador, MonthlyShift, ShiftAssignment, Store


class ShiftTestBase(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(
            username='ho', email='ho@example.com', password='pw', user_type=1
        )
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.store = Store.objects.create(name='Metro', store_code='ST-01', city='Lahore', address='x')
        self.other = Store.objects.create(name='Imtiaz', store_code='ST-02', city='Lahore', address='y')
        self.ba = Ambassador.objects.create(name='Ali', status=Ambassador.Status.CERTIFIED)
        self.pending = Ambassador.objects.create(name='Sana', status=Ambassador.Status.PENDING)

    def post(self, rows):
        return self.client.post('/api/shifts/bulk/', {'rows': rows}, format='json')

    def row(self, **extra):
        return {
            'ba_code': self.ba.ba_code.lower(),
            'store_code': 'st-01',
            'start_time': '10:00',
            'end_time': '14:00',
            'month': '2026-02',
            **extra,
        }


class BulkMonthlyShiftTests(ShiftTestBase):
    def test_one_row_is_one_monthly_shift(self):
        res = self.post([self.row()])
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['created'], 1)
        shift = MonthlyShift.objects.get()
        self.assertEqual(shift.month, '2026-02')
        self.assertEqual(shift.shift_label, '10:00 AM – 2:00 PM')
        self.assertEqual(shift.status, MonthlyShift.Status.SCHEDULED)
        self.assertEqual(ShiftAssignment.objects.count(), 0)

    def test_reupload_does_not_duplicate(self):
        self.post([self.row()])
        res = self.post([self.row()])
        self.assertEqual(res.data['created'], 0)
        self.assertEqual(res.data['skipped_existing'], 1)
        self.assertEqual(MonthlyShift.objects.count(), 1)

    def test_overlap_at_other_store_is_conflict(self):
        self.post([self.row()])
        res = self.post([self.row(store_code='ST-02', start_time='13:00', end_time='17:00')])
        self.assertEqual(res.data['conflicts'], 1)

    def test_bad_rows_are_reported_and_good_rows_saved(self):
        res = self.post(
            [
                self.row(),
                self.row(ba_code='BA-NOPE'),
                self.row(ba_code=self.pending.ba_code),
                self.row(store_code='ST-99', month='2026-13', end_time='09:00'),
            ]
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['rows_saved'], 2)
        self.assertEqual(len(res.data['errors']), 2)

    def test_all_rows_invalid_is_400(self):
        res = self.post([self.row(ba_code='')])
        self.assertEqual(res.status_code, 400)
        self.assertEqual(MonthlyShift.objects.count(), 0)


class MonthlyShiftApiTests(ShiftTestBase):
    def create(self, **extra):
        body = {'store_id': self.store.id, 'month': '2026-10', 'startTime': '10:00', 'endTime': '18:30', **extra}
        return self.client.post('/api/shifts/', body, format='json')

    def test_create_builds_label_and_open_status(self):
        res = self.create()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['shift'], '10:00 AM – 6:30 PM')
        self.assertEqual(res.data['monthLabel'], 'October 2026')
        self.assertEqual(res.data['status'], 'Open')

    def test_assign_and_clear_ba(self):
        shift_id = self.create().data['id']
        res = self.client.patch(f'/api/shifts/{shift_id}/', {'ambassador_id': self.pending.id}, format='json')
        self.assertEqual(res.data['baName'], 'Sana')
        self.assertEqual(res.data['status'], 'Scheduled')
        res = self.client.patch(f'/api/shifts/{shift_id}/', {'ambassador_id': None}, format='json')
        self.assertEqual(res.data['status'], 'Open')

    def test_end_before_start_rejected(self):
        self.assertEqual(self.create(startTime='18:00', endTime='10:00').status_code, 400)

    def test_bad_month_rejected(self):
        self.assertEqual(self.create(month='2026-13').status_code, 400)

    def test_list_by_month(self):
        self.create()
        self.create(month='2026-11')
        res = self.client.get('/api/shifts/?month=2026-10')
        self.assertEqual(res.data['month_label'], 'October 2026')
        self.assertEqual(len(res.data['results']), 1)


class DailyAttendanceTests(ShiftTestBase):
    def setUp(self):
        super().setUp()
        self.month = timezone.localdate().strftime('%Y-%m')
        self.post([self.row(month=self.month)])
        self.monthly = MonthlyShift.objects.get()

    def test_today_shift_comes_from_monthly_shift(self):
        res = self.client.get(f'/api/ba/today-shift/?token={self.ba.invite_token}')
        self.assertTrue(res.data['has_shift'])
        self.assertEqual(res.data['shift']['startTime'], '10:00')
        self.assertEqual(ShiftAssignment.objects.get().monthly_shift, self.monthly)

    def test_check_in_records_today_only(self):
        res = self.client.post('/api/ba/check-in/', {'token': self.ba.invite_token}, format='json')
        self.assertIn(res.status_code, (200, 201), res.data)
        row = ShiftAssignment.objects.get()
        self.assertEqual(row.date, timezone.localdate())
        self.assertIsNotNone(row.checked_in_at)

    def test_editing_hours_updates_today_before_check_in(self):
        self.client.get(f'/api/ba/today-shift/?token={self.ba.invite_token}')
        self.client.patch(f'/api/shifts/{self.monthly.id}/', {'startTime': '12:00', 'endTime': '20:00'}, format='json')
        self.assertEqual(ShiftAssignment.objects.get().shift_label, '12:00 PM – 8:00 PM')

    def test_deleting_keeps_checked_in_day(self):
        self.client.post('/api/ba/check-in/', {'token': self.ba.invite_token}, format='json')
        self.client.delete(f'/api/shifts/{self.monthly.id}/')
        self.assertEqual(MonthlyShift.objects.count(), 0)
        self.assertEqual(ShiftAssignment.objects.count(), 1)


class CampaignMetricsTests(ShiftTestBase):
    def test_metrics_reflect_database(self):
        from .models import Consumer

        month = timezone.localdate().strftime('%Y-%m')
        self.post([self.row(month=month)])
        Consumer.objects.create(store=self.store, answers={})
        self.client.post('/api/ba/check-in/', {'token': self.ba.invite_token}, format='json')

        res = self.client.get('/api/intelligence/campaign-metrics/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['kpis']['shoppers_engaged'], 1)
        self.assertEqual(res.data['kpis']['shoppers_today'], 1)
        ops = res.data['operations']
        self.assertEqual(ops['scheduled_today'], 1)
        self.assertEqual(ops['active_bas'], 1)
        self.assertEqual(ops['attendance_rate'], 100.0)
        self.assertEqual(ops['stores_covered'], 1)
        self.assertEqual(len(res.data['engagement_trend']), 7)
        uncovered = [r for r in res.data['recommendations'] if r['id'] == self.other.id]
        self.assertEqual(uncovered[0]['pattern'], 'No BA scheduled this month')


REPORT = {'stock': {'danedar_950g': '12'}, 'sales': {'danedar_950g': '3'}, 'otherBrands': []}


class CheckoutAttendanceTests(ShiftTestBase):
    def setUp(self):
        super().setUp()
        self.today = timezone.localdate()
        self.post([self.row(month=self.today.strftime('%Y-%m'))])
        self.token = self.ba.invite_token

    def check_in(self):
        return self.client.post('/api/ba/check-in/', {'token': self.token}, format='json')

    def check_out(self, **body):
        return self.client.post('/api/ba/check-out/', {'token': self.token, **body}, format='json')

    def attendance(self, **params):
        return self.client.get('/api/attendance/', params).data

    def test_check_out_without_report_is_refused(self):
        self.check_in()
        res = self.check_out()
        self.assertEqual(res.status_code, 400)
        self.assertIn('report', res.data['detail'])
        row = ShiftAssignment.objects.get()
        self.assertIsNone(row.checked_out_at)
        self.assertEqual(self.attendance()['results'][0]['status'], 'On shift')

    def test_empty_report_is_refused(self):
        self.check_in()
        res = self.check_out(report={'stock': {}, 'sales': {}, 'otherBrands': []})
        self.assertEqual(res.status_code, 400)

    def test_report_submission_marks_present(self):
        self.check_in()
        res = self.check_out(report=REPORT, early_reason='Store closed early')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data['shift']['reportSubmitted'])
        row = ShiftAssignment.objects.get()
        self.assertEqual(row.checkout_report['stock'], REPORT['stock'])
        data = self.attendance()
        self.assertEqual(data['results'][0]['status'], 'Present')
        self.assertEqual(data['results'][0]['earlyCheckoutReason'], 'Store closed early')
        self.assertEqual(data['summary']['present'], 1)
        self.assertEqual(data['summary']['early_checkouts'], 1)

    def test_not_checked_in_today(self):
        data = self.attendance()
        self.assertEqual(data['results'][0]['status'], 'Not checked in')
        self.assertEqual(data['results'][0]['baCode'], self.ba.ba_code)

    def test_past_day_without_report_is_absent(self):
        from datetime import timedelta

        yesterday = self.today - timedelta(days=1)
        if yesterday.month != self.today.month:
            self.post([self.row(month=yesterday.strftime('%Y-%m'))])
        data = self.attendance(date_from=yesterday.isoformat(), date_to=yesterday.isoformat())
        self.assertEqual([r['status'] for r in data['results']], ['Absent'])

    def test_filter_by_ambassador(self):
        other = Ambassador.objects.create(name='Zara', status=Ambassador.Status.CERTIFIED)
        self.post([self.row(ba_code=other.ba_code, month=self.today.strftime('%Y-%m'), store_code='ST-02')])
        self.assertEqual(self.attendance()['summary']['total'], 2)
        self.assertEqual(self.attendance(ambassador=other.id)['results'][0]['baName'], 'Zara')

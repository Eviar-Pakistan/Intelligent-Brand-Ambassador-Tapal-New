from io import BytesIO

import openpyxl
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Ambassador, AmbassadorMonthTarget, Store
from .shifts import build_monthly_shift, parse_hhmm

STORE = 'Al Latif Super Store (Multan)'


def sheet(rows):
    """Same layout as 'BA targets multan.xlsx'."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(['Region', 'City', 'Store name', 'Brand', 'SKU Name', 'KG Count', 'Count', 'Grammage'])
    for i, (store, brand, sku, kg, grams) in enumerate(rows, start=2):
        ws.append(['Multan', 'Multan', store, brand, sku, kg, f'=F{i}/H{i}', grams])
    out = BytesIO()
    wb.save(out)
    return SimpleUploadedFile('targets.xlsx', out.getvalue())


ROWS = [
    (STORE, 'Danedar', 'DD 100gm Tea Bag', 5, 0.1),
    (STORE, 'Danedar', 'DD 1750gm Pouch', 16.5, 1.65),
    (STORE, 'Tezdum', 'TD 290gm Pouch', None, 0),
    (STORE, 'Green Tea', 'Elaichi 45gm', 0.9, 0.045),
]


class StoreSkuTargetUploadTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.ho = APIClient()
        self.ho.force_authenticate(User.objects.create_user(username='ho', email='ho@x.com', password='pw', user_type=1))
        self.store = Store.objects.create(name=STORE, store_code='MUX-1', city='Multan', address='x')
        self.ba = Ambassador.objects.create(name='Zubair BA', city='Multan', status=Ambassador.Status.CERTIFIED)
        build_monthly_shift(
            store=self.store, ambassador=self.ba, month='2026-10', start=parse_hhmm('10:00'), end=parse_hhmm('18:00')
        ).save()

    def upload(self, client, rows=ROWS, month='2026-10'):
        return client.post('/api/ba-targets/upload/', {'file': sheet(rows), 'month': month}, format='multipart')

    def test_assigns_store_targets_to_its_ba(self):
        res = self.upload(self.ho)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['saved'][0]['baName'], 'Zubair BA')
        target = AmbassadorMonthTarget.objects.get(ambassador=self.ba, month='2026-10')
        self.assertEqual(float(target.target_total), 22.4)
        lines = {line['sku']: line for line in target.lines}
        self.assertEqual(lines['DD 100gm Tea Bag']['count'], 50.0)       # 5 kg / 0.1 kg per pack
        self.assertEqual(lines['DD 1750gm Pouch']['count'], 10.0)
        self.assertIsNone(lines['TD 290gm Pouch']['count'])              # grammage 0 -> no #DIV/0!
        self.assertEqual(lines['Elaichi 45gm']['brand'], 'Green Tea')
        shown = self.ho.get('/api/ba-targets/?month=2026-10').data['results'][0]
        self.assertEqual((shown['storeName'], shown['targetKg'], len(shown['lines'])), (STORE, 22.4, 4))

    def test_reupload_replaces_and_keeps_sales(self):
        self.upload(self.ho)
        AmbassadorMonthTarget.objects.filter(ambassador=self.ba).update(sales_total=7)
        self.upload(self.ho, rows=[(STORE, 'Danedar', 'DD 100gm Tea Bag', 10, 0.1)])
        target = AmbassadorMonthTarget.objects.get(ambassador=self.ba, month='2026-10')
        self.assertEqual((float(target.target_total), float(target.sales_total), len(target.lines)), (10.0, 7.0, 1))

    def test_deployed_ba_also_gets_it(self):
        other = Ambassador.objects.create(name='Deployed BA', store=self.store, status=Ambassador.Status.DEPLOYED)
        res = self.upload(self.ho)
        self.assertEqual(sorted(s['baName'] for s in res.data['saved']), ['Deployed BA', 'Zubair BA'])
        self.assertTrue(AmbassadorMonthTarget.objects.filter(ambassador=other).exists())

    def test_reports_problems(self):
        res = self.upload(self.ho, rows=[('Unknown Store', 'Danedar', 'DD', 1, 0.1)])
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['unmatched_stores'], ['Unknown Store'])
        empty = self.upload(self.ho, rows=[(STORE, 'Danedar', 'DD', None, 0.1)])
        self.assertEqual(empty.data['stores_with_empty_kg'], [STORE])
        no_ba = self.upload(self.ho, month='2026-11')
        self.assertEqual(no_ba.data['stores_without_ba'], [STORE])
        self.assertEqual(self.ho.post('/api/ba-targets/upload/', {'month': '2026-10'}).status_code, 400)

    def test_city_scope(self):
        User = get_user_model()
        lahore = APIClient()
        lahore.force_authenticate(
            User.objects.create_user(username='lhr', email='l@x.com', password='pw', user_type=1, city='Lahore')
        )
        res = self.upload(lahore)
        self.assertEqual(res.data['unmatched_stores'], [STORE])  # a Multan store is not theirs
        multan = APIClient()
        multan.force_authenticate(
            User.objects.create_user(username='mux', email='m@x.com', password='pw', user_type=1, city='Multan')
        )
        self.assertEqual(self.upload(multan).status_code, 201)


class StoreNameMatchingTests(TestCase):
    def test_hyphen_and_city_suffix(self):
        from .target_sheet import _find_store

        main = Store.objects.create(name='Al-Latif Super Store', store_code='A1', city='Multan', address='x')
        branch = Store.objects.create(name='Al-Latif Super Store -2', store_code='A2', city='Multan', address='x')
        stores = list(Store.objects.all())
        self.assertEqual(_find_store('Al Latif Super Store (Multan)', 'Multan', stores), main)
        self.assertEqual(_find_store('Al Latif Super Store -2 (Multan)', 'Multan', stores), branch)
        self.assertIsNone(_find_store('Al Latif Super Store (Lahore)', 'Lahore', stores[:0]))


class SkuTemplateTests(StoreSkuTargetUploadTests):
    def test_template_is_ba_code_by_sku(self):
        res = self.ho.get('/api/ba-targets/template/?month=2026-10')
        self.assertEqual(res.status_code, 200)
        rows = list(openpyxl.load_workbook(BytesIO(res.content))['Targets'].iter_rows(values_only=True))
        self.assertEqual(rows[0][:7], ('BA Code', 'BA Name', 'Store', 'Month', 'Brand', 'SKU Name', 'Target Kg'))
        mine = [r for r in rows[1:] if r[0] == self.ba.ba_code]
        self.assertEqual(len(mine), 48)
        self.assertEqual((mine[0][2], mine[0][3]), (STORE, '2026-10'))

    def test_save_many_skus_per_ba(self):
        rows = [{'baCode': self.ba.ba_code.lower(), 'month': '2026-10', 'lines': [
            {'sku': 'DD 100gm Tea Bag', 'qty': 5},
            {'sku': 'DD 1750gm Pouch', 'qty': 16.5, 'sales': 3},
            {'sku': 'Custom SKU', 'brand': 'Other', 'qty': 2, 'grammage': 0.5},
        ]}]
        res = self.ho.post('/api/ba-targets/', {'rows': rows}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        t = AmbassadorMonthTarget.objects.get(ambassador=self.ba, month='2026-10')
        self.assertEqual((float(t.target_total), float(t.sales_total), t.store, len(t.lines)), (23.5, 3.0, self.store, 3))
        lines = {l['sku']: l for l in t.lines}
        self.assertEqual(lines['DD 100gm Tea Bag']['count'], 50.0)
        self.assertEqual(lines['Custom SKU']['count'], 4.0)
        shown = self.ho.get('/api/ba-targets/?month=2026-10').data['results'][0]
        self.assertEqual((shown['baCode'], len(shown['lines'])), (self.ba.ba_code, 3))
        # re-upload replaces the lines, keeps sales when none given
        self.ho.post('/api/ba-targets/', {'rows': [{'baCode': self.ba.ba_code, 'month': '2026-10',
                     'lines': [{'sku': 'DD 100gm Tea Bag', 'qty': 1}]}]}, format='json')
        t.refresh_from_db()
        self.assertEqual((float(t.target_total), float(t.sales_total), len(t.lines)), (1.0, 3.0, 1))

    def test_ba_without_store_and_bad_code(self):
        loose = Ambassador.objects.create(name='No Store BA', city='Multan')
        res = self.ho.post('/api/ba-targets/', {'rows': [
            {'baCode': loose.ba_code, 'month': '2026-10', 'lines': [{'sku': 'DD 40gm RTB', 'qty': 2}]},
            {'baCode': 'BA-NOPE', 'month': '2026-10', 'lines': [{'sku': 'DD 40gm RTB', 'qty': 2}]},
        ]}, format='json')
        self.assertEqual(len(res.data['saved']), 1)
        self.assertIn('BA-NOPE', res.data['errors'][0])
        self.assertIsNone(AmbassadorMonthTarget.objects.get(ambassador=loose).store)
        self.assertEqual(self.ho.get('/api/ba-targets/?month=2026-10').data['results'][0]['storeName'], '')

    def test_city_user_only_their_bas(self):
        lahore = APIClient()
        lahore.force_authenticate(get_user_model().objects.create_user(username='l2', email='l2@x.com', password='pw', user_type=1, city='Lahore'))
        res = lahore.post('/api/ba-targets/', {'rows': [{'baCode': self.ba.ba_code, 'month': '2026-10', 'lines': [{'sku': 'DD 40gm RTB', 'qty': 2}]}]}, format='json')
        self.assertEqual(res.status_code, 400)

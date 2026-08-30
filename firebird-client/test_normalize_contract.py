import unittest
from datetime import datetime

from main import FirebirdRepository, normalize_contract


class NormalizeContractTest(unittest.TestCase):
    def test_billing_fields_are_normalized(self):
        record = {
            "seqcontrato": 1,
            "cdcliente": 2,
            "nrcontrato": "0001",
            "status": "A",
            "valor_total_contrato": 1000,
            "tr_vl_fixo": 100,
            "valor_franquia": 50,
            "qt_franquia": 5000,
            "min_excedente": 40,
            "max_excedente": 800,
            "billing_mode": "misto",
            "qt_equipamentos": 3,
        }
        result = normalize_contract(record)
        self.assertEqual(result["pageFranchise"], 5000)
        self.assertEqual(result["overageRateMin"], 0.04)
        self.assertEqual(result["overageRateMax"], 0.8)
        self.assertEqual(result["billingMode"], "misto")
        self.assertEqual(result["customerExternalId"], "2")
        self.assertEqual(result["number"], "0001")
        self.assertEqual(result["activeEquipment"], 3)
        self.assertEqual(result["excessPageValue"], 0.8)

    def test_billing_fields_default_when_missing(self):
        record = {
            "seqcontrato": 2,
            "cdcliente": 3,
        }
        result = normalize_contract(record)
        self.assertEqual(result["pageFranchise"], 0)
        self.assertEqual(result["overageRateMin"], 0.0)
        self.assertEqual(result["overageRateMax"], 0.0)
        self.assertIsNone(result["billingMode"])


class ContractRefreshQueryTest(unittest.TestCase):
    def test_incremental_query_filters_by_updated_at(self):
        repo = FirebirdRepository.__new__(FirebirdRepository)
        calls = []

        def fake_rows(sql, params):
            calls.append((sql, params))
            return iter([])

        repo._rows = fake_rows
        watermark = datetime(2026, 8, 30, 12, 0, 0)

        self.assertEqual(list(repo.fetch_recently_updated_contracts(watermark, 250)), [])
        self.assertEqual(len(calls), 1)
        sql, params = calls[0]
        self.assertIn("select first 250", sql.lower())
        self.assertIn("ct.atualizado >= ?", sql.lower())
        self.assertEqual(params, (watermark,))

    def test_incremental_query_without_watermark_is_bounded(self):
        repo = FirebirdRepository.__new__(FirebirdRepository)
        calls = []
        repo._rows = lambda sql, params: (calls.append((sql, params)) or iter([]))

        list(repo.fetch_recently_updated_contracts(None, 5000))
        sql, params = calls[0]
        self.assertIn("select first 5000", sql.lower())
        self.assertIn("ct.atualizado is not null", sql.lower())
        self.assertNotIn("ct.atualizado >= ?", sql.lower())
        self.assertEqual(params, ())


if __name__ == "__main__":
    unittest.main()

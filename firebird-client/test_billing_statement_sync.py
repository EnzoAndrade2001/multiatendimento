import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from main import (
    StateStore,
    normalize_billing_statement,
    sync_billing_statements,
    _stmt_bool,
    _stmt_int,
)


def _header(seq, **over):
    base = {
        "seqdemonstrativo": seq,
        "periodo": "2026/08",
        "dtdemonstrativo": "04/09/2026 00:00:00",
        "dtcobranca": "22/09/2026 00:00:00",
        "valdemonstrativo": 2075.35,
        "valdemonstrativof": 1080.0,
        "valdemonstrativoe": 995.35,
        "valdesconto": 0.0,
        "valacrescimo": 0.0,
        "vl_demo_liq": 2075.35,
        "status": "F",
        "cdcliente": 107,
        "cdempresa": 1,
        "seqcontratogrp": 554,
        "atualizado": "04/09/2026 10:12:02",
        "observacao": None,
        "customer_name": "CLIENTE X",
        "customer_cnpj": "12.345.678/0001-90",
        "customer_cpf": None,
        "nlinhas": 2,
        "seqreceita": 19217,
        "numnf": 14894,
    }
    base.update(over)
    return base


def _line(**over):
    base = {
        "seqcontrato": 585,
        "seqcontratogrp": 554,
        "cdequipamento": 333,
        "cdmedidor": "PBA4",
        "cdmedidorfat": "PBA4",
        "medidorini": 615734,
        "medidorfin": 620123,
        "medidordesc": 0,
        "dtperiodofatini": "21/07/2026 00:00:00",
        "dtperiodofatfin": "20/08/2026 00:00:00",
        "dtleitura": "25/08/2026 00:00:00",
        "nr_dias_periodo_fat": 31,
        "qtproducao": 4389,
        "qtfranquia": 23000,
        "qtexcedente": 0,
        "valfranquia": 405.0,
        "valexcedente": 45.0,
        "valfranquiacob": 405.0,
        "valexcedentecob": 0.0,
        "valfatura": 0.0,
        "valdesconto": 0.0,
        "valacrescimo": 0.0,
        "tffixo": "N",
        "tfisento": "N",
        "tfrateio": "N",
        "tfbonificacao": None,
        "department": None,
        "installation_location": "RECEPCAO",
        "serie": "ABC123",
        "modelo": "XEROX 7845",
        "equipment_name": "MULTIFUNCIONAL XEROX 7845",
    }
    base.update(over)
    return base


class FakeRepo:
    def __init__(self, headers, lines_by_seq, max_seq):
        self._headers = headers
        self._lines = lines_by_seq
        self._max = max_seq
        self.fetch_calls = []

    def max_billing_statement_seq(self):
        return self._max

    def fetch_billing_statements(self, min_seq, since_date=None, limit=2000):
        self.fetch_calls.append((min_seq, since_date))
        for h in self._headers:
            seq = int(h["seqdemonstrativo"])
            if seq > min_seq or (since_date is not None):
                yield h

    def fetch_statement_lines_bulk(self, seqs):
        return {int(s): self._lines.get(int(s), []) for s in seqs}


class FakeCRM:
    def __init__(self):
        self.pushes = []

    def push(self, entity, records):
        self.pushes.append((entity, list(records)))
        return {"ok": True}


class NormalizeStatementTest(unittest.TestCase):
    def test_shape_and_reconciliation(self):
        # header bate com as duas linhas: fixo 405+135, excedente 0+150
        header = _header(14893, valdemonstrativof=540.0, valdemonstrativoe=150.0,
                         valdemonstrativo=690.0, vl_demo_liq=690.0)
        lines = [
            _line(valfranquiacob=405.0, valexcedentecob=0.0),
            _line(cdequipamento=335, cdmedidor="CORA4", valfranquiacob=135.0,
                  valexcedentecob=150.0, tfrateio="S"),
        ]
        out = normalize_billing_statement(header, lines)
        self.assertEqual(out["externalId"], "14893")
        self.assertEqual(out["period"], "2026/08")
        self.assertEqual(out["receivableExternalId"], "19217")
        self.assertEqual(out["invoiceNumber"], "14894")
        self.assertEqual(out["customerExternalId"], "107")
        self.assertEqual(len(out["lines"]), 2)
        self.assertEqual(out["lines"][0]["lineNo"], 0)
        self.assertEqual(out["lines"][1]["lineNo"], 1)
        self.assertTrue(out["lines"][1]["isProrated"])
        self.assertFalse(out["lines"][0]["isProrated"])
        self.assertEqual(out["lines"][0]["meterStart"], 615734)
        self.assertEqual(out["lines"][0]["equipmentName"], "MULTIFUNCIONAL XEROX 7845")
        self.assertIn("statementDate", out)
        self.assertTrue(out["statementDate"].startswith("2026-09-04"))
        # invariante: Σ COB fixo == header fixo, Σ COB exc == header exc
        sfix = sum(l["franchiseCharged"] for l in out["lines"])
        sexc = sum(l["excessCharged"] for l in out["lines"])
        self.assertAlmostEqual(sfix, out["fixedValue"], places=2)
        self.assertAlmostEqual(sexc, out["excessValue"], places=2)

    def test_header_only(self):
        out = normalize_billing_statement(_header(14884, nlinhas=0, seqreceita=None, numnf=None), [])
        self.assertEqual(out["lines"], [])
        self.assertEqual(out["lineCount"], 0)
        self.assertIsNone(out["receivableExternalId"])

    def test_helpers(self):
        self.assertTrue(_stmt_bool("S"))
        self.assertTrue(_stmt_bool("s"))
        self.assertFalse(_stmt_bool("N"))
        self.assertFalse(_stmt_bool(None))
        self.assertEqual(_stmt_int("31"), 31)
        self.assertEqual(_stmt_int(4389.0), 4389)
        self.assertIsNone(_stmt_int(None))
        self.assertIsNone(_stmt_int(""))


class SyncBillingStatementsTest(unittest.TestCase):
    def _state(self):
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
        tmp.close()
        return StateStore(Path(tmp.name))

    def test_bootstrap_cursor_starts_1500_behind(self):
        repo = FakeRepo(headers=[], lines_by_seq={}, max_seq=14894)
        crm = FakeCRM()
        state = self._state()
        sync_billing_statements(repo, crm, state)
        self.assertEqual(state.data["cursors"]["billingStatements"], 14894 - 1500)

    def test_forward_scan_pushes_and_advances_cursor(self):
        headers = [_header(s) for s in (13400, 13401, 13402)]
        lines = {13400: [_line()], 13401: [_line(), _line(cdequipamento=999)], 13402: []}
        repo = FakeRepo(headers, lines, max_seq=13402)
        crm = FakeCRM()
        state = self._state()
        state.data["cursors"]["billingStatements"] = 13399  # ja passou do bootstrap
        sync_billing_statements(repo, crm, state)

        self.assertEqual(len(crm.pushes), 1)
        entity, records = crm.pushes[0]
        self.assertEqual(entity, "billingStatement")
        self.assertEqual([r["externalId"] for r in records], ["13400", "13401", "13402"])
        self.assertEqual(len(records[1]["lines"]), 2)
        self.assertEqual(state.data["cursors"]["billingStatements"], 13402)
        # janela de refresh marcada
        self.assertIn("billing_statement_refresh_at", state.data)

    def test_refresh_window_skipped_when_recent(self):
        repo = FakeRepo(headers=[_header(13400)], lines_by_seq={13400: []}, max_seq=13400)
        crm = FakeCRM()
        state = self._state()
        state.data["cursors"]["billingStatements"] = 13399
        state.data["billing_statement_refresh_at"] = datetime.now().isoformat(timespec="seconds")
        sync_billing_statements(repo, crm, state)
        # since_date fica None quando o refresh e recente
        self.assertEqual(repo.fetch_calls[-1][1], None)

    def test_refresh_window_used_when_stale(self):
        repo = FakeRepo(headers=[], lines_by_seq={}, max_seq=13400)
        crm = FakeCRM()
        state = self._state()
        state.data["cursors"]["billingStatements"] = 13399
        state.data["billing_statement_refresh_at"] = (
            datetime.now() - timedelta(hours=9)
        ).isoformat(timespec="seconds")
        sync_billing_statements(repo, crm, state)
        self.assertIsNotNone(repo.fetch_calls[-1][1])  # since_date preenchido


if __name__ == "__main__":
    unittest.main()

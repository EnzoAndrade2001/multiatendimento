import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader

import financial_document_index as fdi
from main import AppConfig, FirebirdRepository, format_date_br, format_money_br


class FinancialDocumentTests(unittest.TestCase):
    def setUp(self):
        self.repo = FirebirdRepository(AppConfig())
        self.context = {
            "seqreceita": 18741,
            "seqincnfs": 15894,
            "seqdemonstrativo": 14466,
            "invoice_number": 14494,
            "customer_name": "POSTAL DIGITAL LTDA - ME",
            "customer_cnpj": "01.971.259/0001-42",
            "cdcliente": 326,
            "customer_address": "AVENIDA PROTASIO ALVES",
            "customer_number": 2934,
            "customer_city": "PORTO ALEGRE",
            "customer_state": "RS",
            "company_name": "LCD DIGITAL OUTSOURCING DE IMPRESSAO",
            "company_cnpj": "35.692.721/0001-94",
            "dtemissaorec": "2026-08-17T00:00:00",
            "dtvectorec": "2026-08-20T00:00:00",
            "valreceita": 2228.33,
            "valtotalnfs": 2228.33,
            "nmformapagto": "BOLETO",
            "statement_period": "2026/07",
            "valdemonstrativo": 2228.33,
            "valdemonstrativof": 1556.50,
            "valdemonstrativoe": 671.83,
        }

    def assert_valid_pdf(self, data):
        self.assertTrue(data.startswith(b"%PDF"))
        reader = PdfReader(__import__("io").BytesIO(data))
        self.assertGreaterEqual(len(reader.pages), 1)
        text = " ".join((page.extract_text() or "") for page in reader.pages)
        self.assertNotIn("<b>", text)
        self.assertNotIn("<br/>", text)

    def test_formatters(self):
        self.assertEqual(format_date_br("2026-08-17T00:00:00"), "17/08/2026")
        self.assertEqual(format_money_br(2228.33), "R$ 2.228,33")

    def test_invoice_pdf_is_valid_and_contains_core_data(self):
        pdf = self.repo._render_invoice_pdf(self.context, [{
            "cdproduto": "LOCACAO", "product_name": "LOCACAO DE EQUIPAMENTOS",
            "quantidade": 1, "precounitario": 2228.33, "valdescrat": 0,
        }])
        self.assert_valid_pdf(pdf)

    def test_statement_pdf_is_valid_and_supports_multiple_lines(self):
        lines = [{
            "cdequipamento": index, "equipment_name": "MULTIFUNCIONAL",
            "serie": f"SERIE{index}", "cdmedidor": "PBA4",
            "dtperiodofatini": "2026-06-26", "dtperiodofatfin": "2026-07-25",
            "medidorini": 100, "medidorfin": 200, "qtproducao": 100,
            "qtfranquia": 50, "qtexcedente": 50, "valfranquia": 10,
            "valexcedente": 20, "valfranquiacob": 10,
            "valexcedentecob": 20,
        } for index in range(1, 45)]
        pdf = self.repo._render_statement_pdf(self.context, lines)
        self.assert_valid_pdf(pdf)
        self.assertGreaterEqual(len(PdfReader(__import__("io").BytesIO(pdf)).pages), 2)

    def test_unified_command_does_not_fall_back_to_a_synthetic_pdf(self):
        with patch.object(self.repo, "_fetch_billing_document_context", return_value=self.context), \
             patch.object(self.repo, "_fetch_official_financial_document", return_value=None):
            with self.assertRaisesRegex(ValueError, "oficial ainda nao localizado"):
                self.repo.fetch_billing_document({
                    "receivableExternalId": 18741,
                    "documentType": "invoice",
                })

    def test_fatura_alias_returns_the_requested_document_type(self):
        official = {
            "pdfBase64": base64.b64encode(b"%PDF-1.7 official").decode("ascii"),
            "fileName": "NF 14494 - POSTAL DIGITAL.pdf",
            "mimeType": "application/pdf",
            "documentType": "invoice",
        }
        with patch.object(self.repo, "_fetch_billing_document_context", return_value=self.context), \
             patch.object(self.repo, "_fetch_official_financial_document", return_value=official):
            result = self.repo.fetch_billing_document({
                "receivableExternalId": 18741,
                "documentType": "fatura",
            })
        self.assertEqual(result["documentType"], "fatura")

    def test_unknown_document_type_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Tipo de documento invalido"):
            self.repo.fetch_billing_document({
                "receivableExternalId": 18741,
                "documentType": "arquivo-desconhecido",
            })

    def test_on_demand_fetch_does_not_block_behind_a_running_scan(self):
        """Regression: a click in the CRM (FETCH_BILLING_DOCUMENT) used to call
        FinancialDocumentIndex.scan() directly, which can take many minutes on a
        large folder and, once scans became mutually exclusive, would hang this
        interactive request -- and every other queued agent command -- behind
        whatever scan (manual button or background monitor) was already running.
        The on-demand path must fail fast with a clear message instead."""
        with tempfile.TemporaryDirectory() as tmp:
            config = AppConfig(
                financial_document_folders=[tmp],
                financial_document_index_file=Path(tmp) / "index.json",
            )
            repo = FirebirdRepository(config)
            index = repo.financial_document_index()
            lock = fdi._lock_for(index.cache_path)
            lock.acquire()  # simulate a scan already running elsewhere
            try:
                with patch.object(repo, "_fetch_billing_document_context", return_value=self.context):
                    with self.assertRaisesRegex(ValueError, "sendo construido"):
                        repo.fetch_billing_document({
                            "receivableExternalId": 18741,
                            "documentType": "invoice",
                        })
            finally:
                lock.release()


if __name__ == "__main__":
    unittest.main()

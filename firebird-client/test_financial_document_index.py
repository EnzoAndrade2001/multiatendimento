import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from reportlab.pdfgen import canvas

import financial_document_index as fdi
from financial_document_index import FinancialDocumentIndex


CUSTOMER_CNPJ = "07.275.799/0001-78"


def make_pdf(path: Path, lines: list[str]):
    document = canvas.Canvas(str(path))
    y = 800
    for line in lines:
        document.drawString(40, y, line)
        y -= 18
    document.save()


class FinancialDocumentIndexTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        make_pdf(self.root / "arquivo-qualquer-a.pdf", [
            "Fatura de Locacao de Bens Moveis",
            f"Cliente J. C. MUNIZ - CNPJ {CUSTOMER_CNPJ}",
            "Fatura 14328",
            "Data Emissao 28/07/2026",
            "Data de Vencimento 10/08/2026",
            "VALOR LIQUIDO R$ 141,30",
        ])
        make_pdf(self.root / "sem-nome-util-b.pdf", [
            "DEMONSTRATIVO DO FATURAMENTO",
            f"CNPJ/CPF: {CUSTOMER_CNPJ}",
            "Demost.:14365",
            "Valor Total 141,30",
        ])
        make_pdf(self.root / "documento.pdf", [
            "RECIBO DO PAGADOR - FICHA DE COMPENSACAO",
            f"Pagador J. C. MUNIZ - CNPJ {CUSTOMER_CNPJ}",
            "Numero do Documento 14328/1",
            "Vencimento 10/08/2026",
            "Valor do Documento 141,30",
            "Nosso Numero 00013216.76",
        ])
        self.context = {
            "customer_cnpj": CUSTOMER_CNPJ,
            "customer_name": "J. C. MUNIZ & CIA LTDA",
            "invoice_number": "14328",
            "seqdemonstrativo": 14365,
            "dtemissaorec": "2026-07-28",
            "dtvectorec": "2026-08-10",
            "valreceita": 141.30,
            "seqreceita": 1,
        }

    def tearDown(self):
        self.temporary.cleanup()

    def test_match_carrega_amount_ok_para_auditoria(self):
        index = FinancialDocumentIndex([str(self.root)], self.root / "index.json", "35.692.721/0001-94")
        index.scan()
        # o PDF "a.pdf" contem "141,30" -> amount_ok True
        self.assertIs(index.find("invoice", self.context).amount_ok, True)
        # sem valor no contexto -> amount_ok None (nao da pra checar)
        no_value = {k: v for k, v in self.context.items() if k != "valreceita"}
        self.assertIsNone(index.find("invoice", no_value).amount_ok)

    def test_matches_all_documents_without_using_file_names(self):
        index = FinancialDocumentIndex([str(self.root)], self.root / "index.json", "35.692.721/0001-94")
        stats = index.scan()
        self.assertEqual(stats["total"], 3)
        self.assertTrue(index.find("invoice", self.context).path.name.endswith("a.pdf"))
        self.assertTrue(index.find("statement", self.context).path.name.endswith("b.pdf"))
        self.assertEqual(index.find("boleto", self.context).path.name, "documento.pdf")

    def test_cached_scan_does_not_reprocess_unchanged_files(self):
        cache = self.root / "index.json"
        FinancialDocumentIndex([str(self.root)], cache).scan()
        stats = FinancialDocumentIndex([str(self.root)], cache).scan()
        self.assertEqual(stats["added"], 0)
        self.assertEqual(stats["updated"], 0)

    def test_rejects_a_different_customer(self):
        index = FinancialDocumentIndex([str(self.root)], self.root / "index.json")
        index.scan()
        wrong = {**self.context, "customer_cnpj": "87.130.589/0001-20"}
        self.assertIsNone(index.find("invoice", wrong))

    def test_matches_a_danfe_with_dot_grouped_zero_padded_number(self):
        """Regression: a real DANFE (NF-e de venda) prints its number grouped
        with thousand-separator dots and zero-padded (e.g. "Nº: 048.134.210"),
        while Firebird stores the same invoice as the plain integer 48134210.
        Before the fix, the dots split the printed number into three unrelated
        tokens and the leading zero broke the boundary match, so this exact
        real-world document was never found."""
        danfe_root = self.root / "danfe"
        danfe_root.mkdir()
        make_pdf(danfe_root / "qualquer-nome.pdf", [
            "DANFE - DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA",
            "Nº: 048.134.210",
            f"CNPJ {CUSTOMER_CNPJ}",
            "Data de Emissao 28/07/2026",
            "Data Vcto 10/08/2026",
            "Valor Total dos Produtos 141,30",
        ])
        index = FinancialDocumentIndex([str(danfe_root)], danfe_root / "index.json")
        index.scan()
        context = {**self.context, "invoice_number": "48134210"}
        match = index.find("invoice", context)
        self.assertIsNotNone(match)
        self.assertEqual(match.path.name, "qualquer-nome.pdf")

    def test_does_not_confuse_a_thousand_separated_money_value_with_the_document_number(self):
        """Regression: a first version of the DANFE fix above collapsed ANY
        dot between digits anywhere in the document, not just a grouped
        document number - so a plain money amount like "R$ 20.786,00"
        (thousand-separator dot) turned into the token "20786" and could
        coincidentally match an unrelated invoice/statement number, flooding
        the automatic billing send with "documento ambiguo" false alarms."""
        root = self.root / "money"
        root.mkdir()
        make_pdf(root / "outra-nota.pdf", [
            "Fatura de Locacao de Bens Moveis",
            f"Cliente OUTRO CLIENTE - CNPJ {CUSTOMER_CNPJ}",
            "Fatura 999",
            "Valor Total dos Produtos R$ 20.786,00",
        ])
        index = FinancialDocumentIndex([str(root)], root / "index.json")
        index.scan()
        # Numero de titulo coincide com os digitos do valor monetario acima,
        # mas nao e o numero real da fatura (999) - nao deve casar com nada.
        context = {**self.context, "invoice_number": "20786"}
        self.assertIsNone(index.find("invoice", context))

    def test_treats_the_same_invoice_filed_in_two_folders_as_one_match(self):
        """Regression: real production data has the exact same invoice filed
        into two organizational subfolders (ex.: "01" and "CONTADOR"), each
        export producing a byte-different PDF (generation metadata/timestamp)
        with identical visible/extracted text. Before this fix, any invoice
        filed this way (found to affect thousands of files in production)
        was permanently "ambiguous" and never sent, even though it is clearly
        the same document."""
        root = self.root / "duas-pastas"
        (root / "01").mkdir(parents=True)
        (root / "CONTADOR").mkdir(parents=True)
        lines = [
            "Fatura de Locacao de Bens Moveis",
            f"Cliente J. C. MUNIZ - CNPJ {CUSTOMER_CNPJ}",
            "Fatura 14328",
            "Data Emissao 28/07/2026",
        ]
        make_pdf(root / "01" / "cliente_14328_fatura.pdf", lines)
        make_pdf(root / "CONTADOR" / "cliente_14328_fatura.pdf", lines)
        index = FinancialDocumentIndex([str(root)], root / "index.json")
        index.scan()
        match = index.find("invoice", {**self.context, "invoice_number": "14328"})
        self.assertIsNotNone(match)
        # Escolha deterministica: sempre o mesmo caminho (ordem alfabetica),
        # nao importa a ordem em que os arquivos foram indexados.
        self.assertIn("01", str(match.path))

    def test_still_flags_ambiguity_when_the_content_genuinely_differs(self):
        """Two files that tie on customer+number but have genuinely different
        extracted text (not just re-exported copies) must still be reported
        as ambiguous - the text-based dedup above must not become a loophole
        that silently picks a wrong document."""
        root = self.root / "genuinamente-diferentes"
        root.mkdir()
        make_pdf(root / "a.pdf", [
            "Fatura de Locacao de Bens Moveis",
            f"Cliente J. C. MUNIZ - CNPJ {CUSTOMER_CNPJ}",
            "Fatura 14328",
            "Valor Total R$ 100,00",
        ])
        make_pdf(root / "b.pdf", [
            "Fatura de Locacao de Bens Moveis",
            f"Cliente J. C. MUNIZ - CNPJ {CUSTOMER_CNPJ}",
            "Fatura 14328",
            "Valor Total R$ 999,00",
        ])
        index = FinancialDocumentIndex([str(root)], root / "index.json")
        index.scan()
        with self.assertRaises(ValueError):
            index.find("invoice", {**self.context, "invoice_number": "14328"})

    def test_ignores_an_embedded_print_timestamp_when_comparing_reexported_copies(self):
        """Regression: a real Demonstrativo layout prints the exact date+time
        the PDF was generated inside the document body itself (ex.: "31/01/2025
        15:41:43"). The same statement filed into two folders and reexported
        at different moments therefore has text that differs ONLY by that
        timestamp - plain text equality (the first version of this fix) failed
        to recognize these as the same document and kept reporting it
        ambiguous forever."""
        root = self.root / "timestamp-impresso"
        (root / "02").mkdir(parents=True)
        (root / "CONTADORES").mkdir(parents=True)
        make_pdf(root / "02" / "demonstrativo.pdf", [
            "DEMONSTRATIVO DO FATURAMENTO",
            f"CNPJ/CPF: {CUSTOMER_CNPJ}",
            "Demost.:7042",
            "Valor Total 350,00",
            "31/01/2025 15:41:43 PAG.: 1/1",
        ])
        make_pdf(root / "CONTADORES" / "demonstrativo.pdf", [
            "DEMONSTRATIVO DO FATURAMENTO",
            f"CNPJ/CPF: {CUSTOMER_CNPJ}",
            "Demost.:7042",
            "Valor Total 350,00",
            "30/01/2025 15:34:10 PAG.: 1/1",
        ])
        index = FinancialDocumentIndex([str(root)], root / "index.json")
        index.scan()
        context = {**self.context, "seqdemonstrativo": "7042"}
        match = index.find("statement", context)
        self.assertIsNotNone(match)


class FinancialDocumentIndexProgressTest(unittest.TestCase):
    """Covers the live progress reporting used by the agent GUI so a scan over a
    large or slow (UNC) folder never looks frozen with no feedback."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        make_pdf(self.root / "a.pdf", ["Fatura de Locacao de Bens Moveis", "Fatura 1"])
        make_pdf(self.root / "b.pdf", ["Fatura de Locacao de Bens Moveis", "Fatura 2"])

    def tearDown(self):
        self.temporary.cleanup()

    def test_reports_progress_milestones_and_final_completion(self):
        index = FinancialDocumentIndex([str(self.root)], self.root / "index.json")
        messages = []
        index.scan(on_progress=messages.append)
        self.assertTrue(any("PDF(s) encontrados" in m for m in messages))
        self.assertTrue(any("Lendo PDFs" in m for m in messages))
        self.assertEqual(messages[-1], "Indexacao concluida.")

    def test_missing_folder_is_reported_instead_of_failing_silently(self):
        missing = self.root / "nao-existe"
        index = FinancialDocumentIndex([str(missing)], self.root / "index.json")
        messages = []
        index.scan(on_progress=messages.append)
        self.assertTrue(any("indisponivel" in m for m in messages))

    def test_a_slow_file_still_yields_heartbeat_progress_instead_of_hanging_silently(self):
        original_extract = fdi._extract_pdf

        def slow_extract(path):
            if path.name == "a.pdf":
                time.sleep(0.3)
            return original_extract(path)

        index = FinancialDocumentIndex([str(self.root)], self.root / "index.json")
        messages = []
        with patch.object(fdi, "HEARTBEAT_SECONDS", 0.05), \
             patch.object(fdi, "_extract_pdf", side_effect=slow_extract):
            stats = index.scan(on_progress=messages.append)

        self.assertEqual(stats["errors"], 0)
        self.assertEqual(stats["added"], 2)
        self.assertTrue(
            any("demorando mais" in m for m in messages),
            f"esperava ao menos um aviso de heartbeat, mensagens recebidas: {messages}",
        )

    def test_concurrent_scans_on_the_same_folder_do_not_read_each_pdf_twice(self):
        """Regression: the manual 'Indexar agora' button and the automatic
        background monitor each build their own FinancialDocumentIndex over the
        same cache file. Without a shared lock, starting the agent while a
        manual scan is still running used to kick off a second full read of
        every PDF at the same time."""
        original_extract = fdi._extract_pdf
        call_count = {"n": 0}
        call_lock = threading.Lock()

        def counting_extract(path):
            with call_lock:
                call_count["n"] += 1
            time.sleep(0.05)
            return original_extract(path)

        cache = self.root / "index.json"
        index_a = FinancialDocumentIndex([str(self.root)], cache)
        index_b = FinancialDocumentIndex([str(self.root)], cache)

        with patch.object(fdi, "_extract_pdf", side_effect=counting_extract):
            threads = [
                threading.Thread(target=index_a.scan),
                threading.Thread(target=index_b.scan),
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

        # 2 real PDFs on disk: each must be read exactly once in total, not once
        # per concurrent caller.
        self.assertEqual(call_count["n"], 2)

    def test_scan_if_idle_skips_instead_of_waiting_when_another_scan_is_running(self):
        cache = self.root / "index.json"
        index = FinancialDocumentIndex([str(self.root)], cache)
        lock = fdi._lock_for(index.cache_path)
        lock.acquire()  # simulate a scan already running elsewhere (button or monitor)
        try:
            with patch.object(fdi, "_extract_pdf") as extract:
                result = index.scan_if_idle()
        finally:
            lock.release()
        self.assertIsNone(result)
        extract.assert_not_called()

    def test_scan_if_idle_scans_normally_when_nothing_else_is_running(self):
        cache = self.root / "index.json"
        index = FinancialDocumentIndex([str(self.root)], cache)
        stats = index.scan_if_idle()
        self.assertIsNotNone(stats)
        self.assertEqual(stats["total"], 2)


class ReplaceWithRetryTest(unittest.TestCase):
    """Regression: production hit WinError 5 (Acesso negado) renaming a
    freshly-written .tmp file into place - almost certainly a brief
    antivirus/backup lock - and it took down an entire automatic billing
    pass after dozens of successful writes in a row. Every atomic write in
    the agent (financial index, billing ledger, command results) goes
    through this retry instead of a bare Path.replace()."""

    def test_recovers_from_a_transient_lock_and_retries(self):
        temporary = Mock()
        temporary.replace.side_effect = [PermissionError("acesso negado"), PermissionError("acesso negado"), None]
        with patch.object(fdi.time, "sleep", return_value=None):
            fdi.replace_with_retry(temporary, Path("destino.json"), attempts=5, delay_seconds=0.01)
        self.assertEqual(temporary.replace.call_count, 3)

    def test_gives_up_and_raises_after_exhausting_attempts(self):
        temporary = Mock()
        temporary.replace.side_effect = PermissionError("acesso negado sempre")
        with patch.object(fdi.time, "sleep", return_value=None):
            with self.assertRaises(PermissionError):
                fdi.replace_with_retry(temporary, Path("destino.json"), attempts=3, delay_seconds=0.01)
        self.assertEqual(temporary.replace.call_count, 3)


if __name__ == "__main__":
    unittest.main()

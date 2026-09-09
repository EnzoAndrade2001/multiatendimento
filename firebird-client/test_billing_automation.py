import tempfile
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from reportlab.pdfgen import canvas

import main as agent_main
from main import (
    AppConfig,
    BillingSendLedger,
    CRMClient,
    FirebirdRepository,
    _within_billing_window,
    run_billing_automation,
)


CUSTOMER_CNPJ = "07.275.799/0001-78"

# D4: o envio automatico so considera titulos emitidos no mes atual, entao as
# fixtures usam datas do mes corrente em vez de datas fixas de 2026-07.
_EMISSAO = datetime.now().replace(day=3, hour=0, minute=0, second=0, microsecond=0)
_VENC = _EMISSAO + timedelta(days=20)
_EMISSAO_BR = _EMISSAO.strftime("%d/%m/%Y")
_VENC_BR = _VENC.strftime("%d/%m/%Y")
_EMISSAO_ISO = _EMISSAO.strftime("%Y-%m-%d")
_VENC_ISO = _VENC.strftime("%Y-%m-%d")


def make_pdf(path: Path, lines: list[str]):
    document = canvas.Canvas(str(path))
    y = 800
    for line in lines:
        document.drawString(40, y, line)
        y -= 18
    document.save()


class BillingSendLedgerTest(unittest.TestCase):
    def test_records_and_checks_persist_across_reload(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ledger.json"
            ledger = BillingSendLedger(path)
            self.assertFalse(ledger.already_sent(101, "hash-a"))
            ledger.record(101, "hash-a", {"customerName": "Cliente Teste"})
            self.assertTrue(ledger.already_sent(101, "hash-a"))
            # A different hash for the same receivable (e.g. a reissued boleto
            # with a new due date) must be treated as a brand new package.
            self.assertFalse(ledger.already_sent(101, "hash-b"))

            reloaded = BillingSendLedger(path)
            self.assertTrue(reloaded.already_sent(101, "hash-a"))

    def test_skip_entry_blocks_only_until_retry_after(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ledger.json"
            ledger = BillingSendLedger(path)

            future = datetime.now() + timedelta(hours=24)
            ledger.record_skip(202, "hash-s", {"customerName": "Sem opt-in"}, future)
            self.assertTrue(ledger.already_sent(202, "hash-s"))

            # Passada a janela, o pacote volta a ser elegível.
            ledger.data[ledger.key(202, "hash-s")]["retryAfter"] = (
                datetime.now() - timedelta(minutes=1)
            ).isoformat(timespec="seconds")
            self.assertFalse(ledger.already_sent(202, "hash-s"))

            # Um envio real depois torna a entrada permanente.
            ledger.record(202, "hash-s", {"customerName": "Sem opt-in"})
            self.assertTrue(ledger.already_sent(202, "hash-s"))
            self.assertNotIn("retryAfter", ledger.data[ledger.key(202, "hash-s")])

    def test_reload_prunes_stale_skip_entries_but_keeps_real_sends(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ledger.json"
            ledger = BillingSendLedger(path)
            ledger.record(1, "real", {})
            ledger.record_skip(2, "fresh", {}, datetime.now() + timedelta(hours=24))
            ledger.record_skip(3, "stale", {}, datetime.now() + timedelta(hours=24))
            ledger.data[ledger.key(3, "stale")]["retryAfter"] = (
                datetime.now() - timedelta(days=31)
            ).isoformat(timespec="seconds")
            ledger._save()

            reloaded = BillingSendLedger(path)
            self.assertIn(reloaded.key(1, "real"), reloaded.data)
            self.assertIn(reloaded.key(2, "fresh"), reloaded.data)
            self.assertNotIn(reloaded.key(3, "stale"), reloaded.data)


class FindReadyBillingPackagesTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        make_pdf(self.root / "a.pdf", [
            "Fatura de Locacao de Bens Moveis",
            f"Cliente J. C. MUNIZ - CNPJ {CUSTOMER_CNPJ}",
            "Fatura 14328",
            f"Data Emissao {_EMISSAO_BR}",
            f"Data de Vencimento {_VENC_BR}",
            "VALOR LIQUIDO R$ 141,30",
        ])
        make_pdf(self.root / "b.pdf", [
            "DEMONSTRATIVO DO FATURAMENTO",
            f"CNPJ/CPF: {CUSTOMER_CNPJ}",
            "Demost.:14365",
            "Valor Total 141,30",
        ])
        make_pdf(self.root / "c.pdf", [
            "RECIBO DO PAGADOR - FICHA DE COMPENSACAO",
            f"Pagador J. C. MUNIZ - CNPJ {CUSTOMER_CNPJ}",
            "Numero do Documento 14328/1",
            f"Vencimento {_VENC_BR}",
            "Valor do Documento 141,30",
            "Nosso Numero 00013216.76",
        ])
        self.config = AppConfig(
            financial_document_folders=[str(self.root)],
            financial_document_index_file=self.root / "index.json",
        )
        self.repo = FirebirdRepository(self.config)
        self.repo.scan_financial_documents()
        self.receivable_row = {
            "seqreceita": 501,
            "customer_cnpj": CUSTOMER_CNPJ,
            "customer_cpf": None,
            "customer_name": "J. C. MUNIZ & CIA LTDA",
            "invoice_number": "14328",
            "seqdemonstrativo": 14365,
            "dtemissaonfs": None,
            "dtemissaorec": _EMISSAO_ISO,
            "dtvectorec": _VENC_ISO,
            "valreceita": 141.30,
        }

    def tearDown(self):
        self.temporary.cleanup()

    def test_finds_a_complete_unambiguous_package(self):
        ledger = BillingSendLedger(self.root / "ledger.json")
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]):
            packages = self.repo.find_ready_billing_packages(["invoice", "statement", "boleto"], ledger)
        self.assertEqual(len(packages), 1)
        package = packages[0]
        self.assertEqual(package["receivableExternalId"], 501)
        self.assertEqual({d["documentType"] for d in package["documents"]}, {"invoice", "statement", "boleto"})

    def test_does_not_repeat_an_already_sent_package(self):
        ledger = BillingSendLedger(self.root / "ledger.json")
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]):
            first = self.repo.find_ready_billing_packages(["invoice", "statement", "boleto"], ledger)
            ledger.record(501, first[0]["combinedHash"], {})
            second = self.repo.find_ready_billing_packages(["invoice", "statement", "boleto"], ledger)
        self.assertEqual(second, [])

    def test_incomplete_package_is_not_ready(self):
        ledger = BillingSendLedger(self.root / "ledger.json")
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]):
            # "estatement-x" never matches anything real, so this package can
            # never complete -- mirrors a título missing its demonstrativo.
            packages = self.repo.find_ready_billing_packages(["invoice", "statement", "estatement-x"], ledger)
        self.assertEqual(packages, [])

    def test_statement_sem_pdf_na_pasta_cai_para_statementRef(self):
        # Sem o PDF do demonstrativo na pasta, mas com SEQDEMONSTRATIVO no
        # titulo: o pacote fica pronto assim mesmo, com uma referencia para o
        # backend re-renderizar (Fase 2 "faturamento sem a pasta").
        (self.root / "b.pdf").unlink()
        self.repo.scan_financial_documents()
        ledger = BillingSendLedger(self.root / "ledger.json")
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]):
            packages = self.repo.find_ready_billing_packages(["invoice", "statement"], ledger)
        self.assertEqual(len(packages), 1)
        docs = {d["documentType"]: d for d in packages[0]["documents"]}
        self.assertIn("statement", docs)
        self.assertNotIn("path", docs["statement"])
        self.assertEqual(docs["statement"]["statementRef"]["seqDemonstrativo"], "14365")
        self.assertEqual(docs["statement"]["statementRef"]["receivableExternalId"], "501")

    def test_statement_sem_pdf_e_sem_seqdemo_continua_incompleto(self):
        (self.root / "b.pdf").unlink()
        self.repo.scan_financial_documents()
        row = {**self.receivable_row, "seqdemonstrativo": None}
        ledger = BillingSendLedger(self.root / "ledger.json")
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[row]):
            packages = self.repo.find_ready_billing_packages(["invoice", "statement"], ledger)
        self.assertEqual(packages, [])

    def test_expoe_resumo_da_varredura_em_last_scan_stats(self):
        (self.root / "b.pdf").unlink()  # sem demonstrativo na pasta
        self.repo.scan_financial_documents()
        row = {**self.receivable_row, "seqdemonstrativo": None}  # e sem seqdemo -> incompleto
        ledger = BillingSendLedger(self.root / "ledger.json")
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[row]):
            self.repo.find_ready_billing_packages(["invoice", "statement"], ledger)
        stats = self.repo._last_scan_stats
        self.assertEqual(stats["checked"], 1)
        self.assertEqual(stats["ready"], 0)
        self.assertEqual(stats["missingByType"]["statement"], 1)
        self.assertIn("ambiguous", stats)

    def test_pasta_tem_prioridade_sobre_statementRef(self):
        # Com o PDF oficial na pasta, o pacote usa o arquivo -- nao a referencia.
        ledger = BillingSendLedger(self.root / "ledger.json")
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]):
            packages = self.repo.find_ready_billing_packages(["invoice", "statement"], ledger)
        docs = {d["documentType"]: d for d in packages[0]["documents"]}
        self.assertIn("path", docs["statement"])
        self.assertNotIn("statementRef", docs["statement"])

    def test_ignores_documents_older_than_min_mtime_ns(self):
        """Regression: the backlog folder can have a year+ of already-filed
        documents. Turning on automatic sending must never blast that whole
        history at once - only documents modified from a configured cutoff
        onward are eligible (see AppConfig.billing_auto_send_since)."""
        ledger = BillingSendLedger(self.root / "ledger.json")
        future_cutoff_ns = int((time.time() + 3600) * 1_000_000_000)
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]):
            # Every file on disk was modified before "now + 1h", so with that
            # as the cutoff, nothing qualifies - exactly what must happen the
            # first time this feature is enabled against an old backlog.
            packages = self.repo.find_ready_billing_packages(
                ["invoice", "statement", "boleto"], ledger, min_mtime_ns=future_cutoff_ns,
            )
        self.assertEqual(packages, [])


class SendBillingPackageRefTest(unittest.TestCase):
    """O corpo do POST muda quando o documento e uma referencia (boletoRef /
    statementRef) em vez de um arquivo lido da pasta."""

    class _Resp:
        status_code = 200
        def raise_for_status(self):
            pass
        def json(self):
            return {"success": True}

    def _crm(self):
        config = AppConfig(crm_base_url="https://crm.example", crm_tenant_slug="acme")
        return CRMClient(config)

    def test_statementRef_vai_sem_pdfBase64(self):
        crm = self._crm()
        captured = {}
        def fake_post(url, json=None, timeout=None):
            captured["url"] = url
            captured["json"] = json
            return self._Resp()
        with patch.object(crm.session, "post", side_effect=fake_post):
            crm.send_billing_package({
                "receivableExternalId": 501,
                "documents": [{
                    "documentType": "statement",
                    "fileName": "DEMONSTRATIVO 2026-08 - ACME.pdf",
                    "statementRef": {"receivableExternalId": "501", "seqDemonstrativo": "14365", "period": "2026/08"},
                }],
            })
        doc = captured["json"]["documents"][0]
        self.assertEqual(doc["statementRef"]["seqDemonstrativo"], "14365")
        self.assertNotIn("pdfBase64", doc)
        self.assertEqual(doc["mimeType"], "application/pdf")


class RunBillingAutomationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        make_pdf(self.root / "a.pdf", [
            "Fatura de Locacao de Bens Moveis",
            f"Cliente J. C. MUNIZ - CNPJ {CUSTOMER_CNPJ}",
            "Fatura 14328",
            f"Data Emissao {_EMISSAO_BR}",
            f"Data de Vencimento {_VENC_BR}",
            "VALOR LIQUIDO R$ 141,30",
        ])
        self.config = AppConfig(
            financial_document_folders=[str(self.root)],
            financial_document_index_file=self.root / "index.json",
            billing_auto_send_enabled=True,
            billing_auto_send_document_types=["invoice"],
            # Isolado do diretorio real do agente - sem isso, cada rodada de
            # teste leria/gravaria o arquivo de corte de data de verdade.
            billing_auto_send_since_file=self.root / "since.json",
            # Sem janela de horario nos testes gerais desta classe (senao
            # passariam/falhariam conforme a hora/dia em que rodam). Os testes
            # de janela ficam em WithinBillingWindowTest.
            billing_auto_send_hours="",
            billing_auto_send_weekdays_only=False,
        )
        self.repo = FirebirdRepository(self.config)
        self.repo.scan_financial_documents()
        self.receivable_row = {
            "seqreceita": 777,
            "customer_cnpj": CUSTOMER_CNPJ,
            "customer_cpf": None,
            "customer_name": "J. C. MUNIZ & CIA LTDA",
            "invoice_number": "14328",
            "seqdemonstrativo": None,
            "dtemissaonfs": None,
            "dtemissaorec": _EMISSAO_ISO,
            "dtvectorec": _VENC_ISO,
            "valreceita": 141.30,
        }

    def tearDown(self):
        self.temporary.cleanup()

    def test_disabled_by_default_does_nothing(self):
        self.config.billing_auto_send_enabled = False
        ledger = BillingSendLedger(self.root / "ledger.json")
        crm = CRMClient(self.config)
        with patch.object(crm, "send_billing_package") as send:
            stats = run_billing_automation(self.repo, crm, self.config, ledger)
        send.assert_not_called()
        self.assertEqual(stats, {"ready": 0, "sent": 0, "failed": 0, "skipped": 0})

    def test_test_mode_never_calls_send_and_still_dedupes_via_ledger(self):
        self.config.billing_auto_send_test_mode = True
        ledger = BillingSendLedger(self.root / "ledger.json")
        crm = CRMClient(self.config)
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package") as send, \
             patch.object(crm, "log_test_billing") as log_test:
            stats = run_billing_automation(self.repo, crm, self.config, ledger)
        send.assert_not_called()
        # O CRM ainda precisa saber que um envio de teste "aconteceu", para
        # aparecer na tela de Logs mesmo sem nada ser enviado de verdade.
        log_test.assert_called_once()
        self.assertEqual(stats["sent"], 1)
        self.assertEqual(stats["failed"], 0)

        # Recorded once -- a second pass finds nothing new ready, so the same
        # package is not logged again every cycle.
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package") as send_again, \
             patch.object(crm, "log_test_billing") as log_test_again:
            stats_again = run_billing_automation(self.repo, crm, self.config, ledger)
        self.assertEqual(stats_again["ready"], 0)
        send_again.assert_not_called()
        log_test_again.assert_not_called()

    def test_real_mode_sends_and_records_only_on_success(self):
        self.config.billing_auto_send_test_mode = False
        ledger = BillingSendLedger(self.root / "ledger.json")
        crm = CRMClient(self.config)
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package", return_value={"success": True}) as send:
            stats = run_billing_automation(self.repo, crm, self.config, ledger)
        send.assert_called_once()
        self.assertEqual(stats["sent"], 1)

    def test_real_mode_does_not_record_a_failed_send_so_it_retries_next_time(self):
        self.config.billing_auto_send_test_mode = False
        ledger = BillingSendLedger(self.root / "ledger.json")
        crm = CRMClient(self.config)
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package", side_effect=RuntimeError("boom")):
            stats = run_billing_automation(self.repo, crm, self.config, ledger)
        self.assertEqual(stats["failed"], 1)
        self.assertEqual(stats["sent"], 0)

        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package", return_value={"success": True}) as send:
            stats_retry = run_billing_automation(self.repo, crm, self.config, ledger)
        send.assert_called_once()
        self.assertEqual(stats_retry["sent"], 1)

    # Compatibilidade com o backend antigo: antes do campo `skipped`, a
    # resposta ainda era HTTP 200 e só trazia esta mensagem.
    SKIPPED_RESPONSE = {
        "success": True,
        "message": "Envio automatico nao habilitado para este contato.",
    }

    def test_real_mode_skip_backs_off_instead_de_retentar_todo_ciclo(self):
        self.config.billing_auto_send_test_mode = False
        self.config.billing_skip_retry_hours = 24
        ledger = BillingSendLedger(self.root / "ledger.json")
        crm = CRMClient(self.config)
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package", return_value=self.SKIPPED_RESPONSE) as send:
            stats = run_billing_automation(self.repo, crm, self.config, ledger)
        send.assert_called_once()
        self.assertEqual(stats["sent"], 0)
        self.assertEqual(stats["failed"], 0)
        self.assertEqual(stats["skipped"], 1)

        # Dentro da janela de backoff, o mesmo título nem chega a ser POSTado
        # de novo -- era exatamente esse re-POST a cada ~10 min que inflava o
        # relatório em milhares de linhas por dia.
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package") as send_again:
            stats_again = run_billing_automation(self.repo, crm, self.config, ledger)
        send_again.assert_not_called()
        self.assertEqual(stats_again["ready"], 0)

    def test_real_mode_skip_retries_after_backoff_window(self):
        self.config.billing_auto_send_test_mode = False
        self.config.billing_skip_retry_hours = 24
        ledger = BillingSendLedger(self.root / "ledger.json")
        crm = CRMClient(self.config)
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package", return_value=self.SKIPPED_RESPONSE):
            run_billing_automation(self.repo, crm, self.config, ledger)

        # A janela expirou (opt-in do cliente foi corrigido nesse meio-tempo).
        key = next(iter(ledger.data))
        self.assertTrue(ledger.data[key]["skipped"])
        ledger.data[key]["retryAfter"] = (datetime.now() - timedelta(minutes=1)).isoformat(timespec="seconds")

        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package", return_value={"success": True}) as send_retry:
            stats_retry = run_billing_automation(self.repo, crm, self.config, ledger)
        send_retry.assert_called_once()
        self.assertEqual(stats_retry["sent"], 1)
        # Envio real sobrescreve o skip -> vira permanente, nunca reenviado.
        self.assertNotIn("retryAfter", ledger.data[key])

    def test_billing_skip_retry_hours_zero_desliga_o_backoff(self):
        self.config.billing_auto_send_test_mode = False
        self.config.billing_skip_retry_hours = 0
        ledger = BillingSendLedger(self.root / "ledger.json")
        crm = CRMClient(self.config)
        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package", return_value=self.SKIPPED_RESPONSE):
            run_billing_automation(self.repo, crm, self.config, ledger)
        self.assertEqual(ledger.data, {})

        with patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package", return_value={"success": True}) as send_retry:
            stats_retry = run_billing_automation(self.repo, crm, self.config, ledger)
        send_retry.assert_called_once()
        self.assertEqual(stats_retry["sent"], 1)

    def test_fora_da_janela_de_horario_nao_envia_nada(self):
        self.config.billing_auto_send_test_mode = False
        self.config.billing_auto_send_hours = "8-19"
        self.config.billing_auto_send_weekdays_only = False
        ledger = BillingSendLedger(self.root / "ledger.json")
        crm = CRMClient(self.config)
        fake_now = datetime(2026, 8, 28, 3, 0, 0)  # 03:00 -> fora de 8-19
        with patch("main.datetime") as fake_datetime, \
             patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package") as send:
            fake_datetime.now.return_value = fake_now
            fake_datetime.strptime = datetime.strptime
            stats = run_billing_automation(self.repo, crm, self.config, ledger)
        send.assert_not_called()
        self.assertTrue(stats.get("outside_window"))
        self.assertEqual(stats["ready"], 0)

    def test_force_window_ignora_a_janela(self):
        self.config.billing_auto_send_test_mode = False
        self.config.billing_auto_send_hours = "8-19"
        self.config.billing_auto_send_weekdays_only = False
        ledger = BillingSendLedger(self.root / "ledger.json")
        crm = CRMClient(self.config)
        # Hora 3 (fora da janela 8-19), mas no mes atual para o filtro D4
        # (titulo emitido neste mes) nao barrar o envio antes do teste da janela.
        fake_now = datetime.now().replace(hour=3, minute=0, second=0, microsecond=0)
        with patch("main.datetime") as fake_datetime, \
             patch.object(self.repo, "fetch_open_receivables_for_billing", return_value=[self.receivable_row]), \
             patch.object(crm, "send_billing_package", return_value={"success": True}) as send:
            fake_datetime.now.return_value = fake_now
            fake_datetime.strptime = datetime.strptime
            stats = run_billing_automation(self.repo, crm, self.config, ledger, force_window=True)
        send.assert_called_once()
        self.assertEqual(stats["sent"], 1)


class WithinBillingWindowTest(unittest.TestCase):
    def _cfg(self, hours="8-19", weekdays_only=True):
        return AppConfig(billing_auto_send_hours=hours, billing_auto_send_weekdays_only=weekdays_only)

    def test_dentro_do_horario_em_dia_util(self):
        # 2026-08-28 e uma sexta-feira.
        self.assertTrue(_within_billing_window(self._cfg(), datetime(2026, 8, 28, 9, 0)))
        self.assertTrue(_within_billing_window(self._cfg(), datetime(2026, 8, 28, 18, 59)))

    def test_fora_do_horario(self):
        self.assertFalse(_within_billing_window(self._cfg(), datetime(2026, 8, 28, 7, 59)))
        self.assertFalse(_within_billing_window(self._cfg(), datetime(2026, 8, 28, 19, 0)))  # fim exclusivo
        self.assertFalse(_within_billing_window(self._cfg(), datetime(2026, 8, 28, 2, 0)))

    def test_fim_de_semana_bloqueia_quando_weekdays_only(self):
        # 2026-08-29 sabado, 2026-08-30 domingo.
        self.assertFalse(_within_billing_window(self._cfg(), datetime(2026, 8, 29, 10, 0)))
        self.assertFalse(_within_billing_window(self._cfg(), datetime(2026, 8, 30, 10, 0)))
        self.assertTrue(_within_billing_window(self._cfg(weekdays_only=False), datetime(2026, 8, 29, 10, 0)))

    def test_sem_restricao_de_hora(self):
        self.assertTrue(_within_billing_window(self._cfg(hours=""), datetime(2026, 8, 28, 3, 0)))
        self.assertTrue(_within_billing_window(self._cfg(hours="  "), datetime(2026, 8, 28, 23, 0)))

    def test_formato_invalido_nao_bloqueia(self):
        self.assertTrue(_within_billing_window(self._cfg(hours="oito as seis"), datetime(2026, 8, 28, 3, 0)))
        self.assertTrue(_within_billing_window(self._cfg(hours="19-8"), datetime(2026, 8, 28, 3, 0)))  # start>=end


class ResolveBillingAutoSendSinceTest(unittest.TestCase):
    """The safety cutoff that stops automatic sending from blasting a
    backlog of already-filed documents the moment ambiguity/matching is
    fixed - each tenant enables this at a different time, so it must be
    self-configuring per install, not a hardcoded date."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.since_file = Path(self.temporary.name) / "since.json"

    def tearDown(self):
        self.temporary.cleanup()

    def test_first_call_persists_todays_date(self):
        config = AppConfig(billing_auto_send_since_file=self.since_file)
        today = time.strftime("%Y-%m-%d")
        result = agent_main._resolve_billing_auto_send_since(config)
        self.assertEqual(result, today)
        self.assertTrue(self.since_file.exists())

    def test_second_call_reuses_the_persisted_date_instead_of_recomputing_today(self):
        config = AppConfig(billing_auto_send_since_file=self.since_file)
        self.since_file.write_text('{"since": "2026-01-15"}', encoding="utf-8")
        # Mesmo rodando "hoje" (uma data bem posterior), o corte fica fixo no
        # dia em que o recurso foi ligado pela primeira vez - senao "hoje"
        # mudaria a cada reinicio do agente e nada seria enviado nunca.
        self.assertEqual(agent_main._resolve_billing_auto_send_since(config), "2026-01-15")

    def test_explicit_config_value_always_wins_and_is_never_persisted(self):
        config = AppConfig(billing_auto_send_since_file=self.since_file, billing_auto_send_since="2025-06-01")
        self.assertEqual(agent_main._resolve_billing_auto_send_since(config), "2025-06-01")
        self.assertFalse(self.since_file.exists())


if __name__ == "__main__":
    unittest.main()

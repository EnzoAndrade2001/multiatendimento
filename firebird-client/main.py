from __future__ import annotations

import argparse
import base64
from io import BytesIO
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import re
from decimal import Decimal
import sys
import time
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import firebirdsql
import requests
from dotenv import load_dotenv
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from xml.sax.saxutils import escape

from financial_document_index import DOCUMENT_LABELS, FinancialDocumentIndex, friendly_filename, replace_with_retry


if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parent


DEFAULT_AGENT_VERSION = "1.0.1"
DEFAULT_AGENT_PROTOCOL_VERSION = "1"
AGENT_CAPABILITIES = (
    "sync.contacts",
    "sync.equipments",
    "sync.contracts",
    "sync.service-orders",
    "sync.financial",
    "commands.create-os",
    "commands.process-billing",
    "commands.fetch-billing-document",
    "commands.fetch-company-profile",
)


def digits(value: Any) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\D+", "", str(value))
    return text or None


def first_non_empty(*values: Any) -> str | None:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def fit_text(value: Any, max_length: int) -> str:
    if value is None:
        return ""
    return str(value).strip()[:max_length]


def is_duplicate_key_error(error: Exception) -> bool:
    message = str(error or "").upper()
    return (
        "PRIMARY OR UNIQUE KEY" in message
        or "DUPLICATE VALUE" in message
        or "VIOLATION OF PRIMARY" in message
    )


def parse_firebird_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")

    text = str(value).strip()
    match = re.match(r"(\d{2})/(\d{2})/(\d{4}) (\d{2}):(\d{2}):(\d{2})", text)
    if not match:
        return None

    dd, mm, yyyy, hh, mi, ss = match.groups()
    return datetime(
        int(yyyy), int(mm), int(dd), int(hh), int(mi), int(ss)
    ).isoformat(timespec="seconds")


def parse_firebird_timestamp_to_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value

    text = str(value).strip()
    match = re.match(r"(\d{2})/(\d{2})/(\d{4}) (\d{2}):(\d{2}):(\d{2})", text)
    if not match:
        return None

    dd, mm, yyyy, hh, mi, ss = match.groups()
    return datetime(int(yyyy), int(mm), int(dd), int(hh), int(mi), int(ss))


def normalize_phone(*values: Any) -> str | None:
    for value in values:
        phone = digits(value)
        if phone:
            # Keep only numeric content; backend will normalize if needed.
            return phone
    return None


def compose_brazil_phone(area_code: Any, number: Any) -> str | None:
    area = digits(area_code)
    local = digits(number)
    if not local:
        return None
    if area:
        return f"{area}{local}"
    return local


def normalize_company_info(record: dict[str, Any]) -> dict[str, Any]:
    """Converte IEMPRESA em um perfil seguro e estável para o CRM."""
    code = record.get("cdempresa")
    address = first_non_empty(record.get("endereco"), record.get("logradouro"))
    number = first_non_empty(record.get("num"), record.get("numero"))
    phone = compose_brazil_phone(record.get("ddd"), record.get("fone1")) or normalize_phone(
        record.get("fone1"), record.get("fone"), record.get("telefone"), record.get("celular")
    )
    return {
        "companyCode": str(code).strip() if code is not None else None,
        "name": first_non_empty(record.get("nmempresa"), record.get("razaosocial"), record.get("razao_social")),
        "tradeName": first_non_empty(record.get("fantasia"), record.get("nmfantasia"), record.get("nomefantasia")),
        "cnpj": first_non_empty(record.get("cnpj"), record.get("cpfcnpj")),
        "stateRegistration": first_non_empty(record.get("inscest"), record.get("ie"), record.get("inscricaoestadual")),
        "address": address,
        "number": number,
        "neighborhood": first_non_empty(record.get("bairro")),
        "zipCode": first_non_empty(record.get("cep")),
        "city": first_non_empty(record.get("cidade")),
        "state": first_non_empty(record.get("uf"), record.get("estado")),
        "areaCode": first_non_empty(record.get("ddd")),
        "phone": phone,
        "capturedAt": datetime.now().isoformat(timespec="seconds"),
    }


def json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return value.hex()
    return value


def format_date_br(value: Any) -> str:
    if not value:
        return "Nao informado"
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y")
    text = str(value).strip()
    try:
        return datetime.fromisoformat(text[:19]).strftime("%d/%m/%Y")
    except ValueError:
        return text


def format_money_br(value: Any) -> str:
    try:
        amount = Decimal(str(value or 0))
    except Exception:
        amount = Decimal("0")
    rendered = f"{amount:,.2f}"
    return "R$ " + rendered.replace(",", "_").replace(".", ",").replace("_", ".")


def safe_pdf_filename_part(value: Any, fallback: str = "CLIENTE") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 ._-]+", " ", str(value or "")).strip()
    return (cleaned or fallback)[:70]


@dataclass
class AppConfig:
    agent_version: str = DEFAULT_AGENT_VERSION
    agent_protocol_version: str = DEFAULT_AGENT_PROTOCOL_VERSION
    firebird_host: str = "127.0.0.1"
    firebird_port: int = 3050
    firebird_database: str = ""
    firebird_user: str = "SYSDBA"
    firebird_password: str = ""
    firebird_charset: str = "WIN1252"
    firebird_company_id: int = 1
    crm_base_url: str = ""
    crm_tenant_slug: str = ""
    crm_sync_token: str = ""
    sync_interval_seconds: int = 300
    batch_size: int = 250
    sync_service_orders: bool = True
    state_file: Path = field(default_factory=lambda: ROOT / "state.json")
    log_dir: Path = field(default_factory=lambda: ROOT / "logs")
    log_file: Path = field(default_factory=lambda: ROOT / "logs" / "client.log")
    log_max_bytes: int = 5 * 1024 * 1024
    log_backup_count: int = 5
    log_level: str = "INFO"
    own_cnpj: str = "35.692.721/0001-94"
    billing_send_policy: str = "Somente Marcados"
    financial_document_folders: list[str] = field(default_factory=list)
    financial_document_index_file: Path = field(default_factory=lambda: ROOT / "financial-documents-index.json")
    financial_document_scan_seconds: int = 600
    # Envio automatico de cobranca pelo WhatsApp, construido sobre o indice de
    # documentos financeiros (substitui a antiga pasta "boletos_enviar" que
    # movia arquivos e identificava o cliente so pelo CNPJ solto no texto).
    billing_auto_send_enabled: bool = False
    billing_auto_send_test_mode: bool = True
    billing_auto_send_document_types: list[str] = field(default_factory=lambda: ["invoice", "statement", "boleto"])
    billing_auto_send_ledger_file: Path = field(default_factory=lambda: ROOT / "billing-auto-send-ledger.json")
    billing_auto_send_since_file: Path = field(default_factory=lambda: ROOT / "billing-auto-send-since.json")
    # Data (YYYY-MM-DD) a partir da qual um PDF passa a valer pro envio
    # automatico, pela data de modificacao do ARQUIVO (nao pela data de
    # emissao da cobranca) - documentos antigos ja arquivados nao devem ser
    # disparados so porque passaram a bater no indice. Se vazio, o proprio
    # agente define e grava a data de hoje (uma unica vez, em state.json) na
    # primeira execucao apos essa funcionalidade ser ativada.
    billing_auto_send_since: str | None = None

    @classmethod
    def from_env(cls) -> "AppConfig":
        load_dotenv(ROOT / ".env")

        def env_int(name: str, default: int) -> int:
            try:
                return int(os.getenv(name, str(default)))
            except ValueError:
                return default

        def env_bool(name: str, default: bool) -> bool:
            value = os.getenv(name)
            if value is None:
                return default
            return value.strip().lower() in {"1", "true", "yes", "sim", "s"}

        def resolve_path(value: str, default: Path) -> Path:
            path = Path(value) if value else default
            if not path.is_absolute():
                path = ROOT / path
            return path

        def env_folders(name: str) -> list[str]:
            value = os.getenv(name, "").strip()
            if not value:
                return []
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            except (TypeError, ValueError, json.JSONDecodeError):
                pass
            return [item.strip() for item in re.split(r"[|\n]+", value) if item.strip()]

        state_file = Path(os.getenv("STATE_FILE", "state.json"))
        if not state_file.is_absolute():
            state_file = ROOT / state_file

        log_dir = resolve_path(os.getenv("LOG_DIR", "logs"), ROOT / "logs")
        log_file = resolve_path(os.getenv("LOG_FILE", "logs/client.log"), ROOT / "logs" / "client.log")

        return cls(
            agent_version=os.getenv("AGENT_VERSION", DEFAULT_AGENT_VERSION).strip() or DEFAULT_AGENT_VERSION,
            agent_protocol_version=(
                os.getenv("AGENT_PROTOCOL_VERSION", DEFAULT_AGENT_PROTOCOL_VERSION).strip()
                or DEFAULT_AGENT_PROTOCOL_VERSION
            ),
            firebird_host=os.getenv("FIREBIRD_HOST", "127.0.0.1"),
            firebird_port=env_int("FIREBIRD_PORT", 3050),
            firebird_database=os.getenv("FIREBIRD_DATABASE", ""),
            firebird_user=os.getenv("FIREBIRD_USER", "SYSDBA"),
            firebird_password=os.getenv("FIREBIRD_PASSWORD", ""),
            firebird_charset=os.getenv("FIREBIRD_CHARSET", "WIN1252"),
            firebird_company_id=env_int("FIREBIRD_COMPANY_ID", 1),
            crm_base_url=os.getenv("CRM_BASE_URL", "").rstrip("/"),
            crm_tenant_slug=os.getenv("CRM_TENANT_SLUG", ""),
            crm_sync_token=os.getenv("CRM_SYNC_TOKEN", ""),
            sync_interval_seconds=env_int("SYNC_INTERVAL_SECONDS", 300),
            batch_size=env_int("BATCH_SIZE", 250),
            # Variável nova de propósito: instalações antigas costumam ter
            # SYNC_SERVICE_ORDERS=false para bloquear o antigo scan completo.
            # O incremental seguro fica ativo por padrão sem exigir editar .env.
            sync_service_orders=env_bool("SYNC_SERVICE_ORDERS_INCREMENTAL", True),
            state_file=state_file,
            log_dir=log_dir,
            log_file=log_file,
            log_max_bytes=env_int("LOG_MAX_BYTES", 5 * 1024 * 1024),
            log_backup_count=env_int("LOG_BACKUP_COUNT", 5),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            own_cnpj=os.getenv("OWN_CNPJ", "35.692.721/0001-94"),
            billing_send_policy=os.getenv("BILLING_SEND_POLICY", "Somente Marcados"),
            financial_document_folders=env_folders("FINANCIAL_DOCUMENT_FOLDERS"),
            financial_document_index_file=resolve_path(
                os.getenv("FINANCIAL_DOCUMENT_INDEX_FILE", "financial-documents-index.json"),
                ROOT / "financial-documents-index.json",
            ),
            financial_document_scan_seconds=env_int("FINANCIAL_DOCUMENT_SCAN_SECONDS", 600),
            billing_auto_send_enabled=env_bool("BILLING_AUTO_SEND_ENABLED", False),
            billing_auto_send_test_mode=env_bool("BILLING_AUTO_SEND_TEST_MODE", True),
            billing_auto_send_document_types=env_folders("BILLING_AUTO_SEND_DOCUMENT_TYPES") or ["invoice", "statement", "boleto"],
            billing_auto_send_ledger_file=resolve_path(
                os.getenv("BILLING_AUTO_SEND_LEDGER_FILE", "billing-auto-send-ledger.json"),
                ROOT / "billing-auto-send-ledger.json",
            ),
            billing_auto_send_since=os.getenv("BILLING_AUTO_SEND_SINCE") or None,
        )


class StateStore:
    def __init__(self, path: Path):
        self.path = path
        self.data: dict[str, Any] = {
            "cursors": {
                "contacts": 0,
                "equipments": 0,
                "contracts": 0,
                "serviceOrders": 0,
                "serviceOrderAttendances": 0,
            },
            "last_sync_at": None,
        }
        self.load()

    def load(self) -> None:
        if not self.path.exists():
            return

        try:
            self.data.update(json.loads(self.path.read_text(encoding="utf-8")))
        except Exception as exc:
            logging.warning("Falha ao ler state %s: %s", self.path, exc)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(
            f".{self.path.name}.{os.getpid()}.{threading.get_ident()}.tmp"
        )
        try:
            temporary.write_text(
                json.dumps(self.data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            replace_with_retry(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def get_cursor(self, key: str) -> int:
        return int(self.data.get("cursors", {}).get(key, 0) or 0)

    def set_cursor(self, key: str, value: int) -> None:
        self.data.setdefault("cursors", {})[key] = int(value)

    def set_last_sync_at(self, value: str | None) -> None:
        self.data["last_sync_at"] = value


class CommandResultStore:
    """Durable idempotency ledger for commands that write to Firebird."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.data: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                self.data = raw
        except Exception as exc:
            logging.warning("Falha ao ler resultados de comandos %s: %s", self.path, exc)

    def get(self, command_id: str) -> dict[str, Any] | None:
        with self.lock:
            value = self.data.get(str(command_id))
            return dict(value) if isinstance(value, dict) else None

    def set(self, command_id: str, result: dict[str, Any]) -> None:
        with self.lock:
            self.data[str(command_id)] = {
                **result,
                "recordedAt": datetime.now().isoformat(timespec="seconds"),
            }
            temporary = self.path.with_suffix(self.path.suffix + ".tmp")
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(
                json.dumps(self.data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            replace_with_retry(temporary, self.path)


class BillingSendLedger:
    """Durable record of automatic WhatsApp billing sends.

    Keyed by receivable + the combined sha256 of every document sent for it --
    never by where the PDF sits on disk. A reissued document (different hash)
    is treated as new and can be sent again; the exact same file content is
    never sent twice, even across agent restarts.
    """

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.data: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                self.data = raw
        except Exception as exc:
            logging.warning("Falha ao ler o controle de envios automaticos %s: %s", self.path, exc)

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        replace_with_retry(temporary, self.path)

    @staticmethod
    def key(receivable_id: Any, combined_hash: str) -> str:
        return f"{receivable_id}:{combined_hash}"

    def already_sent(self, receivable_id: Any, combined_hash: str) -> bool:
        with self.lock:
            return self.key(receivable_id, combined_hash) in self.data

    def record(self, receivable_id: Any, combined_hash: str, info: dict[str, Any]) -> None:
        with self.lock:
            self.data[self.key(receivable_id, combined_hash)] = {
                **info,
                "sentAt": datetime.now().isoformat(timespec="seconds"),
            }
            self._save()


class CRMClient:
    def __init__(self, config: AppConfig):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "x-firebird-token": config.crm_sync_token,
            }
        )

    def push(self, entity: str, records: list[dict[str, Any]]) -> dict[str, Any]:
        if not records:
            return {"ok": True, "stats": {"received": 0}}

        url = f"{self.config.crm_base_url}/api/integrations/firebird/push"
        response = self.session.post(
            url,
            json={
                "tenantSlug": self.config.crm_tenant_slug,
                "entity": entity,
                "records": records,
            },
            timeout=120,
        )
        response.raise_for_status()
        return response.json()

    def process_pending_commands(
        self,
        repo: FirebirdRepository,
        result_store: CommandResultStore,
        wait_seconds: int = 0,
        billing_trigger_event: threading.Event | None = None,
    ) -> None:
        url = f"{self.config.crm_base_url}/api/integrations/firebird/pending-commands"
        try:
            response = self.session.get(
                url,
                params={
                    "tenantSlug": self.config.crm_tenant_slug,
                    "wait": max(0, min(int(wait_seconds), 25)),
                },
                timeout=max(30, wait_seconds + 10),
            )
            response.raise_for_status()
            commands = response.json()
            if not commands:
                return

            logging.info("Recebidos %s comandos pendentes do CRM", len(commands))
            for cmd in commands:
                cmd_id = cmd["id"]
                cmd_type = cmd["type"]
                payload = cmd["payload"]

                try:
                    if cmd_type == "CREATE_OS":
                        cached = result_store.get(cmd_id)
                        if cached and cached.get("seqOs"):
                            seq_os = int(cached["seqOs"])
                            command_result = dict(cached)
                            logging.info(
                                "Comando %s ja processado; reenviando SEQOS %s.",
                                cmd_id,
                                seq_os,
                            )
                        else:
                            seq_os = repo.create_service_order(payload)
                            command_result = {"seqOs": seq_os}
                            try:
                                command_result["printData"] = repo.fetch_service_order_print_data(seq_os)
                            except Exception as print_data_error:
                                logging.warning(
                                    "O.S. %s criada, mas o historico para impressao nao foi consultado: %s",
                                    seq_os,
                                    print_data_error,
                                )
                            # Persist before callback. If HTTPS fails, replaying this
                            # command returns the same SEQOS instead of inserting again.
                            result_store.set(cmd_id, command_result)
                        self.report_command_result(cmd_id, success=True, result=command_result)
                        logging.info("O.S. criada no Firebird com sucesso. SEQOS: %s", seq_os)
                    elif cmd_type == "PROCESS_BILLING":
                        # O fluxo antigo de pasta foi aposentado, mas o comando continua
                        # sendo usado pelo botao "Reprocessar pendencias" do CRM. Acorda
                        # o monitor de documentos para executar uma rodada imediata; o
                        # proprio ledger continua impedindo qualquer pacote ja entregue.
                        if billing_trigger_event is not None:
                            billing_trigger_event.set()
                        logging.info("Reprocessamento de cobrancas solicitado pelo CRM; monitor acordado.")
                        self.report_command_result(
                            cmd_id,
                            success=True,
                            result={"message": "Reprocessamento solicitado. Pacotes ja enviados permanecem protegidos pelo ledger."},
                        )
                    elif cmd_type == "FETCH_BILLING_PDF":
                        logging.info("Buscando PDF do boleto %s sob demanda...", payload.get("receivableExternalId"))
                        command_result = repo.fetch_billing_pdf(payload)
                        self.report_command_result(cmd_id, success=True, result=command_result)
                        logging.info("PDF do boleto recuperado com sucesso.")
                    elif cmd_type == "FETCH_BILLING_DOCUMENT":
                        document_type = str(payload.get("documentType") or "").strip().lower()
                        logging.info(
                            "Gerando documento financeiro %s do titulo %s...",
                            document_type,
                            payload.get("receivableExternalId"),
                        )
                        command_result = repo.fetch_billing_document(payload)
                        self.report_command_result(cmd_id, success=True, result=command_result)
                        logging.info("Documento financeiro %s gerado com sucesso.", document_type)
                    elif cmd_type == "FETCH_COMPANY_PROFILE":
                        logging.info("Consultando cadastro da empresa no iLux (IEMPRESA)...")
                        company = repo.fetch_company_info(payload.get("companyCode"))
                        self.report_command_result(cmd_id, success=True, result={"company": company})
                        logging.info(
                            "Cadastro da empresa sincronizado: %s.",
                            company.get("name") or company.get("companyCode") or "sem nome",
                        )
                    else:
                        logging.warning("Tipo de comando desconhecido: %s", cmd_type)
                except Exception as e:
                    logging.exception("Erro ao processar comando %s:", cmd_id)
                    self.report_command_result(cmd_id, success=False, error=str(e))
        except Exception as e:
            logging.error("Falha ao buscar ou processar comandos do CRM: %s", e)

    def report_command_result(self, command_id: str, success: bool, result: dict | None = None, error: str | None = None) -> None:
        url = f"{self.config.crm_base_url}/api/integrations/firebird/pending-commands/{command_id}/callback"
        for attempt in range(1, 4):
            try:
                response = self.session.post(
                    url,
                    json={
                        "tenantSlug": self.config.crm_tenant_slug,
                        "success": success,
                        "result": result,
                        "error": error
                    },
                    timeout=30
                )
                response.raise_for_status()
                return
            except Exception as exc:
                logging.error(
                    "Falha ao reportar resultado do comando %s (tentativa %s/3): %s",
                    command_id,
                    attempt,
                    exc,
                )
                if attempt < 3:
                    time.sleep(attempt)

    def send_ping(self) -> None:
        url = f"{self.config.crm_base_url}/api/integrations/firebird/ping"
        try:
            self.session.post(
                url,
                json={
                    # Keep tenantSlug unchanged for compatibility with current
                    # backend versions. The remaining fields are additive.
                    "tenantSlug": self.config.crm_tenant_slug,
                    "version": self.config.agent_version,
                    "protocolVersion": self.config.agent_protocol_version,
                    "capabilities": list(AGENT_CAPABILITIES),
                    "health": {
                        "status": "online",
                        "reportedAt": datetime.now().isoformat(timespec="seconds"),
                        "processId": os.getpid(),
                        "runtime": "executable" if getattr(sys, "frozen", False) else "python",
                    },
                },
                timeout=10
            )
        except Exception as e:
            logging.error("Falha ao enviar ping: %s", e)

    def send_billing_package(self, package: dict[str, Any]) -> dict[str, Any]:
        """Delivers one automatic billing package (already matched and deduped
        by find_ready_billing_packages) to the backend, which enforces the
        per-contact WhatsApp opt-in and sends it the same way the CRM's manual
        'Reenviar' button does.
        """
        url = f"{self.config.crm_base_url}/api/integrations/firebird/auto-send-billing"
        documents = []
        for document in package["documents"]:
            pdf_bytes = Path(document["path"]).read_bytes()
            documents.append({
                "documentType": document["documentType"],
                "fileName": document["fileName"],
                "mimeType": "application/pdf",
                "pdfBase64": base64.b64encode(pdf_bytes).decode("ascii"),
            })
        response = self.session.post(
            url,
            json={
                "tenantSlug": self.config.crm_tenant_slug,
                "receivableExternalId": str(package["receivableExternalId"]),
                "sendPolicy": self.config.billing_send_policy,
                "documents": documents,
            },
            timeout=120,
        )
        response.raise_for_status()
        return response.json()

    def log_test_billing(self, package: dict[str, Any]) -> None:
        """Registra na tela de Logs do CRM que este pacote seria enviado, sem
        enviar nada de verdade - permite acompanhar o modo teste direto do
        CRM em vez de depender do log local do agente."""
        url = f"{self.config.crm_base_url}/api/integrations/firebird/log-test-billing"
        try:
            response = self.session.post(
                url,
                json={
                    "tenantSlug": self.config.crm_tenant_slug,
                    "cpfCnpj": package.get("customerCnpj") or package.get("customerCpf"),
                    "customerName": package.get("customerName"),
                    "fileNames": [document["fileName"] for document in package["documents"]],
                },
                timeout=30,
            )
            response.raise_for_status()
        except Exception as exc:
            # Nao interrompe o ciclo de teste por causa disso - e so um espelho
            # de conveniencia na tela do CRM, o log local continua valendo.
            logging.warning("Falha ao espelhar log de teste no CRM: %s", exc)

class FirebirdRepository:
    def __init__(self, config: AppConfig):
        self.config = config
        self._financial_index: FinancialDocumentIndex | None = None

    def financial_document_index(self) -> FinancialDocumentIndex:
        if self._financial_index is None:
            self._financial_index = FinancialDocumentIndex(
                self.config.financial_document_folders,
                self.config.financial_document_index_file,
                self.config.own_cnpj,
            )
        return self._financial_index

    def scan_financial_documents(self, on_progress: Callable[[str], None] | None = None) -> dict[str, int]:
        return self.financial_document_index().scan(on_progress=on_progress)

    def find_ready_billing_packages(
        self,
        document_types: list[str],
        ledger: "BillingSendLedger",
        min_mtime_ns: int | None = None,
    ) -> list[dict[str, Any]]:
        """Open receivables whose configured document types (e.g. boleto + nota
        fiscal + demonstrativo) all match, unambiguously, a PDF already in the
        financial document index -- and that were not sent before for this
        exact combination of file contents.

        min_mtime_ns: ignora documentos modificados antes dessa data - impede
        que o backlog historico da pasta seja disparado so porque passou a
        bater no indice (ver AppConfig.billing_auto_send_since).

        Pure detection: never touches the network, never moves a file. Sending
        is the caller's job (see run_billing_automation).
        """
        index = self.financial_document_index()
        if not index.entries or not document_types:
            return []

        packages: list[dict[str, Any]] = []
        checked = 0
        already_sent = 0
        # Por tipo de documento: quantos titulos pararam ali por falta de match
        # (nao ambiguo - simplesmente nenhum PDF indexado bateu). O aviso de
        # "ambiguo" ja e logado individualmente; sem isso aqui, um "0 prontos"
        # ficava mudo sobre qual dos 3 tipos (nota/demonstrativo/boleto) e o
        # gargalo real, e reproduzir localmente nao ajuda - o indice depende
        # das pastas de rede da maquina do agente.
        missing_by_type = {t: 0 for t in document_types}
        for row in self.fetch_open_receivables_for_billing():
            checked += 1
            receivable_id = row.get("seqreceita")
            context = {
                "customer_cnpj": row.get("customer_cnpj"),
                "customer_cpf": row.get("customer_cpf"),
                "customer_name": row.get("customer_name"),
                "invoice_number": row.get("invoice_number"),
                "seqdemonstrativo": row.get("seqdemonstrativo"),
                "dtemissaonfs": row.get("dtemissaonfs"),
                "dtemissaorec": row.get("dtemissaorec"),
                "dtvectorec": row.get("dtvectorec"),
                "valreceita": row.get("valreceita"),
                "seqreceita": receivable_id,
            }

            matches: dict[str, Any] = {}
            for document_type in document_types:
                try:
                    match = index.find(document_type, context, min_mtime_ns=min_mtime_ns)
                except ValueError as exc:
                    # Ambiguous match: exactly the case find() protects the manual
                    # "Visualizar/Baixar" flow from too. An automatic send must be
                    # even more conservative, so the whole package is skipped and
                    # flagged for someone to look at (it already surfaces in the
                    # CRM's "documentos precisam de revisao" panel).
                    logging.warning(
                        "Envio automatico: titulo %s tem %s ambiguo, pulando ate revisao manual (%s)",
                        receivable_id, document_type, exc,
                    )
                    matches = {}
                    break
                if match is None:
                    missing_by_type[document_type] += 1
                    matches = {}
                    break
                matches[document_type] = match

            if len(matches) != len(document_types):
                continue

            combined_hash = ":".join(sorted(match.sha256 for match in matches.values()))
            if ledger.already_sent(receivable_id, combined_hash):
                already_sent += 1
                continue

            packages.append({
                "receivableExternalId": receivable_id,
                "customerName": row.get("customer_name"),
                "customerCnpj": row.get("customer_cnpj"),
                "customerCpf": row.get("customer_cpf"),
                "combinedHash": combined_hash,
                "documents": [
                    {
                        "documentType": document_type,
                        "path": match.path,
                        "sha256": match.sha256,
                        "fileName": friendly_filename(document_type, context),
                    }
                    for document_type, match in matches.items()
                ],
            })
        logging.info(
            "Envio automatico: %s titulo(s) em aberto verificado(s), %s pronto(s), %s ja enviado(s) antes. "
            "Sem match (nao ambiguo) por tipo: %s",
            checked, len(packages), already_sent, missing_by_type,
        )
        return packages

    def connect(self):
        if not self.config.firebird_database:
            raise RuntimeError("FIREBIRD_DATABASE não configurado.")

        return firebirdsql.connect(
            host=self.config.firebird_host,
            port=self.config.firebird_port,
            database=self.config.firebird_database,
            user=self.config.firebird_user,
            password=self.config.firebird_password,
            charset=self.config.firebird_charset,
        )

    def _rows(self, sql: str, params: tuple[Any, ...]) -> Iterator[dict[str, Any]]:
        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute(sql, params)
            columns = [desc[0].lower() for desc in cur.description]

            while True:
                batch = cur.fetchmany(self.config.batch_size)
                if not batch:
                    break
                for row in batch:
                    yield dict(zip(columns, row))
        finally:
            try:
                con.close()
            except Exception:
                pass

    def fetch_company_info(self, company_id: int | None = None) -> dict[str, Any]:
        """Lê o cadastro oficial da empresa no iLux (IEMPRESA).

        O código da empresa é configurável porque algumas instalações possuem
        mais de um cadastro. Quando não houver código válido, usamos o primeiro
        cadastro disponível, mantendo o agente útil em bases antigas.
        """
        selected_id = int(company_id or self.config.firebird_company_id or 1)
        rows = list(self._rows(
            "select first 1 * from IEMPRESA where CDEMPRESA = ?",
            (selected_id,),
        ))
        if not rows:
            rows = list(self._rows("select first 1 * from IEMPRESA order by CDEMPRESA", ()))
        if not rows:
            raise RuntimeError("Nenhum cadastro encontrado na tabela IEMPRESA.")
        return normalize_company_info(rows[0])

    def inspect_schema(self, sample_rows: int = 3) -> dict[str, Any]:
        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute(
                """
                select
                    trim(rdb$relation_name) as relation_name,
                    case
                      when rdb$view_blr is null then 'TABLE'
                      else 'VIEW'
                    end as relation_type
                from rdb$relations
                where coalesce(rdb$system_flag, 0) = 0
                order by rdb$relation_name
                """
            )
            relations = [
                {"name": str(row[0]).strip(), "type": str(row[1]).strip()}
                for row in cur.fetchall()
            ]

            cur.execute(
                """
                select
                    trim(rf.rdb$relation_name) as relation_name,
                    trim(rf.rdb$field_name) as field_name,
                    f.rdb$field_type,
                    f.rdb$field_length,
                    f.rdb$field_scale,
                    rf.rdb$field_position
                from rdb$relation_fields rf
                join rdb$fields f on f.rdb$field_name = rf.rdb$field_source
                join rdb$relations r on r.rdb$relation_name = rf.rdb$relation_name
                where coalesce(r.rdb$system_flag, 0) = 0
                order by rf.rdb$relation_name, rf.rdb$field_position
                """
            )
            columns_by_relation: dict[str, list[dict[str, Any]]] = {}
            for row in cur.fetchall():
                relation_name = str(row[0]).strip()
                columns_by_relation.setdefault(relation_name, []).append(
                    {
                        "name": str(row[1]).strip(),
                        "typeCode": row[2],
                        "length": row[3],
                        "scale": row[4],
                        "position": row[5],
                    }
                )

            samples: dict[str, list[dict[str, Any]]] = {}
            for relation in relations:
                name = relation["name"]
                try:
                    cur.execute(f'select first {int(sample_rows)} * from "{name}"')
                    field_names = [desc[0].strip() for desc in cur.description]
                    samples[name] = [
                        {field_names[index]: json_safe(value) for index, value in enumerate(row)}
                        for row in cur.fetchall()
                    ]
                except Exception as exc:
                    samples[name] = [{"error": str(exc)}]

            return {
                "generatedAt": datetime.now().isoformat(timespec="seconds"),
                "relations": relations,
                "columns": columns_by_relation,
                "samples": samples,
            }
        finally:
            try:
                con.close()
            except Exception:
                pass

    def fetch_contacts(self, cursor: int) -> Iterator[dict[str, Any]]:
        sql = """
            select
                cli.CDCLIENTE, cli.NMCLIENTE, cli.FANTASIA, cli.CPF, cli.CNPJ, cli.CIDADE, cli.UF, cli.CEP,
                cli.ENDERECO, cli.NUM, cli.COMPLEMENTO, cli.BAIRRO, cli.DDD, cli.FONE1, cli.FONE2, cli.CELULAR, cli.FAX, cli.EMAIL, cli.CONTATO,
                cli.INCLUSAO, cli.ATUALIZADO,
                (
                    select sum(
                        coalesce(c.TR_VL_FIXO, 0) +
                        coalesce((
                            select sum(m.VALFRANQUIA)
                            from IXLCONTRATOSMED m
                            where m.SEQCONTRATO = c.SEQCONTRATO
                              and coalesce(m.TFMEDIDORATIVO, 'S') <> 'N'
                        ), 0)
                    )
                    from IXLCONTRATOSGRP g
                    join IXLCONTRATOS c on c.SEQCONTRATOGRP = g.SEQCONTRATOGRP
                    where g.CDCLIENTE = cli.CDCLIENTE
                      and c.STATUS = 'G'
                ) as TOTAL_MENSALIDADE
            from ICLIENTES cli
            where cli.CDCLIENTE > ?
            order by cli.CDCLIENTE
        """
        yield from self._rows(sql, (cursor,))

    def fetch_equipments(self, cursor: int) -> Iterator[dict[str, Any]]:
        sql = """
            select
                eq.CDEQUIPAMENTO, eq.CDCLIENTE, eq.CDPRODUTO, eq.SERIE, eq.MODELO, eq.FABRICANTE,
                eq.SEQCONTRATO, eq.PATRIMONIO, eq.TFINATIVO,
                eq.ENDERECO, eq.NUM, eq.BAIRRO, eq.COMPLEMENTO, eq.LOCALINSTAL, eq.DEPARTAMENTO, eq.CONTATO, eq.FONE, eq.DDD, eq.CIDADE, eq.UF,
                eq.INCLUSAO, eq.ATUALIZADO,
                p.NMPRODUTO as PRODUCT_NAME
            from IXLEQUIPAMENTO eq
            left join IPRODUTO p on p.CDPRODUTO = eq.CDPRODUTO
            where eq.CDEQUIPAMENTO > ?
            order by eq.CDEQUIPAMENTO
        """
        yield from self._rows(sql, (cursor,))

    def fetch_recently_updated_equipments(self, limit: int = 1000) -> Iterator[dict[str, Any]]:
        """Reenvia equipamentos editados no iLux (ex.: endereco de instalacao
        trocado), independente de quando foram cadastrados. O cursor normal de
        `fetch_equipments` so avanca (CDEQUIPAMENTO > cursor) e nunca revisita
        um equipamento ja sincronizado, entao uma edicao feita anos depois do
        cadastro original nunca seria enviada de novo sem isso."""
        sql = f"""
            select first {max(1, int(limit))}
                eq.CDEQUIPAMENTO, eq.CDCLIENTE, eq.CDPRODUTO, eq.SERIE, eq.MODELO, eq.FABRICANTE,
                eq.SEQCONTRATO, eq.PATRIMONIO, eq.TFINATIVO,
                eq.ENDERECO, eq.NUM, eq.BAIRRO, eq.COMPLEMENTO, eq.LOCALINSTAL, eq.DEPARTAMENTO, eq.CONTATO, eq.FONE, eq.DDD, eq.CIDADE, eq.UF,
                eq.INCLUSAO, eq.ATUALIZADO,
                p.NMPRODUTO as PRODUCT_NAME
            from IXLEQUIPAMENTO eq
            left join IPRODUTO p on p.CDPRODUTO = eq.CDPRODUTO
            where eq.ATUALIZADO is not null
            order by eq.ATUALIZADO desc
        """
        yield from self._rows(sql, ())

    def fetch_contracts(self, cursor: int) -> Iterator[dict[str, Any]]:
        sql = """
            select
                ct.SEQCONTRATO, ct.NRCONTRATO, ct.CDCLIENTE, ct.STATUS,
                ct.DTCONTRATOINI, ct.DTCONTRATOFIN, ct.TIPOCONTRATO,
                ct.CDCONTRATOTP, tp.NMCONTRATOTP,
                ct.VALOR_TOTAL_CONTRATO, ct.TR_VL_FIXO,
                coalesce(med.VALOR_FRANQUIA, 0) as VALOR_FRANQUIA,
                coalesce(med.QT_FRANQUIA, 0) as QT_FRANQUIA,
                coalesce(med.MIN_EXCEDENTE, 0) as MIN_EXCEDENTE,
                coalesce(med.MAX_EXCEDENTE, 0) as MAX_EXCEDENTE,
                med.BILLING_MODE,
                coalesce(it.QT_EQUIPAMENTOS, 0) as QT_EQUIPAMENTOS,
                ct.TFATENDIMENTO, ct.TF_BLOQUEIA_OS, ct.INCLUSAO, ct.ATUALIZADO
            from IXLCONTRATOS ct
            left join ICLIENTESPRODCONT tp on tp.CDCONTRATOTP = ct.CDCONTRATOTP
            left join (
                -- IXLCONTRATOSIT guarda o historico completo de instalacao: uma linha
                -- por equipamento que ja passou pelo contrato. Quando o equipamento
                -- ainda esta instalado, DTINSTALACAOFIN vem igual a data de fim do
                -- proprio contrato (nao null); quando foi removido de verdade, vem
                -- com uma data real no passado. Sem esse filtro, "equipamentos
                -- vinculados" conta tambem equipamentos ja devolvidos/trocados.
                select SEQCONTRATO, count(distinct CDEQUIPAMENTO) as QT_EQUIPAMENTOS
                from IXLCONTRATOSIT
                where DTINSTALACAOFIN is null or DTINSTALACAOFIN >= CURRENT_DATE
                group by SEQCONTRATO
            ) it on it.SEQCONTRATO = ct.SEQCONTRATO
            left join (
                select
                    SEQCONTRATO,
                    sum(coalesce(VALFRANQUIA, 0)) as VALOR_FRANQUIA,
                    sum(coalesce(QTFRANQUIA, 0)) as QT_FRANQUIA,
                    min(coalesce(VALEXCEDENTE, 0)) as MIN_EXCEDENTE,
                    max(coalesce(VALEXCEDENTE, 0)) as MAX_EXCEDENTE,
                    case
                        when sum(case when TFFATURAFIXO = 'S' then 1 else 0 end) = count(*) then 'fixo'
                        when sum(case when TFFATURAFIXO = 'S' then 1 else 0 end) = 0 then 'contador'
                        else 'misto'
                    end as BILLING_MODE
                from IXLCONTRATOSMED
                where coalesce(TFMEDIDORATIVO, 'S') <> 'N'
                group by SEQCONTRATO
            ) med on med.SEQCONTRATO = ct.SEQCONTRATO
            where ct.SEQCONTRATO > ?
            order by ct.SEQCONTRATO
        """
        yield from self._rows(sql, (cursor,))

    def get_receivables_watermark(self) -> int:
        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute("select coalesce(max(SEQRECEITA), 0) from IRECEITAS")
            return int(cur.fetchone()[0] or 0)
        finally:
            con.close()

    def fetch_receivables(self, cursor: int, limit: int | None = None) -> Iterator[dict[str, Any]]:
        first = f"first {max(1, int(limit))}" if limit is not None else ""
        sql = f"""
            select {first}
                r.SEQRECEITA, r.CDCLIENTE, r.DTEMISSAOREC, r.DTVECTOREC,
                r.DTPAGTOREC, r.VALRECEITA, r.VALRECEITAPAGA, r.NUMNF,
                r.CDFORMAPAGTO, fp.NMFORMAPAGTO, r.CD_RECEITA_STATUS,
                rs.DS_RECEITA_STATUS, r.SEQCONTRATO, r.SEQIXLCONTRATOS,
                r.SEQIXLCONTRATOSGRP, r.SEQDEMONSTRATIVO, r.SEQINCNFS,
                r.NOSSONUMERO, r.LINHA_DIGITAVEL,
                b.ID_BOLETO, b.CHAVE_INTEGRACAO, b.SITUACAO as BOLETO_SITUACAO,
                b.URLBOLETO, b.TITULONOSSONUMERO, b.TITULONOSSONUMEROIMPRESSAO,
                b.TITULOLINHADIGITAVEL, b.TITULOCODIGOBARRAS, b.PDF_PROTOCOLO,
                nf.NRNFSAIDA, nf.NRNFSAIDASERV, nf.DTEMISSAONFS,
                nf.VALTOTALNFS, nf.TFNFSCANCELADA, nf.OBS as NF_OBS,
                demo.CDPRODUTO as FATURAMENTO_TIPO, demo.PERIODO as FATURAMENTO_PERIODO
            from IRECEITAS r
            left join IFORMAPAGTO fp on fp.CDFORMAPAGTO = r.CDFORMAPAGTO
            left join IRECEITAS_STATUS rs on rs.ID_RECEITA_STATUS = r.CD_RECEITA_STATUS
            left join CE_BOLETO b on b.SEQRECEITA = r.SEQRECEITA
            left join INFSAIDA nf on nf.SEQINCNFS = r.SEQINCNFS
            left join IXLDEMOFAT demo on demo.SEQDEMONSTRATIVO = r.SEQDEMONSTRATIVO
            where r.SEQRECEITA > ?
            order by r.SEQRECEITA
        """
        yield from self._rows(sql, (cursor,))

    def fetch_recent_receivables(self, limit: int = 1000) -> Iterator[dict[str, Any]]:
        sql = f"""
            select first {max(1, int(limit))}
                r.SEQRECEITA, r.CDCLIENTE, r.DTEMISSAOREC, r.DTVECTOREC,
                r.DTPAGTOREC, r.VALRECEITA, r.VALRECEITAPAGA, r.NUMNF,
                r.CDFORMAPAGTO, fp.NMFORMAPAGTO, r.CD_RECEITA_STATUS,
                rs.DS_RECEITA_STATUS, r.SEQCONTRATO, r.SEQIXLCONTRATOS,
                r.SEQIXLCONTRATOSGRP, r.SEQDEMONSTRATIVO, r.SEQINCNFS,
                r.NOSSONUMERO, r.LINHA_DIGITAVEL,
                b.ID_BOLETO, b.CHAVE_INTEGRACAO, b.SITUACAO as BOLETO_SITUACAO,
                b.URLBOLETO, b.TITULONOSSONUMERO, b.TITULONOSSONUMEROIMPRESSAO,
                b.TITULOLINHADIGITAVEL, b.TITULOCODIGOBARRAS, b.PDF_PROTOCOLO,
                nf.NRNFSAIDA, nf.NRNFSAIDASERV, nf.DTEMISSAONFS,
                nf.VALTOTALNFS, nf.TFNFSCANCELADA, nf.OBS as NF_OBS,
                demo.CDPRODUTO as FATURAMENTO_TIPO, demo.PERIODO as FATURAMENTO_PERIODO
            from IRECEITAS r
            left join IFORMAPAGTO fp on fp.CDFORMAPAGTO = r.CDFORMAPAGTO
            left join IRECEITAS_STATUS rs on rs.ID_RECEITA_STATUS = r.CD_RECEITA_STATUS
            left join CE_BOLETO b on b.SEQRECEITA = r.SEQRECEITA
            left join INFSAIDA nf on nf.SEQINCNFS = r.SEQINCNFS
            left join IXLDEMOFAT demo on demo.SEQDEMONSTRATIVO = r.SEQDEMONSTRATIVO
            order by r.SEQRECEITA desc
        """
        yield from self._rows(sql, ())

    def fetch_open_receivables(self, limit: int = 5000) -> Iterator[dict[str, Any]]:
        sql = f"""
            select first {max(1, int(limit))}
                r.SEQRECEITA, r.CDCLIENTE, r.DTEMISSAOREC, r.DTVECTOREC,
                r.DTPAGTOREC, r.VALRECEITA, r.VALRECEITAPAGA, r.NUMNF,
                r.CDFORMAPAGTO, fp.NMFORMAPAGTO, r.CD_RECEITA_STATUS,
                rs.DS_RECEITA_STATUS, r.SEQCONTRATO, r.SEQIXLCONTRATOS,
                r.SEQIXLCONTRATOSGRP, r.SEQDEMONSTRATIVO, r.SEQINCNFS,
                r.NOSSONUMERO, r.LINHA_DIGITAVEL,
                b.ID_BOLETO, b.CHAVE_INTEGRACAO, b.SITUACAO as BOLETO_SITUACAO,
                b.URLBOLETO, b.TITULONOSSONUMERO, b.TITULONOSSONUMEROIMPRESSAO,
                b.TITULOLINHADIGITAVEL, b.TITULOCODIGOBARRAS, b.PDF_PROTOCOLO,
                nf.NRNFSAIDA, nf.NRNFSAIDASERV, nf.DTEMISSAONFS,
                nf.VALTOTALNFS, nf.TFNFSCANCELADA, nf.OBS as NF_OBS,
                demo.CDPRODUTO as FATURAMENTO_TIPO, demo.PERIODO as FATURAMENTO_PERIODO
            from IRECEITAS r
            left join IFORMAPAGTO fp on fp.CDFORMAPAGTO = r.CDFORMAPAGTO
            left join IRECEITAS_STATUS rs on rs.ID_RECEITA_STATUS = r.CD_RECEITA_STATUS
            left join CE_BOLETO b on b.SEQRECEITA = r.SEQRECEITA
            left join INFSAIDA nf on nf.SEQINCNFS = r.SEQINCNFS
            left join IXLDEMOFAT demo on demo.SEQDEMONSTRATIVO = r.SEQDEMONSTRATIVO
            where r.DTPAGTOREC is null
              and coalesce(r.VALRECEITAPAGA, 0) < coalesce(r.VALRECEITA, 0)
            order by r.DTVECTOREC, r.SEQRECEITA
        """
        yield from self._rows(sql, ())

    def fetch_open_receivables_for_billing(self, limit: int = 5000) -> Iterator[dict[str, Any]]:
        """Open (unpaid) receivables with the customer's CNPJ/CPF attached.

        Used by the automatic WhatsApp sending to match newly indexed PDFs
        against real titles -- same eligibility rule as fetch_open_receivables,
        with the extra fields FinancialDocumentIndex.find() needs (customer
        document, invoice number, dates, value) so no per-title round trip is
        required while scanning.
        """
        sql = f"""
            select first {max(1, int(limit))}
                r.SEQRECEITA, r.SEQINCNFS, r.SEQDEMONSTRATIVO,
                coalesce(nf.NRNFSAIDA, r.NUMNF) as INVOICE_NUMBER,
                r.DTEMISSAOREC, r.DTVECTOREC, r.VALRECEITA,
                nf.DTEMISSAONFS,
                cli.CDCLIENTE, cli.NMCLIENTE as CUSTOMER_NAME,
                cli.CNPJ as CUSTOMER_CNPJ, cli.CPF as CUSTOMER_CPF
            from IRECEITAS r
            join ICLIENTES cli on cli.CDCLIENTE = r.CDCLIENTE
            left join INFSAIDA nf on nf.SEQINCNFS = r.SEQINCNFS
            where r.DTPAGTOREC is null
              and coalesce(r.VALRECEITAPAGA, 0) < coalesce(r.VALRECEITA, 0)
            order by r.DTVECTOREC, r.SEQRECEITA
        """
        yield from self._rows(sql, ())

    def fetch_billing_pdf(self, payload: dict[str, Any]) -> dict[str, Any]:
        receivable_id = int(payload.get("receivableExternalId") or 0)
        if receivable_id <= 0:
            raise ValueError("Identificador do titulo nao informado.")

        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute(
                """
                select first 1
                    r.NUMNF, cli.NMCLIENTE,
                    b.CHAVE_INTEGRACAO, b.PDF_PROTOCOLO, b.SITUACAO,
                    ced.CEDENTECPFCNPJ, ced.TOKEN_CEDENTE,
                    cfg.URL_BASE, cfg.PATH_BOLETO_IMPRESSAO
                from IRECEITAS r
                join CE_BOLETO b on b.SEQRECEITA = r.SEQRECEITA
                join CE_CONVENIO conv on conv.ID_CONVENIO = b.CD_CONVENIO
                join CE_CONTA conta on conta.ID_CONTA = conv.CD_CONTA
                join CE_CEDENTE ced on ced.ID_CEDENTE = conta.CD_CEDENTE
                join CE_PARAM_CONFIG cfg
                  on cfg.CD_EMPRESA = r.CDEMPRESA
                 and cfg.TP_AMBIENTE = conv.TP_AMBIENTE
                left join ICLIENTES cli on cli.CDCLIENTE = r.CDCLIENTE
                where r.SEQRECEITA = ?
                """,
                (receivable_id,),
            )
            row = cur.fetchone()
        finally:
            con.close()

        if not row:
            raise ValueError("Boleto vinculado ao titulo nao encontrado no iLux.")

        (
            invoice_number,
            customer_name,
            integration_id,
            pdf_protocol,
            boleto_status,
            cedente_cnpj,
            cedente_token,
            base_url,
            print_path,
        ) = row
        if str(boleto_status or "").strip().upper() not in {"EMITIDO", "REGISTRADO", "LIQUIDADO"}:
            raise ValueError(f"Boleto ainda nao pode ser impresso. Situacao: {boleto_status or 'nao informada'}.")
        if not cedente_cnpj or not cedente_token:
            raise ValueError("Credenciais do cedente nao encontradas no iLux.")

        headers = {
            "Content-Type": "application/json",
            "cnpj-cedente": str(cedente_cnpj).strip(),
            "token-cedente": str(cedente_token).strip(),
        }
        endpoint = f"{str(base_url).rstrip('/')}{str(print_path).rstrip('/')}"

        if not pdf_protocol:
            if not integration_id:
                raise ValueError("Boleto sem chave de integracao para gerar o PDF.")
            requested = requests.post(
                endpoint,
                headers=headers,
                json={"TipoImpressao": "0", "Boletos": [str(integration_id).strip()]},
                timeout=30,
            )
            requested.raise_for_status()
            requested_data = requested.json()
            pdf_protocol = (requested_data.get("_dados") or {}).get("protocolo")
            if not pdf_protocol:
                raise ValueError(requested_data.get("_mensagem") or "A geracao do PDF nao retornou protocolo.")

        pdf_response = None
        for attempt in range(1, 6):
            pdf_response = requests.get(
                f"{endpoint}/{str(pdf_protocol).strip()}",
                headers=headers,
                timeout=30,
            )
            pdf_response.raise_for_status()
            if pdf_response.content.startswith(b"%PDF"):
                break
            try:
                response_data = pdf_response.json()
            except ValueError as exc:
                raise ValueError("O servico bancario nao devolveu um PDF valido.") from exc
            situation = str((response_data.get("_dados") or {}).get("situacao") or "").upper()
            if situation != "PROCESSANDO" or attempt == 5:
                raise ValueError(response_data.get("_mensagem") or "Nao foi possivel recuperar o PDF do boleto.")
            time.sleep(5)

        if pdf_response is None or not pdf_response.content.startswith(b"%PDF"):
            raise ValueError("O PDF do boleto nao ficou pronto no tempo esperado.")

        safe_customer = re.sub(r"[^A-Za-z0-9 ._-]+", " ", str(customer_name or "CLIENTE")).strip()[:70]
        safe_invoice = re.sub(r"[^A-Za-z0-9_-]+", "", str(invoice_number or receivable_id))
        return {
            "pdfBase64": base64.b64encode(pdf_response.content).decode("ascii"),
            "fileName": f"BOLETO NF {safe_invoice} - {safe_customer or 'CLIENTE'}.pdf",
            "mimeType": "application/pdf",
            "documentType": "boleto",
        }

    def fetch_billing_document(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Return the official PDF exported by iLux for one receivable.

        File names are deliberately ignored. The local index matches the PDF contents
        against the customer, document number, dates and amount stored in Firebird.
        """
        document_type = str(payload.get("documentType") or "").strip().lower()
        aliases = {
            "bill": "boleto",
            "invoice": "invoice",
            "nf": "invoice",
            "statement": "statement",
            "demonstrativo": "statement",
            "boleto": "boleto",
        }
        document_type = aliases.get(document_type, document_type)
        if document_type not in {"invoice", "statement", "boleto"}:
            raise ValueError("Tipo de documento invalido. Use invoice, statement ou boleto.")

        context = self._fetch_billing_document_context(payload)
        official = self._fetch_official_financial_document(document_type, context)
        if official:
            return official

        # The bank API remains a safe fallback for boletos that have not yet been
        # exported through Documentos em Lote. Invoice/statement must never silently
        # fall back to a synthetic layout.
        if document_type == "boleto":
            return self.fetch_billing_pdf(payload)
        if document_type == "invoice":
            if not context.get("seqincnfs"):
                raise ValueError("Nota fiscal nao vinculada a este titulo no iLux.")
            label = "Nota/Fatura"
        else:
            if not context.get("seqdemonstrativo"):
                raise ValueError("Demonstrativo nao vinculado a este titulo no iLux.")
            label = "Demonstrativo"
        raise ValueError(
            f"{label} oficial ainda nao localizado nas pastas monitoradas. "
            "Gere o documento em lote no iLux e execute uma nova indexacao no agente."
        )

    def _fetch_official_financial_document(
        self,
        document_type: str,
        context: dict[str, Any],
    ) -> dict[str, Any] | None:
        index = self.financial_document_index()
        if not self.config.financial_document_folders:
            return None
        if not index.entries:
            # This is an interactive, on-demand request (a click in the CRM), so it
            # must never block for the full duration of a large first scan -- that
            # can take many minutes on a folder with thousands of PDFs and would
            # hang this command (and every other queued command behind it) well
            # past any reasonable timeout. scan_if_idle() only scans if nothing
            # else is already scanning; otherwise it returns immediately.
            stats = index.scan_if_idle()
            if stats is not None:
                logging.info("Indice financeiro criado: %s documento(s).", stats["total"])
            if not index.entries:
                raise ValueError(
                    "O indice de documentos financeiros ainda esta sendo construido pelo agente "
                    "(primeira leitura da pasta pode levar alguns minutos). Tente novamente em instantes."
                )
        match = index.find(document_type, context)
        if match is None:
            # Best-effort top-up so a file exported after the last sync is picked
            # up right away -- but again, never block behind a scan already
            # running elsewhere.
            stats = index.scan_if_idle()
            if stats is not None:
                logging.info(
                    "Indice financeiro atualizado sob demanda: %s novo(s), %s alterado(s).",
                    stats["added"],
                    stats["updated"],
                )
                match = index.find(document_type, context)
        if match is None:
            return None

        pdf = match.path.read_bytes()
        if not pdf.startswith(b"%PDF"):
            raise ValueError("O arquivo oficial localizado nao e um PDF valido.")
        if len(pdf) > 20 * 1024 * 1024:
            raise ValueError("O documento oficial excede o limite de 20 MB.")
        logging.info(
            "Documento oficial localizado (%s, score %s): %s",
            document_type,
            match.score,
            match.path,
        )
        return {
            "pdfBase64": base64.b64encode(pdf).decode("ascii"),
            "fileName": friendly_filename(document_type, context),
            "mimeType": "application/pdf",
            "documentType": document_type,
            "source": "ilux-export-folder",
            "sha256": match.sha256,
        }

    def _fetch_billing_document_context(self, payload: dict[str, Any]) -> dict[str, Any]:
        receivable_id = int(payload.get("receivableExternalId") or 0)
        if receivable_id <= 0:
            raise ValueError("Identificador do titulo nao informado.")

        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute(
                """
                select first 1
                    r.SEQRECEITA, r.SEQINCNFS, r.SEQDEMONSTRATIVO,
                    coalesce(nf.NRNFSAIDA, r.NUMNF) as INVOICE_NUMBER,
                    r.DTEMISSAOREC, r.DTVECTOREC, r.VALRECEITA,
                    fp.NMFORMAPAGTO, r.NOSSONUMERO, r.LINHA_DIGITAVEL,
                    cli.CDCLIENTE, cli.NMCLIENTE as CUSTOMER_NAME,
                    cli.CNPJ as CUSTOMER_CNPJ, cli.CPF as CUSTOMER_CPF,
                    cli.INSCEST as CUSTOMER_INSCEST, cli.ENDERECO as CUSTOMER_ADDRESS,
                    cli.NUM as CUSTOMER_NUMBER, cli.COMPLEMENTO as CUSTOMER_COMPLEMENT,
                    cli.BAIRRO as CUSTOMER_DISTRICT, cli.CIDADE as CUSTOMER_CITY,
                    cli.UF as CUSTOMER_STATE, cli.CEP as CUSTOMER_ZIP,
                    cli.EMAILNF as CUSTOMER_EMAIL,
                    nf.DTEMISSAONFS, nf.VALTOTALNFS, nf.VALTOTPRODUTO,
                    nf.VALTOTSERVICO, nf.VALDESCNFS, nf.OBS as INVOICE_NOTES,
                    nf.MODELO as INVOICE_MODEL, nf.SERIENF as INVOICE_SERIES,
                    nf.CHAVEACESSO_NFEL, nf.CHAVEACESSO_NFSE,
                    demo.PERIODO as STATEMENT_PERIOD, demo.DTDEMONSTRATIVO,
                    demo.DTCOBRANCA, demo.VALDEMONSTRATIVO,
                    demo.VALDEMONSTRATIVOF, demo.VALDEMONSTRATIVOE,
                    demo.VALDESCONTO as STATEMENT_DISCOUNT,
                    demo.VALACRESCIMO as STATEMENT_SURCHARGE,
                    demo.OBSERVACAO as STATEMENT_NOTES,
                    emp.NMEMPRESA as COMPANY_NAME, emp.FANTASIA as COMPANY_TRADE_NAME,
                    emp.CNPJ as COMPANY_CNPJ, emp.INSCEST as COMPANY_INSCEST,
                    emp.ENDERECO as COMPANY_ADDRESS, emp.NUM as COMPANY_NUMBER,
                    emp.COMPLEMENTO as COMPANY_COMPLEMENT, emp.BAIRRO as COMPANY_DISTRICT,
                    emp.CIDADE as COMPANY_CITY, emp.UF as COMPANY_STATE,
                    emp.CEP as COMPANY_ZIP, emp.DDD as COMPANY_DDD, emp.FONE1 as COMPANY_PHONE
                from IRECEITAS r
                join ICLIENTES cli on cli.CDCLIENTE = r.CDCLIENTE
                left join INFSAIDA nf on nf.SEQINCNFS = r.SEQINCNFS
                left join IXLDEMOFAT demo on demo.SEQDEMONSTRATIVO = r.SEQDEMONSTRATIVO
                left join IEMPRESA emp on emp.CDEMPRESA = r.CDEMPRESA
                left join IFORMAPAGTO fp on fp.CDFORMAPAGTO = r.CDFORMAPAGTO
                where r.SEQRECEITA = ?
                """,
                (receivable_id,),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("Titulo financeiro nao encontrado no iLux.")
            columns = [desc[0].lower() for desc in cur.description]
            return dict(zip(columns, row))
        finally:
            con.close()

    def _fetch_invoice_items(self, seqincnfs: int) -> list[dict[str, Any]]:
        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute(
                """
                select
                    it.CDPRODUTO, coalesce(it.NMPRODUTOCLI, p.NMPRODUTO) as PRODUCT_NAME,
                    it.QUANTIDADE, it.PRECOUNITARIO, it.VALDESCRAT,
                    it.VALIPI, it.VALICMS, it.VALISS
                from INFSAIDAIT it
                left join IPRODUTO p on p.CDPRODUTO = it.CDPRODUTO
                where it.SEQINCNFS = ?
                order by it.CDPRODUTO
                """,
                (seqincnfs,),
            )
            columns = [desc[0].lower() for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        finally:
            con.close()

    def _fetch_statement_items(self, seqdemonstrativo: int) -> list[dict[str, Any]]:
        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute(
                """
                select
                    fat.SEQCONTRATO, fat.CDEQUIPAMENTO, fat.CDMEDIDOR,
                    fat.MEDIDORINI, fat.MEDIDORFIN, fat.MEDIDORDESC,
                    fat.DTPERIODOFATINI, fat.DTPERIODOFATFIN,
                    fat.QTPRODUCAO, fat.QTFRANQUIA, fat.QTEXCEDENTE,
                    fat.VALFRANQUIA, fat.VALEXCEDENTE, fat.VALFATURA,
                    fat.VALFRANQUIACOB, fat.VALEXCEDENTECOB,
                    coalesce(fat.DEPARTAMENTO, eq.DEPARTAMENTO) as DEPARTMENT,
                    coalesce(fat.LOCALINSTAL, eq.LOCALINSTAL) as INSTALLATION_LOCATION,
                    eq.SERIE, eq.MODELO, p.NMPRODUTO as EQUIPMENT_NAME
                from IXLCONTRATOSFAT fat
                left join IXLEQUIPAMENTO eq on eq.CDEQUIPAMENTO = fat.CDEQUIPAMENTO
                left join IPRODUTO p on p.CDPRODUTO = eq.CDPRODUTO
                where fat.SEQDEMONSTRATIVO = ?
                order by fat.SEQCONTRATO, fat.CDEQUIPAMENTO, fat.CDMEDIDOR
                """,
                (seqdemonstrativo,),
            )
            columns = [desc[0].lower() for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        finally:
            con.close()

    @staticmethod
    def _pdf_styles() -> tuple[dict[str, ParagraphStyle], TableStyle]:
        sample = getSampleStyleSheet()
        styles = {
            "title": ParagraphStyle(
                "FinanceTitle", parent=sample["Title"], fontName="Helvetica-Bold",
                fontSize=16, leading=19, alignment=TA_CENTER, textColor=colors.HexColor("#111827")
            ),
            "heading": ParagraphStyle(
                "FinanceHeading", parent=sample["Heading2"], fontName="Helvetica-Bold",
                fontSize=9, leading=11, textColor=colors.white, backColor=colors.HexColor("#C81E1E"),
                borderPadding=4, spaceBefore=6, spaceAfter=4,
            ),
            "body": ParagraphStyle(
                "FinanceBody", parent=sample["BodyText"], fontName="Helvetica",
                fontSize=8, leading=10, textColor=colors.HexColor("#111827")
            ),
            "small": ParagraphStyle(
                "FinanceSmall", parent=sample["BodyText"], fontName="Helvetica",
                fontSize=7, leading=8, textColor=colors.HexColor("#374151")
            ),
            "right": ParagraphStyle(
                "FinanceRight", parent=sample["BodyText"], fontName="Helvetica-Bold",
                fontSize=8, leading=10, alignment=TA_RIGHT
            ),
        }
        table_style = TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#6B7280")),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ])
        return styles, table_style

    @staticmethod
    def _paragraph(value: Any, style: ParagraphStyle) -> Paragraph:
        text = escape(str(value or "Nao informado").strip()).replace("\n", "<br/>")
        return Paragraph(text, style)

    def _render_invoice_pdf(self, data: dict[str, Any], items: list[dict[str, Any]]) -> bytes:
        styles, table_style = self._pdf_styles()
        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=A4, rightMargin=14 * mm, leftMargin=14 * mm,
            topMargin=12 * mm, bottomMargin=12 * mm,
            title=f"NF {data.get('invoice_number') or ''}",
        )
        p = lambda value, style="body": self._paragraph(value, styles[style])
        story: list[Any] = [p("NOTA FISCAL / DOCUMENTO DE LOCACAO", "title"), Spacer(1, 3 * mm)]
        company_address = " ".join(filter(None, [str(data.get("company_address") or "").strip(), str(data.get("company_number") or "").strip()]))
        customer_address = " ".join(filter(None, [str(data.get("customer_address") or "").strip(), str(data.get("customer_number") or "").strip()]))
        story.append(Table([
            [p(f"{data.get('company_name') or data.get('company_trade_name') or 'EMPRESA'}\nCNPJ: {data.get('company_cnpj') or 'Nao informado'}\n{company_address} - {data.get('company_city') or ''}/{data.get('company_state') or ''}"),
             p(f"NF: {data.get('invoice_number') or ''}\nSerie: {data.get('invoice_series') or ''}\nEmissao: {format_date_br(data.get('dtemissaonfs') or data.get('dtemissaorec'))}\nVencimento: {format_date_br(data.get('dtvectorec'))}")]
        ], colWidths=[120 * mm, 55 * mm], style=TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.7, colors.black), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])))
        story.extend([p("DESTINATARIO", "heading"), Table([
            [p(f"{data.get('customer_name') or ''}\nCodigo iLux: {data.get('cdcliente') or ''}\nCNPJ/CPF: {data.get('customer_cnpj') or data.get('customer_cpf') or 'Nao informado'}"),
             p(f"{customer_address}\n{data.get('customer_district') or ''} - {data.get('customer_city') or ''}/{data.get('customer_state') or ''}\nCEP: {data.get('customer_zip') or 'Nao informado'}")]
        ], colWidths=[88 * mm, 87 * mm], style=TableStyle([("BOX", (0, 0), (-1, -1), .5, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("PADDING", (0, 0), (-1, -1), 5)])), p("ITENS", "heading")])
        rows = [["Codigo", "Descricao", "Qtd.", "Unitario", "Desconto", "Total"]]
        for item in items:
            quantity = Decimal(str(item.get("quantidade") or 0))
            unit = Decimal(str(item.get("precounitario") or 0))
            discount = Decimal(str(item.get("valdescrat") or 0))
            total = quantity * unit - discount
            rows.append([
                str(item.get("cdproduto") or ""), p(item.get("product_name") or "", "small"),
                f"{quantity:g}", format_money_br(unit), format_money_br(discount), format_money_br(total),
            ])
        if len(rows) == 1:
            rows.append(["-", "Sem itens detalhados", "-", "-", "-", format_money_br(data.get("valreceita"))])
        item_table = Table(rows, colWidths=[22*mm, 64*mm, 13*mm, 25*mm, 24*mm, 27*mm], repeatRows=1)
        item_table.setStyle(table_style)
        story.extend([item_table, Spacer(1, 3 * mm), Table([
            [p("Forma de pagamento"), p(data.get("nmformapagto") or "Nao informado"), p("VALOR TOTAL", "right"), p(format_money_br(data.get("valtotalnfs") or data.get("valreceita")), "right")]
        ], colWidths=[32*mm, 65*mm, 38*mm, 40*mm], style=TableStyle([("BOX", (0,0), (-1,-1), .5, colors.grey), ("PADDING", (0,0), (-1,-1), 5)]))])
        if data.get("invoice_notes"):
            story.extend([p("OBSERVACOES", "heading"), p(data.get("invoice_notes"), "small")])
        access_key = data.get("chaveacesso_nfel") or data.get("chaveacesso_nfse")
        if access_key:
            story.extend([Spacer(1, 2 * mm), p(f"Chave de acesso: {access_key}", "small")])
        doc.build(story)
        return buffer.getvalue()

    def _render_statement_pdf(self, data: dict[str, Any], items: list[dict[str, Any]]) -> bytes:
        styles, table_style = self._pdf_styles()
        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=A4, rightMargin=10 * mm, leftMargin=10 * mm,
            topMargin=10 * mm, bottomMargin=10 * mm,
            title=f"Demonstrativo {data.get('invoice_number') or ''}",
        )
        p = lambda value, style="body": self._paragraph(value, styles[style])
        story: list[Any] = [p("DEMONSTRATIVO DE FATURAMENTO", "title"), Spacer(1, 2 * mm)]
        story.append(Table([
            [p(f"{data.get('company_name') or data.get('company_trade_name') or 'EMPRESA'}\nCNPJ: {data.get('company_cnpj') or 'Nao informado'}"),
             p(f"{data.get('customer_name') or ''}\nCodigo iLux: {data.get('cdcliente') or ''}\nCNPJ/CPF: {data.get('customer_cnpj') or data.get('customer_cpf') or 'Nao informado'}"),
             p(f"NF: {data.get('invoice_number') or ''}\nPeriodo: {data.get('statement_period') or 'Nao informado'}\nVencimento: {format_date_br(data.get('dtvectorec'))}")]
        ], colWidths=[62*mm, 78*mm, 50*mm], style=TableStyle([("BOX", (0,0), (-1,-1), .6, colors.black), ("VALIGN", (0,0), (-1,-1), "TOP"), ("PADDING", (0,0), (-1,-1), 5)])))
        story.extend([p("EQUIPAMENTOS E MEDIDORES", "heading")])
        rows = [["Equipamento", "Serie / Local", "Medidor", "Periodo", "Inicial", "Final", "Producao", "Franquia", "Exced.", "Valor"]]
        for item in items:
            equipment = item.get("equipment_name") or item.get("modelo") or f"Equip. {item.get('cdequipamento') or ''}"
            location = first_non_empty(item.get("installation_location"), item.get("department"), "") or ""
            period = f"{format_date_br(item.get('dtperiodofatini'))} a {format_date_br(item.get('dtperiodofatfin'))}"
            # VALFRANQUIA/VALEXCEDENTE are contract prices. The *COB fields
            # contain what was effectively charged in this statement.
            fixed_charged = item.get("valfranquiacob")
            excess_charged = item.get("valexcedentecob")
            if fixed_charged is None and excess_charged is None:
                line_value = Decimal(str(item.get("valfatura") or 0))
            else:
                line_value = Decimal(str(fixed_charged or 0)) + Decimal(str(excess_charged or 0))
            rows.append([
                p(f"{equipment}\n#{item.get('cdequipamento') or ''}", "small"),
                p(f"{item.get('serie') or ''}\n{location}", "small"),
                str(item.get("cdmedidor") or ""), p(period, "small"),
                str(item.get("medidorini") or 0), str(item.get("medidorfin") or 0),
                str(item.get("qtproducao") or 0), str(item.get("qtfranquia") or 0),
                str(item.get("qtexcedente") or 0), format_money_br(line_value),
            ])
        if len(rows) == 1:
            rows.append(["-", "Sem equipamentos detalhados", "-", "-", "-", "-", "-", "-", "-", format_money_br(data.get("valdemonstrativo") or data.get("valreceita"))])
        table = Table(rows, colWidths=[31*mm, 28*mm, 14*mm, 30*mm, 15*mm, 15*mm, 16*mm, 15*mm, 14*mm, 22*mm], repeatRows=1)
        table.setStyle(table_style)
        story.extend([table, Spacer(1, 3*mm), Table([
            [p("Valor fixo", "right"), p(format_money_br(data.get("valdemonstrativof")), "right"),
             p("Excedentes", "right"), p(format_money_br(data.get("valdemonstrativoe")), "right"),
             p("TOTAL", "right"), p(format_money_br(data.get("valdemonstrativo") or data.get("valreceita")), "right")]
        ], colWidths=[28*mm, 32*mm, 28*mm, 32*mm, 28*mm, 42*mm], style=TableStyle([("BOX", (0,0), (-1,-1), .5, colors.grey), ("PADDING", (0,0), (-1,-1), 5)]))])
        if data.get("statement_notes"):
            story.extend([p("OBSERVACOES", "heading"), p(data.get("statement_notes"), "small")])
        doc.build(story)
        return buffer.getvalue()

    def fetch_equipment_meters(self, equipment_cursor: int) -> Iterator[dict[str, Any]]:
        sql = """
            select
                m.CDEQUIPAMENTO, e.CDCLIENTE, m.CDMEDIDOR, m.MEDIDOR,
                m.MEDIDORULT, m.DTLEITURA, m.DTLEITURAULT, m.ATUALIZADO
            from IXLEQUIPAMENTOMED m
            join IXLEQUIPAMENTO e on e.CDEQUIPAMENTO = m.CDEQUIPAMENTO
            where m.CDEQUIPAMENTO > ?
            order by m.CDEQUIPAMENTO, m.CDMEDIDOR
        """
        yield from self._rows(sql, (equipment_cursor,))

    def fetch_recent_equipment_meters(self, limit: int = 1000) -> Iterator[dict[str, Any]]:
        sql = f"""
            select first {max(1, int(limit))}
                m.CDEQUIPAMENTO, e.CDCLIENTE, m.CDMEDIDOR, m.MEDIDOR,
                m.MEDIDORULT, m.DTLEITURA, m.DTLEITURAULT, m.ATUALIZADO
            from IXLEQUIPAMENTOMED m
            join IXLEQUIPAMENTO e on e.CDEQUIPAMENTO = m.CDEQUIPAMENTO
            order by m.DTLEITURA desc, m.CDEQUIPAMENTO desc
        """
        yield from self._rows(sql, ())

    def _service_orders_select(self, where_clause: str, limit: int | None = None) -> str:
        first = f"first {max(1, int(limit))}" if limit is not None else ""
        return f"""
            select {first}
                os.CDCLIENTE, os.NMCLIENTE, os.CDEQUIPAMENTO, os.SEQOS,
                os.DTINCLUSAO, os.HRINCLUSAO, os.DTATENDIMENTO, os.HRATENDIMENTO, os.DTFECHAMENTO,
                tp.NMOSTP, st.NMSTATUS, os.STATUS, os.NMSUPORTEA, os.NMSUPORTET, os.NMSUPORTEL,
                os.USUARIO_FECHAMENTO, os.OBSDEFEITOCLI, os.OBSDEFEITOATS,
                os.DEPARTAMENTO, os.LOCALINSTAL, os.CIDADE, os.UF, os.ENDERECO, os.CEP,
                os.DDD, os.FONE, os.CELULAR, os.EMAIL,
                eq.CDPRODUTO as CDPRODUTOE, eq.SERIE, eq.MODELO as MODELOE, eq.FABRICANTE
            from IXLOS os
            left join IXLOSTP tp on tp.CDOSTP = os.CDOSTP
            left join IXLOSSTATUS st on st.CDSTATUS = os.CDSTATUS
            left join IXLEQUIPAMENTO eq on eq.CDEQUIPAMENTO = os.CDEQUIPAMENTO
            where {where_clause}
            order by os.SEQOS
        """

    def fetch_service_orders(
        self,
        cursor: int,
        limit: int | None = None,
    ) -> Iterator[dict[str, Any]]:
        sql = self._service_orders_select("os.SEQOS > ?", limit)
        yield from self._rows(sql, (cursor,))

    def get_service_order_watermarks(self) -> tuple[int, int]:
        """Return current high-water marks without reading O.S. rows."""
        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute("select coalesce(max(SEQOS), 0) from IXLOS")
            max_seq_os = int(cur.fetchone()[0] or 0)
            cur.execute(
                "select coalesce(max(ID_ATENDIMENTO), 0) from IXLOSATENDIMENTO"
            )
            max_attendance = int(cur.fetchone()[0] or 0)
            return max_seq_os, max_attendance
        finally:
            try:
                con.close()
            except Exception:
                pass

    def fetch_service_orders_changed_by_attendance(
        self,
        attendance_cursor: int,
        limit: int,
    ) -> tuple[list[dict[str, Any]], int]:
        """Read O.S. touched by new attendance rows using a global integer cursor."""
        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute(
                f"""
                select first {max(1, int(limit))} ID_ATENDIMENTO, SEQOS
                from IXLOSATENDIMENTO
                where ID_ATENDIMENTO > ?
                order by ID_ATENDIMENTO
                """,
                (attendance_cursor,),
            )
            events = cur.fetchall()
        finally:
            try:
                con.close()
            except Exception:
                pass

        if not events:
            return [], attendance_cursor

        max_attendance = max(int(row[0]) for row in events)
        seq_os_values = sorted({int(row[1]) for row in events if row[1] is not None})
        if not seq_os_values:
            return [], max_attendance

        placeholders = ", ".join("?" for _ in seq_os_values)
        sql = self._service_orders_select(
            f"os.SEQOS in ({placeholders})",
        )
        return list(self._rows(sql, tuple(seq_os_values))), max_attendance

    def fetch_os_types(self) -> Iterator[dict[str, Any]]:
        # O iLux associa cada tipo de O.S. a um formulario/modelo de
        # impressao na propria IXLOSTP. Mantemos esse vinculo no CRM para
        # que a selecao do atendimento permaneça identica à do desktop.
        sql = """
            select CDOSTP, NMOSTP, FORMULARIO, FORMULARIOOBS,
                   TIPO_OS, TPCHAMADO, LOGO_OS, TFINATIVO
              from IXLOSTP
             order by CDOSTP
        """
        yield from self._rows(sql, ())

    def fetch_technicians(self) -> Iterator[dict[str, Any]]:
        sql = "select NMSUPORTE, TFATIVO from IXLOSSUPORTE"
        yield from self._rows(sql, ())

    def fetch_service_order_print_data(self, seq_os: int) -> dict[str, Any]:
        """Read only the small Firebird snapshot required by the A4 form."""
        con = self.connect()
        try:
            cur = con.cursor()

            def fetch_all(sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
                cur.execute(sql, params)
                columns = [str(item[0]).strip().lower() for item in cur.description]
                return [
                    {column: json_safe(value) for column, value in zip(columns, row)}
                    for row in cur.fetchall()
                ]

            def pick(record: dict[str, Any], *fields: str) -> dict[str, Any]:
                return {field: record.get(field) for field in fields if field in record}

            current_rows = fetch_all(
                "select * from IXLOS where SEQOS = ?",
                (seq_os,),
            )
            if not current_rows:
                return {"history": [], "attendances": []}

            current = current_rows[0]
            client_rows = fetch_all(
                "select * from ICLIENTES where CDCLIENTE = ?",
                (current.get("cdcliente"),),
            ) if current.get("cdcliente") else []
            equipment_rows = fetch_all(
                "select * from IXLEQUIPAMENTO where CDEQUIPAMENTO = ?",
                (current.get("cdequipamento"),),
            ) if current.get("cdequipamento") else []
            equipment = equipment_rows[0] if equipment_rows else {}
            contract_id = current.get("seqcontrato") or equipment.get("seqcontrato")
            contract_rows = fetch_all(
                "select * from IXLCONTRATOS where SEQCONTRATO = ?",
                (contract_id,),
            ) if contract_id else []
            contract_group_id = contract_rows[0].get("seqcontratogrp") if contract_rows else None
            contract_group_rows = fetch_all(
                "select * from IXLCONTRATOSGRP where SEQCONTRATOGRP = ?",
                (contract_group_id,),
            ) if contract_group_id else []
            os_type_rows = fetch_all(
                "select * from IXLOSTP where CDOSTP = ?",
                (current.get("cdostp"),),
            ) if current.get("cdostp") else []
            company_rows = fetch_all(
                "select * from IEMPRESA where CDEMPRESA = ?",
                (current.get("cdempresa") or 1,),
            )
            history_rows = fetch_all(
                """
                select first 5
                       os.SEQOS, os.DTINCLUSAO, os.HRINCLUSAO,
                       os.CDEQUIPAMENTO, os.OBSDEFEITOCLI, os.OBSDEFEITOATS,
                       os.NMSUPORTEA, os.NMSUPORTET, os.NMSUPORTEL,
                       os.USUARIO_FECHAMENTO, os.STATUS, tp.NMOSTP
                  from IXLOS os
                  left join IXLOSTP tp on tp.CDOSTP = os.CDOSTP
                 where os.CDCLIENTE = ? and os.SEQOS <> ?
                 order by os.DTINCLUSAO desc, os.HRINCLUSAO desc, os.SEQOS desc
                """,
                (current.get("cdcliente"), seq_os),
            )
            attendance_rows = fetch_all(
                """
                select *
                  from IXLOSATENDIMENTO
                 where SEQOS = ?
                 order by DATAHORA, ID_ATENDIMENTO
                """,
                (seq_os,),
            )
            return {
                "serviceOrder": pick(
                    current,
                    "seqos", "cdcliente", "cdequipamento", "seqcontrato", "cdempresa", "cdostp",
                    "dtinclusao", "hrinclusao", "dtatendimento", "hratendimento", "hratendimento1",
                    "obsdefeitocli", "obsdefeitoats", "nmsuportea", "nmsuportet", "nmsuportel",
                    "usuario_fechamento", "status", "prioridade", "dtpreventrega", "hrpreventrega",
                    "tporcatend", "tpchamado", "tipo_os", "cdterritorio", "departamento", "localinstal",
                    "nmcliente", "endereco", "num", "complemento", "bairro", "cidade", "uf", "cep",
                    "ddd", "fone", "celular", "contato",
                ),
                "client": pick(
                    client_rows[0] if client_rows else {},
                    "cdcliente", "nmcliente", "endereco", "num", "complemento", "bairro", "cidade",
                    "uf", "cep", "cnpj", "cpf", "inscest", "inscmun", "ddd", "fone1", "celular", "contato",
                ),
                "equipment": pick(
                    equipment,
                    "cdequipamento", "modelo", "serie", "patrimonio", "cdcontratotp", "cdterritorio",
                    "departamento", "localinstal", "seqcontrato",
                ),
                "contract": pick(
                    contract_rows[0] if contract_rows else {},
                    "seqcontrato", "nrcontrato", "cdcontratotp", "seqcontratogrp",
                ),
                "contractGroup": pick(
                    contract_group_rows[0] if contract_group_rows else {},
                    "seqcontratogrp", "nmcontratogrp", "cdterritorio",
                ),
                "osType": pick(
                    os_type_rows[0] if os_type_rows else {},
                    "cdostp", "nmostp", "formulario", "formularioobs", "tipo_os",
                    "tpchamado", "logo_os", "tfinativo",
                ),
                "company": pick(
                    company_rows[0] if company_rows else {},
                    "cdempresa", "nmempresa", "fantasia", "nmfantasia", "nomefantasia", "cnpj", "inscest", "endereco", "num", "bairro", "cidade",
                    "uf", "cep", "ddd", "fone", "fone1",
                ),
                "history": history_rows,
                "attendances": attendance_rows,
                "capturedAt": datetime.now().isoformat(timespec="seconds"),
            }
        finally:
            try:
                con.close()
            except Exception:
                pass

    def create_service_order(self, data: dict[str, Any]) -> int:
        cd_cliente = int(data["cdCliente"]) if data.get("cdCliente") else None
        cd_equipamento = int(data["cdEquipamento"]) if data.get("cdEquipamento") else None
        cd_ostp = fit_text(data.get("cdOstp", "02"), 10)

        now = datetime.now()
        dt_inclusao = now.strftime("%Y-%m-%d")
        hr_inclusao = now.strftime("%H:%M")
        
        from datetime import timedelta
        data_prev_entrega = (now + timedelta(days=3)).strftime("%Y-%m-%d")

        status = "E"  # Aberto
        cd_status = "E1"  # Aberto

        defect = str(data.get("defect", "")).strip()
        nmsuportet = fit_text(data.get("nmsuportet", ""), 10)
        attendant_name = fit_text(data.get("attendantName", ""), 10)

        num = None
        if data.get("num"):
            try:
                num = int(data["num"])
            except ValueError:
                pass

        cd_cliente_ent = cd_cliente

        params = (
            cd_cliente,
            cd_cliente_ent,
            cd_equipamento,
            cd_ostp,
            dt_inclusao,
            hr_inclusao,
            status,
            cd_status,
            defect,
            nmsuportet if nmsuportet else attendant_name,
            attendant_name,

            fit_text(data.get("nmCliente", ""), 50),
            fit_text(data.get("endereco", ""), 50),
            num,
            fit_text(data.get("complemento", ""), 30),
            fit_text(data.get("bairro", ""), 30),
            fit_text(data.get("cidade", ""), 40),
            fit_text(data.get("uf", ""), 2),
            fit_text(digits(data.get("cep")), 8),
            fit_text(data.get("ddd", ""), 10),
            fit_text(data.get("fone", ""), 15),
            fit_text(data.get("celular", ""), 15),
            fit_text(data.get("email", ""), 50),
            fit_text(data.get("contato", ""), 20),

            fit_text(data.get("departamento", ""), 45),
            fit_text(data.get("localInstal", ""), 50),
            data_prev_entrega, hr_inclusao,
            fit_text(f"{now.strftime('%d/%m/%Y %H:%M:%S')} CA I", 25)
        )

        sql = """
                insert into IXLOS (
                    SEQOS, CDCLIENTE, CDCLIENTEENT, CDEQUIPAMENTO, CDOSTP, DTINCLUSAO, HRINCLUSAO, STATUS, CDSTATUS, OBSDEFEITOCLI, NMSUPORTET, NMSUPORTEA,
                    NMCLIENTE, ENDERECO, NUM, COMPLEMENTO, BAIRRO, CIDADE, UF, CEP, DDD, FONE, CELULAR, EMAIL, CONTATO,
                    DEPARTAMENTO, LOCALINSTAL, DTPREVENTREGA, HRPREVENTREGA, CDEMPRESA, TPORCATEND, TPCHAMADO, CDTERRITORIO, EQUIPCLI, STATUSEQUIP,
                    SEQOSORIGEM, TIPO_OS, TFLIBERADO, CDDEFEITO, PRIORIDADE, ATUALIZADO, FORMULARIOOS, SEQOSCLI, NMSUPORTEL, NR_CAU, NR_RP
                ) values (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, 1, 'A', '1', 'GERAL', 'E', '0',
                    -1, '1', 'S', 'MAN', '24', ?, '', '', '', '', ''
                )
            """

        # O Desktop numera IXLOS pelo maior SEQOS real. O contador
        # ORDEMSERVICO pode ficar atrasado e devolver uma chave ja ocupada.
        # Em caso de concorrencia, refazemos a leitura e tentamos novamente.
        for attempt in range(1, 4):
            con = self.connect()
            try:
                cur = con.cursor()
                cur.execute("SELECT COALESCE(MAX(SEQOS), 0) + 1 FROM IXLOS")
                row = cur.fetchone()
                if not row or row[0] is None:
                    raise RuntimeError("Nao foi possivel consultar o proximo SEQOS.")
                seq_os = int(row[0])
                logging.info("Inserindo com o proximo SEQOS livre: %s", seq_os)
                cur.execute(sql, (seq_os,) + params)
                con.commit()
                return seq_os
            except Exception as exc:
                con.rollback()
                if attempt < 3 and is_duplicate_key_error(exc):
                    logging.warning(
                        "SEQOS ocupado durante a gravacao; recalculando (tentativa %s/3).",
                        attempt + 1,
                    )
                    continue
                raise
            finally:
                try:
                    con.close()
                except Exception:
                    pass

        raise RuntimeError("Nao foi possivel reservar um SEQOS livre apos 3 tentativas.")


def normalize_contact(record: dict[str, Any]) -> dict[str, Any]:
    external_id = str(record["cdcliente"]).strip()
    phone = normalize_phone(
        compose_brazil_phone(record.get("ddd"), record.get("celular")),
        compose_brazil_phone(record.get("ddd"), record.get("fone1")),
        record.get("celular"),
        record.get("fone1"),
        record.get("fone2"),
    ) or f"FB-{external_id}"

    # Format full address: "Street, Number - Complement - Neighborhood"
    street = first_non_empty(record.get("endereco"))
    num = first_non_empty(record.get("num"))
    complement = first_non_empty(record.get("complemento"))
    bairro = first_non_empty(record.get("bairro"))

    addr_parts = []
    if street:
        if num:
            addr_parts.append(f"{street}, {num}")
        else:
            addr_parts.append(street)
    elif num:
        addr_parts.append(num)

    if complement:
        addr_parts.append(complement)
    if bairro:
        addr_parts.append(bairro)

    address_str = " - ".join(addr_parts) if addr_parts else None

    return {
        "externalId": external_id,
        "cdCliente": external_id,
        "name": first_non_empty(record.get("nmcliente"), record.get("fantasia")) or f"Cliente {external_id}",
        "fantasyName": first_non_empty(record.get("fantasia")),
        "phone": phone,
        "email": first_non_empty(record.get("email")),
        "cpfCnpj": first_non_empty(record.get("cpf"), record.get("cnpj")),
        "address": address_str,
        "neighborhood": bairro,
        "city": first_non_empty(record.get("cidade")),
        "state": first_non_empty(record.get("uf")),
        "zipCode": first_non_empty(record.get("cep")),
        "contact": first_non_empty(record.get("contato")),
        "updatedAt": parse_firebird_timestamp(record.get("atualizado")),
        "inclusionAt": parse_firebird_timestamp(record.get("inclusao")),
        "raw": {k: json_safe(v) for k, v in record.items()},
    }


def normalize_equipment(record: dict[str, Any]) -> dict[str, Any]:
    external_id = str(record["cdequipamento"]).strip()
    client_external_id = str(record["cdcliente"]).strip() if record.get("cdcliente") is not None else None

    # Format full address: "Street, Number - Complement - Neighborhood"
    street = first_non_empty(record.get("endereco"))
    num = first_non_empty(record.get("num"))
    complement = first_non_empty(record.get("complemento"))
    bairro = first_non_empty(record.get("bairro"))

    addr_parts = []
    if street:
        if num:
            addr_parts.append(f"{street}, {num}")
        else:
            addr_parts.append(street)
    elif num:
        addr_parts.append(num)

    if complement:
        addr_parts.append(complement)
    if bairro:
        addr_parts.append(bairro)

    address_str = " - ".join(addr_parts) if addr_parts else None

    return {
        "externalId": external_id,
        "clientExternalId": client_external_id,
        "clientName": None,
        "name": first_non_empty(record.get("modelo"), record.get("fabricante")) or f"Equipamento {external_id}",
        "model": first_non_empty(record.get("modelo")) or f"Equipamento {external_id}",
        "manufacturer": first_non_empty(record.get("fabricante")),
        "serialNumber": first_non_empty(record.get("serie")),
        "type": first_non_empty(record.get("product_name"), record.get("cdproduto")),
        "sector": first_non_empty(record.get("departamento"), record.get("localinstal")),
        "installLocation": first_non_empty(record.get("localinstal")),
        "address": address_str,
        "city": first_non_empty(record.get("cidade")),
        "state": first_non_empty(record.get("uf")),
        "contact": first_non_empty(record.get("contato")),
        "phone": compose_brazil_phone(record.get("ddd"), record.get("fone")) or normalize_phone(record.get("fone")),
        "contractExternalId": first_non_empty(record.get("seqcontrato")),
        "assetTag": first_non_empty(record.get("patrimonio")),
        "inactive": first_non_empty(record.get("tfinativo")),
        "updatedAt": parse_firebird_timestamp(record.get("atualizado")),
        "inclusionAt": parse_firebird_timestamp(record.get("inclusao")),
        "raw": {k: json_safe(v) for k, v in record.items()},
    }


def normalize_contract(record: dict[str, Any]) -> dict[str, Any]:
    external_id = str(record["seqcontrato"]).strip()
    total_value = float(record.get("valor_total_contrato") or 0)
    fixed_value = float(record.get("tr_vl_fixo") or 0)
    franchise_value = float(record.get("valor_franquia") or 0)
    monthly_value = fixed_value + franchise_value
    return {
        "externalId": external_id,
        "clientExternalId": str(record["cdcliente"]).strip() if record.get("cdcliente") is not None else None,
        "contractNumber": first_non_empty(record.get("nrcontrato")),
        "status": first_non_empty(record.get("status")),
        "contractType": first_non_empty(record.get("nmcontratotp"), record.get("tipocontrato"), record.get("cdcontratotp")),
        "contractTypeCode": first_non_empty(record.get("cdcontratotp"), record.get("tipocontrato")),
        "value": monthly_value if monthly_value > 0 else total_value,
        "monthlyValue": monthly_value,
        "fixedValue": fixed_value,
        "franchiseValue": franchise_value,
        "totalValue": total_value,
        "equipmentCount": int(record.get("qt_equipamentos") or 0),
        "pageFranchise": int(record.get("qt_franquia") or 0),
        "overageRateMin": float(record.get("min_excedente") or 0) / 1000,
        "overageRateMax": float(record.get("max_excedente") or 0) / 1000,
        "billingMode": first_non_empty(record.get("billing_mode")),
        "startsAt": parse_firebird_timestamp(record.get("dtcontratoini")),
        "endsAt": parse_firebird_timestamp(record.get("dtcontratofin")),
        "updatedAt": parse_firebird_timestamp(record.get("atualizado")),
        "inclusionAt": parse_firebird_timestamp(record.get("inclusao")),
        "raw": {k: json_safe(v) for k, v in record.items()},
    }


def normalize_receivable(record: dict[str, Any]) -> dict[str, Any]:
    external_id = str(record["seqreceita"]).strip()
    value = float(record.get("valreceita") or 0)
    paid_value = float(record.get("valreceitapaga") or 0)
    return {
        "externalId": external_id,
        "clientExternalId": str(record["cdcliente"]).strip() if record.get("cdcliente") is not None else None,
        "issuedAt": parse_firebird_timestamp(record.get("dtemissaorec")),
        "dueAt": parse_firebird_timestamp(record.get("dtvectorec")),
        "paidAt": parse_firebird_timestamp(record.get("dtpagtorec")),
        "value": value,
        "paidValue": paid_value,
        "openValue": max(0, value - paid_value),
        "invoiceNumber": first_non_empty(record.get("numnf")),
        "paymentMethodCode": first_non_empty(record.get("cdformapagto")),
        "paymentMethod": first_non_empty(record.get("nmformapagto")),
        "statusCode": first_non_empty(record.get("cd_receita_status")),
        "statusLabel": first_non_empty(record.get("ds_receita_status")),
        "contractExternalId": first_non_empty(record.get("seqixlcontratos"), record.get("seqcontrato")),
        "contractGroupExternalId": first_non_empty(record.get("seqixlcontratosgrp")),
        "statementExternalId": first_non_empty(record.get("seqdemonstrativo")),
        "invoiceExternalId": first_non_empty(record.get("seqincnfs")),
        "invoiceIssuedAt": parse_firebird_timestamp(record.get("dtemissaonfs")),
        "invoiceValue": float(record.get("valtotalnfs") or 0),
        "invoiceCancelled": str(record.get("tfnfscancelada") or "N").strip().upper() == "S",
        "invoiceNotes": first_non_empty(record.get("nf_obs")),
        "billingType": first_non_empty(record.get("faturamento_tipo")),
        "billingPeriod": first_non_empty(record.get("faturamento_periodo")),
        "boletoId": first_non_empty(record.get("id_boleto")),
        "boletoIntegrationId": first_non_empty(record.get("chave_integracao")),
        "boletoStatus": first_non_empty(record.get("boleto_situacao")),
        "boletoUrl": first_non_empty(record.get("urlboleto")),
        "boletoPdfProtocol": first_non_empty(record.get("pdf_protocolo")),
        "ourNumber": first_non_empty(
            record.get("titulonossonumeroimpressao"),
            record.get("titulonossonumero"),
            record.get("nossonumero"),
        ),
        "digitableLine": first_non_empty(record.get("titulolinhadigitavel"), record.get("linha_digitavel")),
        "barcode": first_non_empty(record.get("titulocodigobarras")),
        "raw": {k: json_safe(v) for k, v in record.items()},
    }


def normalize_equipment_meter(record: dict[str, Any]) -> dict[str, Any]:
    equipment_id = str(record["cdequipamento"]).strip()
    meter_code = str(record["cdmedidor"]).strip()
    return {
        "externalId": f"{equipment_id}:{meter_code}",
        "equipmentExternalId": equipment_id,
        "clientExternalId": str(record["cdcliente"]).strip() if record.get("cdcliente") is not None else None,
        "meterCode": meter_code,
        "currentValue": float(record.get("medidor") or 0),
        "previousValue": float(record.get("medidorult") or 0),
        "currentReadingAt": parse_firebird_timestamp(record.get("dtleitura")),
        "previousReadingAt": parse_firebird_timestamp(record.get("dtleiturault")),
        "updatedAt": parse_firebird_timestamp(record.get("atualizado")) or parse_firebird_timestamp(record.get("dtleitura")),
        "raw": {k: json_safe(v) for k, v in record.items()},
    }


def normalize_service_order(record: dict[str, Any]) -> dict[str, Any]:
    external_id = str(record["seqos"]).strip()
    client_external_id = str(record["cdcliente"]).strip() if record.get("cdcliente") is not None else None
    equipment_external_id = str(record["cdequipamento"]).strip() if record.get("cdequipamento") is not None else None

    return {
        "externalId": external_id,
        "clientExternalId": client_external_id,
        "clientName": first_non_empty(record.get("nmcliente")),
        "equipmentExternalId": equipment_external_id,
        "equipmentModel": first_non_empty(record.get("modeloe")),
        "manufacturer": first_non_empty(record.get("fabricante")),
        "serialNumber": first_non_empty(record.get("serie")),
        "status": first_non_empty(record.get("nmstatus"), record.get("status")),
        "nmSuporteT": first_non_empty(record.get("nmsuportet")),
        "defect": first_non_empty(record.get("obsdefeitocli"), record.get("nmdefeito"), record.get("causa"), record.get("sintoma")),
        "action": first_non_empty(record.get("acao")),
        "observacao": first_non_empty(record.get("observacao"), record.get("obsdefeitoats"), record.get("nmostp")),
        "resolvedAt": parse_firebird_timestamp(record.get("dtfechamento")) or parse_firebird_timestamp(record.get("dtatendimento")),
        "updatedAt": parse_firebird_timestamp(record.get("dtfechamento")) or parse_firebird_timestamp(record.get("dtatendimento")) or parse_firebird_timestamp(record.get("dtinclusao")),
        "address": first_non_empty(record.get("endereco")),
        "city": first_non_empty(record.get("cidade")),
        "state": first_non_empty(record.get("uf")),
        "zipCode": first_non_empty(record.get("cep")),
        "sector": first_non_empty(record.get("departamento"), record.get("localinstal")),
        "phone": compose_brazil_phone(record.get("ddd"), record.get("fone")) or normalize_phone(record.get("fone"), record.get("celular")),
        "raw": {k: json_safe(v) for k, v in record.items()},
    }


def normalize_os_type(record: dict[str, Any]) -> dict[str, Any]:
    formulario = first_non_empty(record.get("formulario"))
    return {
        "code": str(record["cdostp"]).strip(),
        "name": str(record["nmostp"]).strip(),
        "formulario": formulario,
        "formularioObs": first_non_empty(record.get("formularioobs")),
        "tipoOs": first_non_empty(record.get("tipo_os")),
        "tipoChamado": first_non_empty(record.get("tpchamado")),
        "logoOs": first_non_empty(record.get("logo_os")),
        "inactive": str(record.get("tfinativo") or "").strip().upper() in {"S", "SIM", "1", "TRUE"},
        # Os modelos cadastrados no Firebird ficam no bundle de relatorios
        # do desktop; o nome exato do relatorio é mantido para o renderer.
        "reportBundle": "IPR_OS_M064.rel" if formulario else None,
    }


def normalize_technician(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": str(record["nmsuporte"]).strip(),
        "inactive": record.get("tfativo") == "N"
    }


def sync_static_entities(repo: FirebirdRepository, crm: CRMClient) -> None:
    try:
        logging.info("Sincronizando tipos de O.S...")
        os_types = [normalize_os_type(row) for row in repo.fetch_os_types()]
        if os_types:
            crm.push("osTypes", os_types)
            logging.info("Sincronizados %s tipos de O.S.", len(os_types))

        logging.info("Sincronizando técnicos...")
        techs = [normalize_technician(row) for row in repo.fetch_technicians()]
        if techs:
            crm.push("technicians", techs)
            logging.info("Sincronizados %s técnicos.", len(techs))
    except Exception as e:
        logging.error("Falha ao sincronizar entidades estáticas (tipos/técnicos): %s", e)


def sync_company_profile(repo: FirebirdRepository, crm: CRMClient, config: AppConfig) -> None:
    """Mantém o cadastro oficial da empresa disponível no CRM.

    É uma leitura pequena e idempotente, executada junto ao ciclo normal. O
    botão da tela Empresa usa o mesmo caminho, mas por comando imediato, para
    não depender do próximo ciclo de sincronização.
    """
    try:
        company = repo.fetch_company_info(config.firebird_company_id)
        crm.push("companyInfo", [company])
        logging.info(
            "Empresa iLux sincronizada: %s (código %s)",
            company.get("name") or "sem nome",
            company.get("companyCode") or "N/A",
        )
    except Exception as exc:
        # A empresa não deve impedir contatos, contratos ou O.S. de serem
        # sincronizados. O status geral/ping continuará identificando o agente.
        logging.warning("Não foi possível sincronizar IEMPRESA: %s", exc)


def sync_entity(
    repo: FirebirdRepository,
    crm: CRMClient,
    state: StateStore,
    entity: str,
    batch_size: int,
    stop_event: threading.Event | None = None,
) -> bool:
    cursor_key = entity
    cursor = state.get_cursor(cursor_key)
    rows: list[dict[str, Any]] = []
    total_sent = 0
    max_cursor = cursor

    if entity == "contacts":
        iterator = repo.fetch_contacts(cursor)
        normalizer = normalize_contact
        cursor_field = "cdcliente"
    elif entity == "equipments":
        iterator = repo.fetch_equipments(cursor)
        normalizer = normalize_equipment
        cursor_field = "cdequipamento"
    elif entity == "contracts":
        iterator = repo.fetch_contracts(cursor)
        normalizer = normalize_contract
        cursor_field = "seqcontrato"
    elif entity == "receivables":
        iterator = repo.fetch_receivables(cursor)
        normalizer = normalize_receivable
        cursor_field = "seqreceita"
    elif entity == "serviceOrders":
        iterator = repo.fetch_service_orders(cursor)
        normalizer = normalize_service_order
        cursor_field = "seqos"
    else:
        raise ValueError(f"Entity desconhecida: {entity}")

    for raw in iterator:
        if stop_event is not None and stop_event.is_set():
            logging.info("%s: sincronizacao interrompida pelo usuario", entity)
            return False
        rows.append(normalizer(raw))

        raw_id = raw.get(cursor_field)
        if raw_id is not None:
            max_cursor = max(max_cursor, int(raw_id))

        if len(rows) >= batch_size:
            crm.push(entity, rows)
            total_sent += len(rows)
            logging.debug("%s: enviado lote de %s registros", entity, len(rows))
            rows.clear()
            state.set_cursor(cursor_key, max_cursor)
            state.set_last_sync_at(datetime.now().isoformat(timespec="seconds"))
            state.save()

    if rows:
        crm.push(entity, rows)
        total_sent += len(rows)
        logging.debug("%s: enviado lote final de %s registros", entity, len(rows))
        rows.clear()
        state.set_cursor(cursor_key, max_cursor)
        state.set_last_sync_at(datetime.now().isoformat(timespec="seconds"))
        state.save()

    logging.info("%s: sincronização concluída, %s registros enviados", entity, total_sent)
    return True


def push_normalized_batches(
    crm: CRMClient,
    entity: str,
    records: Iterator[dict[str, Any]] | list[dict[str, Any]],
    normalizer,
    batch_size: int,
) -> tuple[int, int]:
    batch: list[dict[str, Any]] = []
    total = 0
    max_equipment = 0
    for raw in records:
        batch.append(normalizer(raw))
        if raw.get("cdequipamento") is not None:
            max_equipment = max(max_equipment, int(raw["cdequipamento"]))
        if len(batch) >= batch_size:
            crm.push(entity, batch)
            total += len(batch)
            batch.clear()
    if batch:
        crm.push(entity, batch)
        total += len(batch)
    return total, max_equipment


def sync_crm360_details(
    repo: FirebirdRepository,
    crm: CRMClient,
    state: StateStore,
    batch_size: int,
    force_meter_bootstrap: bool = False,
) -> None:
    receivable_cursor = state.get_cursor("receivables")
    if receivable_cursor <= 0:
        watermark = repo.get_receivables_watermark()
        # A primeira carga traz uma janela recente sem percorrer todo o
        # financeiro historico. Novos titulos seguem pelo cursor normal.
        state.set_cursor("receivables", max(0, watermark - 2000))
        state.save()
    sync_entity(repo, crm, state, "receivables", batch_size)

    meter_cursor = 0 if force_meter_bootstrap else state.get_cursor("equipmentMeters")
    meter_total, max_equipment = push_normalized_batches(
        crm,
        "equipmentMeters",
        repo.fetch_equipment_meters(meter_cursor),
        normalize_equipment_meter,
        batch_size,
    )
    if max_equipment:
        state.set_cursor("equipmentMeters", max_equipment)

    last_refresh_text = state.data.get("crm360_recent_refresh_at")
    try:
        last_refresh = datetime.fromisoformat(last_refresh_text) if last_refresh_text else None
    except ValueError:
        last_refresh = None
    # 15 min (era 1h): uma alteracao no iLux - endereco de equipamento, titulo,
    # medidor - precisa aparecer no CRM rapido o suficiente pro atendente nao
    # esbarrar em dado desatualizado no meio de um atendimento real.
    CRM360_REFRESH_INTERVAL_SECONDS = 15 * 60
    refresh_due = force_meter_bootstrap or not last_refresh or (datetime.now() - last_refresh).total_seconds() >= CRM360_REFRESH_INTERVAL_SECONDS
    if refresh_due:
        recent_receivables, _ = push_normalized_batches(
            crm, "receivables", repo.fetch_recent_receivables(1000), normalize_receivable, batch_size
        )
        open_receivables, _ = push_normalized_batches(
            crm, "receivables", repo.fetch_open_receivables(5000), normalize_receivable, batch_size
        )
        recent_meters, _ = push_normalized_batches(
            crm, "equipmentMeters", repo.fetch_recent_equipment_meters(1000), normalize_equipment_meter, batch_size
        )
        recent_equipments, _ = push_normalized_batches(
            crm, "equipments", repo.fetch_recently_updated_equipments(1000), normalize_equipment, batch_size
        )
        state.data["crm360_recent_refresh_at"] = datetime.now().isoformat(timespec="seconds")
        logging.info(
            "CRM 360: atualizados %s titulo(s), %s medidor(es) e %s equipamento(s) recentes",
            recent_receivables + open_receivables,
            recent_meters,
            recent_equipments,
        )
    elif meter_total:
        logging.info("CRM 360: %s novo(s) medidor(es) sincronizado(s)", meter_total)
    state.save()


def sync_service_orders_incremental(
    repo: FirebirdRepository,
    crm: CRMClient,
    state: StateStore,
    batch_size: int,
    stop_event: threading.Event | None = None,
) -> bool:
    """Sync a bounded set of new/changed O.S. without scanning IXLOS."""
    if stop_event is not None and stop_event.is_set():
        return False

    recent_bootstrap_size = 250
    cycle_limit = max(25, min(int(batch_size), 100))
    seq_cursor = state.get_cursor("serviceOrders")
    attendance_cursor_exists = "serviceOrderAttendances" in state.data.get("cursors", {})
    attendance_cursor = state.get_cursor("serviceOrderAttendances")

    if seq_cursor <= 0 or not attendance_cursor_exists:
        max_seq_os, max_attendance = repo.get_service_order_watermarks()
        if seq_cursor <= 0:
            # Importa só uma janela recente em uma instalação nova. Os ciclos
            # seguintes concluem essa janela em lotes limitados.
            seq_cursor = max(0, max_seq_os - recent_bootstrap_size)
            state.set_cursor("serviceOrders", seq_cursor)
            # Uma instalação nova também deve saltar os atendimentos antigos.
            attendance_cursor = max_attendance
            state.set_cursor("serviceOrderAttendances", attendance_cursor)
        elif not attendance_cursor_exists:
            # A janela recente já traz o estado atual dessas O.S.; iniciar no
            # MAX evita reproduzir todo o histórico de atendimentos.
            attendance_cursor = max_attendance
            state.set_cursor("serviceOrderAttendances", attendance_cursor)
        state.save()

    new_rows = list(repo.fetch_service_orders(seq_cursor, limit=cycle_limit))
    changed_rows, max_attendance = repo.fetch_service_orders_changed_by_attendance(
        attendance_cursor,
        cycle_limit,
    )

    rows_by_seq: dict[int, dict[str, Any]] = {}
    for raw in new_rows + changed_rows:
        raw_seq = raw.get("seqos")
        if raw_seq is not None:
            rows_by_seq[int(raw_seq)] = raw

    if stop_event is not None and stop_event.is_set():
        return False

    normalized = [
        normalize_service_order(rows_by_seq[seq_os])
        for seq_os in sorted(rows_by_seq)
    ]
    if normalized:
        crm.push("serviceOrders", normalized)

    if new_rows:
        seq_cursor = max(
            seq_cursor,
            max(int(row["seqos"]) for row in new_rows if row.get("seqos") is not None),
        )
    state.set_cursor("serviceOrders", seq_cursor)
    state.set_cursor("serviceOrderAttendances", max_attendance)
    state.set_last_sync_at(datetime.now().isoformat(timespec="seconds"))
    state.save()

    if normalized:
        logging.info(
            "O.S.: %s registro(s) novo(s)/alterado(s) sincronizado(s)",
            len(normalized),
        )
    else:
        logging.debug("O.S.: nenhuma alteração desde o último ciclo")
    return True


def run_cycle(
    config: AppConfig,
    state: StateStore,
    full: bool = False,
    stop_event: threading.Event | None = None,
) -> None:
    repo = FirebirdRepository(config)
    crm = CRMClient(config)
    # v4: "equipamentos vinculados" contava todo equipamento que ja passou pelo
    # contrato (IXLCONTRATOSIT sem filtro), incluindo os ja devolvidos/trocados
    # -- agora so conta quem ainda esta instalado (DTINSTALACAOFIN nulo ou >=
    # hoje). Validado contra producao: 6 de 15 contratos amostrados mudam de
    # valor com essa correcao. v3: trouxe franquia de paginas, valor do
    # excedente e o modo de faturamento (fixo/contador/misto).
    # v5: VALEXCEDENTE e taxa por milheiro de paginas excedentes (nao um valor
    # em dinheiro), e cada medidor do contrato pode ter uma taxa diferente --
    # somar essas taxas entre medidores nao produz nenhum valor real. Trocado
    # por min/max da taxa (por pagina) entre os medidores ativos do contrato.
    contract_details_version = 5
    receivable_details_version = 2
    refresh_contract_details = int(state.data.get("contract_details_version", 0) or 0) < contract_details_version
    refresh_receivable_details = int(state.data.get("receivable_details_version", 0) or 0) < receivable_details_version

    if full:
        state.data["cursors"] = {
            "contacts": 0,
            "equipments": 0,
            "contracts": 0,
            "serviceOrders": 0,
            "serviceOrderAttendances": 0,
            "receivables": 0,
            "equipmentMeters": 0,
        }
        state.save()
    elif refresh_contract_details:
        # Esta versao passou a trazer valor fixo, franquia e vinculos reais do
        # contrato. Refaz apenas contratos/equipamentos uma vez, preservando a
        # sincronizacao pesada de contatos e O.S.
        state.set_cursor("equipments", 0)
        state.set_cursor("contracts", 0)
        state.set_cursor("equipmentMeters", 0)
        state.save()

    if refresh_receivable_details:
        # A nova versao inclui NF, tipo de faturamento e vinculo do boleto.
        # Forca apenas a janela financeira recente/aberta, sem refazer o historico inteiro.
        state.data["crm360_recent_refresh_at"] = None
        state.save()

    state.data["batch_size"] = config.batch_size

    # Sync static support metadata
    sync_static_entities(repo, crm)
    sync_company_profile(repo, crm, config)

    entities = ["contacts", "equipments", "contracts"]
    if full:
        entities.append("serviceOrders")

    for entity in entities:
        if stop_event is not None and stop_event.is_set():
            return
        logging.info("Iniciando sincronização de %s", entity)
        if not sync_entity(repo, crm, state, entity, config.batch_size, stop_event):
            return

    if refresh_contract_details:
        state.data["contract_details_version"] = contract_details_version
        state.save()
        logging.info("Detalhes de contratos e equipamentos atualizados")

    sync_crm360_details(
        repo,
        crm,
        state,
        config.batch_size,
        force_meter_bootstrap=refresh_contract_details or full,
    )
    if refresh_receivable_details:
        state.data["receivable_details_version"] = receivable_details_version
        state.save()
        logging.info("Detalhes de notas fiscais e boletos atualizados")

    if full:
        # A carga completa ja enviou o estado atual de todas as O.S. Portanto,
        # os dois cursores devem partir do topo para que o proximo ciclo nao
        # percorra novamente todo o historico de atendimentos.
        max_seq_os, max_attendance = repo.get_service_order_watermarks()
        state.set_cursor("serviceOrders", max_seq_os)
        state.set_cursor("serviceOrderAttendances", max_attendance)
        state.save()

    if config.sync_service_orders and not full:
        if not sync_service_orders_incremental(
            repo,
            crm,
            state,
            config.batch_size,
            stop_event,
        ):
            return

    # Inform backend that agent is alive
    crm.send_ping()


def run_service_order_history_backfill(config: AppConfig) -> dict[str, Any]:
    """Ressincroniza o historico completo de O.S. (sem tocar em outros cursores).

    Numa instalacao nova, sync_service_orders_incremental so importa uma janela
    recente (ultimas 250 O.S.) e nunca preenche o historico anterior -- o
    cursor so anda para frente. Isso zera SO o cursor de serviceOrders e reusa
    sync_entity(), que ja pagina, envia em lotes e salva progresso
    incrementalmente (resumivel se interrompido).
    """
    repo = FirebirdRepository(config)
    crm = CRMClient(config)
    state = StateStore(config.state_file)
    previous_cursor = state.get_cursor("serviceOrders")
    state.set_cursor("serviceOrders", 0)
    state.save()
    try:
        ok = sync_entity(repo, crm, state, "serviceOrders", config.batch_size)
    except Exception:
        # Nao deixa o cursor zerado se algo explodir antes do primeiro lote --
        # sync_entity ja salva progresso incremental, entao so restauramos o
        # cursor anterior se ele nao avancou nada (evita perder progresso real).
        if state.get_cursor("serviceOrders") == 0:
            state.set_cursor("serviceOrders", previous_cursor)
            state.save()
        raise
    return {"ok": ok, "finalCursor": state.get_cursor("serviceOrders")}


def run_command_listener(
    config: AppConfig,
    stop_event: threading.Event | None = None,
    billing_trigger_event: threading.Event | None = None,
) -> None:
    """Keep an outbound HTTPS request ready for immediate CRM commands."""
    repo = FirebirdRepository(config)
    crm = CRMClient(config)
    result_store = CommandResultStore(ROOT / "command-results.json")
    logging.info("Listener imediato de comandos iniciado.")

    while stop_event is None or not stop_event.is_set():
        try:
            crm.process_pending_commands(
                repo,
                result_store,
                wait_seconds=25,
                billing_trigger_event=billing_trigger_event,
            )
        except Exception as exc:
            logging.exception("Falha no listener de comandos: %s", exc)
            time.sleep(2)


def _resolve_billing_auto_send_since(config: AppConfig) -> str:
    """Data (YYYY-MM-DD) a partir da qual um documento pode ser enviado
    automaticamente, pela data de modificacao do arquivo. Configuravel via
    BILLING_AUTO_SEND_SINCE; se nao configurado, grava a data de hoje na
    primeira vez que roda e reusa esse valor para sempre depois - assim o
    corte fica fixo no dia em que o recurso foi ligado, em vez de "hoje"
    mudar a cada reinicio (o que faria o agente nunca enviar nada, sempre
    esperando um "hoje" que nunca chega)."""
    if config.billing_auto_send_since:
        return config.billing_auto_send_since
    since_file = config.billing_auto_send_since_file
    if since_file.exists():
        try:
            data = json.loads(since_file.read_text(encoding="utf-8"))
            if data.get("since"):
                return data["since"]
        except Exception as exc:
            logging.warning("Falha ao ler data de corte do envio automatico, recriando: %s", exc)
    today = datetime.now().strftime("%Y-%m-%d")
    since_file.parent.mkdir(parents=True, exist_ok=True)
    since_file.write_text(json.dumps({"since": today}), encoding="utf-8")
    logging.info(
        "Envio automatico: definindo o corte de data em %s (primeira vez) - "
        "documentos arquivados antes disso nunca serao enviados automaticamente, "
        "so os que forem gerados/atualizados a partir de agora.",
        today,
    )
    return today


def run_billing_automation(
    repo: FirebirdRepository,
    crm: CRMClient,
    config: AppConfig,
    ledger: "BillingSendLedger",
) -> dict[str, int]:
    """One pass of the automatic WhatsApp billing send.

    Finds open receivables whose configured documents (billing_auto_send_document_types
    -- boleto, nota fiscal and/or demonstrativo) are all matched, unambiguously, in the
    financial document index, and sends (or, in test mode, only logs) the ones not sent
    before. Never touches the original PDFs; every send is recorded in the local ledger
    keyed by file content, not by folder location, so nothing is ever sent twice.
    """
    if not config.billing_auto_send_enabled:
        return {"ready": 0, "sent": 0, "failed": 0}

    since_date = _resolve_billing_auto_send_since(config)
    min_mtime_ns = int(datetime.strptime(since_date, "%Y-%m-%d").timestamp() * 1_000_000_000)
    packages = repo.find_ready_billing_packages(
        config.billing_auto_send_document_types, ledger, min_mtime_ns=min_mtime_ns,
    )
    sent = failed = 0
    for package in packages:
        labels = ", ".join(
            DOCUMENT_LABELS.get(document["documentType"], document["documentType"])
            for document in package["documents"]
        )
        who = package["customerName"] or package["customerCnpj"] or "cliente"
        description = f"{labels} para {who} (titulo #{package['receivableExternalId']})"
        ledger_info = {
            "customerName": package["customerName"],
            "documentTypes": [document["documentType"] for document in package["documents"]],
            "testMode": config.billing_auto_send_test_mode,
        }
        if config.billing_auto_send_test_mode:
            logging.info(
                "[TESTE] Enviaria automaticamente pelo WhatsApp: %s. "
                "Nada foi enviado -- desligue o modo teste na aba Documentos financeiros quando validar.",
                description,
            )
            crm.log_test_billing(package)
            ledger.record(package["receivableExternalId"], package["combinedHash"], ledger_info)
            sent += 1
            continue
        try:
            result = crm.send_billing_package(package)
            result_message = str(result.get("message") or "")
            legacy_skip_message = result_message.casefold()
            was_skipped = bool(result.get("skipped")) or any(
                marker in legacy_skip_message
                for marker in (
                    "não habilitado",
                    "nao habilitado",
                    "não há contato",
                    "nao ha contato",
                    "telefone do contato não é válido",
                    "telefone do contato nao e valido",
                )
            )
            if was_skipped:
                logging.warning(
                    "Envio automatico ignorado para %s (titulo #%s): %s. "
                    "Nao foi gravado no ledger e podera ser tentado novamente.",
                    who,
                    package["receivableExternalId"],
                    result_message or "contato sem permissao ou telefone valido",
                )
                continue
            logging.info("Envio automatico realizado: %s -- %s", description, result_message or "ok")
            ledger.record(package["receivableExternalId"], package["combinedHash"], ledger_info)
            sent += 1
        except Exception as exc:
            failed += 1
            logging.error("Falha no envio automatico de %s: %s", description, exc)
    return {"ready": len(packages), "sent": sent, "failed": failed}


def run_financial_document_monitor(
    config: AppConfig,
    stop_event: threading.Event | None = None,
    billing_trigger_event: threading.Event | None = None,
) -> None:
    if not config.financial_document_folders:
        return
    repo = FirebirdRepository(config)
    crm = CRMClient(config)
    # NOTA: o ledger e recriado a cada ciclo para refletir mudancas no modo
    # teste sem precisar reiniciar o agente. O arquivo de teste e separado do
    # de producao, entao desligar o modo teste descarta o ledger de teste e
    # re-avalia todos os pacotes que foram apenas simulados.
    while stop_event is None or not stop_event.is_set():
        try:
            # Resolve o ledger correto com base no modo atual (pode mudar em tempo real)
            ledger_path = config.billing_auto_send_ledger_file
            if config.billing_auto_send_test_mode:
                ledger_path = ledger_path.with_name(f"{ledger_path.stem}-teste{ledger_path.suffix}")
            ledger = BillingSendLedger(ledger_path)

            # Reuses the same live progress the manual "Indexar agora" button uses,
            # so a slow/large folder shows heartbeats in Logs instead of going quiet
            # for the whole duration of a periodic background scan.
            stats = repo.scan_financial_documents(on_progress=logging.info)
            logging.info(
                "Documentos financeiros: %s indexado(s), %s novo(s), %s atualizado(s), %s erro(s).",
                stats["total"],
                stats["added"],
                stats["updated"],
                stats["errors"],
            )
        except Exception as exc:
            logging.exception("Falha ao atualizar o indice de documentos financeiros: %s", exc)

        try:
            billing_stats = run_billing_automation(repo, crm, config, ledger)
            if billing_stats["ready"]:
                logging.info(
                    "Envio automatico de cobrancas: %s pronto(s), %s enviado(s)/testado(s), %s falha(s).",
                    billing_stats["ready"],
                    billing_stats["sent"],
                    billing_stats["failed"],
                )
        except Exception as exc:
            logging.exception("Falha no envio automatico de cobrancas: %s", exc)

        wait_seconds = max(60, config.financial_document_scan_seconds)
        if stop_event is not None and stop_event.is_set():
            return
        if billing_trigger_event is not None:
            # Um clique em "Reprocessar pendencias" interrompe a espera normal e
            # inicia outra leitura assim que a rodada atual terminar.
            billing_trigger_event.wait(wait_seconds)
            billing_trigger_event.clear()
        else:
            time.sleep(wait_seconds)



def inspect_schema(config: AppConfig) -> Path:
    repo = FirebirdRepository(config)
    report = repo.inspect_schema()
    output_path = ROOT / "schema-report.json"
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logging.info("Relatorio do schema salvo em %s", output_path)
    return output_path


def configure_logging(config: AppConfig) -> None:
    config.log_dir.mkdir(parents=True, exist_ok=True)
    config.log_file.parent.mkdir(parents=True, exist_ok=True)

    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, config.log_level.upper(), logging.INFO))
    root_logger.handlers.clear()

    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    root_logger.addHandler(stream_handler)

    file_handler = RotatingFileHandler(
        config.log_file,
        maxBytes=config.log_max_bytes,
        backupCount=config.log_backup_count,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)


def validate_config(config: AppConfig) -> None:
    required = {
        "FIREBIRD_DATABASE": config.firebird_database,
        "CRM_BASE_URL": config.crm_base_url,
        "CRM_TENANT_SLUG": config.crm_tenant_slug,
        "CRM_SYNC_TOKEN": config.crm_sync_token,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise RuntimeError(f"Configuração ausente: {', '.join(missing)}")


def validate_firebird_config(config: AppConfig) -> None:
    missing = []
    if not config.firebird_database:
        missing.append("FIREBIRD_DATABASE")
    if missing:
        raise RuntimeError(f"Configuracao ausente: {', '.join(missing)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Firebird to CRM sync client")
    parser.add_argument("--once", action="store_true", help="Executa apenas um ciclo de sincronização")
    parser.add_argument("--full", action="store_true", help="Força ressincronização completa")
    parser.add_argument("--inspect-schema", action="store_true", help="Gera schema-report.json com tabelas, colunas e amostras")
    args = parser.parse_args()

    config = AppConfig.from_env()
    configure_logging(config)
    if args.inspect_schema:
        validate_firebird_config(config)
        inspect_schema(config)
        return

    validate_config(config)

    state = StateStore(config.state_file)

    if args.once:
        run_cycle(config, state, full=args.full)
        CRMClient(config).process_pending_commands(
            FirebirdRepository(config),
            CommandResultStore(ROOT / "command-results.json"),
        )
        return

    # Forca uma atualizacao "CRM 360" (titulos/medidores/equipamentos
    # recentes) logo no primeiro ciclo apos o agente abrir, em vez de confiar
    # no timestamp da ultima rodada salvo no state.json - que pode ser de
    # minutos atras (de uma execucao anterior) e faz o agente esperar ate 1h
    # para revisar algo que acabou de mudar no iLux, mesmo logo apos abrir.
    state.data["crm360_recent_refresh_at"] = None
    state.save()
    logging.info("Client iniciado. Intervalo: %ss", config.sync_interval_seconds)
    billing_trigger_event = threading.Event()
    command_thread = threading.Thread(
        target=run_command_listener,
        args=(config, None, billing_trigger_event),
        name="firebird-command-listener",
        daemon=True,
    )
    command_thread.start()
    threading.Thread(
        target=run_financial_document_monitor,
        args=(config, None, billing_trigger_event),
        name="financial-document-monitor",
        daemon=True,
    ).start()

    while True:
        try:
            run_cycle(config, state, full=args.full)
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            logging.exception("Falha na sincronização: %s", exc)
        time.sleep(max(30, config.sync_interval_seconds))


if __name__ == "__main__":
    main()

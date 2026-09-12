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
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

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


DEFAULT_AGENT_VERSION = "1.1.8"
DEFAULT_AGENT_PROTOCOL_VERSION = "1"
# O pacote oficial e o painel de configurações usam este endpoint. Manter um
# valor padrão evita que uma instalação nova, com .env vazio ou incompleto,
# tente chamar requests com uma URL relativa ("/api/...").
DEFAULT_CRM_BASE_URL = "https://api-crm.lcddigital.com.br"
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
    "sync.plugboleto-config",
    "sync.billing-statements",
)

# A command listener normally waits up to 25 seconds for work. Authentication
# failures return immediately, though, so an old agent could spin thousands of
# requests per minute. These bounds keep the client useful after a transient
# outage while making a stale token self-throttling.
AUTH_FAILURE_STATUS_CODES = frozenset({400, 401, 403, 409, 422})
COMMAND_RETRY_BACKOFF_SECONDS = (5, 15, 30, 60, 300)
COMMAND_AUTH_PAUSE_SECONDS = 300

# A abertura imediata e a sincronizacao incremental usam threads diferentes.
# Sem uma trava compartilhada, a sincronizacao pode importar a O.S. recem-criada
# antes de o callback associar o SEQOS ao registro original do CRM.
SERVICE_ORDER_SYNC_LOCK = threading.RLock()


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


def normalize_crm_base_url(value: Any) -> str:
    """Normaliza a URL do CRM antes de montar os endpoints do agente.

    Instalações antigas às vezes guardam somente o domínio, sem esquema. O
    requests não aceita esse formato; como o agente oficial fala com o CRM por
    HTTPS, completamos o esquema automaticamente. URL vazia usa o endpoint
    oficial, enquanto formatos inválidos continuam sendo rejeitados por
    ``validate_config`` com uma mensagem clara.
    """
    text = str(value or "").strip().strip('"').strip("'")
    if not text:
        return DEFAULT_CRM_BASE_URL
    if not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", text):
        text = f"https://{text}"
    return text.rstrip("/")


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
    if match:
        dd, mm, yyyy, hh, mi, ss = match.groups()
        return datetime(int(yyyy), int(mm), int(dd), int(hh), int(mi), int(ss))

    # The incremental cursor is persisted as ISO-8601, while Firebird
    # drivers may return the native ``dd/mm/yyyy HH:MM:SS`` representation.
    # Accept both forms so a restart continues from the saved cursor instead
    # of falling back to the recovery window on every cycle.
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


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
    # Identificador persistente da instalação. Não é um segredo; serve apenas
    # para o CRM distinguir duas cópias do agente que usam o mesmo token.
    agent_install_id: str = ""
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
    financial_document_scan_seconds: int = 900
    # Envio automatico de cobranca pelo WhatsApp, construido sobre o indice de
    # documentos financeiros (substitui a antiga pasta "boletos_enviar" que
    # movia arquivos e identificava o cliente so pelo CNPJ solto no texto).
    billing_auto_send_enabled: bool = False
    billing_auto_send_test_mode: bool = True
    billing_auto_send_document_types: list[str] = field(default_factory=lambda: ["invoice", "statement", "boleto"])
    billing_auto_send_ledger_file: Path = field(default_factory=lambda: ROOT / "billing-auto-send-ledger.json")
    billing_auto_send_since_file: Path = field(default_factory=lambda: ROOT / "billing-auto-send-since.json")
    # Quando um titulo volta "ignorado" (cliente sem opt-in / sem telefone),
    # o agente registra no ledger com uma data de reavaliacao em vez de
    # re-tentar a cada ciclo (~10 min). Sem isso, ~100 titulos sem opt-in
    # viram milhares de POSTs/dia no backend. Zerado -> sem backoff (tenta
    # sempre, comportamento antigo).
    billing_skip_retry_hours: int = 24
    # Janela em que o envio automatico pode disparar (hora local, formato
    # "HH-HH", fim exclusivo). Fora dela o indice ainda e atualizado, mas
    # nada e enviado -- evita a cobranca rodar de madrugada e martelar a
    # instancia. Vazio = sem restricao de hora. "Reprocessar pendencias"
    # (clique manual) ignora a janela.
    billing_auto_send_hours: str = "8-19"
    billing_auto_send_weekdays_only: bool = True
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
            agent_install_id=os.getenv("AGENT_INSTALL_ID", "").strip(),
            firebird_host=os.getenv("FIREBIRD_HOST", "127.0.0.1"),
            firebird_port=env_int("FIREBIRD_PORT", 3050),
            firebird_database=os.getenv("FIREBIRD_DATABASE", ""),
            firebird_user=os.getenv("FIREBIRD_USER", "SYSDBA"),
            firebird_password=os.getenv("FIREBIRD_PASSWORD", ""),
            firebird_charset=os.getenv("FIREBIRD_CHARSET", "WIN1252"),
            firebird_company_id=env_int("FIREBIRD_COMPANY_ID", 1),
            crm_base_url=normalize_crm_base_url(os.getenv("CRM_BASE_URL", "")),
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
            financial_document_scan_seconds=env_int("FINANCIAL_DOCUMENT_SCAN_SECONDS", 900),
            billing_auto_send_enabled=env_bool("BILLING_AUTO_SEND_ENABLED", False),
            billing_auto_send_test_mode=env_bool("BILLING_AUTO_SEND_TEST_MODE", True),
            billing_auto_send_document_types=env_folders("BILLING_AUTO_SEND_DOCUMENT_TYPES") or ["invoice", "statement", "boleto"],
            billing_auto_send_ledger_file=resolve_path(
                os.getenv("BILLING_AUTO_SEND_LEDGER_FILE", "billing-auto-send-ledger.json"),
                ROOT / "billing-auto-send-ledger.json",
            ),
            billing_auto_send_since=os.getenv("BILLING_AUTO_SEND_SINCE") or None,
            billing_skip_retry_hours=env_int("BILLING_SKIP_RETRY_HOURS", 24),
            billing_auto_send_hours=os.getenv("BILLING_AUTO_SEND_HOURS", "8-19"),
            billing_auto_send_weekdays_only=env_bool("BILLING_AUTO_SEND_WEEKDAYS_ONLY", True),
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


def ensure_agent_install_id(config: AppConfig, state: StateStore) -> str:
    """Return a stable, non-secret identifier for this agent installation."""
    existing = str(state.data.get("agent_install_id") or "").strip()
    install_id = existing or config.agent_install_id or uuid.uuid4().hex
    if existing != install_id:
        state.data["agent_install_id"] = install_id
        state.save()
    config.agent_install_id = install_id
    return install_id


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
                self.data = self._prune(raw)
        except Exception as exc:
            logging.warning("Falha ao ler o controle de envios automaticos %s: %s", self.path, exc)

    @staticmethod
    def _prune(data: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """Descarta entradas de "ignorado" nao reavaliadas ha 30 dias -- o
        titulo quase certamente ja foi pago/baixado. Envios reais (sem
        retryAfter) ficam para sempre, garantindo que nada seja reenviado.
        """
        cutoff = datetime.now() - timedelta(days=30)
        kept: dict[str, dict[str, Any]] = {}
        for key, entry in data.items():
            retry_after = entry.get("retryAfter") if isinstance(entry, dict) else None
            if retry_after:
                try:
                    if datetime.fromisoformat(retry_after) < cutoff:
                        continue
                except ValueError:
                    pass
            kept[key] = entry
        return kept

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        replace_with_retry(temporary, self.path)

    @staticmethod
    def key(receivable_id: Any, combined_hash: str) -> str:
        return f"{receivable_id}:{combined_hash}"

    def already_sent(self, receivable_id: Any, combined_hash: str) -> bool:
        """True se este pacote exato nao pode ser enviado agora.

        Uma entrada de envio real / teste nao tem ``retryAfter`` e bloqueia
        para sempre. Uma entrada de ``skipped`` (sem opt-in / sem telefone)
        bloqueia apenas ate o ``retryAfter`` passar -- assim um opt-in
        corrigido e reavaliado no ciclo seguinte a janela, e nao a cada
        ~10 minutos.
        """
        with self.lock:
            entry = self.data.get(self.key(receivable_id, combined_hash))
            if entry is None:
                return False
            retry_after = entry.get("retryAfter")
            if not retry_after:
                return True
            try:
                return datetime.now() < datetime.fromisoformat(retry_after)
            except ValueError:
                return True

    def record(self, receivable_id: Any, combined_hash: str, info: dict[str, Any]) -> None:
        with self.lock:
            self.data[self.key(receivable_id, combined_hash)] = {
                **info,
                "sentAt": datetime.now().isoformat(timespec="seconds"),
            }
            self._save()

    def record_skip(
        self,
        receivable_id: Any,
        combined_hash: str,
        info: dict[str, Any],
        retry_after: datetime,
    ) -> None:
        """Registra um pacote que o backend recusou enviar (sem opt-in / sem
        telefone). Fica fora do caminho ate ``retry_after``, para os mesmos
        titulos sem como enviar nao voltarem a ser POSTados a cada varredura.
        Um ``record`` bem-sucedido depois sobrescreve e torna permanente.
        """
        with self.lock:
            self.data[self.key(receivable_id, combined_hash)] = {
                **info,
                "skipped": True,
                "skippedAt": datetime.now().isoformat(timespec="seconds"),
                "retryAfter": retry_after.isoformat(timespec="seconds"),
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
                "x-ilux-agent-version": config.agent_version,
                "x-ilux-agent-protocol": config.agent_protocol_version,
            }
        )
        if config.agent_install_id:
            self.session.headers.update({"x-ilux-agent-id": config.agent_install_id})

    @staticmethod
    def _raise_for_status(response: requests.Response) -> None:
        """Keep the CRM response body in the local log for actionable errors."""
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            detail = response.text.strip()
            if detail:
                detail = detail[:500]
                raise requests.HTTPError(f"{exc} - resposta do CRM: {detail}", response=response) from exc
            raise

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
        self._raise_for_status(response)
        return response.json()

    def process_pending_commands(
        self,
        repo: FirebirdRepository,
        result_store: CommandResultStore,
        wait_seconds: int = 0,
        billing_trigger_event: threading.Event | None = None,
    ) -> dict[str, Any]:
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
            self._raise_for_status(response)
            commands = response.json()
            if not commands:
                return {"ok": True, "commands": 0}

            logging.info("Recebidos %s comandos pendentes do CRM", len(commands))
            for cmd in commands:
                cmd_id = cmd["id"]
                cmd_type = cmd["type"]
                payload = cmd["payload"]

                try:
                    if cmd_type == "CREATE_OS":
                        # Mantem insercao, leitura do snapshot e callback atomicos em
                        # relacao ao sincronizador incremental de O.S. A trava evita
                        # que o mesmo SEQOS seja importado como um segundo registro
                        # enquanto o CRM ainda aguarda a confirmacao deste comando.
                        with SERVICE_ORDER_SYNC_LOCK:
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
            return {"ok": True, "commands": len(commands)}
        except Exception as e:
            response = getattr(e, "response", None)
            status_code = getattr(response, "status_code", None)
            retry_after = None
            try:
                retry_after = int(response.headers.get("Retry-After")) if response is not None else None
            except (TypeError, ValueError, AttributeError):
                retry_after = None
            auth_error = status_code in AUTH_FAILURE_STATUS_CODES
            logging.error(
                "Falha ao buscar ou processar comandos do CRM: %s%s",
                e,
                " (credencial rejeitada; listener em pausa)" if auth_error else "",
            )
            return {
                "ok": False,
                "status_code": status_code,
                "auth_error": auth_error,
                "retry_after": retry_after,
            }

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
                self._raise_for_status(response)
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
                        "installId": self.config.agent_install_id or None,
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
            if document.get("boletoRef") and not document.get("path"):
                # Boleto: o backend busca o PDF no PlugBoleto a partir da chave.
                documents.append({
                    "documentType": document["documentType"],
                    "fileName": document["fileName"],
                    "mimeType": "application/pdf",
                    "boletoRef": document["boletoRef"],
                })
                continue
            if document.get("statementRef") and not document.get("path"):
                # Demonstrativo: o backend re-renderiza pelo iLux (CrmBillingStatement)
                # quando o tenant tem statementRerenderEnabled; senao o envio pula.
                documents.append({
                    "documentType": document["documentType"],
                    "fileName": document["fileName"],
                    "mimeType": "application/pdf",
                    "statementRef": document["statementRef"],
                })
                continue
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
        self._raise_for_status(response)
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
            self._raise_for_status(response)
        except Exception as exc:
            # Nao interrompe o ciclo de teste por causa disso - e so um espelho
            # de conveniencia na tela do CRM, o log local continua valendo.
            logging.warning("Falha ao espelhar log de teste no CRM: %s", exc)


# IXLEQUIPAMENTO.SEQCONTRATO nao e limpo quando a maquina sai do contrato e
# TFINATIVO nao e usado nesta base (fica sempre 'N'). O vinculo real esta em
# IXLCONTRATOSIT: uma linha por equipamento que passou pelo contrato, com
# DTINSTALACAOFIN = fim do contrato enquanto instalado e uma data real no
# passado quando o equipamento foi removido/trocado. Essas duas colunas dizem
# se o equipamento ainda esta instalado em algum contrato.
_EQUIPMENT_CONTRACT_STATUS_COLS = """
                (select count(*) from IXLCONTRATOSIT it
                   where it.SEQCONTRATO = eq.SEQCONTRATO and it.CDEQUIPAMENTO = eq.CDEQUIPAMENTO
                     and (it.DTINSTALACAOFIN is null or it.DTINSTALACAOFIN >= CURRENT_DATE)) as CONTRATO_INSTAL_ATIVA,
                (select count(*) from IXLCONTRATOSIT it
                   where it.SEQCONTRATO = eq.SEQCONTRATO and it.CDEQUIPAMENTO = eq.CDEQUIPAMENTO) as CONTRATO_INSTAL_TOTAL"""


class FirebirdRepository:
    def __init__(self, config: AppConfig):
        self.config = config
        self._financial_index: FinancialDocumentIndex | None = None
        self._last_scan_stats: dict[str, Any] | None = None

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
        if not document_types:
            return []
        # boleto preferencialmente vem do PlugBoleto (backend), pela chave no
        # Firebird; se nao houver boleto imprimivel, cai para o indice de pasta.
        non_boleto_types = [t for t in document_types if t != "boleto"]
        wants_boleto = "boleto" in document_types
        index = self.financial_document_index()

        packages: list[dict[str, Any]] = []
        checked = 0
        already_sent = 0
        skipped_period = 0
        ambiguous = 0
        # Por tipo de documento: quantos titulos pararam ali por falta de match
        # (nao ambiguo - simplesmente nenhum PDF indexado bateu). O aviso de
        # "ambiguo" ja e logado individualmente; sem isso aqui, um "0 prontos"
        # ficava mudo sobre qual dos 3 tipos (nota/demonstrativo/boleto) e o
        # gargalo real, e reproduzir localmente nao ajuda - o indice depende
        # das pastas de rede da maquina do agente.
        missing_by_type = {t: 0 for t in document_types}
        current_month = datetime.now().strftime("%Y-%m")
        for row in self.fetch_open_receivables_for_billing():
            checked += 1
            receivable_id = row.get("seqreceita")

            # D4: envio automatico so do periodo atual. "Atual" = titulo emitido
            # neste mes-calendario (DTEMISSAOREC). Meses anteriores nao vencidos
            # ou em atraso so saem por envio manual. O firebirdsql devolve a
            # data como date/datetime; nos testes vem como string ISO ou BR.
            issued_raw = row.get("dtemissaorec")
            if hasattr(issued_raw, "strftime"):
                issued_ym = issued_raw.strftime("%Y-%m")
            elif issued_raw:
                text = str(issued_raw)
                iso = re.match(r"(\d{4})-(\d{2})", text)
                br = None if iso else re.match(r"(\d{2})[/.](\d{2})[/.](\d{4})", text)
                issued_ym = (f"{iso.group(1)}-{iso.group(2)}" if iso
                             else f"{br.group(3)}-{br.group(2)}" if br else None)
            else:
                issued_ym = None
            if issued_ym != current_month:
                skipped_period += 1
                continue

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

            documents: list[dict[str, Any]] = []
            hash_parts: list[str] = []
            ok = True
            folder_types = list(non_boleto_types)

            if wants_boleto:
                situacao = str(row.get("boleto_situacao") or "").strip().upper()
                chave = str(row.get("chave_integracao") or "").strip()
                if situacao in {"EMITIDO", "REGISTRADO", "LIQUIDADO"} and chave:
                    nosso = str(row.get("nosso_numero") or "").strip()
                    period = str(row.get("billing_period") or issued_ym.replace("-", "/")).strip()
                    documents.append({
                        "documentType": "boleto",
                        "fileName": friendly_filename("boleto", context),
                        "boletoRef": {
                            "receivableExternalId": str(receivable_id),
                            "chaveIntegracao": chave,
                            "pdfProtocolo": str(row.get("pdf_protocolo") or "").strip() or None,
                            "nossoNumero": nosso,
                            "situacao": situacao,
                        },
                    })
                    hash_parts.append(f"boleto:{receivable_id}:{nosso}:{period}")
                else:
                    # Sem boleto imprimivel no Firebird -> tenta a pasta monitorada.
                    folder_types.append("boleto")

            for document_type in folder_types if ok else []:
                try:
                    match = index.find(document_type, context, min_mtime_ns=min_mtime_ns)
                except ValueError as exc:
                    logging.warning(
                        "Envio automatico: titulo %s tem %s ambiguo, pulando ate revisao manual (%s)",
                        receivable_id, document_type, exc,
                    )
                    ambiguous += 1
                    ok = False
                    break
                if match is None:
                    # Demonstrativo sem PDF oficial na pasta: manda uma referencia
                    # e o backend re-renderiza pelo iLux (CrmBillingStatement) --
                    # so quando o tenant tem statementRerenderEnabled; caso
                    # contrario o backend responde "pulado" e o titulo espera a
                    # pasta. A pasta continua sendo preferida quando existe.
                    seqdemo = str(row.get("seqdemonstrativo") or "").strip()
                    if document_type == "statement" and seqdemo:
                        period = str(row.get("billing_period") or issued_ym.replace("-", "/")).strip()
                        documents.append({
                            "documentType": "statement",
                            "fileName": friendly_filename("statement", context),
                            "statementRef": {
                                "receivableExternalId": str(receivable_id),
                                "seqDemonstrativo": seqdemo,
                                "period": period,
                            },
                        })
                        hash_parts.append(f"statement:{receivable_id}:{seqdemo}:{period}")
                        continue
                    missing_by_type[document_type] += 1
                    ok = False
                    break
                documents.append({
                    "documentType": document_type,
                    "path": match.path,
                    "sha256": match.sha256,
                    "fileName": friendly_filename(document_type, context),
                })
                hash_parts.append(match.sha256)

            if not ok or len(documents) != len(document_types):
                continue

            combined_hash = ":".join(sorted(hash_parts))
            if ledger.already_sent(receivable_id, combined_hash):
                already_sent += 1
                continue

            packages.append({
                "receivableExternalId": receivable_id,
                "customerName": row.get("customer_name"),
                "customerCnpj": row.get("customer_cnpj"),
                "customerCpf": row.get("customer_cpf"),
                "combinedHash": combined_hash,
                "documents": documents,
            })
        logging.info(
            "Envio automatico: %s titulo(s) verificado(s), %s pronto(s), %s ja enviado(s), "
            "%s fora do periodo atual, %s ambiguo(s). Sem match/boleto por tipo: %s",
            checked, len(packages), already_sent, skipped_period, ambiguous, missing_by_type,
        )
        self._last_scan_stats = {
            "checked": checked,
            "ready": len(packages),
            "alreadySent": already_sent,
            "skippedPeriod": skipped_period,
            "ambiguous": ambiguous,
            "missingByType": dict(missing_by_type),
        }
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
        sql = f"""
            select
                eq.CDEQUIPAMENTO, eq.CDCLIENTE, eq.CDPRODUTO, eq.SERIE, eq.MODELO, eq.FABRICANTE,
                eq.SEQCONTRATO, eq.PATRIMONIO, eq.TFINATIVO,
                eq.ENDERECO, eq.NUM, eq.BAIRRO, eq.COMPLEMENTO, eq.LOCALINSTAL, eq.DEPARTAMENTO, eq.CONTATO, eq.FONE, eq.DDD, eq.CIDADE, eq.UF,
                eq.INCLUSAO, eq.ATUALIZADO,
                p.NMPRODUTO as PRODUCT_NAME,
{_EQUIPMENT_CONTRACT_STATUS_COLS}
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
        cadastro original nunca seria enviada de novo sem isso. Com limite alto
        cobre a frota inteira, corrigindo tambem o vinculo de contrato de
        maquinas trocadas que nunca mais teriam ATUALIZADO no topo."""
        sql = f"""
            select first {max(1, int(limit))}
                eq.CDEQUIPAMENTO, eq.CDCLIENTE, eq.CDPRODUTO, eq.SERIE, eq.MODELO, eq.FABRICANTE,
                eq.SEQCONTRATO, eq.PATRIMONIO, eq.TFINATIVO,
                eq.ENDERECO, eq.NUM, eq.BAIRRO, eq.COMPLEMENTO, eq.LOCALINSTAL, eq.DEPARTAMENTO, eq.CONTATO, eq.FONE, eq.DDD, eq.CIDADE, eq.UF,
                eq.INCLUSAO, eq.ATUALIZADO,
                p.NMPRODUTO as PRODUCT_NAME,
{_EQUIPMENT_CONTRACT_STATUS_COLS}
            from IXLEQUIPAMENTO eq
            left join IPRODUTO p on p.CDPRODUTO = eq.CDPRODUTO
            where eq.ATUALIZADO is not null
            order by eq.ATUALIZADO desc
        """
        yield from self._rows(sql, ())

    def fetch_equipment_ids(self) -> Iterator[dict[str, Any]]:
        """Lista completa e enxuta de CDEQUIPAMENTO para o snapshot de
        reconciliacao (desativa no CRM o que sumiu do iLux)."""
        yield from self._rows("select CDEQUIPAMENTO from IXLEQUIPAMENTO", ())

    def _contracts_sql(
        self,
        where_clause: str,
        order_clause: str,
        limit: int | None = None,
    ) -> str:
        """Monta a consulta de contratos para carga e refresh incremental.

        A carga inicial e o refresh por ATUALIZADO precisam usar exatamente os
        mesmos joins e agregacoes. Centralizar a consulta evita que a tela de
        contratos e o refresh periodico passem a calcular franquia ou vinculos
        de equipamentos de formas diferentes.
        """
        first = f"first {max(1, int(limit))}" if limit is not None else ""
        return f"""
            select {first}
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
            where {where_clause}
            order by {order_clause}
        """

    def fetch_contracts(self, cursor: int) -> Iterator[dict[str, Any]]:
        sql = self._contracts_sql("ct.SEQCONTRATO > ?", "ct.SEQCONTRATO")
        yield from self._rows(sql, (cursor,))

    def fetch_recently_updated_contracts(
        self,
        updated_after: datetime | None = None,
        limit: int = 5000,
    ) -> Iterator[dict[str, Any]]:
        """Reenvia contratos alterados no iLux sem depender do SEQCONTRATO.

        O cursor da carga inicial so encontra contratos novos. Este caminho usa
        ATUALIZADO para que alteracoes de franquia, excedente, vigencia ou
        equipamentos vinculados cheguem ao CRM. Quando nao houver marcador
        salvo, a consulta fica limitada para proteger o servidor; o backfill
        versionado continua sendo o responsavel pela carga completa.
        """
        predicates = ["ct.ATUALIZADO is not null"]
        params: tuple[Any, ...] = ()
        if updated_after is not None:
            predicates.append("ct.ATUALIZADO >= ?")
            params = (updated_after,)

        sql = self._contracts_sql(
            " and ".join(predicates),
            "ct.ATUALIZADO desc, ct.SEQCONTRATO desc",
            limit,
        )
        yield from self._rows(sql, params)

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
              and coalesce(nf.TFNFSCANCELADA, 'N') <> 'S'
              and upper(coalesce(rs.DS_RECEITA_STATUS, '')) not containing 'CANCEL'
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
                cli.CNPJ as CUSTOMER_CNPJ, cli.CPF as CUSTOMER_CPF,
                b.SITUACAO as BOLETO_SITUACAO, b.CHAVE_INTEGRACAO,
                b.PDF_PROTOCOLO,
                coalesce(b.TITULONOSSONUMEROIMPRESSAO, b.TITULONOSSONUMERO, r.NOSSONUMERO) as NOSSO_NUMERO,
                demo.PERIODO as BILLING_PERIOD
            from IRECEITAS r
            join ICLIENTES cli on cli.CDCLIENTE = r.CDCLIENTE
            left join INFSAIDA nf on nf.SEQINCNFS = r.SEQINCNFS
            left join IRECEITAS_STATUS rs on rs.ID_RECEITA_STATUS = r.CD_RECEITA_STATUS
            left join CE_BOLETO b on b.SEQRECEITA = r.SEQRECEITA
            left join IXLDEMOFAT demo on demo.SEQDEMONSTRATIVO = r.SEQDEMONSTRATIVO
            where r.DTPAGTOREC is null
              and coalesce(r.VALRECEITAPAGA, 0) < coalesce(r.VALRECEITA, 0)
              and coalesce(nf.TFNFSCANCELADA, 'N') <> 'S'
              and upper(coalesce(rs.DS_RECEITA_STATUS, '')) not containing 'CANCEL'
            order by r.DTVECTOREC, r.SEQRECEITA
        """
        yield from self._rows(sql, ())

    def fetch_plugboleto_config(self) -> dict[str, Any]:
        """Le a credencial do PlugBoleto no iLux para o CRM chamar a API direto.

        Mesma cadeia que fetch_billing_pdf percorre por titulo, sem um titulo
        especifico: CE_CEDENTE -> CE_CONTA -> CE_CONVENIO -> CE_PARAM_CONFIG.
        """
        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute(
                """
                select first 1
                    ced.CEDENTECPFCNPJ, ced.TOKEN_CEDENTE,
                    cfg.URL_BASE, cfg.PATH_BOLETO_IMPRESSAO
                from CE_CEDENTE ced
                join CE_CONTA conta on conta.CD_CEDENTE = ced.ID_CEDENTE
                join CE_CONVENIO conv on conv.CD_CONTA = conta.ID_CONTA
                join CE_PARAM_CONFIG cfg
                  on cfg.TP_AMBIENTE = conv.TP_AMBIENTE
                where coalesce(ced.TOKEN_CEDENTE, '') <> ''
                """,
            )
            row = cur.fetchone()
        finally:
            con.close()
        if not row:
            raise ValueError("Nenhuma credencial do PlugBoleto encontrada no iLux (CE_CEDENTE / CE_PARAM_CONFIG).")
        cnpj, token, base_url, print_path = row
        digits = "".join(ch for ch in str(cnpj or "") if ch.isdigit())
        if not digits or not str(token or "").strip():
            raise ValueError("Credencial do PlugBoleto incompleta no iLux (CNPJ ou token vazio).")
        return {
            "cedenteCnpj": digits,
            "token": str(token).strip(),
            "baseUrl": str(base_url or "").strip(),
            "printPath": str(print_path or "").strip(),
        }

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
            # Auditoria de divergencia no CRM.
            "amountOk": match.amount_ok,
            "matchScore": match.score,
            "receivableValue": float(context.get("valreceita") or 0) or None,
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

    # ------------------------------------------------------------------
    # Sincronizacao de demonstrativos (Fase 2 "faturamento sem a pasta").
    # O CRM guarda header + linhas e re-renderiza o PDF do demonstrativo sem
    # depender da pasta monitorada. Valores vem fechados do ERP -- nada e
    # recalculado aqui nem no CRM.
    # ------------------------------------------------------------------
    def max_billing_statement_seq(self) -> int:
        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute("select coalesce(max(SEQDEMONSTRATIVO), 0) from IXLDEMOFAT")
            row = cur.fetchone()
            return int((row[0] if row else 0) or 0)
        finally:
            con.close()

    def fetch_billing_statements(
        self,
        min_seq: int,
        since_date: str | None = None,
        limit: int = 2000,
    ) -> Iterator[dict[str, Any]]:
        """Headers de IXLDEMOFAT acima do cursor (SEQDEMONSTRATIVO), opcionalmente
        somados aos recalculados dentro da janela ``since_date`` (DTDEMONSTRATIVO
        >= data), para pegar edicoes tardias sem varrer o historico inteiro."""
        params: list[Any] = [int(min_seq)]
        if since_date:
            seq_filter = "(d.SEQDEMONSTRATIVO > ? or d.DTDEMONSTRATIVO >= ?)"
            params.append(since_date)
        else:
            seq_filter = "d.SEQDEMONSTRATIVO > ?"
        sql = f"""
            select first {max(1, int(limit))}
                d.SEQDEMONSTRATIVO, d.PERIODO, d.DTDEMONSTRATIVO, d.DTCOBRANCA,
                d.VALDEMONSTRATIVO, d.VALDEMONSTRATIVOF, d.VALDEMONSTRATIVOE,
                d.VALDESCONTO, d.VALACRESCIMO, d.VL_DEMO_LIQ, d.STATUS,
                d.CDCLIENTE, d.CDEMPRESA, d.SEQCONTRATOGRP, d.ATUALIZADO,
                cast(d.OBSERVACAO as varchar(2000)) as OBSERVACAO,
                cli.NMCLIENTE as CUSTOMER_NAME,
                cli.CNPJ as CUSTOMER_CNPJ, cli.CPF as CUSTOMER_CPF,
                (select count(*) from IXLCONTRATOSFAT f
                   where f.SEQDEMONSTRATIVO = d.SEQDEMONSTRATIVO) as NLINHAS,
                (select min(r.SEQRECEITA) from IRECEITAS r
                   where r.SEQDEMONSTRATIVO = d.SEQDEMONSTRATIVO) as SEQRECEITA,
                (select min(r.NUMNF) from IRECEITAS r
                   where r.SEQDEMONSTRATIVO = d.SEQDEMONSTRATIVO) as NUMNF
            from IXLDEMOFAT d
            left join ICLIENTES cli on cli.CDCLIENTE = d.CDCLIENTE
            where d.DTDEMONSTRATIVO is not null and {seq_filter}
            order by d.SEQDEMONSTRATIVO
        """
        yield from self._rows(sql, tuple(params))

    def fetch_statement_lines_bulk(self, seqs: list[int]) -> dict[int, list[dict[str, Any]]]:
        """Linhas de IXLCONTRATOSFAT de varios demonstrativos numa consulta so."""
        cleaned = [int(s) for s in seqs if s is not None]
        if not cleaned:
            return {}
        placeholders = ",".join("?" for _ in cleaned)
        con = self.connect()
        try:
            cur = con.cursor()
            cur.execute(
                f"""
                select
                    fat.SEQDEMONSTRATIVO, fat.SEQCONTRATO, fat.SEQCONTRATOGRP,
                    fat.CDEQUIPAMENTO, fat.CDMEDIDOR, fat.CDMEDIDORFAT,
                    fat.MEDIDORINI, fat.MEDIDORFIN, fat.MEDIDORDESC,
                    fat.DTPERIODOFATINI, fat.DTPERIODOFATFIN, fat.DTLEITURA,
                    fat.NR_DIAS_PERIODO_FAT,
                    fat.QTPRODUCAO, fat.QTFRANQUIA, fat.QTEXCEDENTE,
                    fat.VALFRANQUIA, fat.VALEXCEDENTE,
                    fat.VALFRANQUIACOB, fat.VALEXCEDENTECOB,
                    fat.VALFATURA, fat.VALDESCONTO, fat.VALACRESCIMO,
                    fat.TFFIXO, fat.TFISENTO, fat.TFRATEIO, fat.TFBONIFICACAO,
                    coalesce(fat.DEPARTAMENTO, eq.DEPARTAMENTO) as DEPARTMENT,
                    coalesce(fat.LOCALINSTAL, eq.LOCALINSTAL) as INSTALLATION_LOCATION,
                    eq.SERIE, eq.MODELO, p.NMPRODUTO as EQUIPMENT_NAME
                from IXLCONTRATOSFAT fat
                left join IXLEQUIPAMENTO eq on eq.CDEQUIPAMENTO = fat.CDEQUIPAMENTO
                left join IPRODUTO p on p.CDPRODUTO = eq.CDPRODUTO
                where fat.SEQDEMONSTRATIVO in ({placeholders})
                order by fat.SEQDEMONSTRATIVO, fat.SEQCONTRATO,
                         fat.CDEQUIPAMENTO, fat.CDMEDIDOR
                """,
                tuple(cleaned),
            )
            columns = [desc[0].lower() for desc in cur.description]
            grouped: dict[int, list[dict[str, Any]]] = {}
            for row in cur.fetchall():
                record = dict(zip(columns, row))
                grouped.setdefault(int(record["seqdemonstrativo"]), []).append(record)
            return grouped
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

    def _service_orders_select(
        self,
        where_clause: str,
        limit: int | None = None,
        include_updated_at: bool = False,
    ) -> str:
        first = f"first {max(1, int(limit))}" if limit is not None else ""
        updated_column = "os.ATUALIZADO," if include_updated_at else ""
        return f"""
            select {first}
                os.CDCLIENTE, os.NMCLIENTE, os.CDEQUIPAMENTO, os.SEQOS,
                os.DTINCLUSAO, os.HRINCLUSAO, os.DTATENDIMENTO, os.HRATENDIMENTO, os.DTFECHAMENTO,
                {updated_column}
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

    def fetch_service_orders_open(self) -> list[dict[str, Any]]:
        """Return the complete authoritative window of open O.S.

        Some iLux installations do not advance IXLOS.ATUALIZADO when a
        technician closes an order. A bounded cursor can therefore retain an
        order as open forever. The open-status query is small in practice and
        lets the CRM reconcile records that disappeared from this window.
        """
        sql = self._service_orders_select(
            "trim(coalesce(os.STATUS, '')) in ('A', 'E', 'M', 'T', 'P')",
        )
        return list(self._rows(sql, ()))

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

    def fetch_service_orders_changed_by_updated_at(
        self,
        updated_cursor: dict[str, Any] | None,
        limit: int,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """Read O.S. whose IXLOS row changed after the durable cursor.

        Closing an O.S. in the iLux updates IXLOS directly and does not always
        create a row in IXLOSATENDIMENTO. The attendance cursor alone therefore
        misses status/closing-date changes. ATUALIZADO is consumed with a
        timestamp+SEQOS tie-breaker so rows changed in the same second are not
        lost between cycles.
        """
        raw_at = updated_cursor.get("at") if isinstance(updated_cursor, dict) else None
        cursor_at = parse_firebird_timestamp_to_datetime(raw_at)
        if cursor_at is None:
            cursor_at = datetime.now() - timedelta(days=3)
        try:
            cursor_seq = max(0, int(updated_cursor.get("seq", 0))) if isinstance(updated_cursor, dict) else 0
        except (TypeError, ValueError):
            cursor_seq = 0

        sql = self._service_orders_select(
            "os.ATUALIZADO is not null "
            "and (os.ATUALIZADO > ? or (os.ATUALIZADO = ? and os.SEQOS > ?))",
            limit,
            include_updated_at=True,
        ).replace("order by os.SEQOS", "order by os.ATUALIZADO, os.SEQOS")
        rows = list(self._rows(sql, (cursor_at, cursor_at, cursor_seq)))

        next_at = cursor_at
        next_seq = cursor_seq
        for row in rows:
            row_at = parse_firebird_timestamp_to_datetime(row.get("atualizado"))
            if row_at is None:
                continue
            try:
                row_seq = int(row.get("seqos") or 0)
            except (TypeError, ValueError):
                row_seq = 0
            if row_at > next_at or (row_at == next_at and row_seq > next_seq):
                next_at = row_at
                next_seq = row_seq

        return rows, {"at": next_at.isoformat(timespec="seconds"), "seq": next_seq}

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

    def fetch_defect_types(self) -> Iterator[dict[str, Any]]:
        sql = """
            select CDDEFEITO, NMDEFEITO, TFINATIVO
              from IXLOSDEFEITOTP
             order by CDDEFEITO
        """
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

        data_prev_entrega = (now + timedelta(days=3)).strftime("%Y-%m-%d")

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

        # Existem ao menos duas geracoes do schema de O.S. do iLux em campo.
        # A mais nova possui TPORCATEND1 e usa os codigos de integracao
        # CDSTATUS=O / CDDEFEITO=1001; bases legadas (como a nossa de
        # homologacao) nao possuem a coluna e usam E1 / MAN. A deteccao e
        # feita na mesma conexao da gravacao para nunca enviar uma coluna ou
        # um codigo que nao exista naquela instalacao.
        sql_base = """
                insert into IXLOS (
                    SEQOS, CDCLIENTE, CDCLIENTEENT, CDEQUIPAMENTO, CDOSTP, DTINCLUSAO, HRINCLUSAO, STATUS, CDSTATUS, OBSDEFEITOCLI, NMSUPORTET, NMSUPORTEA,
                    NMCLIENTE, ENDERECO, NUM, COMPLEMENTO, BAIRRO, CIDADE, UF, CEP, DDD, FONE, CELULAR, EMAIL, CONTATO,
                    DEPARTAMENTO, LOCALINSTAL, DTPREVENTREGA, HRPREVENTREGA, CDEMPRESA, TPORCATEND, {tporcatend1_column} TPCHAMADO, CDTERRITORIO, EQUIPCLI, STATUSEQUIP,
                    SEQOSORIGEM, TIPO_OS, TFLIBERADO, CDDEFEITO, PRIORIDADE, ATUALIZADO, FORMULARIOOS, SEQOSCLI, NMSUPORTEL, NR_CAU, NR_RP
                ) values (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, 1, 'A', {tporcatend1_value} ?, 'GERAL', 'E', '0',
                    -1, ?, ?, ?, '24', ?, '', '', '', '', ''
                )
            """

        # O Desktop numera IXLOS pelo maior SEQOS real. O contador
        # ORDEMSERVICO pode ficar atrasado e devolver uma chave ja ocupada.
        # Em caso de concorrencia, refazemos a leitura e tentamos novamente.
        for attempt in range(1, 4):
            con = self.connect()
            try:
                cur = con.cursor()
                cur.execute(
                    "select count(*) from rdb$relation_fields "
                    "where rdb$relation_name = 'IXLOS' "
                    "and rdb$field_name = 'TPORCATEND1'"
                )
                supports_official_column = bool(cur.fetchone()[0])

                def catalog_has(table: str, field: str, value: str) -> bool:
                    cur.execute(f"select count(*) from {table} where {field} = ?", (value,))
                    return bool(cur.fetchone()[0])

                supports_official_codes = (
                    catalog_has("IXLOSSTATUS", "CDSTATUS", "O")
                    and catalog_has("IXLOSDEFEITOTP", "CDDEFEITO", "1001")
                )
                official_profile = supports_official_column and supports_official_codes
                logging.info(
                    "Perfil de abertura de O.S. detectado: %s (TPORCATEND1=%s, codigos oficiais=%s)",
                    "oficial" if official_profile else "legado",
                    "sim" if supports_official_column else "nao",
                    "sim" if supports_official_codes else "nao",
                )

                cur.execute(
                    "select TIPO_OS, TPCHAMADO from IXLOSTP where CDOSTP = ?",
                    (cd_ostp,),
                )
                os_type_row = cur.fetchone()
                tipo_os = int(os_type_row[0]) if os_type_row and os_type_row[0] is not None else 1
                tp_chamado = fit_text(
                    os_type_row[1] if os_type_row and os_type_row[1] is not None else "1",
                    1,
                )

                status = "A" if official_profile else "E"
                cd_status = "O" if official_profile else "E1"
                cd_defeito = "1001" if official_profile else "MAN"
                requested_defect_code = fit_text(data.get("cdDefeito", ""), 10)
                if requested_defect_code and catalog_has(
                    "IXLOSDEFEITOTP", "CDDEFEITO", requested_defect_code
                ):
                    cd_defeito = requested_defect_code
                tf_liberado = "N" if official_profile else "S"
                sql = sql_base.format(
                    tporcatend1_column="TPORCATEND1," if official_profile else "",
                    tporcatend1_value="'A'," if official_profile else "",
                )

                cur.execute("SELECT COALESCE(MAX(SEQOS), 0) + 1 FROM IXLOS")
                row = cur.fetchone()
                if not row or row[0] is None:
                    raise RuntimeError("Nao foi possivel consultar o proximo SEQOS.")
                seq_os = int(row[0])
                logging.info("Inserindo com o proximo SEQOS livre: %s", seq_os)
                dynamic_params = (
                    params[:6]
                    + (status, cd_status)
                    + params[6:-1]
                    + (tp_chamado, tipo_os, tf_liberado, cd_defeito, params[-1])
                )
                cur.execute(sql, (seq_os,) + dynamic_params)
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

    # Vinculo de contrato pelo historico de instalacao (IXLCONTRATOSIT), nao pelo
    # IXLEQUIPAMENTO.SEQCONTRATO (que fica preso ao ultimo contrato). Se o
    # equipamento ja saiu de todos os contratos por onde passou, ele nao esta
    # mais vinculado nem ativo -- TFINATIVO nao e confiavel nesta base.
    seq_contrato = first_non_empty(record.get("seqcontrato"))
    instal_ativa = int(record.get("contrato_instal_ativa") or 0)
    instal_total = int(record.get("contrato_instal_total") or 0)
    left_contract = bool(seq_contrato) and instal_total > 0 and instal_ativa == 0
    contract_external_id = None if (not seq_contrato or left_contract) else seq_contrato
    tf_inativo = str(record.get("tfinativo") or "").strip().upper() == "S"

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
        "contractExternalId": contract_external_id,
        "assetTag": first_non_empty(record.get("patrimonio")),
        "inactive": bool(tf_inativo or left_contract),
        "updatedAt": parse_firebird_timestamp(record.get("atualizado")),
        "inclusionAt": parse_firebird_timestamp(record.get("inclusao")),
        "raw": {k: json_safe(v) for k, v in record.items()},
    }


def normalize_contract(record: dict[str, Any]) -> dict[str, Any]:
    external_id = str(record["seqcontrato"]).strip()
    client_external_id = str(record["cdcliente"]).strip() if record.get("cdcliente") is not None else None
    contract_number = first_non_empty(record.get("nrcontrato"))
    contract_type = first_non_empty(record.get("nmcontratotp"), record.get("tipocontrato"), record.get("cdcontratotp"))
    contract_type_code = first_non_empty(record.get("cdcontratotp"), record.get("tipocontrato"))
    total_value = float(record.get("valor_total_contrato") or 0)
    fixed_value = float(record.get("tr_vl_fixo") or 0)
    franchise_value = float(record.get("valor_franquia") or 0)
    monthly_value = fixed_value + franchise_value
    page_franchise = int(record.get("qt_franquia") or 0)
    overage_rate_min = float(record.get("min_excedente") or 0) / 1000
    overage_rate_max = float(record.get("max_excedente") or 0) / 1000
    equipment_count = int(record.get("qt_equipamentos") or 0)
    updated_at = parse_firebird_timestamp(record.get("atualizado"))
    return {
        "externalId": external_id,
        "clientExternalId": client_external_id,
        "contractNumber": contract_number,
        "status": first_non_empty(record.get("status")),
        "contractType": contract_type,
        "contractTypeCode": contract_type_code,
        "value": monthly_value if monthly_value > 0 else total_value,
        "monthlyValue": monthly_value,
        "fixedValue": fixed_value,
        "franchiseValue": franchise_value,
        "totalValue": total_value,
        "equipmentCount": equipment_count,
        "pageFranchise": page_franchise,
        "overageRateMin": overage_rate_min,
        "overageRateMax": overage_rate_max,
        "billingMode": first_non_empty(record.get("billing_mode")),
        "startsAt": parse_firebird_timestamp(record.get("dtcontratoini")),
        "endsAt": parse_firebird_timestamp(record.get("dtcontratofin")),
        "updatedAt": updated_at,
        "inclusionAt": parse_firebird_timestamp(record.get("inclusao")),
        # Nomes canônicos adicionais mantidos no mesmo payload para tornar o
        # contrato explícito e facilitar a compatibilidade com consumidores
        # que não conhecem os nomes históricos usados pelo agente.
        "customerExternalId": client_external_id,
        "number": contract_number,
        "type": contract_type,
        "typeCode": contract_type_code,
        "modality": first_non_empty(record.get("billing_mode")),
        "activeEquipment": equipment_count,
        "excessPageValue": overage_rate_max or overage_rate_min,
        "externalUpdatedAt": updated_at,
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
        "updatedAt": parse_firebird_timestamp(record.get("atualizado")) or parse_firebird_timestamp(record.get("dtfechamento")) or parse_firebird_timestamp(record.get("dtatendimento")) or parse_firebird_timestamp(record.get("dtinclusao")),
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


def normalize_defect_type(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": str(record["cddefeito"]).strip(),
        "name": str(record["nmdefeito"]).strip(),
        "inactive": str(record.get("tfinativo") or "").strip().upper() in {"S", "SIM", "1", "TRUE"},
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

        logging.info("Sincronizando tipos de defeito...")
        defect_types = [normalize_defect_type(row) for row in repo.fetch_defect_types()]
        if defect_types:
            crm.push("defectTypes", defect_types)
            logging.info("Sincronizados %s tipos de defeito.", len(defect_types))
    except Exception as e:
        logging.error("Falha ao sincronizar entidades estáticas (tipos/técnicos/defeitos): %s", e)


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


def sync_plugboleto_config(repo: FirebirdRepository, crm: CRMClient) -> None:
    """Empurra a credencial do PlugBoleto (CE_CEDENTE / CE_PARAM_CONFIG) para o
    CRM a cada ciclo, do mesmo jeito que sync_company_profile faz com a empresa.

    O CRM guarda o token cifrado e passa a chamar o PlugBoleto direto, sem a
    pasta monitorada e sem round-trip com o agente. Leitura pequena e idempotente.
    """
    try:
        cfg = repo.fetch_plugboleto_config()
        crm.push("plugBoletoConfig", [cfg])
        logging.info("Credencial do PlugBoleto sincronizada com o CRM.")
    except Exception as exc:
        logging.warning("Não foi possível sincronizar a credencial do PlugBoleto: %s", exc)


def _stmt_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _stmt_bool(value: Any) -> bool:
    return str(value or "").strip().upper() == "S"


def normalize_billing_statement(
    header: dict[str, Any],
    lines: list[dict[str, Any]],
) -> dict[str, Any]:
    """Converte um demonstrativo (IXLDEMOFAT + IXLCONTRATOSFAT) no payload que o
    CRM guarda em CrmBillingStatement/-Line. Os valores vao como o iLux fechou;
    nenhuma soma e refeita aqui."""
    seq = str(header["seqdemonstrativo"]).strip()
    norm_lines: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        norm_lines.append({
            "lineNo": index,
            "contractExternalId": first_non_empty(line.get("seqcontrato")),
            "contractGroupExternalId": first_non_empty(line.get("seqcontratogrp")),
            "equipmentExternalId": first_non_empty(line.get("cdequipamento")),
            "equipmentName": first_non_empty(line.get("equipment_name")),
            "equipmentModel": first_non_empty(line.get("modelo")),
            "equipmentSerial": first_non_empty(line.get("serie")),
            "meterCode": first_non_empty(line.get("cdmedidor")),
            "meterCodeBilling": first_non_empty(line.get("cdmedidorfat")),
            "department": first_non_empty(line.get("department")),
            "installLocation": first_non_empty(line.get("installation_location")),
            "periodStart": parse_firebird_timestamp(line.get("dtperiodofatini")),
            "periodEnd": parse_firebird_timestamp(line.get("dtperiodofatfin")),
            "readingDate": parse_firebird_timestamp(line.get("dtleitura")),
            "periodDays": _stmt_int(line.get("nr_dias_periodo_fat")),
            "meterStart": _stmt_int(line.get("medidorini")),
            "meterEnd": _stmt_int(line.get("medidorfin")),
            "meterDiscount": _stmt_int(line.get("medidordesc")),
            "qtyProduction": _stmt_int(line.get("qtproducao")),
            "qtyFranchise": _stmt_int(line.get("qtfranquia")),
            "qtyExcess": _stmt_int(line.get("qtexcedente")),
            "franchiseValue": float(line.get("valfranquia") or 0),
            "excessValue": float(line.get("valexcedente") or 0),
            "franchiseCharged": float(line.get("valfranquiacob") or 0),
            "excessCharged": float(line.get("valexcedentecob") or 0),
            "invoiceValue": float(line.get("valfatura") or 0),
            "discountValue": float(line.get("valdesconto") or 0),
            "surchargeValue": float(line.get("valacrescimo") or 0),
            "isFixed": _stmt_bool(line.get("tffixo")),
            "isExempt": _stmt_bool(line.get("tfisento")),
            "isProrated": _stmt_bool(line.get("tfrateio")),
            "isBonus": _stmt_bool(line.get("tfbonificacao")),
            "raw": {k: json_safe(v) for k, v in line.items()},
        })

    obs = header.get("observacao")
    obs = str(obs).strip() if obs not in (None, "") else None
    return {
        "externalId": seq,
        "period": first_non_empty(header.get("periodo")),
        "statementDate": parse_firebird_timestamp(header.get("dtdemonstrativo")),
        "dueDate": parse_firebird_timestamp(header.get("dtcobranca")),
        "customerExternalId": first_non_empty(header.get("cdcliente")),
        "companyExternalId": first_non_empty(header.get("cdempresa")),
        "contractGroupExternalId": first_non_empty(header.get("seqcontratogrp")),
        "receivableExternalId": first_non_empty(header.get("seqreceita")),
        "invoiceNumber": first_non_empty(header.get("numnf")),
        "customerName": first_non_empty(header.get("customer_name")),
        "customerDocument": first_non_empty(header.get("customer_cnpj"), header.get("customer_cpf")),
        "totalValue": float(header.get("valdemonstrativo") or 0),
        "fixedValue": float(header.get("valdemonstrativof") or 0),
        "excessValue": float(header.get("valdemonstrativoe") or 0),
        "discountValue": float(header.get("valdesconto") or 0),
        "surchargeValue": float(header.get("valacrescimo") or 0),
        "netValue": float(header.get("vl_demo_liq") or 0),
        "status": first_non_empty(header.get("status")),
        "notes": obs,
        "lineCount": _stmt_int(header.get("nlinhas")) or len(norm_lines),
        "externalUpdatedAt": parse_firebird_timestamp(header.get("atualizado")),
        "lines": norm_lines,
        "raw": {k: json_safe(v) for k, v in header.items() if k != "observacao"},
    }


def sync_billing_statements(
    repo: FirebirdRepository,
    crm: CRMClient,
    state: StateStore,
) -> None:
    """Sincroniza demonstrativos do iLux para o CRM (Fase 2 "sem a pasta").

    Cursor por SEQDEMONSTRATIVO para o forward-scan; alem disso, no maximo a cada
    6h, revarre a janela de 75 dias por DTDEMONSTRATIVO para pegar recalculos.
    Numa instalacao nova o cursor comeca ~1500 demonstrativos atras (cerca de 3
    meses), nao no inicio do historico.
    """
    try:
        cursors = state.data.setdefault("cursors", {})
        cursor = int(cursors.get("billingStatements", 0) or 0)
        if cursor <= 0:
            max_seq = repo.max_billing_statement_seq()
            cursor = max(0, max_seq - 1500)
            cursors["billingStatements"] = cursor
            state.save()

        do_refresh = True
        last_refresh = state.data.get("billing_statement_refresh_at")
        if last_refresh:
            try:
                do_refresh = (
                    datetime.now() - datetime.fromisoformat(last_refresh)
                ) > timedelta(hours=6)
            except ValueError:
                do_refresh = True
        since_date = (
            (datetime.now() - timedelta(days=75)).strftime("%Y-%m-%d")
            if do_refresh
            else None
        )

        headers = list(repo.fetch_billing_statements(cursor, since_date))
        sent = 0
        max_seq = cursor
        for start in range(0, len(headers), 50):
            chunk = headers[start:start + 50]
            seqs = [int(h["seqdemonstrativo"]) for h in chunk]
            lines_by_seq = repo.fetch_statement_lines_bulk(seqs)
            payload = [
                normalize_billing_statement(h, lines_by_seq.get(int(h["seqdemonstrativo"]), []))
                for h in chunk
            ]
            crm.push("billingStatement", payload)
            sent += len(payload)
            max_seq = max(max_seq, *seqs)

        cursors["billingStatements"] = max_seq
        if do_refresh:
            state.data["billing_statement_refresh_at"] = datetime.now().isoformat(timespec="seconds")
        state.save()
        if sent:
            logging.info("Demonstrativos sincronizados com o CRM: %s", sent)
    except Exception as exc:
        logging.warning("Não foi possível sincronizar demonstrativos: %s", exc)


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
    force_contract_bootstrap: bool = False,
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
    refresh_due = (
        force_meter_bootstrap
        or force_contract_bootstrap
        or not last_refresh
        or (datetime.now() - last_refresh).total_seconds() >= CRM360_REFRESH_INTERVAL_SECONDS
    )
    if refresh_due:
        refresh_started_at = datetime.now()
        recent_receivable_rows = list(repo.fetch_recent_receivables(1000))
        recent_receivables, _ = push_normalized_batches(
            crm, "receivables", recent_receivable_rows, normalize_receivable, batch_size
        )
        recent_receivable_ids = sorted({int(row["seqreceita"]) for row in recent_receivable_rows if row.get("seqreceita") is not None})
        if recent_receivable_ids:
            crm.push("receivablesSnapshot", [{
                "completeWindow": True,
                "count": len(recent_receivable_ids),
                "minExternalId": recent_receivable_ids[0],
                "maxExternalId": recent_receivable_ids[-1],
                "externalIds": [str(value) for value in recent_receivable_ids],
                "capturedAt": datetime.now().isoformat(timespec="seconds"),
            }])
        open_receivables, _ = push_normalized_batches(
            crm, "receivables", repo.fetch_open_receivables(5000), normalize_receivable, batch_size
        )
        recent_meters, _ = push_normalized_batches(
            crm, "equipmentMeters", repo.fetch_recent_equipment_meters(1000), normalize_equipment_meter, batch_size
        )
        recent_equipments, _ = push_normalized_batches(
            crm, "equipments", repo.fetch_recently_updated_equipments(5000), normalize_equipment, batch_size
        )
        contract_refresh_total = 0
        if force_contract_bootstrap:
            # O sync_entity("contracts") acabou de reenviar a tabela inteira
            # por causa do backfill versionado. Evita duplicar esse custo no
            # mesmo ciclo, mas deixa o watermark preparado para o proximo.
            logging.info("CRM 360: refresh de contratos ignorado apos backfill completo")
        else:
            contract_watermark_text = state.data.get("crm360_contracts_updated_at")
            try:
                contract_watermark = (
                    datetime.fromisoformat(contract_watermark_text)
                    if contract_watermark_text
                    else None
                )
            except (TypeError, ValueError):
                contract_watermark = None

            # ATUALIZADO pode ter precisao menor que a do relogio do agente e
            # os dois servidores podem ter pequena diferenca de horario. A
            # sobreposicao torna o refresh resiliente a esses casos; o upsert
            # no backend torna a repeticao segura.
            if contract_watermark is not None:
                contract_watermark -= timedelta(minutes=5)
            contract_refresh_total, _ = push_normalized_batches(
                crm,
                "contracts",
                repo.fetch_recently_updated_contracts(contract_watermark, 5000),
                normalize_contract,
                batch_size,
            )

        equipment_ids = sorted({
            int(row["cdequipamento"])
            for row in repo.fetch_equipment_ids()
            if row.get("cdequipamento") is not None
        })
        if equipment_ids:
            crm.push("equipmentsSnapshot", [{
                "completeWindow": True,
                "count": len(equipment_ids),
                "minExternalId": equipment_ids[0],
                "maxExternalId": equipment_ids[-1],
                "externalIds": [str(value) for value in equipment_ids],
                "capturedAt": datetime.now().isoformat(timespec="seconds"),
            }])
        # O marcador so e salvo depois de todos os pushes do ciclo. Se o
        # backend falhar, a excecao interrompe o ciclo e a janela sera tentada
        # novamente na proxima execucao.
        state.data["crm360_recent_refresh_at"] = refresh_started_at.isoformat(timespec="seconds")
        state.data["crm360_contracts_updated_at"] = refresh_started_at.isoformat(timespec="seconds")
        logging.info(
            "CRM 360: atualizados %s titulo(s), %s medidor(es), %s equipamento(s) e %s contrato(s) recentes",
            recent_receivables + open_receivables,
            recent_meters,
            recent_equipments,
            contract_refresh_total,
        )
    elif meter_total:
        logging.info("CRM 360: %s novo(s) medidor(es) sincronizado(s)", meter_total)
    state.save()


def _sync_service_orders_incremental_unlocked(
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
    cycle_limit = max(25, min(int(batch_size), 250))
    seq_cursor = state.get_cursor("serviceOrders")
    attendance_cursor_exists = "serviceOrderAttendances" in state.data.get("cursors", {})
    attendance_cursor = state.get_cursor("serviceOrderAttendances")
    updated_cursor = state.data.get("serviceOrderUpdatedAt")
    if not isinstance(updated_cursor, dict) or not parse_firebird_timestamp_to_datetime(updated_cursor.get("at")):
        # A new cursor must recover recent direct edits (especially O.S.
        # encerradas hoje) without replaying the complete historical table.
        updated_cursor = {
            "at": (datetime.now() - timedelta(days=3)).isoformat(timespec="seconds"),
            "seq": 0,
        }

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
    changed_by_update_rows = []
    next_updated_cursor = updated_cursor
    fetch_changed_by_update = getattr(repo, "fetch_service_orders_changed_by_updated_at", None)
    if callable(fetch_changed_by_update):
        try:
            changed_by_update_rows, next_updated_cursor = fetch_changed_by_update(
                updated_cursor,
                cycle_limit,
            )
        except Exception as exc:
            # Older Firebird schemas may not have IXLOS.ATUALIZADO. Keep the
            # attendance-based path alive and retry this cursor next cycle.
            logging.warning("Nao foi possivel ler O.S. alteradas por ATUALIZADO: %s", exc)

    # Rele o conjunto atual de O.S. abertas para corrigir o caso em que o
    # fechamento altera apenas STATUS/DTFECHAMENTO, sem criar atendimento e
    # sem atualizar IXLOS.ATUALIZADO. Repositórios/testes antigos podem ainda
    # não implementar esse método.
    open_rows = []
    fetch_open = getattr(repo, "fetch_service_orders_open", None)
    if callable(fetch_open):
        open_rows = list(fetch_open())

    rows_by_seq: dict[int, dict[str, Any]] = {}
    for raw in new_rows + changed_rows + changed_by_update_rows + open_rows:
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

    if open_rows:
        crm.push("serviceOrdersOpenSnapshot", [{
            "completeWindow": True,
            "count": len(open_rows),
            "externalIds": [str(row["seqos"]) for row in open_rows if row.get("seqos") is not None],
            "capturedAt": datetime.now().isoformat(timespec="seconds"),
        }])

    if new_rows:
        seq_cursor = max(
            seq_cursor,
            max(int(row["seqos"]) for row in new_rows if row.get("seqos") is not None),
        )
    state.set_cursor("serviceOrders", seq_cursor)
    state.set_cursor("serviceOrderAttendances", max_attendance)
    state.data["serviceOrderUpdatedAt"] = next_updated_cursor
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


def sync_service_orders_incremental(
    repo: FirebirdRepository,
    crm: CRMClient,
    state: StateStore,
    batch_size: int,
    stop_event: threading.Event | None = None,
) -> bool:
    """Serializa a importacao de historico com a criacao imediata de O.S."""
    with SERVICE_ORDER_SYNC_LOCK:
        return _sync_service_orders_incremental_unlocked(
            repo,
            crm,
            state,
            batch_size,
            stop_event,
        )


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
    contract_details_version = 6
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
    sync_plugboleto_config(repo, crm)
    sync_billing_statements(repo, crm, state)

    entities = ["contacts", "equipments", "contracts"]
    if full:
        entities.append("serviceOrders")

    for entity in entities:
        if stop_event is not None and stop_event.is_set():
            return
        logging.info("Iniciando sincronização de %s", entity)
        if entity == "serviceOrders":
            with SERVICE_ORDER_SYNC_LOCK:
                synced = sync_entity(repo, crm, state, entity, config.batch_size, stop_event)
        else:
            synced = sync_entity(repo, crm, state, entity, config.batch_size, stop_event)
        if not synced:
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
        force_contract_bootstrap=refresh_contract_details or full,
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
        with SERVICE_ORDER_SYNC_LOCK:
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
    failure_streak = 0
    auth_failure_streak = 0

    while stop_event is None or not stop_event.is_set():
        try:
            result = crm.process_pending_commands(
                repo,
                result_store,
                wait_seconds=25,
                billing_trigger_event=billing_trigger_event,
            )
            if result.get("ok", True):
                failure_streak = 0
                auth_failure_streak = 0
                continue

            failure_streak += 1
            if result.get("auth_error"):
                auth_failure_streak += 1
                delay = result.get("retry_after") or min(
                    COMMAND_AUTH_PAUSE_SECONDS,
                    max(30, 30 * (2 ** min(auth_failure_streak - 1, 3))),
                )
                if auth_failure_streak >= 3:
                    logging.error(
                        "Listener de comandos pausado por %ss: token do CRM rejeitado. "
                        "Gere um novo token, salve as configurações e reinicie o agente.",
                        delay,
                    )
                else:
                    logging.warning(
                        "Token do CRM rejeitado; nova tentativa em %ss. "
                        "Confira CRM_SYNC_TOKEN/CRM_TENANT_SLUG.",
                        delay,
                    )
            else:
                delay = result.get("retry_after") or COMMAND_RETRY_BACKOFF_SECONDS[
                    min(failure_streak - 1, len(COMMAND_RETRY_BACKOFF_SECONDS) - 1)
                ]
                logging.warning(
                    "Listener de comandos aguardando %ss antes de tentar novamente.",
                    delay,
                )

            for _ in range(int(max(1, delay))):
                if stop_event is not None and stop_event.is_set():
                    return
                time.sleep(1)
        except Exception as exc:
            logging.exception("Falha no listener de comandos: %s", exc)
            failure_streak += 1
            delay = COMMAND_RETRY_BACKOFF_SECONDS[
                min(failure_streak - 1, len(COMMAND_RETRY_BACKOFF_SECONDS) - 1)
            ]
            logging.warning("Listener de comandos aguardando %ss antes de tentar novamente.", delay)
            time.sleep(delay)


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


def _within_billing_window(config: AppConfig, now: datetime | None = None) -> bool:
    """True se o envio automatico pode disparar agora (hora local).

    billing_auto_send_hours no formato "HH-HH" (fim exclusivo); vazio ou
    invalido = sem restricao de hora. billing_auto_send_weekdays_only pula
    sabado/domingo.
    """
    now = now or datetime.now()
    if config.billing_auto_send_weekdays_only and now.weekday() >= 5:
        return False
    spec = (config.billing_auto_send_hours or "").strip()
    if not spec:
        return True
    match = re.match(r"^(\d{1,2})\s*-\s*(\d{1,2})$", spec)
    if not match:
        return True
    start, end = int(match.group(1)), int(match.group(2))
    if not (0 <= start < end <= 24):
        return True
    return start <= now.hour < end


def run_billing_automation(
    repo: FirebirdRepository,
    crm: CRMClient,
    config: AppConfig,
    ledger: "BillingSendLedger",
    force_window: bool = False,
) -> dict[str, int]:
    """One pass of the automatic WhatsApp billing send.

    Finds open receivables whose configured documents (billing_auto_send_document_types
    -- boleto, nota fiscal and/or demonstrativo) are all matched, unambiguously, in the
    financial document index, and sends (or, in test mode, only logs) the ones not sent
    before. Never touches the original PDFs; every send is recorded in the local ledger
    keyed by file content, not by folder location, so nothing is ever sent twice.

    force_window=True (clique manual em "Reprocessar pendencias") ignora a
    janela de horario.
    """
    if not config.billing_auto_send_enabled:
        return {"ready": 0, "sent": 0, "failed": 0, "skipped": 0}

    if not force_window and not _within_billing_window(config):
        logging.info(
            "Envio automatico de cobrancas fora da janela (%s%s); indice atualizado, nada enviado.",
            config.billing_auto_send_hours or "sem restricao de hora",
            ", somente dias uteis" if config.billing_auto_send_weekdays_only else "",
        )
        return {"ready": 0, "sent": 0, "failed": 0, "skipped": 0, "outside_window": True}

    since_date = _resolve_billing_auto_send_since(config)
    min_mtime_ns = int(datetime.strptime(since_date, "%Y-%m-%d").timestamp() * 1_000_000_000)
    packages = repo.find_ready_billing_packages(
        config.billing_auto_send_document_types, ledger, min_mtime_ns=min_mtime_ns,
    )
    # Resumo da varredura para a visao operacional do CRM ("titulos aguardando
    # documento na pasta"). Best-effort -- nunca derruba o envio.
    scan_stats = getattr(repo, "_last_scan_stats", None)
    if scan_stats:
        try:
            crm.push("billingScanStatus", [scan_stats])
        except Exception as exc:
            logging.debug("Nao foi possivel enviar o resumo da varredura: %s", exc)
    sent = failed = skipped = 0
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
                skip_reason = result_message or "contato sem permissao ou telefone valido"
                if config.billing_skip_retry_hours > 0:
                    retry_after = datetime.now() + timedelta(hours=config.billing_skip_retry_hours)
                    ledger.record_skip(
                        package["receivableExternalId"],
                        package["combinedHash"],
                        {**ledger_info, "skipReason": skip_reason},
                        retry_after,
                    )
                    logging.warning(
                        "Envio automatico ignorado para %s (titulo #%s): %s. "
                        "Nova tentativa so apos %s -- evita re-POSTar o mesmo titulo a cada ciclo.",
                        who,
                        package["receivableExternalId"],
                        skip_reason,
                        retry_after.strftime("%d/%m %H:%M"),
                    )
                else:
                    logging.warning(
                        "Envio automatico ignorado para %s (titulo #%s): %s. "
                        "Backoff desativado (BILLING_SKIP_RETRY_HOURS=0); sera tentado no proximo ciclo.",
                        who,
                        package["receivableExternalId"],
                        skip_reason,
                    )
                skipped += 1
                continue
            logging.info("Envio automatico realizado: %s -- %s", description, result_message or "ok")
            ledger.record(package["receivableExternalId"], package["combinedHash"], ledger_info)
            sent += 1
        except Exception as exc:
            failed += 1
            logging.error("Falha no envio automatico de %s: %s", description, exc)
    return {"ready": len(packages), "sent": sent, "failed": failed, "skipped": skipped}


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
    manual_trigger = False
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
            billing_stats = run_billing_automation(
                repo, crm, config, ledger, force_window=manual_trigger,
            )
            if billing_stats["ready"]:
                logging.info(
                    "Envio automatico de cobrancas: %s pronto(s), %s enviado(s)/testado(s), "
                    "%s ignorado(s) sem opt-in, %s falha(s).",
                    billing_stats["ready"],
                    billing_stats["sent"],
                    billing_stats.get("skipped", 0),
                    billing_stats["failed"],
                )
        except Exception as exc:
            logging.exception("Falha no envio automatico de cobrancas: %s", exc)

        manual_trigger = False
        wait_seconds = max(60, config.financial_document_scan_seconds)
        if stop_event is not None and stop_event.is_set():
            return
        if billing_trigger_event is not None:
            # Um clique em "Reprocessar pendencias" interrompe a espera normal e
            # inicia outra leitura assim que a rodada atual terminar -- e essa
            # rodada ignora a janela de horario (pedido explicito de um humano).
            manual_trigger = billing_trigger_event.wait(wait_seconds)
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
        "CRM_SYNC_TOKEN": config.crm_sync_token,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise RuntimeError(f"Configuração ausente: {', '.join(missing)}")

    parsed_crm_url = urlsplit(config.crm_base_url)
    if parsed_crm_url.scheme not in {"http", "https"} or not parsed_crm_url.netloc:
        raise RuntimeError(
            "CRM_BASE_URL inválida. Informe o endereço completo, por exemplo: "
            "https://api-crm.lcddigital.com.br"
        )


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
    ensure_agent_install_id(config, state)

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

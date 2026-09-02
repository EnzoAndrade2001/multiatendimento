import json
import logging
import os
import re
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk
import pystray
from dotenv import load_dotenv, set_key
from PIL import Image, ImageDraw


ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parent

ENV_FILE = ROOT / ".env"


def create_tray_image():
    image = Image.new("RGB", (64, 64), color=(17, 24, 39))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((5, 5, 59, 59), radius=12, fill=(222, 181, 49))
    draw.text((11, 22), "CRM", fill=(10, 14, 22))
    return image


class AgentGUI(ctk.CTk):
    def __init__(self):
        super().__init__()
        load_dotenv(ENV_FILE)

        self.title("LCD Digital - Agente iLux CRM")
        self.minsize(620, 520)
        self.geometry(self._validated_geometry(os.getenv("AGENT_WINDOW_GEOMETRY", "960x700")))

        self.is_running = False
        self.agent_thread = None
        self.command_stop_event = None
        self.tray_icon = None

        self.create_widgets()
        self.load_settings()
        self.protocol("WM_DELETE_WINDOW", self.hide_window)

    def _validated_geometry(self, value):
        match = re.fullmatch(r"(\d+)x(\d+)(?:([+-]\d+)([+-]\d+))?", str(value or "").strip())
        if not match:
            return "960x700"
        width, height = int(match.group(1)), int(match.group(2))
        if width < 620 or height < 520:
            return "960x700"
        if match.group(3) is None:
            return f"{width}x{height}"
        x, y = int(match.group(3)), int(match.group(4))
        screen_width, screen_height = self.winfo_screenwidth(), self.winfo_screenheight()
        if x > screen_width - 100 or y > screen_height - 100 or x + width < 100 or y + height < 100:
            return "960x700"
        return f"{width}x{height}{x:+d}{y:+d}"

    def _geometry_for_save(self):
        # No startup com --minimized o Tk ainda informa 1x1+0+0. Salvar esse
        # valor faz a proxima abertura normal parecer invisivel.
        if not self.winfo_ismapped() or self.state() != "normal":
            return None
        if self.winfo_width() < 620 or self.winfo_height() < 520:
            return None
        return self.geometry()

    def create_widgets(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(self, fg_color="transparent")
        header.grid(row=0, column=0, padx=18, pady=(16, 6), sticky="ew")
        header.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(
            header,
            text="Agente iLux CRM",
            font=ctk.CTkFont(size=22, weight="bold"),
        ).grid(row=0, column=0, sticky="w")
        self.status_label = ctk.CTkLabel(
            header,
            text="● Parado",
            text_color="#94a3b8",
            font=ctk.CTkFont(weight="bold"),
        )
        self.status_label.grid(row=0, column=1, sticky="e")

        self.tabs = ctk.CTkTabview(self, anchor="nw")
        self.tabs.grid(row=1, column=0, padx=14, pady=6, sticky="nsew")
        for name in ("Conexão", "Sincronização", "Documentos financeiros", "Logs"):
            self.tabs.add(name)
            self.tabs.tab(name).grid_columnconfigure(0, weight=1)
            self.tabs.tab(name).grid_rowconfigure(0, weight=1)

        self._create_connection_tab()
        self._create_sync_tab()
        self._create_documents_tab()
        self._create_logs_tab()

        footer = ctk.CTkFrame(self, fg_color="transparent")
        footer.grid(row=2, column=0, padx=18, pady=(6, 16), sticky="ew")
        footer.grid_columnconfigure(0, weight=1)
        footer.grid_columnconfigure(1, weight=1)
        self.save_btn = ctk.CTkButton(footer, text="Salvar configurações", command=self.save_settings)
        self.save_btn.grid(row=0, column=0, padx=(0, 6), sticky="ew")
        self.action_btn = ctk.CTkButton(
            footer,
            text="▶ Iniciar agente",
            command=self.toggle_agent,
            fg_color="#15803d",
            hover_color="#166534",
        )
        self.action_btn.grid(row=0, column=1, padx=(6, 0), sticky="ew")

    def _scrollable_tab(self, name):
        frame = ctk.CTkScrollableFrame(self.tabs.tab(name), fg_color="transparent")
        frame.grid(row=0, column=0, sticky="nsew")
        frame.grid_columnconfigure(0, weight=1)
        return frame

    def _section_title(self, parent, title, description, row):
        ctk.CTkLabel(parent, text=title, font=ctk.CTkFont(size=17, weight="bold")).grid(
            row=row, column=0, sticky="w", padx=10, pady=(14, 0)
        )
        ctk.CTkLabel(
            parent,
            text=description,
            text_color="#94a3b8",
            justify="left",
            wraplength=760,
        ).grid(row=row + 1, column=0, sticky="ew", padx=10, pady=(2, 10))

    def _input(self, parent, label, row, show="", placeholder=""):
        ctk.CTkLabel(parent, text=label).grid(row=row, column=0, sticky="w", padx=10, pady=(8, 2))
        entry = ctk.CTkEntry(parent, show=show, placeholder_text=placeholder)
        entry.grid(row=row + 1, column=0, sticky="ew", padx=10, pady=(0, 6))
        return entry

    def _create_connection_tab(self):
        frame = self._scrollable_tab("Conexão")
        self._section_title(
            frame,
            "Conexão com o iLux e o CRM",
            "Dados utilizados pelo agente para consultar o Firebird e sincronizar com esta empresa.",
            0,
        )
        self.token_entry = self._input(frame, "Token do CRM", 2, show="•")
        self.db_path_entry = self._input(frame, "Caminho do banco Firebird", 4)
        self.login_entry = self._input(frame, "Usuário Firebird", 6)
        self.password_entry = self._input(frame, "Senha Firebird", 8, show="•")

        connection_actions = ctk.CTkFrame(frame, fg_color="transparent")
        connection_actions.grid(row=10, column=0, padx=10, pady=(4, 2), sticky="ew")
        connection_actions.grid_columnconfigure(0, weight=0)
        connection_actions.grid_columnconfigure(1, weight=1)
        self.test_connection_btn = ctk.CTkButton(
            connection_actions,
            text="Testar conexão com o banco",
            command=self.test_firebird_connection,
        )
        self.test_connection_btn.grid(row=0, column=0, sticky="w")
        self.connection_status_label = ctk.CTkLabel(
            connection_actions,
            text="",
            text_color="#94a3b8",
            anchor="w",
        )
        self.connection_status_label.grid(row=0, column=1, padx=(12, 0), sticky="ew")

    def _create_sync_tab(self):
        frame = self._scrollable_tab("Sincronização")
        self._section_title(
            frame,
            "Sincronização e automações",
            "Controle a frequência do agente.",
            0,
        )
        self.interval_entry = self._input(frame, "Intervalo de sincronização (segundos)", 2)
        ctk.CTkLabel(frame, text="Enviar cobranças automáticas para").grid(row=4, column=0, sticky="w", padx=10, pady=(8, 2))
        self.policy_var = ctk.StringVar(value="Somente Marcados")
        self.policy_menu = ctk.CTkOptionMenu(
            frame,
            variable=self.policy_var,
            values=["Somente Marcados", "Todos"],
        )
        self.policy_menu.grid(row=5, column=0, sticky="ew", padx=10, pady=(0, 4))
        ctk.CTkLabel(
            frame,
            text="\"Somente Marcados\" respeita o \"Enviar Faturas no WhatsApp\" de cada contato. Vale para o envio automático configurado na aba Documentos financeiros.",
            text_color="#94a3b8",
            justify="left",
            wraplength=760,
            font=ctk.CTkFont(size=11),
        ).grid(row=6, column=0, sticky="ew", padx=10, pady=(0, 10))
        self.autostart_var = ctk.BooleanVar(value=False)
        ctk.CTkCheckBox(
            frame,
            text="Iniciar o agente com o Windows",
            variable=self.autostart_var,
        ).grid(row=8, column=0, padx=10, pady=14, sticky="w")

        self._section_title(
            frame,
            "Histórico completo de O.S.",
            "Numa instalação nova, o agente traz só as últimas 250 ordens de serviço. Use o botão "
            "abaixo para trazer também o histórico completo (cerca de 19 mil registros). É uma "
            "operação pesada de execução única -- pode demorar bastante -- e não afeta a "
            "sincronização normal de contatos, equipamentos, contratos ou financeiro.",
            9,
        )
        self.os_backfill_btn = ctk.CTkButton(
            frame,
            text="Sincronizar histórico completo de O.S.",
            command=self.backfill_service_order_history,
        )
        self.os_backfill_btn.grid(row=11, column=0, padx=10, pady=(0, 14), sticky="w")

    def _create_documents_tab(self):
        frame = self._scrollable_tab("Documentos financeiros")
        self._section_title(
            frame,
            "PDFs oficiais gerados pelo iLux",
            "Adicione uma pasta por linha. O agente apenas lê os PDFs e monitora todas as subpastas; nenhum arquivo será movido, alterado ou renomeado.",
            0,
        )
        ctk.CTkLabel(frame, text="Pastas monitoradas").grid(row=2, column=0, sticky="w", padx=10, pady=(8, 2))
        self.financial_folders_text = ctk.CTkTextbox(frame, height=130, wrap="none")
        self.financial_folders_text.grid(row=3, column=0, sticky="ew", padx=10, pady=(0, 8))

        actions = ctk.CTkFrame(frame, fg_color="transparent")
        actions.grid(row=4, column=0, padx=10, pady=4, sticky="ew")
        actions.grid_columnconfigure((0, 1, 2), weight=1)
        ctk.CTkButton(actions, text="Adicionar pasta", command=self.add_financial_folder).grid(
            row=0, column=0, padx=(0, 4), sticky="ew"
        )
        ctk.CTkButton(actions, text="Testar acesso", command=self.test_financial_folders).grid(
            row=0, column=1, padx=4, sticky="ew"
        )
        self.index_btn = ctk.CTkButton(actions, text="Indexar agora", command=self.index_financial_folders)
        self.index_btn.grid(row=0, column=2, padx=(4, 0), sticky="ew")

        interval_row = ctk.CTkFrame(frame, fg_color="transparent")
        interval_row.grid(row=5, column=0, padx=10, pady=(6, 0), sticky="ew")
        interval_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(interval_row, text="Verificar automaticamente a cada (segundos)").grid(row=0, column=0, sticky="w")
        self.financial_scan_interval_entry = ctk.CTkEntry(interval_row, width=100, placeholder_text="600")
        self.financial_scan_interval_entry.grid(row=0, column=1, sticky="e", padx=(8, 0))
        ctk.CTkLabel(
            frame,
            text="Só vale enquanto o agente estiver em execução. Mínimo 60s; padrão 600s (10 min).",
            text_color="#94a3b8",
            font=ctk.CTkFont(size=11),
        ).grid(row=6, column=0, sticky="w", padx=10, pady=(2, 8))

        self._section_title(
            frame,
            "Envio automático de cobranças pelo WhatsApp",
            "Quando um pacote completo (dos tipos marcados abaixo) for encontrado sem ambiguidade para um "
            "título em aberto e ainda não tiver sido enviado, o agente manda pelo WhatsApp sozinho -- sem "
            "mover o arquivo original. Substitui a antiga pasta separada de boletos.",
            7,
        )
        self.auto_send_enabled_var = ctk.BooleanVar(value=False)
        ctk.CTkCheckBox(
            frame,
            text="Ativar envio automático",
            variable=self.auto_send_enabled_var,
        ).grid(row=9, column=0, padx=10, pady=(2, 4), sticky="w")

        self.auto_send_test_mode_var = ctk.BooleanVar(value=True)
        ctk.CTkCheckBox(
            frame,
            text="Modo teste (só registra no log o que enviaria, não envia de verdade)",
            variable=self.auto_send_test_mode_var,
        ).grid(row=10, column=0, padx=10, pady=(0, 8), sticky="w")

        types_row = ctk.CTkFrame(frame, fg_color="transparent")
        types_row.grid(row=11, column=0, padx=10, pady=(0, 4), sticky="ew")
        ctk.CTkLabel(types_row, text="Documentos que compõem o pacote:").grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 4))
        self.auto_send_invoice_var = ctk.BooleanVar(value=True)
        self.auto_send_statement_var = ctk.BooleanVar(value=True)
        self.auto_send_boleto_var = ctk.BooleanVar(value=True)
        ctk.CTkCheckBox(types_row, text="Nota Fiscal", variable=self.auto_send_invoice_var).grid(row=1, column=0, padx=(0, 12), sticky="w")
        ctk.CTkCheckBox(types_row, text="Demonstrativo", variable=self.auto_send_statement_var).grid(row=1, column=1, padx=(0, 12), sticky="w")
        ctk.CTkCheckBox(types_row, text="Boleto", variable=self.auto_send_boleto_var).grid(row=1, column=2, sticky="w")
        ctk.CTkLabel(
            frame,
            text="Só envia quando TODOS os tipos marcados estiverem prontos e identificados para o mesmo título.",
            text_color="#94a3b8",
            font=ctk.CTkFont(size=11),
        ).grid(row=12, column=0, sticky="w", padx=10, pady=(2, 8))

        since_row = ctk.CTkFrame(frame, fg_color="transparent")
        since_row.grid(row=13, column=0, padx=10, pady=(0, 4), sticky="ew")
        ctk.CTkLabel(since_row, text="Só envia documentos gerados/atualizados a partir de (AAAA-MM-DD)").grid(
            row=0, column=0, sticky="w"
        )
        self.auto_send_since_entry = ctk.CTkEntry(since_row, width=110, placeholder_text="AAAA-MM-DD")
        self.auto_send_since_entry.grid(row=0, column=1, sticky="e", padx=(8, 4))
        ctk.CTkButton(since_row, text="Hoje", width=60, command=self._set_auto_send_since_today).grid(
            row=0, column=2, sticky="e"
        )
        ctk.CTkLabel(
            frame,
            text="Documentos arquivados antes dessa data nunca são enviados automaticamente, mesmo que "
            "batam com um título em aberto - protege o histórico antigo de ser disparado de uma vez. "
            "Em branco, o agente grava a data de hoje sozinho na primeira vez que rodar com o envio "
            "automático ativado, e reusa esse valor daqui pra frente.",
            text_color="#94a3b8",
            font=ctk.CTkFont(size=11),
            justify="left",
            wraplength=760,
        ).grid(row=14, column=0, sticky="w", padx=10, pady=(2, 8))

        self.document_status = ctk.CTkLabel(
            frame,
            text="Nenhuma indexação realizada nesta sessão.",
            text_color="#94a3b8",
            justify="left",
            anchor="w",
            wraplength=760,
        )
        self.document_status.grid(row=15, column=0, padx=10, pady=14, sticky="ew")

    def _set_auto_send_since_today(self):
        self.auto_send_since_entry.delete(0, "end")
        self.auto_send_since_entry.insert(0, datetime.now().strftime("%Y-%m-%d"))

    def _create_logs_tab(self):
        tab = self.tabs.tab("Logs")
        self.log_textbox = ctk.CTkTextbox(tab, state="disabled", wrap="word")
        self.log_textbox.grid(row=0, column=0, padx=8, pady=8, sticky="nsew")

    def _folders(self):
        return [line.strip() for line in self.financial_folders_text.get("1.0", "end").splitlines() if line.strip()]

    def load_settings(self):
        self.token_entry.insert(0, os.getenv("CRM_SYNC_TOKEN", ""))
        self.db_path_entry.insert(0, os.getenv("FIREBIRD_DATABASE", ""))
        self.login_entry.insert(0, os.getenv("FIREBIRD_USER", "SYSDBA"))
        self.password_entry.insert(0, os.getenv("FIREBIRD_PASSWORD", ""))
        self.policy_var.set(os.getenv("BILLING_SEND_POLICY", "Somente Marcados"))
        self.interval_entry.insert(0, os.getenv("SYNC_INTERVAL_SECONDS", "300"))
        self.autostart_var.set(os.getenv("AUTOSTART_WINDOWS", "False").lower() == "true")

        raw_folders = os.getenv("FINANCIAL_DOCUMENT_FOLDERS", "")
        try:
            folders = json.loads(raw_folders) if raw_folders else []
        except (TypeError, ValueError, json.JSONDecodeError):
            folders = [item.strip() for item in raw_folders.split("|") if item.strip()]
        if isinstance(folders, list):
            self.financial_folders_text.insert("1.0", "\n".join(str(item) for item in folders))
        self.financial_scan_interval_entry.insert(0, os.getenv("FINANCIAL_DOCUMENT_SCAN_SECONDS", "600"))

        self.auto_send_enabled_var.set(os.getenv("BILLING_AUTO_SEND_ENABLED", "False").lower() == "true")
        self.auto_send_test_mode_var.set(os.getenv("BILLING_AUTO_SEND_TEST_MODE", "True").lower() == "true")
        raw_document_types = os.getenv("BILLING_AUTO_SEND_DOCUMENT_TYPES", "")
        try:
            document_types = json.loads(raw_document_types) if raw_document_types else ["invoice", "statement", "boleto"]
        except (TypeError, ValueError, json.JSONDecodeError):
            document_types = [item.strip() for item in raw_document_types.split("|") if item.strip()]
        if not isinstance(document_types, list):
            document_types = ["invoice", "statement", "boleto"]
        self.auto_send_invoice_var.set("invoice" in document_types)
        self.auto_send_statement_var.set("statement" in document_types)
        self.auto_send_boleto_var.set("boleto" in document_types)

        raw_since = os.getenv("BILLING_AUTO_SEND_SINCE", "")
        if not raw_since:
            # Sem valor explicito no .env, mostra o que o agente ja gravou
            # sozinho (billing-auto-send-since.json) para o usuario ver o
            # corte real que esta valendo sem precisar abrir o arquivo.
            try:
                since_file = ROOT / "billing-auto-send-since.json"
                if since_file.exists():
                    raw_since = json.loads(since_file.read_text(encoding="utf-8")).get("since", "")
            except Exception as exc:
                logging.warning("Nao foi possivel ler a data de corte persistida: %s", exc)
        self.auto_send_since_entry.insert(0, raw_since)

        # The index can be tens of MB after the first large scan (e.g. 15k PDFs), so
        # reading/parsing it happens off the UI thread -- otherwise reopening the
        # agent would freeze for a moment right on startup, the exact "looks stuck"
        # problem this whole area was fixed for earlier.
        threading.Thread(target=self._load_persisted_financial_index_status, daemon=True).start()

    def _load_persisted_financial_index_status(self):
        try:
            import main as agent_main

            config = agent_main.AppConfig.from_env()
            path = config.financial_document_index_file
            if not path.exists():
                return
            data = json.loads(path.read_text(encoding="utf-8"))
            entries = data.get("entries") if isinstance(data, dict) else None
            if not isinstance(entries, dict):
                return
            total = len(entries)
            last_scan = data.get("lastScan") if isinstance(data, dict) else None
            when = ""
            if last_scan:
                try:
                    when = f" em {datetime.fromisoformat(last_scan).strftime('%d/%m/%Y %H:%M')}"
                except ValueError:
                    when = f" em {last_scan}"
            message = (
                f"Última indexação salva: {total} documento(s) indexado(s){when}. "
                "Clique em 'Indexar agora' para verificar novidades."
            )
            self.after(0, lambda: self.document_status.configure(text=message, text_color="#94a3b8"))
        except Exception as exc:
            logging.warning("Nao foi possivel ler o status salvo do indice financeiro: %s", exc)

    def save_settings(self, log=True):
        if not ENV_FILE.exists():
            ENV_FILE.touch()
        settings = {
            "CRM_SYNC_TOKEN": self.token_entry.get(),
            "FIREBIRD_DATABASE": self.db_path_entry.get(),
            "FIREBIRD_USER": self.login_entry.get(),
            "FIREBIRD_PASSWORD": self.password_entry.get(),
            "BILLING_SEND_POLICY": self.policy_var.get(),
            "SYNC_INTERVAL_SECONDS": self.interval_entry.get(),
            "AUTOSTART_WINDOWS": str(self.autostart_var.get()),
            "FINANCIAL_DOCUMENT_FOLDERS": json.dumps(self._folders(), ensure_ascii=False),
            "FINANCIAL_DOCUMENT_SCAN_SECONDS": str(self._financial_scan_interval()),
            "BILLING_AUTO_SEND_ENABLED": str(self.auto_send_enabled_var.get()),
            "BILLING_AUTO_SEND_TEST_MODE": str(self.auto_send_test_mode_var.get()),
            "BILLING_AUTO_SEND_DOCUMENT_TYPES": json.dumps(self._auto_send_document_types(), ensure_ascii=False),
            "BILLING_AUTO_SEND_SINCE": self._auto_send_since(),
        }
        window_geometry = self._geometry_for_save()
        if window_geometry:
            settings["AGENT_WINDOW_GEOMETRY"] = window_geometry
        for key, value in settings.items():
            set_key(str(ENV_FILE), key, value)
        self.set_startup(self.autostart_var.get())
        if log:
            self.log_message("Configurações salvas com sucesso.")

    def test_firebird_connection(self):
        """Testa o acesso ao Firebird sem bloquear a interface do agente."""
        self.save_settings(log=False)
        self.test_connection_btn.configure(state="disabled", text="Testando...")
        self.connection_status_label.configure(text="Abrindo conexão com o banco...", text_color="#eabf32")
        threading.Thread(target=self._test_firebird_connection_worker, daemon=True).start()

    def _test_firebird_connection_worker(self):
        try:
            import main as agent_main

            config = agent_main.AppConfig.from_env()
            agent_main.validate_firebird_config(config)
            connection = agent_main.FirebirdRepository(config).connect()
            try:
                cursor = connection.cursor()
                cursor.execute("select 1 from RDB$DATABASE")
                cursor.fetchone()
            finally:
                connection.close()
            message = "Conexão com o Firebird realizada com sucesso."
            color = "#4ade80"
            logging.info(message)
        except Exception as exc:
            message = f"Falha na conexão com o Firebird: {exc}"
            color = "#f87171"
            logging.error(message)
        self.after(0, self._finish_firebird_connection_test, message, color)

    def _finish_firebird_connection_test(self, message, color):
        self.test_connection_btn.configure(state="normal", text="Testar conexão com o banco")
        self.connection_status_label.configure(text=message, text_color=color)
        self.log_message(message)

    def _financial_scan_interval(self):
        try:
            value = int(self.financial_scan_interval_entry.get().strip())
        except (TypeError, ValueError):
            return 600
        return max(60, value)

    def _auto_send_document_types(self):
        types = []
        if self.auto_send_invoice_var.get():
            types.append("invoice")
        if self.auto_send_statement_var.get():
            types.append("statement")
        if self.auto_send_boleto_var.get():
            types.append("boleto")
        return types

    def _auto_send_since(self):
        raw = self.auto_send_since_entry.get().strip()
        if not raw:
            return ""
        try:
            datetime.strptime(raw, "%Y-%m-%d")
        except ValueError:
            self.log_message(f"Data de corte do envio automatico invalida ({raw!r}) - use AAAA-MM-DD. Ignorada.")
            return ""
        return raw

    def add_financial_folder(self):
        selected = filedialog.askdirectory(title="Selecione a pasta de documentos financeiros", mustexist=True)
        if not selected:
            return
        folders = self._folders()
        if selected.casefold() not in {item.casefold() for item in folders}:
            folders.append(selected)
            self.financial_folders_text.delete("1.0", "end")
            self.financial_folders_text.insert("1.0", "\n".join(folders))
        self.document_status.configure(text=f"Pasta adicionada: {selected}", text_color="#eabf32")

    def test_financial_folders(self):
        folders = self._folders()
        if not folders:
            self.document_status.configure(text="Adicione ao menos uma pasta para testar.", text_color="#f87171")
            return
        unavailable = [folder for folder in folders if not Path(folder).is_dir()]
        if unavailable:
            self.document_status.configure(
                text="Sem acesso: " + " | ".join(unavailable),
                text_color="#f87171",
            )
        else:
            self.document_status.configure(
                text=f"Acesso confirmado em {len(folders)} pasta(s). As subpastas também serão monitoradas.",
                text_color="#4ade80",
            )

    def index_financial_folders(self):
        self.save_settings(log=False)
        self.index_btn.configure(state="disabled", text="Indexando...")
        self.document_status.configure(
            text="Lendo os PDFs. A primeira indexação pode levar alguns minutos...",
            text_color="#eabf32",
        )
        threading.Thread(target=self._index_worker, daemon=True).start()

    def _index_worker(self):
        try:
            import main as agent_main

            def on_progress(text):
                self.after(0, lambda text=text: self.document_status.configure(text=text, text_color="#eabf32"))
                self.after(0, self.log_message, text)

            config = agent_main.AppConfig.from_env()
            stats = agent_main.FirebirdRepository(config).scan_financial_documents(on_progress=on_progress)
            message = (
                f"Indexação concluída: {stats['total']} documento(s), "
                f"{stats['added']} novo(s), {stats['updated']} atualizado(s), "
                f"{stats['errors']} erro(s)."
            )
            color = "#4ade80" if not stats["errors"] else "#facc15"
            self.after(0, lambda: self.document_status.configure(text=message, text_color=color))
            self.after(0, self.log_message, message)
        except Exception as exc:
            message = f"Falha na indexação: {exc}"
            self.after(0, lambda: self.document_status.configure(text=message, text_color="#f87171"))
            self.after(0, self.log_message, message)
        finally:
            self.after(0, lambda: self.index_btn.configure(state="normal", text="Indexar agora"))

    def backfill_service_order_history(self):
        confirmed = messagebox.askyesno(
            "Sincronizar histórico completo de O.S.",
            "Isso vai baixar TODO o histórico de ordens de serviço do iLux de uma vez só "
            "(cerca de 19 mil registros) e enviar para o CRM. Pode demorar bastante e usar "
            "bastante rede/banco durante a execução. Os demais cursores (contatos, "
            "equipamentos, contratos, financeiro) não são afetados.\n\n"
            "Deseja continuar?",
        )
        if not confirmed:
            return
        self.save_settings(log=False)
        self.os_backfill_btn.configure(state="disabled", text="Sincronizando histórico...")
        self.log_message("Iniciando sincronização do histórico completo de O.S...")
        threading.Thread(target=self._service_order_backfill_worker, daemon=True).start()

    def _service_order_backfill_worker(self):
        try:
            import main as agent_main

            config = agent_main.AppConfig.from_env()
            result = agent_main.run_service_order_history_backfill(config)
            message = (
                f"Histórico completo de O.S. sincronizado com sucesso "
                f"(cursor final: {result.get('finalCursor')})."
                if result.get("ok")
                else "Sincronização do histórico completo de O.S. foi interrompida antes de terminar."
            )
            self.after(0, self.log_message, message)
        except Exception as exc:
            self.after(0, self.log_message, f"Falha ao sincronizar histórico completo de O.S.: {exc}")
        finally:
            self.after(
                0,
                lambda: self.os_backfill_btn.configure(
                    state="normal", text="Sincronizar histórico completo de O.S."
                ),
            )

    def set_startup(self, enable):
        startup_path = os.path.join(os.environ["APPDATA"], r"Microsoft\Windows\Start Menu\Programs\Startup")
        bat_path = os.path.join(startup_path, "AgenteCRM.bat")
        if enable:
            exe_path = os.path.abspath(sys.executable) if getattr(sys, "frozen", False) else os.path.abspath(__file__)
            try:
                with open(bat_path, "w", encoding="utf-8") as stream:
                    stream.write(f'@echo off\nstart "" "{exe_path}" --minimized\n')
            except Exception as exc:
                self.log_message(f"Erro ao configurar inicialização: {exc}")
        elif os.path.exists(bat_path):
            try:
                os.remove(bat_path)
            except OSError:
                pass

    def hide_window(self, icon=None, item=None):
        self.save_settings(log=False)
        self.withdraw()
        if self.tray_icon:
            return
        menu = pystray.Menu(
            pystray.MenuItem("Mostrar agente", self.show_window),
            pystray.MenuItem("Sair", self.quit_window),
        )
        self.tray_icon = pystray.Icon("AgenteCRM", create_tray_image(), "Agente iLux CRM", menu)
        threading.Thread(target=self.tray_icon.run, daemon=True).start()

    def show_window(self, icon=None, item=None):
        if icon:
            icon.stop()
        self.tray_icon = None
        def restore():
            self.deiconify()
            self.state("normal")
            self.lift()
            self.focus_force()

        self.after(0, restore)

    def quit_window(self, icon=None, item=None):
        if icon:
            icon.stop()
        self.is_running = False
        if self.command_stop_event:
            self.command_stop_event.set()
        self.after(0, self.destroy)

    def log_message(self, message):
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        self.log_message_raw(f"[{timestamp}] {message}")

    def log_message_raw(self, message):
        self.log_textbox.configure(state="normal")
        self.log_textbox.insert("end", f"{message}\n")
        self.log_textbox.see("end")
        self.log_textbox.configure(state="disabled")

    def toggle_agent(self):
        if not self.is_running:
            self.save_settings()
            self.is_running = True
            self.status_label.configure(text="● Em execução", text_color="#4ade80")
            self.action_btn.configure(text="■ Parar agente", fg_color="#b91c1c", hover_color="#991b1b")
            self.log_message("Agente iniciado.")
            self.agent_thread = threading.Thread(target=self.run_agent_loop, daemon=True)
            self.agent_thread.start()
        else:
            self.is_running = False
            if self.command_stop_event:
                self.command_stop_event.set()
            self.status_label.configure(text="● Parando...", text_color="#facc15")
            self.log_message("Sinal de parada enviado.")

    def run_agent_loop(self):
        import main as agent_main

        class TextBoxLogHandler(logging.Handler):
            def __init__(self, gui):
                super().__init__()
                self.gui = gui
                self.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S"))

            def emit(self, record):
                self.gui.after(0, self.gui.log_message_raw, self.format(record))

        config = agent_main.AppConfig.from_env()
        try:
            # configure_logging() sets up the same rotating file (logs/client.log)
            # the CLI entrypoint uses. Without this, the Logs tab only ever showed
            # the current session -- closing the agent lost everything, which
            # makes validating the auto-send test mode over a few days impossible.
            agent_main.configure_logging(config)
        except Exception:
            logging.exception("Falha ao configurar o log em arquivo do agente.")

        logger = logging.getLogger()
        logger.setLevel(logging.INFO)
        handler = TextBoxLogHandler(self)
        logger.addHandler(handler)
        try:
            state = agent_main.StateStore(config.state_file)
            self.command_stop_event = threading.Event()
            threading.Thread(
                target=agent_main.run_command_listener,
                args=(config, self.command_stop_event),
                name="firebird-command-listener",
                daemon=True,
            ).start()
            threading.Thread(
                target=agent_main.run_financial_document_monitor,
                args=(config, self.command_stop_event),
                name="financial-document-monitor",
                daemon=True,
            ).start()
            while self.is_running:
                try:
                    agent_main.run_cycle(config, state, stop_event=self.command_stop_event)
                except Exception as exc:
                    logging.exception("Erro no ciclo de sincronização: %s", exc)
                for _ in range(max(30, config.sync_interval_seconds)):
                    if not self.is_running:
                        break
                    time.sleep(1)
        except Exception:
            logging.exception("O agente encontrou um erro fatal.")
        finally:
            if self.command_stop_event:
                self.command_stop_event.set()
            self.is_running = False
            self.after(0, lambda: self.status_label.configure(text="● Parado", text_color="#94a3b8"))
            self.after(
                0,
                lambda: self.action_btn.configure(
                    text="▶ Iniciar agente", fg_color="#15803d", hover_color="#166534"
                ),
            )
            logger.removeHandler(handler)


if __name__ == "__main__":
    app = AgentGUI()
    if "--minimized" in sys.argv:
        app.hide_window()
        app.toggle_agent()
    app.mainloop()

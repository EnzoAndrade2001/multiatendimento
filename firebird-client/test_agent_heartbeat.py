import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import main as agent_main
from main import (
    AGENT_CAPABILITIES,
    DEFAULT_AGENT_VERSION,
    DEFAULT_CRM_BASE_URL,
    AppConfig,
    CRMClient,
    StateStore,
    ensure_agent_install_id,
    normalize_crm_base_url,
)


class RecordingSession:
    def __init__(self):
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))


class AuthFailureSession:
    def get(self, url, **kwargs):
        response = type(
            "Response",
            (),
            {"status_code": 401, "headers": {"Retry-After": "17"}, "text": "token inválido"},
        )()
        error = agent_main.requests.HTTPError("401 Client Error", response=response)
        raise error


class AgentHeartbeatTest(unittest.TestCase):
    def test_default_version_matches_current_release(self):
        self.assertEqual(DEFAULT_AGENT_VERSION, "1.3.0")

    def test_crm_base_url_is_normalized_for_old_env_files(self):
        with patch.dict(
            os.environ,
            {"CRM_BASE_URL": "api-crm.lcddigital.com.br/"},
            clear=False,
        ):
            config = AppConfig.from_env()

        self.assertEqual(config.crm_base_url, "https://api-crm.lcddigital.com.br")

    def test_version_and_protocol_are_configurable_from_environment(self):
        with patch.dict(
            os.environ,
            {"AGENT_VERSION": "2.3.4", "AGENT_PROTOCOL_VERSION": "7"},
            clear=False,
        ):
            config = AppConfig.from_env()

        self.assertEqual(config.agent_version, "2.3.4")
        self.assertEqual(config.agent_protocol_version, "7")

    def test_crm_url_gets_https_scheme_when_domain_only(self):
        self.assertEqual(
            normalize_crm_base_url("api-crm.lcddigital.com.br/"),
            "https://api-crm.lcddigital.com.br",
        )
        self.assertEqual(normalize_crm_base_url(""), DEFAULT_CRM_BASE_URL)

    def test_ping_keeps_tenant_slug_and_adds_agent_metadata(self):
        config = AppConfig(
            agent_version="2.3.4",
            agent_protocol_version="7",
            crm_base_url="https://crm.example.test",
            crm_tenant_slug="empresa-teste",
        )
        client = CRMClient(config)
        session = RecordingSession()
        client.session = session

        client.send_ping()

        self.assertEqual(len(session.calls), 1)
        url, request = session.calls[0]
        self.assertEqual(url, "https://crm.example.test/api/integrations/firebird/ping")
        self.assertEqual(request["timeout"], 10)
        payload = request["json"]
        self.assertEqual(payload["tenantSlug"], "empresa-teste")
        self.assertEqual(payload["version"], "2.3.4")
        self.assertEqual(payload["protocolVersion"], "7")
        self.assertEqual(payload["capabilities"], list(AGENT_CAPABILITIES))
        self.assertEqual(payload["health"]["status"], "online")
        self.assertEqual(payload["health"]["processId"], os.getpid())
        self.assertIn(payload["health"]["runtime"], {"python", "executable"})
        self.assertTrue(payload["health"]["reportedAt"])

    def test_client_identifies_installation_in_request_headers(self):
        config = AppConfig(
            agent_version="1.1.6",
            agent_protocol_version="1",
            agent_install_id="install-123",
            crm_base_url="https://crm.example.test",
            crm_sync_token="sync-token",
        )
        client = CRMClient(config)

        self.assertEqual(client.session.headers["x-ilux-agent-version"], "1.1.6")
        self.assertEqual(client.session.headers["x-ilux-agent-protocol"], "1")
        self.assertEqual(client.session.headers["x-ilux-agent-id"], "install-123")

    def test_pending_commands_returns_auth_failure_for_listener_backoff(self):
        config = AppConfig(
            crm_base_url="https://crm.example.test",
            crm_sync_token="sync-token",
        )
        client = CRMClient(config)
        client.session = AuthFailureSession()

        result = client.process_pending_commands(None, None, wait_seconds=25)

        self.assertFalse(result["ok"])
        self.assertTrue(result["auth_error"])
        self.assertEqual(result["status_code"], 401)
        self.assertEqual(result["retry_after"], 17)


class StateStoreAtomicSaveTest(unittest.TestCase):
    def test_save_replaces_file_and_leaves_no_temporary_file(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            state_path = Path(temporary_directory) / "state.json"
            state = StateStore(state_path)
            state.set_cursor("contacts", 42)

            state.save()

            self.assertEqual(StateStore(state_path).get_cursor("contacts"), 42)
            self.assertEqual(list(state_path.parent.glob(".state.json.*.tmp")), [])

    def test_failed_replace_preserves_previous_state_and_removes_temporary_file(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            state_path = Path(temporary_directory) / "state.json"
            state_path.write_text('{"cursors": {"contacts": 9}}', encoding="utf-8")
            state = StateStore(state_path)
            state.set_cursor("contacts", 10)

            with patch.object(agent_main, "replace_with_retry", side_effect=OSError("falha simulada")):
                with self.assertRaises(OSError):
                    state.save()

            self.assertEqual(StateStore(state_path).get_cursor("contacts"), 9)
            self.assertEqual(list(state_path.parent.glob(".state.json.*.tmp")), [])

    def test_install_id_is_stable_and_persisted(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            state_path = Path(temporary_directory) / "state.json"
            config = AppConfig()
            first = StateStore(state_path)
            install_id = ensure_agent_install_id(config, first)

            second = StateStore(state_path)
            second_id = ensure_agent_install_id(AppConfig(), second)

            self.assertEqual(len(install_id), 32)
            self.assertEqual(install_id, second_id)


if __name__ == "__main__":
    unittest.main()

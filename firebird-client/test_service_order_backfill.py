import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from main import (
    AppConfig,
    CRMClient,
    FirebirdRepository,
    StateStore,
    parse_firebird_timestamp_to_datetime,
    run_service_order_history_backfill,
)


def fake_service_order_row(seqos: int) -> dict:
    return {
        "seqos": seqos,
        "cdcliente": 1,
        "nmcliente": "Cliente Teste",
        "cdequipamento": None,
        "modeloe": None,
        "fabricante": None,
        "serie": None,
        "nmstatus": "Fechada",
        "status": None,
        "nmsuportet": None,
        "obsdefeitocli": None,
        "nmdefeito": None,
        "causa": None,
        "sintoma": None,
        "acao": None,
        "observacao": None,
        "obsdefeitoats": None,
        "nmostp": None,
        "dtfechamento": None,
        "dtatendimento": None,
        "dtinclusao": None,
        "endereco": None,
        "cidade": None,
        "uf": None,
        "cep": None,
        "departamento": None,
        "localinstal": None,
        "ddd": None,
        "fone": None,
        "celular": None,
    }


class RunServiceOrderHistoryBackfillTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = AppConfig(
            crm_base_url="http://mock-crm-backend.local",
            crm_tenant_slug="master",
            crm_sync_token="test_token_123",
            batch_size=2,
            state_file=self.root / "state.json",
        )

        # Seeds a pre-existing state as if the agent had already been running for a
        # while: serviceOrders is far ahead (simulating the "only last 250" bootstrap),
        # and the other entities have their own independent progress that must survive
        # the backfill untouched.
        state = StateStore(self.config.state_file)
        state.set_cursor("serviceOrders", 91_293)
        state.set_cursor("contacts", 555)
        state.set_cursor("equipments", 666)
        state.set_cursor("contracts", 777)
        state.set_cursor("receivables", 888)
        state.save()

    def tearDown(self):
        self.temporary.cleanup()

    def test_resets_only_service_orders_cursor_before_syncing(self):
        seen_cursors = []

        def fake_fetch(self_repo, cursor, limit=None):
            seen_cursors.append(cursor)
            for seqos in (10, 11, 12):
                yield fake_service_order_row(seqos)

        with patch.object(FirebirdRepository, "fetch_service_orders", fake_fetch), \
             patch.object(CRMClient, "push", return_value={"ok": True}) as push:
            result = run_service_order_history_backfill(self.config)

        # fetch_service_orders must have been called with cursor 0 -- i.e. the
        # serviceOrders cursor was reset before sync_entity paginated through it.
        self.assertEqual(seen_cursors, [0])
        self.assertTrue(result["ok"])
        push.assert_called()

    def test_final_cursor_reflects_highest_seqos_processed_not_zero(self):
        def fake_fetch(self_repo, cursor, limit=None):
            for seqos in (10, 11, 12):
                yield fake_service_order_row(seqos)

        with patch.object(FirebirdRepository, "fetch_service_orders", fake_fetch), \
             patch.object(CRMClient, "push", return_value={"ok": True}):
            result = run_service_order_history_backfill(self.config)

        self.assertEqual(result["finalCursor"], 12)

        reloaded = StateStore(self.config.state_file)
        self.assertEqual(reloaded.get_cursor("serviceOrders"), 12)

    def test_other_cursors_are_left_untouched(self):
        def fake_fetch(self_repo, cursor, limit=None):
            for seqos in (10, 11, 12):
                yield fake_service_order_row(seqos)

        with patch.object(FirebirdRepository, "fetch_service_orders", fake_fetch), \
             patch.object(CRMClient, "push", return_value={"ok": True}):
            run_service_order_history_backfill(self.config)

        reloaded = StateStore(self.config.state_file)
        self.assertEqual(reloaded.get_cursor("contacts"), 555)
        self.assertEqual(reloaded.get_cursor("equipments"), 666)
        self.assertEqual(reloaded.get_cursor("contracts"), 777)
        self.assertEqual(reloaded.get_cursor("receivables"), 888)

    def test_records_pushed_to_crm_include_all_fetched_rows(self):
        def fake_fetch(self_repo, cursor, limit=None):
            for seqos in (10, 11, 12):
                yield fake_service_order_row(seqos)

        pushed_calls = []

        def fake_push(entity, records):
            # sync_entity clears/reuses its batch list right after pushing, so the
            # mock must snapshot a copy now -- capturing call_args_list afterwards
            # would only see the already-cleared (empty) list.
            pushed_calls.append((entity, [dict(record) for record in records]))
            return {"ok": True}

        with patch.object(FirebirdRepository, "fetch_service_orders", fake_fetch), \
             patch.object(CRMClient, "push", side_effect=fake_push):
            run_service_order_history_backfill(self.config)

        pushed_external_ids = []
        for entity, records in pushed_calls:
            self.assertEqual(entity, "serviceOrders")
            pushed_external_ids.extend(record["externalId"] for record in records)
        self.assertEqual(pushed_external_ids, ["10", "11", "12"])

    def test_cursor_restored_if_nothing_was_processed_before_a_failure(self):
        def failing_fetch(self_repo, cursor, limit=None):
            raise RuntimeError("boom")
            yield  # pragma: no cover -- makes this a generator function

        with patch.object(FirebirdRepository, "fetch_service_orders", failing_fetch):
            with self.assertRaises(RuntimeError):
                run_service_order_history_backfill(self.config)

        # sync_entity never got past the first row, so the pre-existing cursor
        # (simulating a healthy prior install) must be restored, not left at 0.
        reloaded = StateStore(self.config.state_file)
        self.assertEqual(reloaded.get_cursor("serviceOrders"), 91_293)


class FirebirdTimestampCursorTest(unittest.TestCase):
    def test_accepts_persisted_iso_cursor(self):
        self.assertEqual(
            parse_firebird_timestamp_to_datetime("2026-09-02T15:45:12"),
            datetime(2026, 9, 2, 15, 45, 12),
        )

    def test_accepts_firebird_timestamp(self):
        self.assertEqual(
            parse_firebird_timestamp_to_datetime("02/09/2026 15:45:12"),
            datetime(2026, 9, 2, 15, 45, 12),
        )


if __name__ == "__main__":
    unittest.main()

import threading
import time
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import main


class FakeRepo:
    def fetch_service_orders(self, _cursor, limit=None):
        return iter(())

    def fetch_service_orders_changed_by_attendance(self, cursor, _limit):
        return [], cursor


class FakeCrm:
    def push(self, _entity, _records):
        raise AssertionError("nao deveria enviar lote vazio")


class FakeState:
    def __init__(self):
        self.data = {"cursors": {"serviceOrders": 10, "serviceOrderAttendances": 20}}

    def get_cursor(self, name):
        return self.data["cursors"].get(name, 0)

    def set_cursor(self, name, value):
        self.data["cursors"][name] = value

    def set_last_sync_at(self, value):
        self.data["lastSyncAt"] = value

    def save(self):
        return None


class ServiceOrderSyncLockTests(unittest.TestCase):
    def test_incremental_sync_waits_for_create_os_critical_section(self):
        finished = threading.Event()

        def run_sync():
            main.sync_service_orders_incremental(FakeRepo(), FakeCrm(), FakeState(), 100)
            finished.set()

        main.SERVICE_ORDER_SYNC_LOCK.acquire()
        try:
            worker = threading.Thread(target=run_sync)
            worker.start()
            time.sleep(0.05)
            self.assertFalse(finished.is_set())
        finally:
            main.SERVICE_ORDER_SYNC_LOCK.release()

        worker.join(timeout=1)
        self.assertTrue(finished.is_set())


if __name__ == "__main__":
    unittest.main()

import unittest

from main import AppConfig, FirebirdRepository


class FakeCursor:
    def __init__(self, *, official: bool, os_type=(1, "2")):
        self.official = official
        self.os_type = os_type
        self._row = None
        self.insert_sql = ""
        self.insert_params = ()

    def execute(self, sql, params=()):
        normalized = " ".join(sql.upper().split())
        if normalized.startswith("INSERT INTO IXLOS"):
            self.insert_sql = normalized
            self.insert_params = params
        elif "RDB$RELATION_FIELDS" in normalized:
            self._row = (1 if self.official else 0,)
        elif "FROM IXLOSSTATUS" in normalized:
            self._row = (1 if self.official else 0,)
        elif "FROM IXLOSDEFEITOTP" in normalized:
            self._row = (1 if self.official else 0,)
        elif "FROM IXLOSTP" in normalized:
            self._row = self.os_type
        elif "MAX(SEQOS)" in normalized:
            self._row = (1234,)
        else:
            raise AssertionError(f"Consulta inesperada: {normalized}")

    def fetchone(self):
        return self._row


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.committed = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed = True

    def rollback(self):
        pass

    def close(self):
        pass


class ServiceOrderCompatibilityTest(unittest.TestCase):
    def create(self, official):
        cursor = FakeCursor(official=official)
        connection = FakeConnection(cursor)
        repo = FirebirdRepository(AppConfig())
        repo.connect = lambda: connection
        seq = repo.create_service_order({
            "cdCliente": "101",
            "cdEquipamento": "202",
            "cdOstp": "01",
            "defect": "Teste",
            "nmsuportet": "TECNICO",
            "attendantName": "ATENDENTE",
        })
        return seq, cursor, connection

    def test_legacy_schema_keeps_legacy_codes_and_omits_new_column(self):
        seq, cursor, connection = self.create(False)
        self.assertEqual(seq, 1234)
        self.assertTrue(connection.committed)
        self.assertNotIn("TPORCATEND1", cursor.insert_sql)
        self.assertEqual(cursor.insert_params[7], "E")
        self.assertEqual(cursor.insert_params[8], "E1")
        self.assertEqual(cursor.insert_params[-5:-1], ("2", 1, "S", "MAN"))

    def test_official_schema_uses_official_codes_and_new_column(self):
        seq, cursor, connection = self.create(True)
        self.assertEqual(seq, 1234)
        self.assertTrue(connection.committed)
        self.assertIn("TPORCATEND1", cursor.insert_sql)
        self.assertIn("'A', ?", cursor.insert_sql)
        self.assertEqual(cursor.insert_params[7], "A")
        self.assertEqual(cursor.insert_params[8], "O")
        self.assertEqual(cursor.insert_params[-5:-1], ("2", 1, "N", "1001"))


if __name__ == "__main__":
    unittest.main()

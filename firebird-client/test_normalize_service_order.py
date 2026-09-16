import unittest

from main import normalize_service_order


class NormalizeServiceOrderTest(unittest.TestCase):
    def test_preserva_codigo_detalhado_do_status(self):
        result = normalize_service_order({
            "seqos": 1877,
            "cdcliente": 101,
            "cdequipamento": 202,
            "status": "A",
            "cdstatus": "0",
            "nmstatus": "(Nenhum)",
        })
        self.assertEqual(result["statusCode"], "0")
        self.assertEqual(result["cdStatus"], "0")
        self.assertEqual(result["status"], "(Nenhum)")


if __name__ == "__main__":
    unittest.main()

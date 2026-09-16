import unittest

from main import normalize_equipment


def _record(**overrides):
    base = {
        "cdequipamento": 1543,
        "cdcliente": 403,
        "modelo": "XEROX AL8045",
        "fabricante": "XEROX",
        "serie": "8TB572522",
        "seqcontrato": 330,
        "tfinativo": "N",
        "contrato_instal_ativa": 1,
        "contrato_instal_total": 1,
    }
    base.update(overrides)
    return base


class NormalizeEquipmentContractLinkTest(unittest.TestCase):
    def test_maquina_instalada_no_contrato_fica_vinculada_e_ativa(self):
        result = normalize_equipment(_record(contrato_instal_ativa=1, contrato_instal_total=1))
        self.assertEqual(result["contractExternalId"], "330")
        self.assertFalse(result["inactive"])

    def test_maquina_trocada_perde_o_vinculo_e_fica_inativa(self):
        # Caso KAEFER/1543: saiu do contrato (DTINSTALACAOFIN no passado), mas
        # IXLEQUIPAMENTO.SEQCONTRATO e TFINATIVO continuam iguais.
        result = normalize_equipment(_record(contrato_instal_ativa=0, contrato_instal_total=2))
        self.assertIsNone(result["contractExternalId"])
        self.assertTrue(result["inactive"])

    def test_maquina_sem_contrato_permanece_ativa(self):
        result = normalize_equipment(_record(seqcontrato=None, contrato_instal_ativa=0, contrato_instal_total=0))
        self.assertIsNone(result["contractExternalId"])
        self.assertFalse(result["inactive"])

    def test_tfinativo_s_ainda_marca_inativo(self):
        result = normalize_equipment(_record(tfinativo="S", contrato_instal_ativa=1, contrato_instal_total=1))
        self.assertTrue(result["inactive"])

    def test_contrato_sem_itens_mantem_vinculo_cru_por_seguranca(self):
        result = normalize_equipment(_record(contrato_instal_ativa=0, contrato_instal_total=0))
        self.assertEqual(result["contractExternalId"], "330")
        self.assertFalse(result["inactive"])

    def test_proprietario_cliente_e_normalizado(self):
        self.assertEqual(normalize_equipment(_record(proprietario="C"))["ownerType"], "CLIENTE")

    def test_proprietario_empresa_e_normalizado(self):
        self.assertEqual(normalize_equipment(_record(proprietario="E"))["ownerType"], "EMPRESA")

    def test_alias_tfproprietario_e_aceito(self):
        self.assertEqual(normalize_equipment(_record(tfproprietario="C"))["ownerType"], "CLIENTE")


if __name__ == "__main__":
    unittest.main()

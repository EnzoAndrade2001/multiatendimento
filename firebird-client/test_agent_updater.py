import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main


class AgentUpdaterTest(unittest.TestCase):
    def _job(self, folder: Path, staged_bytes: bytes):
        target = folder / "FirebirdCRMClient.exe"
        staged = folder / "new.download"
        backup = folder / "FirebirdCRMClient.backup.exe"
        job = folder / "job.json"
        target.write_bytes(b"old-agent")
        staged.write_bytes(staged_bytes)
        job.write_text(json.dumps({
            "target": str(target), "staged": str(staged), "backup": str(backup),
            "sha256": hashlib.sha256(staged_bytes).hexdigest(), "actionId": "action-1",
            "parentPid": 123, "version": "1.2.0",
        }), encoding="utf-8")
        return target, backup, job

    def test_replaces_binary_and_keeps_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            target, backup, job = self._job(Path(temp), b"new-agent")
            with patch.object(main, "_wait_for_process_exit"), patch.object(main.requests, "post"), patch.object(main.subprocess, "Popen"):
                self.assertEqual(main.apply_update_job(job), 0)
            self.assertEqual(target.read_bytes(), b"new-agent")
            self.assertEqual(backup.read_bytes(), b"old-agent")

    def test_rejects_package_with_wrong_checksum(self):
        with tempfile.TemporaryDirectory() as temp:
            target, backup, job = self._job(Path(temp), b"tampered")
            data = json.loads(job.read_text(encoding="utf-8"))
            data["sha256"] = "0" * 64
            job.write_text(json.dumps(data), encoding="utf-8")
            with patch.object(main, "_wait_for_process_exit"), patch.object(main.requests, "post"), patch.object(main.subprocess, "Popen"):
                self.assertEqual(main.apply_update_job(job), 1)
            self.assertEqual(target.read_bytes(), b"old-agent")
            self.assertFalse(backup.exists())


if __name__ == "__main__":
    unittest.main()

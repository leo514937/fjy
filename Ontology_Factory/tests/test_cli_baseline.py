from __future__ import annotations

import json
import sys
import tempfile
import unittest

from tools.cli_baseline import run_cli, smoke_clis


class CliBaselineTests(unittest.TestCase):
    def test_xiaogugit_runs_with_shared_baseline(self) -> None:
        with tempfile.TemporaryDirectory(prefix="cli-baseline-test-xg-") as temp_dir:
            result = run_cli("xiaogugit", ["--root-dir", temp_dir, "project", "list"])

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"projects": []})

    def test_wikimg_smoke_matches_python_baseline(self) -> None:
        result = smoke_clis(["wikimg"])[0]
        expected_status = "skipped" if sys.version_info[:2] < (3, 10) else "passed"

        self.assertEqual(result["status"], expected_status)

    def test_ner_smoke_matches_python_baseline(self) -> None:
        result = smoke_clis(["ner"])[0]
        expected_status = "skipped" if sys.version_info[:2] < (3, 10) else "passed"

        self.assertEqual(result["status"], expected_status)

    def test_aft_smoke_is_skipped_when_python_is_too_old(self) -> None:
        results = smoke_clis(["aft-review", "aft-qa"])
        expected_status = "skipped" if sys.version_info[:2] < (3, 11) else "passed"

        self.assertEqual([result["status"] for result in results], [expected_status, expected_status])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import os
import json
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PYTHONPATH = [str(ROOT / "src")]
if os.environ.get("PYTHONPATH"):
    PYTHONPATH.append(os.environ["PYTHONPATH"])
ENV = os.environ | {"PYTHONPATH": os.pathsep.join(PYTHONPATH)}


def run_cli(*args: str, cwd: Path, extra_env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    env = dict(ENV)
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, "-m", "wikimg", *args],
        cwd=cwd,
        env=env,
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=False,
    )


def create_minimal_kimi_workspace(workspace: Path) -> None:
    result = run_cli("init", cwd=workspace)
    if result.returncode != 0:
        raise AssertionError(result.stderr)

    system_doc = workspace / "wiki" / "domain" / "kimi-demo" / "system.md"
    system_doc.parent.mkdir(parents=True, exist_ok=True)
    system_doc.write_text(
        """---
{
  "profile": "kimi",
  "page_kind": "entity",
  "title": "系统概览",
  "type": "系统概念",
  "domain": "智能养鱼",
  "level": 1,
  "source": "unit-test",
  "properties": {
    "目标": "验证 export"
  },
  "relations": []
}
---
# 系统概览

> 系统级入口页面。

## 定义与定位
用于验证 WiKiMG 的结构化导出。

## 属性
- 目标: 验证 export

## 证据来源
- 单元测试自建样例。
""",
        encoding="utf-8",
    )


def run_git(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )


@contextmanager
def fake_ontogit_gateway() -> dict[str, object]:
    state: dict[str, object] = {
        "writes": [],
        "deletes": [],
        "versions": {},
        "api_keys": [],
    }

    class Handler(BaseHTTPRequestHandler):
        server_version = "FakeOntoGit/1.0"

        def log_message(self, format: str, *args: object) -> None:
            return

        def _read_json(self) -> dict[str, object]:
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            return json.loads(raw)

        def _write_json(self, status_code: int, payload: dict[str, object]) -> None:
            rendered = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(rendered)))
            self.end_headers()
            self.wfile.write(rendered)

        def do_POST(self) -> None:
            state["api_keys"].append(self.headers.get("X-API-Key", ""))
            if self.path == "/xg/write":
                payload = self._read_json()
                state["writes"].append(payload)
                key = (str(payload["project_id"]), str(payload["filename"]))
                versions = state["versions"].setdefault(key, [])
                next_version = len(versions) + 1
                versions.append(
                    {
                        "version_id": next_version,
                        "data": payload["data"],
                        "basevision": payload["basevision"],
                    }
                )
                self._write_json(
                    200,
                    {
                        "status": "success",
                        "version_id": next_version,
                        "currvision": next_version,
                        "basevision": payload["basevision"],
                        "commit_id": f"commit-{next_version}",
                    },
                )
                return
            if self.path == "/xg/delete":
                payload = self._read_json()
                state.setdefault("deletes", []).append(payload)
                key = (str(payload["project_id"]), str(payload["filename"]))
                versions = state["versions"].setdefault(key, [])
                next_version = len(versions) + 1
                versions.append(
                    {
                        "version_id": next_version,
                        "data": None,
                        "basevision": len(versions),
                    }
                )
                self._write_json(
                    200,
                    {
                        "status": "success",
                        "version_id": next_version,
                        "currvision": next_version,
                        "basevision": payload.get("basevision", len(versions) - 1),
                        "commit_id": f"delete-{next_version}",
                    },
                )
                return
            self._write_json(404, {"detail": "not found"})

        def do_GET(self) -> None:
            state["api_keys"].append(self.headers.get("X-API-Key", ""))
            if self.path.startswith("/xg/timelines/"):
                project_id = urllib.parse.unquote(self.path[len("/xg/timelines/"):])
                filenames = sorted(
                    {
                        filename
                        for stored_project_id, filename in state["versions"].keys()
                        if stored_project_id == project_id
                    }
                )
                timelines = []
                for filename in filenames:
                    versions = state["versions"].get((project_id, filename), [])
                    timelines.append(
                        {
                            "filename": filename,
                            "version_count": len(versions),
                            "latest_version_id": versions[-1]["version_id"] if versions else 0,
                            "history": versions,
                        }
                    )
                self._write_json(200, {"timelines": timelines})
                return
            if self.path.startswith("/xg/read/"):
                tail = self.path[len("/xg/read/"):]
                project_id, _, filename = tail.partition("/")
                project_id = urllib.parse.unquote(project_id)
                filename = urllib.parse.unquote(filename)
                versions = state["versions"].get((project_id, filename), [])
                if not versions:
                    self._write_json(404, {"detail": "not found"})
                    return
                self._write_json(200, {"data": versions[-1]["data"]})
                return
            self._write_json(404, {"detail": "not found"})

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    state["gateway_url"] = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        yield state
    finally:
        httpd.shutdown()
        thread.join(timeout=5)
        httpd.server_close()


class WikiCliTests(unittest.TestCase):
    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_full_document_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)

            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((workspace / ".wikimg" / "config.json").exists())
            self.assertTrue((workspace / "wiki" / "common").exists())
            self.assertTrue((workspace / "wiki" / "domain").exists())
            self.assertTrue((workspace / "wiki" / "private").exists())

            result = run_cli("new", "common", "Getting Started", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stdout)
            document_path = workspace / "wiki" / "common" / "getting-started.md"
            self.assertTrue(document_path.exists())

            result = run_cli("list", cwd=workspace)
            self.assertEqual(result.returncode, 0)
            self.assertIn("common:getting-started", result.stdout)

            result = run_cli("show", "common:getting-started", cwd=workspace)
            self.assertEqual(result.returncode, 0)
            self.assertIn("# Getting Started", result.stdout)

            result = run_cli(
                "rename",
                "common:getting-started",
                "Architecture Notes",
                cwd=workspace,
            )
            self.assertEqual(result.returncode, 0)
            renamed_path = workspace / "wiki" / "common" / "architecture-notes.md"
            self.assertTrue(renamed_path.exists())
            self.assertIn("# Architecture Notes", renamed_path.read_text(encoding="utf-8"))

            result = run_cli("move", "common:architecture-notes", "private", cwd=workspace)
            self.assertEqual(result.returncode, 0)
            moved_path = workspace / "wiki" / "private" / "architecture-notes.md"
            self.assertTrue(moved_path.exists())

            moved_path.write_text(
                "# Architecture Notes\n\nThis is a private note.\n",
                encoding="utf-8",
            )
            result = run_cli("search", "private note", "--content", cwd=workspace)
            self.assertEqual(result.returncode, 0)
            self.assertIn("private:architecture-notes", result.stdout)

            result = run_cli("doctor", cwd=workspace)
            self.assertEqual(result.returncode, 0)
            self.assertIn("Workspace looks healthy.", result.stdout)

            result = run_cli("delete", "private:architecture-notes", "--yes", cwd=workspace)
            self.assertEqual(result.returncode, 0)
            self.assertFalse(moved_path.exists())

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_show_json_and_export_profile_for_kimi(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)

            system_doc = workspace / "wiki" / "domain" / "kimi-demo" / "system.md"
            system_doc.parent.mkdir(parents=True, exist_ok=True)
            system_doc.write_text(
                """---
{
  "profile": "kimi",
  "page_kind": "system",
  "title": "系统概览",
  "type": "系统概念",
  "domain": "智能养鱼",
  "level": 1,
  "source": "unit-test",
  "properties": {
    "目标": "验证 export"
  },
  "relations": [
    {
      "target": "domain:kimi-demo/lighting",
      "type": "包含",
      "description": "系统包含监测主题"
    }
  ]
}
---
# 系统概览

> 系统级入口页面。

## 定义与定位
用于验证 WiKiMG 的结构化导出。

## 属性
- 目标: 验证 export

## 证据来源
- 单元测试自建样例。

## 关联主题
- [光照监测](./lighting.md)
""",
                encoding="utf-8",
            )

            lighting_doc = workspace / "wiki" / "domain" / "kimi-demo" / "lighting.md"
            lighting_doc.write_text(
                """---
{
  "profile": "kimi",
  "page_kind": "entity",
  "title": "光照监测",
  "type": "监测能力",
  "domain": "智能养鱼",
  "level": 2,
  "source": "unit-test",
  "properties": {
    "指标": ["lux"]
  },
  "relations": []
}
---
# 光照监测

> 监测鱼缸光照变化。

## 定义与定位
验证被系统页引用时能够导出为实体节点。

## 属性
- 指标: lux

## 字段模板
| 字段 | 含义 |
| --- | --- |
| `lux` | 光照强度 |

```json
{"lux": 120}
```

> [!NOTE] 联调提示
> 监测页面要和字段单位保持一致。

## 证据来源
- 单元测试自建样例。
""",
                encoding="utf-8",
            )

            common_doc = workspace / "wiki" / "common" / "kimi-demo" / "telemetry.md"
            common_doc.parent.mkdir(parents=True, exist_ok=True)
            common_doc.write_text(
                """---
{
  "profile": "kimi",
  "page_kind": "entity",
  "title": "遥测字段规范",
  "type": "共享规范",
  "domain": "平台接入",
  "level": 1,
  "source": "unit-test",
  "properties": {
    "作用": "统一字段命名"
  },
  "relations": [
    {
      "target": "domain:kimi-demo/system",
      "type": "支撑",
      "description": "为系统概览提供字段约定"
    }
  ]
}
---
# 遥测字段规范

> 共享给多个节点的字段规范。

## 定义与定位
用于验证 common 层实体也会进入 export。

## 属性
- 作用: 统一字段命名

## 证据来源
- 单元测试自建样例。
""",
                encoding="utf-8",
            )

            private_doc = workspace / "wiki" / "private" / "kimi-demo" / "notes.md"
            private_doc.parent.mkdir(parents=True, exist_ok=True)
            private_doc.write_text(
                """---
{
  "profile": "kimi",
  "page_kind": "entity",
  "title": "内部演练记录",
  "type": "实验记录",
  "domain": "远程控制",
  "level": 3,
  "source": "unit-test",
  "properties": {
    "状态": "草稿"
  },
  "relations": [
    {
      "target": "common:kimi-demo/telemetry",
      "type": "引用",
      "description": "内部记录引用共享规范"
    }
  ]
}
---
# 内部演练记录

> 用于验证 private 层实体也会导出。

## 定义与定位
用于验证 private 层实体会进入 entity_index 和 statistics。

## 属性
- 状态: 草稿

## 证据来源
- 单元测试自建样例。
""",
                encoding="utf-8",
            )

            meta_doc = workspace / "wiki" / "common" / "kimi-demo" / "about.md"
            meta_doc.write_text(
                """---
{
  "profile": "kimi",
  "page_kind": "meta",
  "meta_role": "about",
  "title": "平台说明",
  "type": "说明页",
  "domain": "平台",
  "level": 0,
  "source": "unit-test",
  "properties": {
    "说明": "不进入图谱"
  },
  "relations": []
}
---
# 平台说明

## 定义与定位
用于验证 meta 页面不会进入实体图谱。

## 证据来源
- 单元测试自建样例。
""",
                encoding="utf-8",
            )

            legacy_doc = workspace / "wiki" / "domain" / "legacy.md"
            legacy_doc.write_text("# 旧页面\n\n不会进入 kimi export。\n", encoding="utf-8")

            show_result = run_cli("show", "domain:kimi-demo/system", "--json", cwd=workspace)
            self.assertEqual(show_result.returncode, 0, show_result.stdout)
            show_payload = json.loads(show_result.stdout)
            self.assertEqual(show_payload["document"]["profile"], "kimi")
            self.assertEqual(show_payload["document"]["kimiwa"]["name"], "系统概览")
            self.assertEqual(show_payload["document"]["kimiwa"]["layer"], "domain")

            export_result = run_cli("export", "--profile", "kimi", "--json", cwd=workspace)
            self.assertEqual(export_result.returncode, 0, export_result.stdout)
            export_payload = json.loads(export_result.stdout)
            self.assertEqual(export_payload["knowledgeGraph"]["statistics"]["total_entities"], 4)
            self.assertEqual(len(export_payload["documents"]), 5)
            self.assertEqual(export_payload["knowledgeGraph"]["statistics"]["total_relations"], 3)
            self.assertEqual(
                export_payload["knowledgeGraph"]["statistics"]["layers"],
                ["common", "domain", "private"],
            )
            self.assertEqual(
                export_payload["knowledgeGraph"]["statistics"]["layer_counts"],
                {"common": 1, "domain": 2, "private": 1},
            )
            self.assertNotIn("common:kimi-demo/about", export_payload["knowledgeGraph"]["entity_index"])
            self.assertEqual(
                export_payload["knowledgeGraph"]["entity_index"]["private:kimi-demo/notes"]["layer"],
                "private",
            )
            lighting_blocks = export_payload["knowledgeGraph"]["entity_index"]["domain:kimi-demo/lighting"]["formatted_sections"]
            section_titles = [section["title"] for section in lighting_blocks]
            self.assertIn("字段模板", section_titles)
            template_section = next(section for section in lighting_blocks if section["title"] == "字段模板")
            block_types = [block["type"] for block in template_section["blocks"]]
            self.assertIn("table", block_types)
            self.assertIn("code", block_types)
            self.assertIn("callout", block_types)

            validate_result = run_cli("validate", "--profile", "kimi", "--json", cwd=workspace)
            self.assertEqual(validate_result.returncode, 0, validate_result.stdout)
            validate_payload = json.loads(validate_result.stdout)
            self.assertTrue(validate_payload["healthy"], validate_payload["issues"])

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_validate_profile_reports_bad_links(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)

            broken_doc = workspace / "wiki" / "domain" / "kimi-demo" / "broken.md"
            broken_doc.parent.mkdir(parents=True, exist_ok=True)
            broken_doc.write_text(
                """---
{
  "profile": "kimi",
  "page_kind": "entity",
  "title": "坏链接页面",
  "type": "测试页面",
  "domain": "智能养鱼",
  "level": 2,
  "source": "unit-test",
  "properties": {
    "状态": "broken"
  },
  "relations": [
    {
      "target": "domain:kimi-demo/missing-target",
      "type": "相关",
      "description": "指向一个不存在的页面"
    }
  ]
}
---
# 坏链接页面

> 这个页面故意保留错误链接。

## 定义与定位
用于验证 validate 能发现坏链接。

## 证据来源
- 单元测试自建样例。

## 关联主题
- [不存在的页面](./missing.md)
""",
                encoding="utf-8",
            )

            validate_result = run_cli("validate", "--profile", "kimi", "--json", cwd=workspace)
            self.assertEqual(validate_result.returncode, 1, validate_result.stdout)
            payload = json.loads(validate_result.stdout)
            self.assertFalse(payload["healthy"])
            codes = {issue["code"] for issue in payload["issues"]}
            self.assertIn("bad-relation-target", codes)
            self.assertIn("bad-markdown-link", codes)

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_export_json_syncs_payload_to_real_ontogit_api(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, fake_ontogit_gateway() as gateway:
            workspace = Path(temp_dir)
            create_minimal_kimi_workspace(workspace)
            extra_env = {
                "WIKIMG_ONTOGIT_GATEWAY_URL": str(gateway["gateway_url"]),
                "WIKIMG_ONTOGIT_API_KEY": "test-key",
                "WIKIMG_ONTOGIT_PROJECT_ID": "demo",
                "WIKIMG_ONTOGIT_FILENAME": "wikimg_export.json",
            }

            export_result = run_cli("export", "--profile", "kimi", "--json", cwd=workspace, extra_env=extra_env)
            self.assertEqual(export_result.returncode, 0, export_result.stdout)

            payload = json.loads(export_result.stdout)
            self.assertEqual(len(gateway["writes"]), 1)

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_sync_wiki_directory_writes_files_and_removes_deleted_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, fake_ontogit_gateway() as gateway:
            workspace = Path(temp_dir)
            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)

            doc_a = workspace / "wiki" / "common" / "alpha.md"
            doc_a.parent.mkdir(parents=True, exist_ok=True)
            doc_a.write_text("# Alpha\n\nFirst version.\n", encoding="utf-8")

            doc_b = workspace / "wiki" / "domain" / "beta.json"
            doc_b.parent.mkdir(parents=True, exist_ok=True)
            doc_b.write_text(json.dumps({"name": "beta", "value": 1}, ensure_ascii=False), encoding="utf-8")

            first_sync = run_cli(
                "sync",
                "--project-id",
                "demo",
                cwd=workspace,
                extra_env={
                    "WIKIMG_ONTOGIT_GATEWAY_URL": str(gateway["gateway_url"]),
                    "WIKIMG_ONTOGIT_API_KEY": "test-key",
                    "WIKIMG_ONTOGIT_PROJECT_ID": "demo",
                },
            )
            self.assertEqual(first_sync.returncode, 0, first_sync.stdout)
            self.assertIn("written=2", first_sync.stdout)
            self.assertEqual(len(gateway["writes"]), 2)

            doc_a.write_text("# Alpha\n\nSecond version.\n", encoding="utf-8")
            doc_b.unlink()

            second_sync = run_cli(
                "sync",
                "--project-id",
                "demo",
                cwd=workspace,
                extra_env={
                    "WIKIMG_ONTOGIT_GATEWAY_URL": str(gateway["gateway_url"]),
                    "WIKIMG_ONTOGIT_API_KEY": "test-key",
                    "WIKIMG_ONTOGIT_PROJECT_ID": "demo",
                },
            )
            self.assertEqual(second_sync.returncode, 0, second_sync.stdout)
            self.assertIn("written=1", second_sync.stdout)
            self.assertIn("deleted=1", second_sync.stdout)
            self.assertEqual(len(gateway["deletes"]), 1)
            self.assertEqual(gateway["deletes"][0]["filename"], "beta.json")
            self.assertEqual(gateway["writes"][0]["filename"], "alpha.json")
            self.assertEqual(gateway["writes"][1]["filename"], "beta.json")
            self.assertEqual(gateway["writes"][0]["project_id"], "common")
            self.assertEqual(gateway["writes"][1]["project_id"], "domain")
            self.assertEqual(gateway["writes"][0]["basevision"], 0)
            self.assertEqual(gateway["writes"][1]["basevision"], 0)
            self.assertEqual(gateway["writes"][2]["filename"], "alpha.json")
            self.assertEqual(gateway["writes"][2]["project_id"], "common")
            self.assertEqual(gateway["writes"][2]["basevision"], 1)
            self.assertEqual(gateway["writes"][0]["data"], {"content": "# Alpha\n\nFirst version.\n"})
            self.assertEqual(gateway["writes"][2]["data"], {"content": "# Alpha\n\nSecond version.\n"})
            self.assertTrue(all(item == "test-key" for item in gateway["api_keys"]))

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_fetch_wiki_directory_writes_local_md_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, fake_ontogit_gateway() as gateway:
            workspace = Path(temp_dir)
            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)

            doc = workspace / "wiki" / "common" / "alpha.md"
            doc.parent.mkdir(parents=True, exist_ok=True)
            doc.write_text("# Alpha\n\nFirst version.\n", encoding="utf-8")

            sync_result = run_cli(
                "sync",
                "--project-id",
                "demo",
                cwd=workspace,
                extra_env={
                    "WIKIMG_ONTOGIT_GATEWAY_URL": str(gateway["gateway_url"]),
                    "WIKIMG_ONTOGIT_API_KEY": "test-key",
                    "WIKIMG_ONTOGIT_PROJECT_ID": "demo",
                },
            )
            self.assertEqual(sync_result.returncode, 0, sync_result.stdout)

            doc.unlink()
            fetch_result = run_cli(
                "fetch",
                "--project-id",
                "common",
                cwd=workspace,
                extra_env={
                    "WIKIMG_ONTOGIT_GATEWAY_URL": str(gateway["gateway_url"]),
                    "WIKIMG_ONTOGIT_API_KEY": "test-key",
                    "WIKIMG_ONTOGIT_PROJECT_ID": "demo",
                },
            )
            self.assertEqual(fetch_result.returncode, 0, fetch_result.stdout)
            self.assertIn("written=1", fetch_result.stdout)
            self.assertTrue((workspace / "wiki" / "common" / "alpha.md").exists())
            self.assertEqual(
                (workspace / "wiki" / "common" / "alpha.md").read_text(encoding="utf-8"),
                "# Alpha\n\nFirst version.\n",
            )

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_sync_wiki_directory_is_idempotent_when_files_do_not_change(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, fake_ontogit_gateway() as gateway:
            workspace = Path(temp_dir)
            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)

            doc_a = workspace / "wiki" / "common" / "alpha.md"
            doc_a.parent.mkdir(parents=True, exist_ok=True)
            doc_a.write_text("# Alpha\n\nFirst version.\n", encoding="utf-8")

            first_sync = run_cli(
                "sync",
                "--project-id",
                "demo",
                cwd=workspace,
                extra_env={
                    "WIKIMG_ONTOGIT_GATEWAY_URL": str(gateway["gateway_url"]),
                    "WIKIMG_ONTOGIT_API_KEY": "test-key",
                    "WIKIMG_ONTOGIT_PROJECT_ID": "demo",
                },
            )
            self.assertEqual(first_sync.returncode, 0, first_sync.stdout)
            self.assertIn("written=1", first_sync.stdout)
            self.assertEqual(len(gateway["writes"]), 1)

            second_sync = run_cli(
                "sync",
                "--project-id",
                "demo",
                cwd=workspace,
                extra_env={
                    "WIKIMG_ONTOGIT_GATEWAY_URL": str(gateway["gateway_url"]),
                    "WIKIMG_ONTOGIT_API_KEY": "test-key",
                    "WIKIMG_ONTOGIT_PROJECT_ID": "demo",
                },
            )
            self.assertEqual(second_sync.returncode, 0, second_sync.stdout)
            self.assertIn("written=0", second_sync.stdout)
            self.assertEqual(len(gateway["writes"]), 1)

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_export_json_reads_latest_basevision_before_write(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, fake_ontogit_gateway() as gateway:
            workspace = Path(temp_dir)
            create_minimal_kimi_workspace(workspace)
            extra_env = {
                "WIKIMG_ONTOGIT_GATEWAY_URL": str(gateway["gateway_url"]),
                "WIKIMG_ONTOGIT_API_KEY": "test-key",
                "WIKIMG_ONTOGIT_PROJECT_ID": "demo",
                "WIKIMG_ONTOGIT_FILENAME": "wikimg_export.json",
            }

            first_export = run_cli("export", "--profile", "kimi", "--json", cwd=workspace, extra_env=extra_env)
            self.assertEqual(first_export.returncode, 0, first_export.stdout)

            second_export = run_cli("export", "--profile", "kimi", "--json", cwd=workspace, extra_env=extra_env)
            self.assertEqual(second_export.returncode, 0, second_export.stdout)

            self.assertEqual(len(gateway["writes"]), 2)
            self.assertEqual(gateway["writes"][0]["basevision"], 0)
            self.assertEqual(gateway["writes"][1]["basevision"], 1)
            versions = gateway["versions"][("demo", "wikimg_export.json")]
            self.assertEqual(len(versions), 2)
            self.assertEqual(versions[-1]["version_id"], 2)

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_export_json_warns_when_ontogit_sync_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            create_minimal_kimi_workspace(workspace)
            extra_env = {
                "WIKIMG_ONTOGIT_GATEWAY_URL": "http://127.0.0.1:9",
                "WIKIMG_ONTOGIT_API_KEY": "test-key",
                "WIKIMG_ONTOGIT_PROJECT_ID": "demo",
                "WIKIMG_ONTOGIT_FILENAME": "wikimg_export.json",
                "WIKIMG_ONTOGIT_TIMEOUT_SECONDS": "0.2",
            }

            export_result = run_cli("export", "--profile", "kimi", "--json", cwd=workspace, extra_env=extra_env)
            self.assertEqual(export_result.returncode, 0, export_result.stdout)
            export_payload = json.loads(export_result.stdout)
            self.assertEqual(export_payload["knowledgeGraph"]["statistics"]["total_entities"], 1)
            self.assertIn("Warning: OntoGit sync failed:", export_result.stderr)

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_export_summary_output_still_syncs_to_ontogit(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, fake_ontogit_gateway() as gateway:
            workspace = Path(temp_dir)
            create_minimal_kimi_workspace(workspace)
            extra_env = {
                "WIKIMG_ONTOGIT_GATEWAY_URL": str(gateway["gateway_url"]),
                "WIKIMG_ONTOGIT_API_KEY": "test-key",
                "WIKIMG_ONTOGIT_PROJECT_ID": "demo",
                "WIKIMG_ONTOGIT_FILENAME": "wikimg_export.json",
            }

            export_result = run_cli("export", "--profile", "kimi", cwd=workspace, extra_env=extra_env)
            self.assertEqual(export_result.returncode, 0, export_result.stdout)
            self.assertIn("Exported profile=kimi entities=1 relations=0 docs=1", export_result.stdout)
            self.assertEqual(len(gateway["writes"]), 1)

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_ingest_json_normalizes_to_standard_markdown(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)

            source_path = workspace / "ingest-input.json"
            source_path.write_text(
                json.dumps(
                    {
                        "title": "盐度监测",
                        "page_kind": "entity",
                        "type": "监测能力",
                        "domain": "智能养鱼",
                        "level": 2,
                        "source": "unit-test",
                        "summary": "用于持续跟踪水体盐度变化。",
                        "properties": {
                            "指标": ["salinity"],
                            "采样频率": "60s",
                        },
                        "relations": [
                            {
                                "target": "domain:kimi-demo/system",
                                "type": "组成部分",
                                "description": "盐度监测属于系统环境感知的一部分。",
                            }
                        ],
                        "sections": {
                            "定义与定位": "用于持续跟踪水体盐度变化，并为告警提供依据。",
                            "属性": [
                                "指标: salinity",
                                "采样频率: 60s",
                            ],
                            "证据来源": [
                                "单元测试样例。",
                            ],
                            "关联主题": [
                                "智能养鱼系统概览",
                            ],
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                ) + "\n",
                encoding="utf-8",
            )

            ingest_result = run_cli(
                "ingest",
                "--profile",
                "kimi",
                "--mode",
                "json",
                "--layer",
                "domain",
                "--slug",
                "kimi-demo/salinity-monitoring",
                "--input-file",
                str(source_path),
                "--json",
                cwd=workspace,
            )
            self.assertEqual(ingest_result.returncode, 0, ingest_result.stderr)
            payload = json.loads(ingest_result.stdout)
            self.assertEqual(payload["ref"], "domain:kimi-demo/salinity-monitoring")
            self.assertEqual(payload["title"], "盐度监测")
            self.assertEqual(payload["layer"], "domain")
            self.assertEqual(payload["slug"], "kimi-demo/salinity-monitoring")
            self.assertEqual(payload["warnings"], [])
            self.assertIn('"profile": "kimi"', payload["markdown"])
            self.assertIn('"title": "盐度监测"', payload["markdown"])
            self.assertIn("## 定义与定位", payload["markdown"])
            self.assertIn("## 属性", payload["markdown"])
            self.assertIn("## 证据来源", payload["markdown"])
            self.assertIn("## 关联主题", payload["markdown"])
            self.assertIn("盐度监测属于系统环境感知的一部分。", payload["markdown"])

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_ingest_json_infers_layer_when_layer_argument_is_omitted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)

            source_path = workspace / "ingest-input.json"
            source_path.write_text(
                json.dumps(
                    {
                        "title": "控制安全规则",
                        "page_kind": "entity",
                        "type": "共享规则",
                        "domain": "远程控制",
                        "level": 1,
                        "source": "unit-test",
                        "summary": "远程控制命令需要确认、授权和回滚流程。",
                        "properties": {
                            "职责": "约束远程控制命令的授权流程",
                        },
                        "sections": {
                            "定义与定位": "用于定义远程控制命令的安全边界。",
                            "证据来源": ["单元测试样例。"],
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                ) + "\n",
                encoding="utf-8",
            )

            ingest_result = run_cli(
                "ingest",
                "--profile",
                "kimi",
                "--mode",
                "json",
                "--slug",
                "kimi-demo/control-safety-rules",
                "--input-file",
                str(source_path),
                "--json",
                cwd=workspace,
            )
            self.assertEqual(ingest_result.returncode, 0, ingest_result.stderr)
            payload = json.loads(ingest_result.stdout)
            self.assertEqual(payload["ref"], "common:kimi-demo/control-safety-rules")
            self.assertEqual(payload["layer"], "common")
            self.assertTrue(any("common" in warning for warning in payload["warnings"]))

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_ingest_json_items_batch_infers_layer_and_slug_per_item(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)

            source_path = workspace / "batch-ingest-input.json"
            source_path.write_text(
                json.dumps(
                    {
                        "items": [
                            {
                                "title": "遥测字段规范",
                                "layer": "common",
                                "page_kind": "entity",
                                "type": "共享规范",
                                "domain": "平台接入",
                                "level": 1,
                                "source": "unit-test",
                                "sections": {
                                    "定义与定位": "统一遥测字段命名。",
                                    "证据来源": ["单元测试样例。"],
                                },
                            },
                            {
                                "title": "远程控制规则",
                                "page_kind": "entity",
                                "type": "控制规则",
                                "domain": "远程控制",
                                "level": 2,
                                "source": "unit-test",
                                "sections": {
                                    "定义与定位": "约束远程控制命令。",
                                    "证据来源": ["单元测试样例。"],
                                },
                            },
                            {
                                "title": "内部演练记录",
                                "visibility": "private",
                                "page_kind": "entity",
                                "type": "实验记录",
                                "domain": "远程控制",
                                "level": 3,
                                "source": "unit-test",
                                "sections": {
                                    "定义与定位": "记录内部演练过程。",
                                    "证据来源": ["单元测试样例。"],
                                },
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ) + "\n",
                encoding="utf-8",
            )

            ingest_result = run_cli(
                "ingest",
                "--profile",
                "kimi",
                "--mode",
                "json",
                "--slug",
                "kimi-demo",
                "--input-file",
                str(source_path),
                "--json",
                cwd=workspace,
            )
            self.assertEqual(ingest_result.returncode, 0, ingest_result.stderr)
            payload = json.loads(ingest_result.stdout)
            self.assertTrue(payload["batch"])
            self.assertEqual(payload["total"], 3)
            self.assertEqual(payload["layer_counts"], {"common": 1, "domain": 1, "private": 1})
            self.assertEqual(
                [item["ref"] for item in payload["items"]],
                [
                    "common:kimi-demo/遥测字段规范",
                    "domain:kimi-demo/远程控制规则",
                    "private:kimi-demo/内部演练记录",
                ],
            )

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_ingest_markdown_validates_and_returns_normalized_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)

            source_path = workspace / "ingest-input.md"
            source_path.write_text(
                """---
{
  "profile": "kimi",
  "page_kind": "entity",
  "title": "温度监测",
  "type": "监测能力",
  "domain": "智能养鱼",
  "level": 2,
  "source": "unit-test",
  "properties": {
    "指标": ["temperature"]
  },
  "relations": [
    {
      "target": "domain:kimi-demo/system",
      "type": "组成部分",
      "description": "温度监测属于系统环境感知的一部分。"
    }
  ]
}
---
# 温度监测

> 用于持续感知水温变化。

## 定义与定位
用于持续感知水温变化，并为阈值告警提供依据。

## 属性
- 指标: temperature

## 证据来源
- 单元测试样例。

## 关联主题
- 智能养鱼系统概览
""",
                encoding="utf-8",
            )

            ingest_result = run_cli(
                "ingest",
                "--profile",
                "kimi",
                "--mode",
                "markdown",
                "--layer",
                "domain",
                "--slug",
                "kimi-demo/temperature-monitoring",
                "--input-file",
                str(source_path),
                "--json",
                cwd=workspace,
            )
            self.assertEqual(ingest_result.returncode, 0, ingest_result.stderr)
            payload = json.loads(ingest_result.stdout)
            self.assertEqual(payload["ref"], "domain:kimi-demo/temperature-monitoring")
            self.assertEqual(payload["title"], "温度监测")
            self.assertEqual(payload["warnings"], [])
            self.assertIn("# 温度监测", payload["markdown"])
            self.assertIn("## 证据来源", payload["markdown"])

    @unittest.skipIf(sys.version_info[:2] < (3, 10), "wikimg requires Python 3.10+")
    def test_ingest_json_rejects_missing_required_sections(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            result = run_cli("init", cwd=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)

            source_path = workspace / "bad-ingest-input.json"
            source_path.write_text(
                json.dumps(
                    {
                        "title": "不完整节点",
                        "page_kind": "entity",
                        "type": "监测能力",
                        "domain": "智能养鱼",
                        "level": 2,
                        "source": "unit-test",
                        "properties": {
                            "指标": ["unknown"],
                        },
                        "sections": {
                            "属性": [
                                "指标: unknown",
                            ],
                            "证据来源": [
                                "单元测试样例。",
                            ],
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                ) + "\n",
                encoding="utf-8",
            )

            ingest_result = run_cli(
                "ingest",
                "--profile",
                "kimi",
                "--mode",
                "json",
                "--layer",
                "domain",
                "--slug",
                "kimi-demo/incomplete-node",
                "--input-file",
                str(source_path),
                "--json",
                cwd=workspace,
            )
            self.assertNotEqual(ingest_result.returncode, 0)
            payload = json.loads(ingest_result.stdout)
            self.assertEqual(payload["status"], "error")
            self.assertIn("定义与定位", payload["error"])


if __name__ == "__main__":
    unittest.main()

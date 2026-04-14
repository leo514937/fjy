from __future__ import annotations

import os
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PYTHONPATH = [str(ROOT / "src")]
if os.environ.get("PYTHONPATH"):
    PYTHONPATH.append(os.environ["PYTHONPATH"])
ENV = os.environ | {"PYTHONPATH": os.pathsep.join(PYTHONPATH)}


def run_cli(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "wikimg", *args],
        cwd=cwd,
        env=ENV,
        text=True,
        capture_output=True,
        check=False,
    )


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


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from ner import OpenRouterClient, OpenRouterConfig
from ontology_store import OntologyStore
from wiki_agent import WikiAgentRuntime, WikiAgentToolbox


def test_runtime_creates_pages_and_traces_without_llm(tmp_path: Path) -> None:
    store = OntologyStore(str(tmp_path / "wiki.sqlite3"))
    runtime = WikiAgentRuntime(
        store=store,
        llm_client=OpenRouterClient(OpenRouterConfig(enabled=False)),
        workspace_root=tmp_path,
    )
    run = store.start_wiki_run(mode="single", input_root="sample.txt", manifest={})
    clean_text = "智能养鱼系统使用 ESP8266 连接 OneNet。溶氧传感器持续监测鱼缸溶氧。"

    result = runtime.process_document(
        run_id=run.run_id,
        document_id="doc_demo",
        doc_name="鱼家智能养鱼系统",
        clean_text=clean_text,
    )

    assert result["topics"]
    assert result["page_results"]
    assert any(item["status"] == "created" for item in result["page_results"])
    assert store.list_pages()
    assert store.list_wiki_agent_steps(run.run_id)
    assert result["tool_summary"].get("run_command", 0) >= 1
    assert "relation_hints" in result
    assert "document_context" in result
    assert result["page_llm_memory"]
    assert result["page_llm_memory"][0]["final_phase"] == "commit"
    assert result["page_llm_memory"][0]["final_decision_kind"] == "fallback"
    assert (tmp_path / ".wikimg" / "config.json").exists()
    markdown_files = list((tmp_path / "wiki").rglob("*.md"))
    assert markdown_files
    content = markdown_files[0].read_text(encoding="utf-8")
    assert "# " in content
    assert "## 定义与定位" in content


def test_toolbox_run_command_is_readonly_and_scoped(tmp_path: Path) -> None:
    target_dir = tmp_path / "docs"
    target_dir.mkdir()
    (target_dir / "note.txt").write_text("智能养鱼系统连接 OneNet", encoding="utf-8")
    (tmp_path / "outside.txt").write_text("outside", encoding="utf-8")
    store = OntologyStore(str(tmp_path / "wiki.sqlite3"))
    toolbox = WikiAgentToolbox(
        store=store,
        document_id="doc_demo",
        doc_name="测试文档",
        clean_text="智能养鱼系统连接 OneNet",
        run_id="run_demo",
        workspace_root=tmp_path,
        target_folder=target_dir,
    )

    result = toolbox.tool_run_command("cat note.txt")
    assert "智能养鱼系统" in result["stdout"]

    with pytest.raises(ValueError):
        toolbox.tool_run_command("cat ../outside.txt")


def test_toolbox_run_command_allows_xiaogugit_module_with_workspace_paths(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_dir = tmp_path / "docs"
    target_dir.mkdir()
    payload_path = tmp_path / "payload.json"
    payload_path.write_text('{"hello":"world"}', encoding="utf-8")
    store = OntologyStore(str(tmp_path / "wiki.sqlite3"))
    toolbox = WikiAgentToolbox(
        store=store,
        document_id="doc_demo",
        doc_name="测试文档",
        clean_text="智能养鱼系统连接 OneNet",
        run_id="run_demo",
        workspace_root=tmp_path,
        target_folder=target_dir,
    )

    def fake_run(argv, **kwargs):
        assert argv[:3] == ["python", "-m", "xiaogugit"]
        assert kwargs["env"]["PYTHONPATH"].split(os.pathsep)[0] == str(tmp_path.resolve())
        return subprocess.CompletedProcess(argv, 0, stdout='{"projects":[]}\n', stderr="")

    monkeypatch.setattr("wiki_agent.tools.subprocess.run", fake_run)

    result = toolbox.tool_run_command(
        f"python -m xiaogugit --root-dir {str((tmp_path / 'storage').resolve())} "
        f"write --project-id demo --filename ontology.json --message test "
        f"--agent-name agent-1 --committer-name teacher --basevision 0 --data-file {str(payload_path.resolve())}"
    )

    assert result["returncode"] == 0
    assert result["stdout"] == '{"projects":[]}'


def test_toolbox_run_command_rejects_xiaogugit_path_outside_workspace(tmp_path: Path) -> None:
    target_dir = tmp_path / "docs"
    target_dir.mkdir()
    outside_root = tmp_path.parent / "outside-storage"
    store = OntologyStore(str(tmp_path / "wiki.sqlite3"))
    toolbox = WikiAgentToolbox(
        store=store,
        document_id="doc_demo",
        doc_name="测试文档",
        clean_text="智能养鱼系统连接 OneNet",
        run_id="run_demo",
        workspace_root=tmp_path,
        target_folder=target_dir,
    )

    with pytest.raises(ValueError):
        toolbox.tool_run_command(
            f"python -m xiaogugit --root-dir {str(outside_root.resolve())} project list"
        )


def test_toolbox_run_command_supports_cli_help_discovery(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    store = OntologyStore(str(tmp_path / "wiki.sqlite3"))
    toolbox = WikiAgentToolbox(
        store=store,
        document_id="doc_demo",
        doc_name="测试文档",
        clean_text="测试内容",
        run_id="run_demo",
        workspace_root=repo_root,
        target_folder=tmp_path,
    )

    for command in [
        "wikimg --help",
        "python -m pipeline.cli --help",
        "python -m mm_denoise.cli --help",
        "python -m ontology_negotiator.cli --help",
    ]:
        result = toolbox.tool_run_command(command)
        assert result["returncode"] == 0, command
        assert "usage:" in result["stdout"].lower(), command
        assert result["stderr"] == "", command


class FakeTraceClient:
    def is_enabled(self) -> bool:
        return True

    def chat_json_with_trace(self, *, system_prompt: str, user_prompt: str):
        if "页面候选" in system_prompt:
            parsed = {
                "pages": [
                    {
                        "title": "智能养鱼系统",
                        "page_type": "system",
                        "reason": "测试主题",
                        "seed_sentences": ["智能养鱼系统使用 ESP8266 连接 OneNet。"],
                    }
                ]
            }
        else:
            parsed = {
                "kind": "final_commit",
                "thought": "信息足够。",
                "commit": {
                    "title": "智能养鱼系统",
                    "page_type": "system",
                    "summary": "测试摘要",
                    "content_markdown": "# 智能养鱼系统\n\n测试内容",
                    "sources": [],
                    "related_pages": [],
                    "reason": "测试提交",
                },
            }
        return {
            "parsed": parsed,
            "request": {
                "payload": {
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ]
                }
            },
            "response": {
                "raw_text": str(parsed),
                "payload": {"choices": [{"message": {"content": str(parsed)}}]},
            },
        }


def test_runtime_exposes_last_llm_request_and_response(tmp_path: Path) -> None:
    store = OntologyStore(str(tmp_path / "wiki.sqlite3"))
    runtime = WikiAgentRuntime(
        store=store,
        llm_client=FakeTraceClient(),
        workspace_root=tmp_path,
    )
    run = store.start_wiki_run(mode="single", input_root="sample.txt", manifest={})

    result = runtime.process_document(
        run_id=run.run_id,
        document_id="doc_demo",
        doc_name="鱼家智能养鱼系统",
        clean_text="智能养鱼系统使用 ESP8266 连接 OneNet。溶氧传感器持续监测鱼缸溶氧。",
    )

    assert result["topic_plan_last_exchange"]["phase"] == "topic_plan"
    assert result["page_llm_memory"]
    assert result["page_llm_memory"][0]["phase"] in {"react_step", "commit"}
    assert result["page_llm_memory"][0]["source_topic_title"]
    assert result["page_llm_memory"][0]["resolved_page_title"] == result["page_llm_memory"][0]["title"]
    assert result["page_llm_memory"][0]["request"]["payload"]["messages"]
    assert result["page_llm_memory"][0]["response"]["raw_text"]

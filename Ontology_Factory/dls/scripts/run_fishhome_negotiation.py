from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from ontology_negotiator.benchmark import build_benchmark_summary, run_full_pipeline_benchmark
from ontology_negotiator.errors import NegotiationConfigurationError, NegotiationExecutionError
from ontology_negotiator.text_graph_pipeline import build_graph_from_agent_summary

# ================= 配置区域 =================
# 输入项目标识（对应 tests/ 目录下的 .txt 文件名，如 "fish_home" 或 "test"）
INPUT_PROJECT = "test"

# 输出项目标识（用于生成的图谱缓存和运行日志的文件名/目录名）
OUTPUT_PROJECT = "test"

# 最大并发数量
MAX_CONCURRENCY = 3

# 同义替换目标：如果为 None，则不执行替换。
# 如果设置了字符串，则会将文本中的 INPUT_PROJECT 标识替换为此内容。
TARGET_REPLACEMENT = None

# ================= 路径导出 =================
def _get_input_path(project: str) -> Path:
    # 统一从 tests/ 文件夹读取输入文件
    input_file = PROJECT_ROOT / "tests" / f"{project}.txt"
    return input_file

INPUT_TEXT_PATH = _get_input_path(INPUT_PROJECT)
GRAPH_CACHE_PATH = PROJECT_ROOT / "examples" / f"{OUTPUT_PROJECT}_knowledge_graph.json"
ARTIFACT_ROOT = PROJECT_ROOT / "artifacts" / f"{OUTPUT_PROJECT}_negotiation"
CONFIG_PATH = PROJECT_ROOT / "config" / "ontology_negotiator.toml"

_PRINT_LOCK = threading.Lock()


def ensure_project_graph() -> dict[str, object]:
    """确保获取当前项目的知识图谱数据（优先从缓存 JSON 读取，否则从文本提取）"""
    if GRAPH_CACHE_PATH.exists():
        return json.loads(GRAPH_CACHE_PATH.read_text(encoding="utf-8"))

    if not INPUT_TEXT_PATH.exists():
        raise FileNotFoundError(f"找不到输入文本文件: {INPUT_TEXT_PATH}")

    text = INPUT_TEXT_PATH.read_text(encoding="utf-8")
    
    project_key = OUTPUT_PROJECT
    project_name = f"{OUTPUT_PROJECT} system"
    
    if TARGET_REPLACEMENT:
        # 进行同义替换
        text = text.replace(INPUT_PROJECT, TARGET_REPLACEMENT)
        
        project_key = TARGET_REPLACEMENT.lower().replace(" ", "_")
        project_name = f"{TARGET_REPLACEMENT} system"

    graph = build_graph_from_agent_summary(
        text,
        project_key=project_key,
        project_name=project_name,
    )
    GRAPH_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    GRAPH_CACHE_PATH.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
    return graph


def print_key_outputs(report: dict[str, object]) -> None:
    print(f"节点数量: {report['node_count']}")
    print(f"并发数量: {report['max_concurrency']}")
    print(f"总耗时: {report['total_seconds']} 秒")
    print(f"平均轮次: {report['average_round_count']}")
    print()
    print("全流程摘要:")
    print(build_benchmark_summary(report))
    print()
    print("输出文件:")
    for label, path in report["written_files"].items():
        print(f"- {label}: {path}")


def _extract_arbiter_decision(output: object) -> dict[str, object]:
    if not isinstance(output, dict):
        return {}
    summary = output.get("round_summaries")
    if isinstance(summary, list) and summary:
        last = summary[-1]
        if isinstance(last, dict):
            return last
    history = output.get("history")
    if isinstance(history, list) and history:
        last = history[-1]
        if isinstance(last, dict):
            content = last.get("content")
            if isinstance(content, dict):
                return content
    return {}


def print_progress(event: dict[str, object]) -> None:
    event_type = str(event.get("event_type", ""))
    node_id = str(event.get("node_id", ""))
    agent_name = str(event.get("agent_name", ""))
    round_index = event.get("round")
    duration_seconds = event.get("duration_seconds")
    final_label = event.get("final_label")
    round_count = event.get("round_count")

    with _PRINT_LOCK:
        if event_type == "node_started":
            print(f"[节点开始] {node_id}", flush=True)
        elif event_type == "agent_started":
            print(
                f"  [阶段开始] 节点={node_id} 轮次={round_index} 阶段={agent_name}",
                flush=True,
            )
        elif event_type == "agent_finished":
            print(
                f"  [阶段完成] 节点={node_id} 轮次={round_index} 阶段={agent_name} 耗时={duration_seconds} 秒",
                flush=True,
            )
            if agent_name == "arbiter_node":
                decision = _extract_arbiter_decision(event.get("output"))
                action = decision.get("arbiter_action")
                reason_type = decision.get("decision_reason_type") or decision.get("retry_reason_type")
                focus = decision.get("next_focus", "")
                decision_reason = decision.get("decision_reason", "")
                print(
                    f"  [裁决] 节点={node_id} 轮次={round_index} 动作={action} 原因={reason_type or '-'} 焦点={focus or '-'}",
                    flush=True,
                )
                if decision_reason:
                    print(f"    [裁决说明] {decision_reason}", flush=True)
        elif event_type == "agent_failed":
            print(
                f"  [阶段失败] 节点={node_id} 轮次={round_index} 阶段={agent_name} 耗时={duration_seconds} 秒",
                flush=True,
            )
        elif event_type == "node_finished":
            print(
                f"[节点完成] {node_id} 最终标签={final_label} 总耗时={duration_seconds} 秒 总轮次={round_count}",
                flush=True,
            )


def _is_hour_quota_exhausted(exc: NegotiationExecutionError) -> bool:
    if exc.status_code != 429:
        return False
    return "hour allocated quota exceeded" in str(exc.message).lower()


def _print_rate_limit_guidance(exc: NegotiationExecutionError) -> None:
    print("模型配额不足（429: hour allocated quota exceeded）。", file=sys.stderr)
    print("建议：", file=sys.stderr)
    print("1) 等待下一小时配额窗口后重试；", file=sys.stderr)
    print("2) 在 config/ontology_negotiator.toml 中更换 api_key 或 model；", file=sys.stderr)
    print("3) 配置 openai.fallback_model 以便主模型限流时自动切换。", file=sys.stderr)
    print(str(exc), file=sys.stderr)


def main() -> int:
    try:
        graph = ensure_project_graph()
        report = run_full_pipeline_benchmark(
            graph,
            artifact_root=ARTIFACT_ROOT,
            config_path=CONFIG_PATH,
            max_concurrency=MAX_CONCURRENCY,
            progress_callback=print_progress,
        )
    except NegotiationConfigurationError as exc:
        print("模型配置错误。", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 1
    except NegotiationExecutionError as exc:
        if _is_hour_quota_exhausted(exc):
            _print_rate_limit_guidance(exc)
            return 2
        print("多 agent 协商执行失败。", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 2
    except FileNotFoundError as exc:
        print(f"缺少输入文件: {exc.filename if hasattr(exc, 'filename') else ''}", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 3

    print_key_outputs(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
from __future__ import annotations

"""LLM-driven vault evidence matching used during state initialization."""

import json
from ast import literal_eval
from typing import Any

from ontology_negotiator.config import LLMRetryConfig
from ontology_negotiator.errors import NegotiationExecutionError
from ontology_negotiator.errors import invoke_llm_with_retry
from ontology_negotiator.models import LLMTracePayload, VaultContextPayload

try:
    from langchain_core.messages import HumanMessage, SystemMessage
except Exception:
    HumanMessage = None
    SystemMessage = None


VAULT_SYSTEM_PROMPT = """You are the vault evidence matcher for OntologyNegotiator.
Your job is not to assign the final ontology label. Your job is only to decide
whether the current node has meaningful vault-style evidence suggesting it is
semantically close to a universal or foundational law or principle.

Use the full semantics of node_data and graph_context. Do not rely on literal
keyword matching alone. Neighboring L2 nodes may be supporting context, but they
must not force matched=true by themselves.

Return strict JSON only:
{
  "matched": true,
  "evidence": ["short evidence item"],
  "reason": "one or two sentences",
  "related_l2_nodes": ["node_id"]
}
"""


def _raise_vault_error(
    *,
    node_data: dict[str, Any],
    stage: str,
    message: str,
    raw_response: Any,
) -> None:
    raise NegotiationExecutionError(
        node_id=node_data.get("node_id"),
        agent_name="vault",
        stage=stage,
        iteration=1,
        message=message,
        raw_response=raw_response,
        prompt_name="vault_system",
    )


def _extract_json(content: Any) -> dict[str, Any]:
    if hasattr(content, "model_dump"):
        return content.model_dump(mode="json")
    if isinstance(content, dict):
        return content
    if isinstance(content, list):
        text = "".join(
            item.get("text", str(item))
            if isinstance(item, dict)
            else getattr(item, "text", str(item))
            for item in content
        )
    else:
        text = str(content)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("No JSON object found in vault response.")
    json_text = text[start : end + 1]
    try:
        return json.loads(json_text)
    except json.JSONDecodeError:
        repaired = _parse_pythonish_json_object(json_text)
        if isinstance(repaired, dict):
            return repaired
        raise


def _parse_pythonish_json_object(text: str) -> dict[str, Any]:
    normalized: list[str] = []
    quote_char: str | None = None
    escaped = False
    index = 0

    while index < len(text):
        char = text[index]
        if quote_char is not None:
            normalized.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote_char:
                quote_char = None
            index += 1
            continue

        if char in ('"', "'"):
            quote_char = char
            normalized.append(char)
            index += 1
            continue

        if text.startswith("null", index) and _is_token_boundary(text, index, 4):
            normalized.append("None")
            index += 4
            continue
        if text.startswith("true", index) and _is_token_boundary(text, index, 4):
            normalized.append("True")
            index += 4
            continue
        if text.startswith("false", index) and _is_token_boundary(text, index, 5):
            normalized.append("False")
            index += 5
            continue

        normalized.append(char)
        index += 1

    parsed = literal_eval("".join(normalized))
    if not isinstance(parsed, dict):
        raise ValueError("Vault response did not evaluate to a JSON object.")
    return parsed


def _is_token_boundary(text: str, start: int, length: int) -> bool:
    before = text[start - 1] if start > 0 else ""
    after_index = start + length
    after = text[after_index] if after_index < len(text) else ""
    return (not before or not (before.isalnum() or before == "_")) and (
        not after or not (after.isalnum() or after == "_")
    )


def _filter_related_l2_nodes(
    graph_context: dict[str, Any],
    related_l2_nodes: list[str],
) -> list[str]:
    available_l2_nodes = {
        str(neighbor.get("node_id"))
        for neighbor in graph_context.get("neighbors", [])
        if neighbor.get("l_level") == "L2" and neighbor.get("node_id")
    }
    filtered: list[str] = []
    for node_id in related_l2_nodes:
        if node_id in available_l2_nodes and node_id not in filtered:
            filtered.append(node_id)
    return filtered


def _resolve_model_name(llm: Any | None) -> str | None:
    if llm is None:
        return None
    for attr in ("model_name", "model", "name", "model_id"):
        value = getattr(llm, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return type(llm).__name__


def match_vault(
    node_data: dict[str, Any],
    graph_context: dict[str, Any],
    *,
    llm: Any,
    fallback_llm: Any | None = None,
    retry_policy: LLMRetryConfig | None = None,
    trace_collector: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    payload = {
        "node_data": node_data,
        "graph_context": graph_context,
    }
    retry_policy = retry_policy or LLMRetryConfig()

    if llm is None:
        _raise_vault_error(
            node_data=node_data,
            stage="llm_invoke",
            message="Vault matching requires a configured LLM instance.",
            raw_response=None,
        )

    def _invoke_client(client: Any) -> Any:
        if SystemMessage is not None and HumanMessage is not None:
            response = client.invoke(
                [
                    SystemMessage(content=VAULT_SYSTEM_PROMPT),
                    HumanMessage(
                        content=(
                            "Return strict JSON only. Do not use Markdown.\n"
                            f"input={json.dumps(payload, ensure_ascii=False)}"
                        )
                    ),
                ]
            )
        else:
            response = client.invoke(
                f"{VAULT_SYSTEM_PROMPT}\nReturn strict JSON only.\n{json.dumps(payload, ensure_ascii=False)}"
            )
        return getattr(response, "content", response)

    if hasattr(llm, "generate_json"):
        call = lambda: llm.generate_json("vault", payload)
        fallback_call = (
            (lambda: fallback_llm.generate_json("vault", payload))
            if fallback_llm is not None and hasattr(fallback_llm, "generate_json")
            else None
        )
    elif hasattr(llm, "invoke"):
        call = lambda: _invoke_client(llm)
        fallback_call = (
            (lambda: _invoke_client(fallback_llm))
            if fallback_llm is not None and hasattr(fallback_llm, "invoke")
            else None
        )
    else:
        _raise_vault_error(
            node_data=node_data,
            stage="llm_invoke",
            message="LLM object does not support generate_json or invoke.",
            raw_response=None,
        )

    trace_metadata: dict[str, Any] = {}
    raw_response: Any = invoke_llm_with_retry(
        call=call,
        fallback_call=fallback_call,
        node_id=node_data.get("node_id"),
        agent_name="vault",
        stage="llm_invoke",
        iteration=1,
        prompt_name="vault_system",
        max_attempts=max(1, int(retry_policy.max_attempts)),
        base_delay_seconds=float(retry_policy.base_delay_seconds),
        max_delay_seconds=float(retry_policy.max_delay_seconds),
        jitter_seconds=float(retry_policy.jitter_seconds),
        primary_model=_resolve_model_name(llm),
        fallback_model=_resolve_model_name(fallback_llm),
        trace_metadata=trace_metadata,
    )
    if trace_collector is not None:
        trace_collector.append(
            LLMTracePayload(
                agent_name="vault",
                stage="llm_invoke",
                iteration=1,
                prompt_name="vault_system",
                llm_model=trace_metadata.get("llm_model"),
                fallback_model=trace_metadata.get("fallback_model"),
                fallback_used=bool(trace_metadata.get("fallback_used", False)),
                attempts=int(trace_metadata.get("attempts", 1) or 1),
                success=bool(trace_metadata.get("success", True)),
            ).model_dump(mode="json")
        )

    try:
        parsed = _extract_json(raw_response)
    except Exception as exc:
        _raise_vault_error(
            node_data=node_data,
            stage="json_parse",
            message=f"Vault JSON parsing failed: {exc}",
            raw_response=raw_response,
        )

    try:
        validated = VaultContextPayload.model_validate(parsed)
    except Exception as exc:
        _raise_vault_error(
            node_data=node_data,
            stage="schema_validate",
            message=f"Vault response failed schema validation: {exc}",
            raw_response=parsed,
        )

    filtered_related_l2_nodes = _filter_related_l2_nodes(
        graph_context,
        validated.related_l2_nodes,
    )
    return validated.model_copy(
        update={"related_l2_nodes": filtered_related_l2_nodes}
    ).model_dump(mode="json")

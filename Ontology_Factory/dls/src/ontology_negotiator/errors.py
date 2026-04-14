from __future__ import annotations

"""Shared configuration and execution errors for ontology negotiation."""

import json
import random
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Literal


LLMErrorKind = Literal[
    "capacity_exhausted",
    "transient_503",
    "rate_limited",
    "timeout",
    "transport_error",
    "unsupported_interface",
    "other",
]


@dataclass(frozen=True)
class LLMErrorDiagnosis:
    kind: LLMErrorKind
    retryable: bool
    status_code: int | None = None
    message: str = ""
    exception_type: str = ""
    retry_after_seconds: float | None = None
    fallback_recommended: bool = False


def _to_jsonable(value: Any) -> Any:
    """Best-effort conversion for structured logging."""
    if hasattr(value, "model_dump"):
        return _to_jsonable(value.model_dump(mode="json"))
    if isinstance(value, dict):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


class NegotiationConfigurationError(RuntimeError):
    """Raised when configuration is invalid or missing before execution."""


class NegotiationExecutionError(RuntimeError):
    """Raised when a node fails during execution."""

    def __init__(
        self,
        *,
        node_id: str | None,
        agent_name: str,
        stage: str,
        iteration: int,
        message: str,
        raw_response: Any = None,
        prompt_name: str,
        error_kind: str = "other",
        retryable: bool = False,
        status_code: int | None = None,
        attempt: int = 1,
        max_attempts: int = 1,
        fallback_used: bool = False,
        fallback_model: str | None = None,
        llm_model: str | None = None,
        retry_after_seconds: float | None = None,
    ) -> None:
        self.node_id = node_id
        self.agent_name = agent_name
        self.stage = stage
        self.iteration = iteration
        self.message = message
        self.raw_response = raw_response
        self.prompt_name = prompt_name
        self.error_kind = error_kind
        self.retryable = retryable
        self.status_code = status_code
        self.attempt = attempt
        self.max_attempts = max_attempts
        self.fallback_used = fallback_used
        self.fallback_model = fallback_model
        self.llm_model = llm_model
        self.retry_after_seconds = retry_after_seconds
        super().__init__(self.__str__())

    def to_dict(self) -> dict[str, Any]:
        """Serialize the failure in a structured and stable format."""
        return {
            "node_id": self.node_id,
            "agent_name": self.agent_name,
            "stage": self.stage,
            "iteration": self.iteration,
            "message": self.message,
            "raw_response": _to_jsonable(self.raw_response),
            "prompt_name": self.prompt_name,
            "error_kind": self.error_kind,
            "retryable": self.retryable,
            "status_code": self.status_code,
            "attempt": self.attempt,
            "max_attempts": self.max_attempts,
            "fallback_used": self.fallback_used,
            "fallback_model": self.fallback_model,
            "llm_model": self.llm_model,
            "retry_after_seconds": self.retry_after_seconds,
        }

    def __str__(self) -> str:
        """Return JSON text so the terminal and logs stay easy to inspect."""
        return json.dumps(self.to_dict(), ensure_ascii=False)


def _extract_status_code(exc: BaseException) -> int | None:
    for attr in ("status_code", "http_status", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)

    response = getattr(exc, "response", None)
    if response is not None:
        value = getattr(response, "status_code", None)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)

    text = f"{type(exc).__name__} {exc}"
    match = re.search(r"\b(429|500|502|503|504)\b", text)
    if match:
        return int(match.group(1))
    return None


def _extract_retry_after_seconds(exc: BaseException) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    for key in ("retry-after", "Retry-After"):
        value = None
        if hasattr(headers, "get"):
            value = headers.get(key)
        if value is None:
            continue
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                continue
    return None


def _collect_exception_text(exc: BaseException) -> str:
    parts = [type(exc).__name__, str(exc)]
    for attr in ("message", "detail", "body", "error", "content"):
        value = getattr(exc, attr, None)
        if value is not None:
            parts.append(str(_to_jsonable(value)))
    response = getattr(exc, "response", None)
    if response is not None:
        for attr in ("text", "reason_phrase"):
            value = getattr(response, attr, None)
            if value is not None:
                parts.append(str(value))
        try:
            headers = getattr(response, "headers", None)
            if headers is not None:
                parts.append(str(_to_jsonable(dict(headers))))
        except Exception:
            pass
    return " ".join(part for part in parts if part)


def diagnose_llm_exception(exc: BaseException) -> LLMErrorDiagnosis:
    """Classify a low-level LLM failure for retry decisions."""
    status_code = _extract_status_code(exc)
    message = _collect_exception_text(exc)
    lower_message = message.lower()
    exception_type = type(exc).__name__
    retry_after_seconds = _extract_retry_after_seconds(exc)

    capacity_markers = (
        "model_capacity_exhausted",
        "capacity exhausted",
        "no capacity available",
        "model capacity exhausted",
    )
    if status_code == 503 and any(marker in lower_message for marker in capacity_markers):
        return LLMErrorDiagnosis(
            kind="capacity_exhausted",
            retryable=True,
            status_code=status_code,
            message=message,
            exception_type=exception_type,
            retry_after_seconds=retry_after_seconds,
            fallback_recommended=True,
        )

    if status_code == 503:
        return LLMErrorDiagnosis(
            kind="transient_503",
            retryable=True,
            status_code=status_code,
            message=message,
            exception_type=exception_type,
            retry_after_seconds=retry_after_seconds,
            fallback_recommended=True,
        )

    if status_code == 429:
        hard_quota_markers = (
            "hour allocated quota exceeded",
            "insufficient quota",
            "quota exceeded",
        )
        hard_quota_exhausted = any(marker in lower_message for marker in hard_quota_markers)
        return LLMErrorDiagnosis(
            kind="rate_limited",
            retryable=not hard_quota_exhausted,
            status_code=status_code,
            message=message,
            exception_type=exception_type,
            retry_after_seconds=retry_after_seconds,
            fallback_recommended=True,
        )

    if status_code in {502, 504}:
        return LLMErrorDiagnosis(
            kind="transient_503",
            retryable=True,
            status_code=status_code,
            message=message,
            exception_type=exception_type,
            retry_after_seconds=retry_after_seconds,
            fallback_recommended=True,
        )

    transport_markers = (
        "timeout",
        "timed out",
        "connection error",
        "connecterror",
        "remoteprotocolerror",
        "readerror",
        "writeerror",
        "broken pipe",
        "server disconnected",
        "temporarily unavailable",
    )
    if any(marker in lower_message for marker in transport_markers):
        return LLMErrorDiagnosis(
            kind="timeout" if "timeout" in lower_message or "timed out" in lower_message else "transport_error",
            retryable=True,
            status_code=status_code,
            message=message,
            exception_type=exception_type,
            retry_after_seconds=retry_after_seconds,
            fallback_recommended=True,
        )

    return LLMErrorDiagnosis(
        kind="other",
        retryable=False,
        status_code=status_code,
        message=message,
        exception_type=exception_type,
        retry_after_seconds=retry_after_seconds,
        fallback_recommended=False,
    )


def compute_retry_delay_seconds(
    attempt: int,
    diagnosis: LLMErrorDiagnosis,
    *,
    base_delay_seconds: float,
    max_delay_seconds: float,
    jitter_seconds: float,
) -> float:
    """Compute exponential backoff with a small jitter."""
    delay = base_delay_seconds * (2 ** max(0, attempt - 1))
    if diagnosis.kind == "capacity_exhausted":
        delay *= 1.5
    elif diagnosis.kind == "rate_limited":
        delay *= 2.0
    if diagnosis.retry_after_seconds is not None:
        delay = max(delay, diagnosis.retry_after_seconds)
    delay = min(delay, max_delay_seconds)
    if jitter_seconds > 0:
        delay = min(max_delay_seconds, delay + random.uniform(0.0, jitter_seconds))
    return max(0.0, delay)


def invoke_llm_with_retry(
    *,
    call: Callable[[], Any],
    node_id: str | None,
    agent_name: str,
    stage: str,
    iteration: int,
    prompt_name: str,
    max_attempts: int,
    base_delay_seconds: float,
    max_delay_seconds: float,
    jitter_seconds: float,
    primary_model: str | None = None,
    fallback_call: Callable[[], Any] | None = None,
    fallback_model: str | None = None,
    trace_metadata: dict[str, Any] | None = None,
) -> Any:
    """Invoke a model with retry, fallback, and structured failure reporting."""
    if max_attempts < 1:
        max_attempts = 1

    current_call = call
    current_model = primary_model
    fallback_used = False

    for attempt in range(1, max_attempts + 1):
        try:
            result = current_call()
            if trace_metadata is not None:
                trace_metadata.update(
                    {
                        "llm_model": current_model,
                        "fallback_model": fallback_model,
                        "fallback_used": fallback_used,
                        "attempts": attempt,
                        "success": True,
                    }
                )
            return result
        except NegotiationExecutionError:
            raise
        except Exception as exc:
            diagnosis = diagnose_llm_exception(exc)
            should_retry = diagnosis.retryable and attempt < max_attempts
            if should_retry:
                should_switch_to_fallback = (
                    fallback_call is not None
                    and not fallback_used
                    and diagnosis.fallback_recommended
                    and (
                        diagnosis.kind == "capacity_exhausted"
                        or attempt == max_attempts - 1
                    )
                )
                if should_switch_to_fallback:
                    current_call = fallback_call
                    current_model = fallback_model or current_model
                    fallback_used = True
                delay = compute_retry_delay_seconds(
                    attempt,
                    diagnosis,
                    base_delay_seconds=base_delay_seconds,
                    max_delay_seconds=max_delay_seconds,
                    jitter_seconds=jitter_seconds,
                )
                time.sleep(delay)
                continue

            if trace_metadata is not None:
                trace_metadata.update(
                    {
                        "llm_model": current_model,
                        "fallback_model": fallback_model,
                        "fallback_used": fallback_used,
                        "attempts": attempt,
                        "success": False,
                    }
                )
            error_message = (
                f"LLM call failed after {attempt} attempt(s)"
                f"; kind={diagnosis.kind}"
                f"; status={diagnosis.status_code if diagnosis.status_code is not None else 'n/a'}"
                f"; retryable={diagnosis.retryable}"
                f"; fallback_used={fallback_used}"
                f"; detail={diagnosis.message}"
            )
            raise NegotiationExecutionError(
                node_id=node_id,
                agent_name=agent_name,
                stage=stage,
                iteration=iteration,
                message=error_message,
                raw_response=exc,
                prompt_name=prompt_name,
                error_kind=diagnosis.kind,
                retryable=diagnosis.retryable,
                status_code=diagnosis.status_code,
                attempt=attempt,
                max_attempts=max_attempts,
                fallback_used=fallback_used,
                fallback_model=fallback_model if fallback_used else None,
                llm_model=current_model,
                retry_after_seconds=diagnosis.retry_after_seconds,
            ) from exc

    if trace_metadata is not None:
        trace_metadata.update(
            {
                "llm_model": current_model,
                "fallback_model": fallback_model,
                "fallback_used": fallback_used,
                "attempts": max_attempts,
                "success": False,
            }
        )
    raise NegotiationExecutionError(
        node_id=node_id,
        agent_name=agent_name,
        stage=stage,
        iteration=iteration,
        message="LLM call failed without a classified exception.",
        raw_response=None,
        prompt_name=prompt_name,
        error_kind="other",
        retryable=False,
        attempt=max_attempts,
        max_attempts=max_attempts,
        fallback_used=fallback_used,
        fallback_model=fallback_model if fallback_used else None,
        llm_model=current_model,
    )


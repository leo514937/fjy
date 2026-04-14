from __future__ import annotations

from dataclasses import dataclass

import pytest

from ontology_negotiator.errors import (
    NegotiationExecutionError,
    diagnose_llm_exception,
    invoke_llm_with_retry,
)


@dataclass
class DummyResponse:
    status_code: int = 503
    headers: dict[str, str] | None = None
    text: str = ""


class DummyCapacityError(RuntimeError):
    def __init__(self, message: str = "No capacity available for model gemini-3-flash-agent on the server") -> None:
        super().__init__(message)
        self.status_code = 503
        self.response = DummyResponse(status_code=503, headers={"Retry-After": "0.1"}, text=message)


class Dummy503Error(RuntimeError):
    def __init__(self, message: str = "Service Unavailable") -> None:
        super().__init__(message)
        self.status_code = 503
        self.response = DummyResponse(status_code=503, headers={"Retry-After": "0.1"}, text=message)


def test_diagnose_capacity_exhausted_503() -> None:
    diag = diagnose_llm_exception(DummyCapacityError())
    assert diag.kind == "capacity_exhausted"
    assert diag.retryable is True
    assert diag.status_code == 503
    assert diag.fallback_recommended is True


def test_invoke_llm_with_retry_uses_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []
    monkeypatch.setattr("ontology_negotiator.errors.time.sleep", lambda seconds: sleeps.append(seconds))

    calls: list[str] = []

    def primary() -> str:
        calls.append("primary")
        raise DummyCapacityError()

    def fallback() -> str:
        calls.append("fallback")
        return "ok"

    result = invoke_llm_with_retry(
        call=primary,
        fallback_call=fallback,
        node_id="node-1",
        agent_name="proposer",
        stage="llm_invoke",
        iteration=2,
        prompt_name="proposer_system",
        max_attempts=3,
        base_delay_seconds=0.1,
        max_delay_seconds=0.5,
        jitter_seconds=0.0,
        primary_model="primary-model",
        fallback_model="fallback-model",
    )

    assert result == "ok"
    assert calls == ["primary", "fallback"]
    assert sleeps and sleeps[0] >= 0.1


def test_invoke_llm_with_retry_preserves_non_retryable_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("ontology_negotiator.errors.time.sleep", lambda seconds: None)

    calls: list[str] = []

    def primary() -> str:
        calls.append("primary")
        raise ValueError("schema mismatch")

    def fallback() -> str:
        calls.append("fallback")
        return "ok"

    with pytest.raises(NegotiationExecutionError) as exc_info:
        invoke_llm_with_retry(
            call=primary,
            fallback_call=fallback,
            node_id="node-2",
            agent_name="critic",
            stage="llm_invoke",
            iteration=2,
            prompt_name="critic_system",
            max_attempts=3,
            base_delay_seconds=0.1,
            max_delay_seconds=0.5,
            jitter_seconds=0.0,
            primary_model="primary-model",
            fallback_model="fallback-model",
        )

    error = exc_info.value
    assert error.retryable is False
    assert error.error_kind == "other"
    assert error.attempt == 1
    assert error.fallback_used is False
    assert calls == ["primary"]

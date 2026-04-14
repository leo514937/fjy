from ontology_audit_hub.graphs.nodes.intent_router import classify_intent


def test_classify_intent_prefers_explicit_mode() -> None:
    label, confidence, human_card = classify_intent("Please audit docs", "code")

    assert label == "code"
    assert confidence == 1.0
    assert human_card is None


def test_classify_intent_detects_full_from_multiple_signals() -> None:
    label, confidence, human_card = classify_intent("Audit ontology docs and code together", None)

    assert label == "full"
    assert confidence >= 0.7
    assert human_card is None


def test_classify_intent_requests_human_input_when_unknown() -> None:
    label, confidence, human_card = classify_intent("Please help", None)

    assert label == "unknown"
    assert confidence == 0.0
    assert human_card is not None
    assert "Which path" in human_card.question

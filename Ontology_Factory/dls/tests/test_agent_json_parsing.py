from __future__ import annotations

from ontology_negotiator.agents import _extract_json as extract_agent_json
from ontology_negotiator.vault import _extract_json as extract_vault_json


def test_agent_extract_json_accepts_python_style_string_item() -> None:
    raw = """{
  "confidence_score": 0.63,
  "consensus_stability_score": 0.68,
  "evidence_strength_score": 0.71,
  "logic_consistency_score": 0.65,
  "semantic_fit_score": 0.69,
  "audit_opinion": "ok",
  "reasoning": "still valid",
  "xiaogu_list": [
    "first",
    '第二条用了单引号'
  ],
  "generated_ran": null,
  "generated_ti": null
}"""

    parsed = extract_agent_json(raw)

    assert parsed["confidence_score"] == 0.63
    assert parsed["xiaogu_list"] == ["first", "第二条用了单引号"]
    assert parsed["generated_ran"] is None


def test_vault_extract_json_accepts_python_literals() -> None:
    raw = """{
  "matched": true,
  "evidence": ['a', "b"],
  "reason": "mixed quotes",
  "related_l2_nodes": []
}"""

    parsed = extract_vault_json(raw)

    assert parsed == {
        "matched": True,
        "evidence": ["a", "b"],
        "reason": "mixed quotes",
        "related_l2_nodes": [],
    }

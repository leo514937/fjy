from pathlib import Path

from ontology_audit_hub.domain.ontology.loader import load_ontology


def test_load_ontology_from_yaml(tmp_path: Path) -> None:
    ontology_file = tmp_path / "ontology.yaml"
    ontology_file.write_text(
        """
version: "1.0"
entities:
  - name: Account
relations:
  - source: Account
    target: Account
    type: relates_to
""".strip(),
        encoding="utf-8",
    )

    ontology = load_ontology(ontology_file)

    assert ontology.version == "1.0"
    assert ontology.entities[0].name == "Account"
    assert ontology.relations[0].relation_type == "relates_to"

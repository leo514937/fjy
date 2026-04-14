from pathlib import Path

from ontology_audit_hub.domain.documents.parser import chunk_markdown
from ontology_audit_hub.domain.ontology.models import OntologyModel


def test_chunk_markdown_preserves_sections_and_ontology_tags(tmp_path: Path) -> None:
    markdown_file = tmp_path / "requirements.md"
    markdown_file.write_text(
        """
# Overview
Payment records are tracked here.

# Details
Invoice generation follows a billing workflow.
""".strip(),
        encoding="utf-8",
    )
    ontology = OntologyModel.model_validate(
        {
            "entities": [
                {"name": "Payment"},
                {"name": "Invoice"},
            ]
        }
    )

    chunks = chunk_markdown(markdown_file, ontology)

    assert [chunk.section for chunk in chunks] == ["Overview", "Details"]
    assert chunks[0].ontology_tags == ["Payment"]
    assert chunks[1].ontology_tags == ["Invoice"]

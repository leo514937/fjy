from __future__ import annotations

import pytest

from ontology_audit_hub.domain.documents.extractors import (
    DOCX_CONTENT_TYPE,
    MARKDOWN_CONTENT_TYPE,
    PDF_CONTENT_TYPE,
    DocumentExtractionError,
    extract_uploaded_document,
)
from tests.support.document_samples import build_docx_bytes, build_pdf_bytes


def test_extract_uploaded_document_decodes_markdown_text() -> None:
    result = extract_uploaded_document(
        filename="knowledge.md",
        content=b"# Overview\nPayment rules.",
        content_type="text/markdown",
    )

    assert result.parser_kind == "text"
    assert result.normalized_content_type == MARKDOWN_CONTENT_TYPE
    assert result.text == "# Overview\nPayment rules."


def test_extract_uploaded_document_extracts_pdf_text() -> None:
    result = extract_uploaded_document(
        filename="knowledge.pdf",
        content=build_pdf_bytes("Approval token"),
        content_type=PDF_CONTENT_TYPE,
    )

    assert result.parser_kind == "pdf"
    assert result.normalized_content_type == PDF_CONTENT_TYPE
    assert "Approval token" in result.text


def test_extract_uploaded_document_converts_docx_headings_and_tables() -> None:
    result = extract_uploaded_document(
        filename="knowledge.docx",
        content=build_docx_bytes(),
        content_type=DOCX_CONTENT_TYPE,
    )

    assert result.parser_kind == "docx"
    assert result.normalized_content_type == DOCX_CONTENT_TYPE
    assert "# Overview" in result.text
    assert "## Rules" in result.text
    assert "Status | Approved" in result.text


def test_extract_uploaded_document_rejects_legacy_doc() -> None:
    with pytest.raises(DocumentExtractionError) as exc_info:
        extract_uploaded_document(
            filename="legacy.doc",
            content=b"",
            content_type="application/msword",
        )

    assert ".doc" in exc_info.value.message


def test_extract_uploaded_document_rejects_pdf_without_extractable_text() -> None:
    with pytest.raises(DocumentExtractionError) as exc_info:
        extract_uploaded_document(
            filename="scan.pdf",
            content=build_pdf_bytes(""),
            content_type=PDF_CONTENT_TYPE,
        )

    assert "does not support scanned documents or OCR" in exc_info.value.message

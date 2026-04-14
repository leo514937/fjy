from __future__ import annotations

import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from docx import Document as open_docx_document
from docx.document import Document as DocxDocument
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph
from pypdf import PdfReader

from ontology_audit_hub.domain.documents.parser import normalize_text

DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PDF_CONTENT_TYPE = "application/pdf"
MARKDOWN_CONTENT_TYPE = "text/markdown"
PLAIN_TEXT_CONTENT_TYPE = "text/plain"

SUPPORTED_SUFFIXES = {".md", ".markdown", ".txt", ".pdf", ".docx"}


@dataclass(frozen=True)
class ExtractedDocument:
    text: str
    normalized_content_type: str
    filename: str
    parser_kind: str


@dataclass
class DocumentExtractionError(Exception):
    message: str


def extract_uploaded_document(
    *,
    filename: str,
    content: bytes,
    content_type: str | None,
) -> ExtractedDocument:
    suffix = Path(filename).suffix.lower()
    basename = Path(filename).name
    normalized_content_type = _normalize_content_type(content_type, suffix)

    if suffix == ".doc":
        raise DocumentExtractionError("Legacy Word .doc files are not supported yet. Please save the file as .docx.")

    if suffix not in SUPPORTED_SUFFIXES:
        raise DocumentExtractionError(
            "Unsupported knowledge document type. Supported formats: Markdown, TXT, PDF (text-based), DOCX."
        )

    if suffix in {".md", ".markdown", ".txt"}:
        parser_kind = "text"
        text = _decode_text_document(content)
    elif suffix == ".pdf":
        parser_kind = "pdf"
        text = _extract_pdf_text(content)
    else:
        parser_kind = "docx"
        text = _extract_docx_text(content)

    normalized_for_validation = normalize_text(text)
    if not normalized_for_validation.strip():
        if suffix == ".pdf":
            raise DocumentExtractionError(
                "PDF contains no extractable text. The current version does not support scanned documents or OCR."
            )
        raise DocumentExtractionError("Uploaded document is empty.")

    return ExtractedDocument(
        text=text,
        normalized_content_type=normalized_content_type,
        filename=basename,
        parser_kind=parser_kind,
    )


def _decode_text_document(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise DocumentExtractionError(f"Uploaded text document must be UTF-8 encoded: {exc}") from exc


def _extract_pdf_text(content: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(content))
    except Exception as exc:  # pragma: no cover - library error surface
        raise DocumentExtractionError(f"Failed to read PDF document: {exc}") from exc

    page_texts: list[str] = []
    for page in reader.pages:
        extracted = page.extract_text() or ""
        cleaned = normalize_text(extracted)
        if cleaned:
            page_texts.append(cleaned)
    return "\n\n".join(page_texts)


def _extract_docx_text(content: bytes) -> str:
    try:
        document = open_docx_document(BytesIO(content))
    except Exception as exc:  # pragma: no cover - library error surface
        raise DocumentExtractionError(f"Failed to read DOCX document: {exc}") from exc

    blocks: list[str] = []
    for block in _iter_docx_blocks(document):
        if isinstance(block, Paragraph):
            text = _clean_block_text(block.text)
            if not text:
                continue
            heading_level = _heading_level(block.style.name if block.style is not None else "")
            if heading_level is not None:
                blocks.append(f"{'#' * heading_level} {text}")
            else:
                blocks.append(text)
            continue

        if isinstance(block, Table):
            for row in block.rows:
                cells = [_clean_block_text(cell.text) for cell in row.cells]
                flattened = [cell for cell in cells if cell]
                if flattened:
                    blocks.append(" | ".join(flattened))

    return "\n\n".join(blocks)


def _iter_docx_blocks(document: DocxDocument):
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)


def _heading_level(style_name: str) -> int | None:
    match = re.fullmatch(r"Heading\s+([1-6])", style_name.strip())
    if match is None:
        return None
    return int(match.group(1))


def _clean_block_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _normalize_content_type(content_type: str | None, suffix: str) -> str:
    if suffix in {".md", ".markdown"}:
        return MARKDOWN_CONTENT_TYPE
    if suffix == ".txt":
        return PLAIN_TEXT_CONTENT_TYPE
    if suffix == ".pdf":
        return PDF_CONTENT_TYPE
    if suffix == ".docx":
        return DOCX_CONTENT_TYPE

    if content_type:
        normalized = content_type.strip().lower()
        if normalized and normalized != "application/octet-stream":
            return normalized
    return PLAIN_TEXT_CONTENT_TYPE

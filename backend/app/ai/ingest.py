"""Builds the retrievable corpus for one opportunity version: documents, the DeepDive itself, and the
Director's comments. Re-running replaces the version's chunks, so a re-analysis always sees current material."""
from __future__ import annotations

import hashlib
import uuid
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ai.chunking import chunk_blocks, deepdive_chunks
from app.ai.extraction import extract
from app.ai.providers import EmbeddingProvider
from app.models import DocumentChunk, OpportunityDocument, OpportunityVersion, ReviewComment, User
from app.services.documents import stream as document_stream

BATCH = 32
# Chunk ids are derived from the content, so re-ingesting unchanged sources keeps the same ids and the
# citations stored on earlier analysis runs still resolve.
CHUNK_NAMESPACE = uuid.UUID("6f1f2f4a-9f2a-4c39-9c62-2a0049bde001")


def _row(**kwargs) -> DocumentChunk:
    text = kwargs["text"]
    kwargs.setdefault("sha256", hashlib.sha256(text.encode()).hexdigest())
    key = "|".join(str(kwargs.get(f, "")) for f in
                   ("version_id", "source_kind", "document_id", "field_path", "ordinal", "sha256"))
    kwargs["id"] = uuid.uuid5(CHUNK_NAMESPACE, key)
    return DocumentChunk(**kwargs)


def ingest_version(db: Session, version: OpportunityVersion, embeddings: EmbeddingProvider) -> dict:
    """Returns a summary: chunk counts per source and any documents that could not be read."""
    opportunity_id = version.opportunity_id
    db.execute(delete(DocumentChunk).where(DocumentChunk.version_id == version.id))
    rows: list[DocumentChunk] = []
    warnings: list[dict] = []

    # A. DeepDive fields
    for field_path, value in deepdive_chunks(version.deepdive.data if version.deepdive else {}):
        label = f"DeepDive v{version.version_number} — {field_path}"
        rows.append(_row(opportunity_id=opportunity_id, version_id=version.id, source_kind="deepdive",
                         document_name=f"DeepDive v{version.version_number}", field_path=field_path,
                         ordinal=len(rows), text=f"{field_path}: {value}", location_label=label))

    # B. Director review comments
    comments = db.execute(select(ReviewComment).where(ReviewComment.opportunity_id == opportunity_id)
                          .order_by(ReviewComment.created_at)).scalars().all()
    for comment in comments:
        author = db.get(User, comment.created_by)
        header = f"Director comment ({comment.comment_type}" + (f", {comment.section}" if comment.section else "") + ")"
        body = (f"{header}: {comment.body}"
                + (f" [priority {comment.priority}]" if comment.priority else "")
                + (f" [owner {comment.owner_name}]" if comment.owner_name else "")
                + (f" [due {comment.due_date}]" if comment.due_date else "")
                + f" [status {comment.status}]")
        rows.append(_row(opportunity_id=opportunity_id, version_id=version.id, source_kind="review",
                         document_name=f"Director review — {author.full_name if author else 'Director'}",
                         field_path=str(comment.id), ordinal=len(rows), text=body,
                         location_label=f"Director comment {comment.id} ({comment.comment_type})",
                         meta={"comment_id": str(comment.id), "status": comment.status, "priority": comment.priority}))

    # C. Uploaded customer documents
    documents = db.execute(select(OpportunityDocument).where(
        OpportunityDocument.opportunity_id == opportunity_id, OpportunityDocument.deleted_at.is_(None))).scalars().all()
    for document in documents:
        buffer = b"".join(document_stream(document))
        import io

        result = extract(document.file_extension, io.BytesIO(buffer))
        if result.warnings:
            warnings.append({"document": document.file_name, "warnings": result.warnings})
        if result.ocr_pages:
            warnings.append({"document": document.file_name,
                             "warnings": [f"{len(result.ocr_pages)} page(s) have no text layer and were skipped "
                                          f"(OCR is not enabled): pages {result.ocr_pages[:10]}"]})
        chunks = chunk_blocks(result.blocks)
        document.extraction_status = "done" if chunks else "failed"
        document.page_count = result.page_count
        for chunk in chunks:
            rows.append(_row(opportunity_id=opportunity_id, version_id=version.id, source_kind="document",
                             document_id=document.id, document_name=document.file_name,
                             document_category=document.category, page_number=chunk.page_number,
                             slide_number=chunk.slide_number, sheet_name=chunk.sheet_name,
                             section_path=chunk.section_path, ordinal=len(rows), text=chunk.text,
                             location_label=chunk.location(document.file_name), sha256=chunk.sha256,
                             meta={"kind": chunk.kind}))

    for start in range(0, len(rows), BATCH):
        batch = rows[start:start + BATCH]
        vectors = embeddings.embed([r.text for r in batch])
        for row, vector in zip(batch, vectors):
            row.embedding = vector
            row.embedding_model = embeddings.name
    db.add_all(rows)
    db.flush()
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.source_kind] = counts.get(row.source_kind, 0) + 1
    return {"chunks": counts, "documents": len(documents), "comments": len(comments), "warnings": warnings}


def corpus_entities(db: Session, version_id: UUID) -> set[str]:
    """Names the model is allowed to use (vendors, competitors, units) taken from the sources themselves."""
    from app.ai.validation import normalise

    version = db.get(OpportunityVersion, version_id)
    data = version.deepdive.data if version and version.deepdive else {}
    names: set[str] = set()
    for key in ("vendors", "competitors", "internal"):
        for item in data.get(key, []) or []:
            if isinstance(item, dict):
                for field in ("name", "unit", "provider"):
                    if item.get(field):
                        names.add(normalise(str(item[field])))
    for group in data.get("groups", []) or []:
        for row in (group or {}).get("rows", []) or []:
            if row.get("provider"):
                names.add(normalise(str(row["provider"])))
    for field in ("customer", "accountManager", "presalesOwner"):
        if data.get(field):
            names.add(normalise(str(data[field])))
    return names

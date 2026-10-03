"""Hybrid retrieval over one opportunity version: vector similarity plus keyword search, then merged.

Every query is filtered to a single version, so an analysis can never read another opportunity's material.
"""
from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.ai.providers import EmbeddingProvider


@dataclass
class Hit:
    chunk_id: str
    text: str
    location: str
    source_kind: str
    document_name: str
    field_path: str | None
    score: float


VECTOR_SQL = text("""
    SELECT id::text AS id, text, location_label, source_kind, document_name, field_path,
           1 - (embedding <=> CAST(:query AS vector)) AS score
    FROM document_chunks
    WHERE version_id = :version_id AND embedding IS NOT NULL
      AND (CAST(:kinds AS text) IS NULL OR source_kind = ANY(string_to_array(CAST(:kinds AS text), ',')))
    ORDER BY embedding <=> CAST(:query AS vector)
    LIMIT :limit
""")

KEYWORD_SQL = text("""
    SELECT id::text AS id, text, location_label, source_kind, document_name, field_path,
           ts_rank(search_vector, plainto_tsquery('simple', :q)) AS score
    FROM document_chunks
    WHERE version_id = :version_id AND search_vector @@ plainto_tsquery('simple', :q)
      AND (CAST(:kinds AS text) IS NULL OR source_kind = ANY(string_to_array(CAST(:kinds AS text), ',')))
    ORDER BY score DESC
    LIMIT :limit
""")


def search(db: Session, version_id: UUID, query: str, embeddings: EmbeddingProvider, *, limit: int = 12,
           kinds: list[str] | None = None) -> list[Hit]:
    kind_filter = ",".join(kinds) if kinds else None
    vector = embeddings.embed([query])[0]
    params = {"version_id": str(version_id), "kinds": kind_filter, "limit": limit}
    rows = db.execute(VECTOR_SQL.bindparams(bindparam("query")), {**params, "query": str(vector)}).mappings().all()
    keyword = db.execute(KEYWORD_SQL, {**params, "q": query}).mappings().all()

    merged: dict[str, Hit] = {}
    for rank, row in enumerate(rows):                       # reciprocal rank fusion keeps both signals useful
        merged[row["id"]] = Hit(row["id"], row["text"], row["location_label"], row["source_kind"],
                                row["document_name"], row["field_path"], 1.0 / (60 + rank))
    for rank, row in enumerate(keyword):
        hit = merged.get(row["id"])
        if hit:
            hit.score += 1.0 / (60 + rank)
        else:
            merged[row["id"]] = Hit(row["id"], row["text"], row["location_label"], row["source_kind"],
                                    row["document_name"], row["field_path"], 1.0 / (60 + rank))
    return sorted(merged.values(), key=lambda h: h.score, reverse=True)[:limit]


def all_chunks(db: Session, version_id: UUID, kinds: list[str] | None = None, limit: int = 400) -> list[Hit]:
    sql = text("""
        SELECT id::text AS id, text, location_label, source_kind, document_name, field_path
        FROM document_chunks
        WHERE version_id = :version_id AND (CAST(:kinds AS text) IS NULL OR source_kind = ANY(string_to_array(CAST(:kinds AS text), ',')))
        ORDER BY source_kind, document_name, ordinal
        LIMIT :limit
    """)
    rows = db.execute(sql, {"version_id": str(version_id), "kinds": ",".join(kinds) if kinds else None, "limit": limit}).mappings()
    return [Hit(r["id"], r["text"], r["location_label"], r["source_kind"], r["document_name"], r["field_path"], 1.0) for r in rows]


def render_context(hits: list[Hit], max_chars: int = 90_000) -> tuple[str, dict[str, str]]:
    """Formats chunks for the prompt and returns the id → text map used to police citations."""
    blocks, supplied, used = [], {}, 0
    labels = {"deepdive": "A. DEEPDIVE", "review": "B. DIRECTOR REVIEW", "document": "C. CUSTOMER DOCUMENTS"}
    for kind in ("deepdive", "review", "document"):
        section = [h for h in hits if h.source_kind == kind]
        if not section:
            continue
        blocks.append(f"\n=== {labels[kind]} ===")
        for hit in section:
            body = hit.text if len(hit.text) < 4000 else hit.text[:4000] + " …"
            entry = f"[{hit.chunk_id}] ({hit.location})\n{body}"
            if used + len(entry) > max_chars:
                blocks.append("… further material omitted for length.")
                break
            blocks.append(entry)
            supplied[hit.chunk_id] = hit.text
            used += len(entry)
    return "\n\n".join(blocks), supplied

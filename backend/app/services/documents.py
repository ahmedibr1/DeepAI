"""Opportunity documents: validation, storage and versioning of uploads."""
import uuid
from datetime import UTC, datetime
from typing import BinaryIO

from fastapi import Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import DocumentCategory, OpportunityStatus
from app.core.errors import conflict, forbidden, not_found, unprocessable
from app.models import Opportunity, OpportunityDocument, User
from app.services import audit
from app.services.access import is_team_director
from app.services.storage import build_key, get_storage

# First bytes that must match, per extension. Keeps a renamed executable out of the document store.
MAGIC: dict[str, tuple[bytes, ...]] = {
    "pdf": (b"%PDF",),
    "docx": (b"PK\x03\x04",), "xlsx": (b"PK\x03\x04",), "pptx": (b"PK\x03\x04",),
    "doc": (b"\xd0\xcf\x11\xe0",), "xls": (b"\xd0\xcf\x11\xe0",), "ppt": (b"\xd0\xcf\x11\xe0",),
    "msg": (b"\xd0\xcf\x11\xe0",),
    "png": (b"\x89PNG\r\n\x1a\n",), "jpg": (b"\xff\xd8\xff",), "jpeg": (b"\xff\xd8\xff",),
}
MIME = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "doc": "application/msword", "xls": "application/vnd.ms-excel", "ppt": "application/vnd.ms-powerpoint",
    "txt": "text/plain", "csv": "text/csv", "msg": "application/vnd.ms-outlook", "eml": "message/rfc822",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
}
UPLOADABLE_STATUSES = {OpportunityStatus.DRAFT, OpportunityStatus.CHANGES_REQUESTED}


def can_manage_documents(user: User, opp: Opportunity) -> bool:
    """Owners attach documents while the DeepDive is theirs to edit."""
    return opp.owner_id == user.id and opp.status in UPLOADABLE_STATUSES


def active_documents(db: Session, opportunity_id: uuid.UUID, version_id: uuid.UUID | None = None) -> list[OpportunityDocument]:
    """Documents belong to a version, like the DeepDive: v1 keeps what it was reviewed with."""
    stmt = (select(OpportunityDocument)
            .where(OpportunityDocument.opportunity_id == opportunity_id, OpportunityDocument.deleted_at.is_(None))
            .order_by(OpportunityDocument.uploaded_at.desc()))
    if version_id is not None:
        stmt = stmt.where(OpportunityDocument.version_id == version_id)
    return list(db.execute(stmt).scalars())


def carry_forward(db: Session, previous_version_id: uuid.UUID, new_version_id: uuid.UUID, opportunity_id: uuid.UUID) -> int:
    """A new version starts with the documents of the one it was copied from.

    The rows are copies pointing at the same stored bytes, so removing a document from the new version
    leaves the earlier version exactly as it was reviewed.
    """
    carried = 0
    for doc in active_documents(db, opportunity_id, previous_version_id):
        db.add(OpportunityDocument(
            id=uuid.uuid4(), opportunity_id=doc.opportunity_id, version_id=new_version_id,
            logical_document_id=doc.logical_document_id, doc_version=doc.doc_version, category=doc.category,
            file_name=doc.file_name, file_extension=doc.file_extension, mime_type=doc.mime_type,
            size_bytes=doc.size_bytes, sha256=doc.sha256, storage_key=doc.storage_key,
            scan_status=doc.scan_status, extraction_status="pending", page_count=doc.page_count,
            uploaded_by=doc.uploaded_by, uploaded_at=doc.uploaded_at,
        ))
        carried += 1
    return carried


def _validate(file: UploadFile, category: str) -> tuple[str, str]:
    s = get_settings()
    try:
        DocumentCategory(category)
    except ValueError:
        raise unprocessable("Choose a document category.")
    name = (file.filename or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise unprocessable("That file name is not valid.")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in s.allowed_document_extensions:
        raise unprocessable(f"{ext.upper() or 'That file type'} is not accepted. Allowed: "
                            + ", ".join(sorted(s.allowed_document_extensions)) + ".")
    head = file.file.read(8)
    file.file.seek(0)
    expected = MAGIC.get(ext)
    if expected and not any(head.startswith(sig) for sig in expected):
        raise unprocessable(f"The contents of “{name}” do not match a {ext.upper()} file.")
    return name, ext


def upload(db: Session, user: User, opp: Opportunity, file: UploadFile, category: str, request: Request) -> OpportunityDocument:
    s = get_settings()
    if not can_manage_documents(user, opp):
        raise forbidden("Documents can be added by the opportunity owner while it is in Draft or Changes Requested.")
    name, ext = _validate(file, category)
    count = db.scalar(select(func.count()).select_from(OpportunityDocument)
                      .where(OpportunityDocument.opportunity_id == opp.id,
                             OpportunityDocument.version_id == opp.current_version_id,
                             OpportunityDocument.deleted_at.is_(None))) or 0
    if count >= s.max_documents_per_opportunity:
        raise conflict(f"This opportunity already has {s.max_documents_per_opportunity} documents.")

    # Re-uploading the same file name supersedes the previous one and keeps the history.
    previous = db.execute(
        select(OpportunityDocument).where(
            OpportunityDocument.opportunity_id == opp.id, OpportunityDocument.version_id == opp.current_version_id,
            OpportunityDocument.file_name == name, OpportunityDocument.deleted_at.is_(None))
        .order_by(OpportunityDocument.doc_version.desc())).scalars().first()

    doc_id = uuid.uuid4()
    key = build_key(opp.id, doc_id, name)
    try:
        size, sha256 = get_storage().save(key, file.file, s.max_upload_mb * 1024 * 1024)
    except ValueError:
        raise unprocessable(f"“{name}” is larger than the {s.max_upload_mb} MB limit.")
    if size == 0:
        get_storage().delete(key)
        raise unprocessable(f"“{name}” is empty.")

    now = datetime.now(UTC)
    doc = OpportunityDocument(
        id=doc_id, opportunity_id=opp.id, version_id=opp.current_version_id,
        logical_document_id=previous.logical_document_id if previous else uuid.uuid4(),
        doc_version=(previous.doc_version + 1) if previous else 1,
        category=category, file_name=name, file_extension=ext, mime_type=MIME.get(ext, "application/octet-stream"),
        size_bytes=size, sha256=sha256, storage_key=key, uploaded_by=user.id,
        # Malware scanning is not part of this deployment; the integration point stays in the schema.
        scan_status="skipped", extraction_status="pending",
    )
    if previous:
        previous.deleted_at, previous.deleted_by = now, user.id
    db.add(doc)
    opp.updated_at = now
    opp.updated_by = user.id
    audit.record(db, "document.uploaded", actor=user, request=request, entity_type="opportunity_document",
                 entity_id=doc.id, opportunity_id=opp.id,
                 details={"file_name": name, "category": category, "size_bytes": size, "sha256": sha256,
                          "doc_version": doc.doc_version})
    return doc


def delete(db: Session, user: User, opp: Opportunity, document_id: uuid.UUID, request: Request) -> None:
    doc = db.get(OpportunityDocument, document_id)
    if doc is None or doc.opportunity_id != opp.id or doc.deleted_at is not None:
        raise not_found("Document")
    if not can_manage_documents(user, opp):
        raise forbidden("Documents can be removed by the owner before the opportunity is submitted.")
    doc.deleted_at = datetime.now(UTC)
    doc.deleted_by = user.id
    audit.record(db, "document.deleted", actor=user, request=request, entity_type="opportunity_document",
                 entity_id=doc.id, opportunity_id=opp.id, details={"file_name": doc.file_name})


def storage_key_is_orphaned(db: Session, storage_key: str, exclude_id: uuid.UUID) -> bool:
    others = db.scalar(select(func.count()).select_from(OpportunityDocument)
                       .where(OpportunityDocument.storage_key == storage_key, OpportunityDocument.id != exclude_id)) or 0
    return others == 0


def get_for_download(db: Session, opp: Opportunity, document_id: uuid.UUID) -> OpportunityDocument:
    doc = db.get(OpportunityDocument, document_id)
    if doc is None or doc.opportunity_id != opp.id or doc.deleted_at is not None:
        raise not_found("Document")
    return doc


def stream(doc: OpportunityDocument):
    return get_storage().open(doc.storage_key)


def can_view_documents(user: User, opp: Opportunity) -> bool:
    return opp.owner_id == user.id or is_team_director(user, opp) or user.role_key.value in ("admin", "presales_gm")

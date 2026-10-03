import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import current_user, require, verify_csrf
from app.core.enums import DocumentCategory
from app.core.errors import forbidden
from app.core.rbac import Perm
from app.db import get_db
from app.models import User
from app.schemas.common import DocumentOut
from app.services import audit, documents
from app.services.access import get_visible_opportunity

router = APIRouter(prefix="/opportunities/{opportunity_id}/documents", tags=["documents"])


def _out(d, viewer_can_manage: bool) -> DocumentOut:
    return DocumentOut(
        id=d.id, file_name=d.file_name, file_extension=d.file_extension, mime_type=d.mime_type,
        size_bytes=d.size_bytes, category=d.category, doc_version=d.doc_version, sha256=d.sha256,
        uploaded_at=d.uploaded_at, uploaded_by=d.uploader, version_number=d.version.version_number if d.version else None,
        can_delete=viewer_can_manage,
    )


@router.get("", response_model=list[DocumentOut])
def list_documents(opportunity_id: uuid.UUID, version_id: uuid.UUID | None = None, db: Session = Depends(get_db),
                   user: User = Depends(require(Perm.DOC_VIEW))):
    """Documents of one version. Defaults to the current one."""
    opp = get_visible_opportunity(db, user, opportunity_id)
    selected = version_id or opp.current_version_id
    # Only the current version can be changed, exactly like its DeepDive.
    manage = documents.can_manage_documents(user, opp) and selected == opp.current_version_id
    return [_out(d, manage) for d in documents.active_documents(db, opp.id, selected)]


@router.post("", response_model=DocumentOut, status_code=201)
def upload_document(opportunity_id: uuid.UUID, request: Request, file: UploadFile = File(...),
                    category: str = Form(DocumentCategory.OTHER.value), db: Session = Depends(get_db),
                    user: User = Depends(require(Perm.DOC_UPLOAD))):
    verify_csrf(request)   # multipart upload: the JSON dependency chain does not run here
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    doc = documents.upload(db, user, opp, file, category, request)
    db.commit()
    db.refresh(doc)
    return _out(doc, True)


@router.delete("/{document_id}", status_code=204)
def delete_document(opportunity_id: uuid.UUID, document_id: uuid.UUID, request: Request,
                    db: Session = Depends(get_db), user: User = Depends(require(Perm.DOC_UPLOAD))):
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    documents.delete(db, user, opp, document_id, request)
    db.commit()


@router.get("/{document_id}/download")
def download_document(opportunity_id: uuid.UUID, document_id: uuid.UUID, request: Request,
                      db: Session = Depends(get_db), user: User = Depends(current_user)):
    opp = get_visible_opportunity(db, user, opportunity_id)
    if not documents.can_view_documents(user, opp):
        raise forbidden("You cannot open documents for this opportunity.")
    doc = documents.get_for_download(db, opp, document_id)
    audit.record(db, "document.downloaded", actor=user, request=request, entity_type="opportunity_document",
                 entity_id=doc.id, opportunity_id=opp.id, details={"file_name": doc.file_name})
    db.commit()
    name = quote(doc.file_name)
    return StreamingResponse(documents.stream(doc), media_type=doc.mime_type, headers={
        "content-disposition": f"attachment; filename*=UTF-8''{name}",
        "content-length": str(doc.size_bytes),
        "x-content-type-options": "nosniff",
    })

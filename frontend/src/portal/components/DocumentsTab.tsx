import { useRef, useState } from "react";
import { api } from "../api/client";
import type { DocumentItem, OpportunityDetail, Reference } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { fmtDateTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Empty, ErrorAlert, useToast } from "./ui";

/** The demo has no server: it hands back a blob URL for the stored file instead of an API path. */
const demoDownload = (window as unknown as { __PORTAL_DEMO_DOWNLOAD__?: (id: string) => string }).__PORTAL_DEMO_DOWNLOAD__;
const hrefFor = (oppId: string, docId: string) => demoDownload?.(docId) ?? `/api/opportunities/${oppId}/documents/${docId}/download`;

const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function DocumentsTab({ opp, versionId, onChanged }: { opp: OpportunityDetail; versionId?: string; onChanged?: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const ref = useAsync(() => api.get<Reference>("/meta/reference"), []);
  const viewingCurrent = !versionId || versionId === opp.current_version_id;
  const docs = useAsync(() => api.get<DocumentItem[]>(`/opportunities/${opp.id}/documents`, { version_id: versionId }),
                        [opp.id, versionId]);
  const [category, setCategory] = useState("rfp");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Same rule as the API: the owner, while the opportunity is in Draft.
  // Documents are attached to the opportunity, so this does not depend on a version being unlocked.
  // Only the current version accepts changes; earlier versions keep what they were reviewed with.
  const canUpload = viewingCurrent && (me?.id === opp.owner.id || !!opp.can_edit)
    && opp.status === "draft";

  const send = async (files: FileList | File[]) => {
    setBusy(true);
    setError(null);
    let done = 0;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("category", category);
      try {
        await api.upload<DocumentItem>(`/opportunities/${opp.id}/documents`, form);
        done += 1;
      } catch (e) { setError(e); break; }
    }
    setBusy(false);
    if (done) { toast(`${done} document${done === 1 ? "" : "s"} uploaded.`); await docs.reload(); onChanged?.(); }
    if (fileInput.current) fileInput.current.value = "";
  };

  const remove = async (doc: DocumentItem) => {
    try {
      await api.del(`/opportunities/${opp.id}/documents/${doc.id}`);
      toast(`${doc.file_name} removed.`);
      await docs.reload();
      onChanged?.();
    } catch (e) { setError(e); }
  };

  const label = (key: string) => ref.data?.document_categories.find((c) => c.key === key)?.label ?? key;

  return (
    <section className="card" style={{ maxWidth: 1100 }}>
      <div className="card-pad" style={{ paddingBottom: 8 }}>
        <h2 className="section">Opportunity documents</h2>
        <p className="muted small" style={{ margin: 0 }}>
          RFP, RFI/RFQ, scope of work, customer requirements, BoQ, technical specifications, clarifications and emails.
          They belong to this version and are carried into the next one, so each version keeps the material it was
          reviewed and analysed with.
        </p>
      </div>

      {canUpload && (
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <ErrorAlert error={error} />
          <div className="upload-row">
            <div className="field" style={{ maxWidth: 260 }}>
              <label htmlFor="doc-category">Category for the next upload</label>
              <select id="doc-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {ref.data?.document_categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div className={`dropzone${dragging ? " over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) void send(e.dataTransfer.files); }}>
              <input ref={fileInput} id="doc-file" type="file" multiple className="vh"
                onChange={(e) => e.target.files?.length && void send(e.target.files)} />
              <label htmlFor="doc-file" className="btn primary">{busy ? "Uploading…" : "Choose files"}</label>
              <span className="muted small">or drop them here · up to {ref.data?.max_upload_mb ?? 100} MB each · PDF, Word, Excel, PowerPoint, text, email, images</span>
            </div>
          </div>
        </div>
      )}

      {docs.data && docs.data.length === 0 ? (
        <Empty title="No documents yet">
          {canUpload ? "Upload the RFP and any customer material for this opportunity." : "Nothing was attached to this opportunity."}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Document</th><th>Category</th><th>Size</th><th>Uploaded by</th><th>Uploaded</th><th><span className="vh">Actions</span></th></tr></thead>
            <tbody>
              {docs.data?.map((d) => (
                <tr key={d.id}>
                  <td>
                    <a className="opp-title" href={hrefFor(opp.id, d.id)} download={d.file_name}>{d.file_name}</a>
                    <div className="muted small">{d.file_extension.toUpperCase()}{d.doc_version > 1 ? ` · file version ${d.doc_version}` : ""}{d.version_number ? ` · added on DeepDive v${d.version_number}` : ""}</div>
                  </td>
                  <td>{label(d.category)}</td>
                  <td className="num">{fmtSize(d.size_bytes)}</td>
                  <td>{d.uploaded_by.full_name}</td>
                  <td className="small">{fmtDateTime(d.uploaded_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <a className="btn ghost small" href={hrefFor(opp.id, d.id)} download={d.file_name}>Download</a>{" "}
                    {d.can_delete && <button className="btn danger small" onClick={() => void remove(d)}>Remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canUpload && (
        <p className="muted small card-pad" style={{ paddingTop: 0 }}>
          Documents can be added or removed by the owner while the opportunity is in Draft.
        </p>
      )}
    </section>
  );
}


/** Step 8 of the DeepDive Builder: the documents that travel with this version. */
export function DocumentsStep({ opp, versionId, snapshot, onChanged }: {
  opp: OpportunityDetail; versionId?: string;
  snapshot: { group: string; label: string; version: string | null; files: number }[];
  onChanged?: () => void;
}) {
  return (
    <section className="card panel" id="deepdive-documents" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <h2 className="section"><span className="step-kicker">Step 8 of 9</span> Documents</h2>
        <span className="muted small">
          Everything uploaded here becomes part of this DeepDive version when it is submitted.
        </span>
      </div>
      <div className="card-pad" style={{ paddingTop: 0 }}>
        <ul className="snapshot-inline">
          {snapshot.map((r) => (
            <li key={r.group}><span>{r.label}</span><b className={r.version ? "" : "muted"}>{r.version ?? "Not available"}</b></li>
          ))}
        </ul>
      </div>
      <DocumentsTab opp={opp} versionId={versionId} onChanged={onChanged} />
    </section>
  );
}

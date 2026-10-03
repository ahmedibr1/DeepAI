/* Hosts the existing DeepDive Builder (builder.html?embed=1) and connects it to the portal API.
 * - Loads the selected version's DeepDive into the builder.
 * - Autosaves edits with optimistic concurrency (revision), and flushes on demand before submitting.
 * - Read-only for locked versions and for anyone who is not the owner in an editable status.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { OpportunityDetail, VersionDetail, VersionSummary, DocumentItem } from "../api/types";
import { fmtDateTime } from "../lib/format";

export interface BuilderHandle {
  flush: () => Promise<boolean>;
  errorCount: () => number | null;
  gotoReview: () => void;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

interface Props {
  opportunity: OpportunityDetail;
  versionId: string;          // chosen above the tabs, shared with Documents, Review and AI
  onSaved: (v: VersionSummary) => void;
}

const AUTOSAVE_MS = 2000;

/** Normally /builder.html. In the single-file demo the builder is inlined and served from a blob URL. */
let cachedSrc: string | null = null;
const inlinedBuilder = () => (window as unknown as { __PORTAL_DEMO_BUILDER__?: string }).__PORTAL_DEMO_BUILDER__;
const opaqueOrigin = !window.location.origin || window.location.origin === "null";

/** Demo opened from disk (file://): a blob: frame can't be messaged, so the document is inlined instead. */
function builderDoc(): string | undefined {
  const html = inlinedBuilder();
  return html && opaqueOrigin ? html : undefined;
}
function builderUrl(): string | undefined {
  if (builderDoc()) return undefined;
  if (cachedSrc) return cachedSrc;
  const html = inlinedBuilder();
  cachedSrc = html ? URL.createObjectURL(new Blob([html], { type: "text/html" })) : "/builder.html?embed=1";
  return cachedSrc;
}

/** The six document groups the DeepDive version is measured by. */
const DOC_GROUPS: { key: string; label: string; categories: string[] }[] = [
  { key: "customer", label: "Customer Documents", categories: ["rfp", "rfq", "rfi", "sow", "clarification", "customer_other"] },
  { key: "tp", label: "Technical Proposal (TP)", categories: ["tp"] },
  { key: "cp", label: "Commercial Proposal (CP)", categories: ["cp"] },
  { key: "ta", label: "Tender Analyzer (TA)", categories: ["ta"] },
  { key: "quotation", label: "Quotation", categories: ["quotation"] },
  { key: "other", label: "Supporting documents", categories: ["other"] },
];

const snapshotOf = (docs: DocumentItem[], _labels: Map<string, string>) =>
  DOC_GROUPS.map((g) => {
    const mine = docs.filter((d) => g.categories.includes(d.category));
    return { group: g.key, label: g.label, version: mine.length ? `v${Math.max(...mine.map((d) => d.doc_version))}` : null };
  });

export const BuilderHost = forwardRef<BuilderHandle, Props>(function BuilderHost({ opportunity, versionId, onSaved }, ref) {
  // Documents are step 8 inside the form: the builder asks, the portal uploads and sends the list back.
  const pushDocuments = useCallback(async () => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    try {
      const [docs, meta] = await Promise.all([
        api.get<DocumentItem[]>(`/opportunities/${opportunity.id}/documents`, { version_id: versionId }),
        api.get<{ document_categories: { key: string; label: string }[] }>("/meta/reference"),
      ]);
      const labels = new Map(meta.document_categories.map((c) => [c.key, c.label]));
      win.postMessage({
        type: "docs:list",
        canManage: docs.length ? docs[0].can_delete : opportunity.can_edit,
        categories: meta.document_categories,
        items: docs.map((d) => ({
          id: d.id, file_name: d.file_name, category: d.category, category_label: labels.get(d.category) ?? d.category,
          doc_version: d.doc_version, uploaded_by: d.uploaded_by.full_name, uploaded_at: d.uploaded_at,
        })),
        snapshot: snapshotOf(docs, labels),
      }, "*");
    } catch { /* the step shows an empty list until the portal can read the documents */ }
  }, [opportunity.id, opportunity.can_edit, versionId]);

  const [frameHeight, setFrameHeight] = useState(900);

  useEffect(() => {
    const handle = async (e: MessageEvent) => {
      const data = e.data as { type?: string; category?: string; files?: File[]; id?: string; height?: number };
      // The form grows with its content so the page scrolls once, not twice.
      if (data?.type === "builder:height" && data.height) setFrameHeight(Math.max(640, Math.ceil(data.height) + 24));
      if (data?.type === "docs:upload" && data.files?.length) {
        for (const file of data.files) {
          const body = new FormData();
          body.append("file", file);
          body.append("category", data.category ?? "rfp");
          try { await api.upload(`/opportunities/${opportunity.id}/documents`, body); } catch { /* reported by the list */ }
        }
        await pushDocuments();
      }
      if (data?.type === "docs:remove" && data.id) {
        try { await api.del(`/opportunities/${opportunity.id}/documents/${data.id}`); } catch { /* ignore */ }
        await pushDocuments();
      }
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [opportunity.id, pushDocuments]);

  useEffect(() => {
    const timer = setInterval(() => void pushDocuments(), 1500);   // the step reflects the portal's list
    return () => clearInterval(timer);
  }, [pushDocuments]);

  const frame = useRef<HTMLIFrameElement>(null);
  const [version, setVersion] = useState<VersionDetail | null>(null);
  const versionRef = useRef<VersionDetail | null>(null);   // the builder may announce itself before React re-renders
  const [state, setState] = useState<SaveState>("idle");
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [frameBlocked, setFrameBlocked] = useState(false);
  const ready = useRef(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  const revision = useRef(0);
  const errors = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<Promise<boolean> | null>(null);

  const editable = !!version && opportunity.can_edit && version.id === opportunity.current_version_id && !version.is_locked;

  // file:// and blob: pages have an opaque origin; the iframe identity check below is the real guard.
  const sameOrigin = window.location.origin && window.location.origin !== "null";
  // The demo's inlined builder runs from a blob: URL. Opened from disk, that frame's origin is "null" while
  // this page reports "file://", so a message addressed to our own origin is silently dropped and the
  // builder never receives the version. We only ever post to the frame we created, so "*" is safe there.
  const targetOrigin = sameOrigin && !inlinedBuilder() ? window.location.origin : "*";
  const post = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(msg, targetOrigin);

  const pushToBuilder = useCallback((v: VersionDetail) => {
    if (!ready.current) return;
    post({
      type: "dd:load", data: v.data,
      readOnly: !(opportunity.can_edit && v.id === opportunity.current_version_id && !v.is_locked),
      context: {
        opportunityNumber: opportunity.opportunity_number, opportunityName: opportunity.title,
        customer: opportunity.account_name, owner: opportunity.owner.full_name,
        versionNumber: v.version_number, status: opportunity.status,
      },
    });
  }, [opportunity.account_name, opportunity.can_edit, opportunity.current_version_id, opportunity.opportunity_number,
      opportunity.owner.full_name, opportunity.status, opportunity.title]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    api.get<VersionDetail>(`/opportunities/${opportunity.id}/versions/${versionId}`)
      .then((v) => {
        if (cancelled) return;
        versionRef.current = v;
        setVersion(v);
        revision.current = v.revision;
        pending.current = null;
        setState("idle");
        pushToBuilder(v);
      })
      .catch((e: Error) => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [opportunity.id, versionId, pushToBuilder]);

  // Re-send when the read-only decision changes, for example right after submitting.
  useEffect(() => { if (ready.current && versionRef.current) pushToBuilder(versionRef.current); }, [pushToBuilder]);

  const save = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    if (!pending.current || !version) return true;
    const data = pending.current;
    pending.current = null;
    setState("saving");
    const run = (async () => {
      try {
        const saved = await api.put<VersionSummary>(`/opportunities/${opportunity.id}/versions/${version.id}/deepdive`, { data, revision: revision.current });
        revision.current = saved.revision;
        setLastSaved(saved.updated_at);
        setState(pending.current ? "dirty" : "saved");
        onSaved(saved);
        return true;
      } catch (e) {
        pending.current = pending.current ?? data;
        setState(e instanceof ApiError && e.status === 409 ? "conflict" : "error");
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [opportunity.id, version, onSaved]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (sameOrigin && event.origin !== window.location.origin && event.origin !== "null") return;
      const msg = event.data ?? {};
      if (msg.type === "dd:ready") { ready.current = true; if (versionRef.current) pushToBuilder(versionRef.current); }
      if (msg.type === "dd:state" || msg.type === "dd:changed") errors.current = msg.errorCount ?? null;
      if (msg.type === "dd:changed" && editable) {
        pending.current = msg.data;
        setState("dirty");
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [editable, pushToBuilder, save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); window.clearTimeout(timer.current); void save(); };
  }, [save]);

  // Opened as a local file, the browser gives the page an opaque origin and blocks the embedded builder.
  useEffect(() => {
    if (!opaqueOrigin || !inlinedBuilder()) return;
    const t = window.setTimeout(() => { if (!ready.current) setFrameBlocked(true); }, 5000);
    return () => window.clearTimeout(t);
  }, []);

  useImperativeHandle(ref, () => ({
    flush: async () => { window.clearTimeout(timer.current); return save(); },
    errorCount: () => errors.current,
    gotoReview: () => post({ type: "dd:goto-review" }),
  }), [save]);

  const label: Record<SaveState, string> = {
    idle: editable ? "All changes are saved to the portal" : "Read-only",
    dirty: "Unsaved changes…", saving: "Saving…",
    saved: `Saved${lastSaved ? ` · ${fmtDateTime(lastSaved)}` : ""}`,
    error: "Couldn’t save. Check your connection — we’ll retry when you edit again.",
    conflict: "This DeepDive was changed elsewhere. Reload the page to get the latest version before editing.",
  };

  return (
    <div>
      <div className="builder-bar">
        {!editable && version && (
          <span className="badge st-draft" title="The owner, the Portfolio Presales Manager and the Portfolio Presales Director can edit an open version.">
            {version.is_locked ? `v${version.version_number} is locked — open a new version to edit` : "View only"}
          </span>
        )}
        <span className="muted small" title="Opportunity number, name, account and owner come from the opportunity record">
          {opportunity.opportunity_number} · v{version?.version_number ?? "—"}
        </span>
        <span className={`save-state${state === "error" || state === "conflict" ? " bad" : ""}`} role="status" aria-live="polite">{label[state]}</span>
        {state === "conflict" && <button className="btn ghost small" onClick={() => window.location.reload()}>Reload</button>}
      </div>
      {loadError && <div className="alert error" style={{ margin: 16 }}>{loadError}</div>}
      {frameBlocked && (
        <div className="alert info" style={{ margin: 16 }}>
          <b>The DeepDive Builder can’t run in this window.</b> You opened the demo as a file on your computer, and browsers
          block embedded content in that case. Open the demo from its web link instead, and everything else here works as it does now.
        </div>
      )}
      <iframe ref={frame} className="builder-frame" style={{ height: frameHeight }} title="DeepDive Builder" src={builderUrl()} srcDoc={builderDoc()}
        onLoad={() => { /* dd:ready arrives from the builder once its script has run */ }} />
    </div>
  );
});

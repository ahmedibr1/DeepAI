/* "Import sheet": reads the opportunities sheet, shows what will change, and applies it on confirmation.
   New rows become active opportunities; sheet-managed opportunities missing from the sheet are archived.
   Opportunities added by hand are flagged "Manual" and left alone. */
import { useRef, useState } from "react";
import { api } from "../api/client";
import { readOpportunitySheet, REQUIRED_HEADERS, type OpportunityRow } from "../lib/sheet";
import { Icon } from "./Icon";
import { ErrorAlert, Modal, useToast } from "./ui";

interface Brief { number: string; title: string; account: string }
interface Plan {
  rows: number; add: Brief[]; restore: Brief[]; archive: Brief[]; manual: Brief[]; unchanged: number;
  invalid: { row: number; reason: string }[]; applied?: boolean;
}

function List({ title, items }: { title: string; items: Brief[] }) {
  if (!items.length) return null;
  return <>
    <b className="small">{title}</b>
    <ul className="sheet-list">{items.map((o) => <li key={o.number}><b>{o.number}</b> · {o.title} — {o.account}</li>)}</ul>
  </>;
}

export function SheetImport({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string>("");
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const close = () => { setRows(null); setPlan(null); setError(null); };

  const pick = async (f: File) => {
    setBusy(true); setError(null); setFile(f.name);
    try {
      const sheet = await readOpportunitySheet(f);
      setRows(sheet.rows);
      setPlan(await api.post<Plan>("/opportunities/import-sheet", { rows: sheet.rows, apply: false }));
    } catch (e) {
      setRows([]); setPlan(null);
      setError(e instanceof Error && !(e as { status?: number }).status ? { message: e.message } : e);
    } finally { setBusy(false); }
  };

  const apply = async () => {
    setBusy(true); setError(null);
    try {
      const done = await api.post<Plan>("/opportunities/import-sheet", { rows, apply: true });
      toast(`Sheet applied: ${done.add.length} added, ${done.archive.length} archived, ${done.restore.length} restored.`);
      close(); onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const changes = plan ? plan.add.length + plan.archive.length + plan.restore.length : 0;
  return <>
    <input ref={input} type="file" accept=".xlsx,.csv" hidden
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
    <button type="button" className="btn ghost" disabled={busy} onClick={() => input.current?.click()}>
      <Icon name="doc" /> {busy && !rows ? "Reading…" : "Import sheet"}
    </button>
    {rows && (
      <Modal wide title="Import opportunities sheet" onClose={close} footer={<>
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={busy || !plan || changes === 0} onClick={() => void apply()}>
          {busy ? "Applying…" : changes ? `Apply ${changes} change${changes === 1 ? "" : "s"}` : "Nothing to change"}
        </button>
      </>}>
        <p className="muted small" style={{ marginTop: 0 }}>
          {file} · Opportunities are matched by Opportunity Number. The sheet needs these columns: {REQUIRED_HEADERS.join(", ")}.
        </p>
        <ErrorAlert error={error} />
        {plan && <>
          <div className="sheet-summary">
            <div className="add"><b>{plan.add.length}</b><span>New → Active</span></div>
            <div className="archive"><b>{plan.archive.length}</b><span>Not in sheet → Archive</span></div>
            <div><b>{plan.restore.length}</b><span>Back in sheet → Restore</span></div>
            <div><b>{plan.unchanged}</b><span>Already active</span></div>
            <div><b>{plan.manual.length}</b><span>⚑ Manual — left as is</span></div>
            {plan.invalid.length > 0 && <div><b>{plan.invalid.length}</b><span>Rows skipped</span></div>}
          </div>
          <List title="Will be added as active" items={plan.add} />
          <List title="Will be archived (no longer in the sheet)" items={plan.archive} />
          <List title="Will be restored" items={plan.restore} />
          <List title="Added by hand — the sheet does not change these" items={plan.manual} />
          {plan.invalid.length > 0 && <>
            <b className="small">Skipped rows</b>
            <ul className="sheet-list">{plan.invalid.map((r) => <li key={r.row}>Row {r.row}: {r.reason}</li>)}</ul>
          </>}
        </>}
      </Modal>
    )}
  </>;
}

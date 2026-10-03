/* Portfolios / Verticals — one Administration page with both sections. */
import { useState } from "react";
import { api } from "../../api/client";
import type { Team, UserRef } from "../../api/types";
import { Empty, ErrorAlert, Modal, PageHeader } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { TeamsPanel } from "./TeamsPage";

interface UserRefLite { id: string; full_name: string }
interface Vertical {
  id: string; name: string; is_active: boolean;
  sales_director?: UserRefLite | null; account_managers?: UserRefLite[];
}

function VerticalsPanel() {
  const list = useAsync(() => api.get<Vertical[]>("/admin/verticals"), []);
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<{ id?: string; name: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const rows = (list.data ?? []).filter((v) => v.name.toLowerCase().includes(query.toLowerCase()));

  const save = async () => {
    if (!edit) return;
    setBusy(true); setError(null);
    try {
      if (edit.id) await api.patch(`/admin/verticals/${edit.id}`, { name: edit.name });
      else await api.post("/admin/verticals", { name: edit.name });
      setEdit(null);
      await list.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const remove = async (v: Vertical) => {
    try { await api.del(`/admin/verticals/${v.id}`); await list.reload(); }
    catch (e) { setError(e); }
  };

  return (
    <section className="card panel">
      <div className="panel-head">
        <h2 className="section">Verticals ({list.data?.length ?? 0})</h2>
        <div className="panel-tools">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." aria-label="Search verticals" />
          <button className="btn primary" onClick={() => { setError(null); setEdit({ name: "" }); }}>Add Vertical</button>
        </div>
      </div>
      <ErrorAlert error={error ?? list.error} />
      {rows.length === 0 ? <Empty title="No verticals yet">Add the verticals your opportunities belong to.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Vertical</th><th>Sales Director</th><th>Account Managers</th><th>Status</th>
              <th><span className="vh">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td><b>{v.name}</b></td>
                  <td>{v.sales_director?.full_name ?? <span className="muted">Not set</span>}</td>
                  <td>
                    {v.account_managers?.length
                      ? <span className="people">{v.account_managers.map((m) => m.full_name).join(" · ")}</span>
                      : <span className="muted">None</span>}
                  </td>
                  <td>{v.is_active ? "Active" : "Inactive"}</td>
                  <td className="row-actions">
                    <button className="btn ghost small" onClick={() => { setError(null); setEdit({ id: v.id, name: v.name }); }}>Edit</button>
                    <button className="btn ghost small danger" onClick={() => void remove(v)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <Modal title={edit.id ? "Edit vertical" : "Add vertical"} onClose={() => setEdit(null)} footer={<>
          <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn primary" disabled={busy || edit.name.trim().length < 2} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>}>
          <ErrorAlert error={error} />
          <div className="field span">
            <label htmlFor="v-name">Vertical name</label>
            <input id="v-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={120} autoFocus />
          </div>
        </Modal>
      )}
    </section>
  );
}

export function PortfoliosPage() {
  return (
    <main className="content wide">
      <PageHeader title="Portfolios / Verticals"
        lede="A portfolio carries its Sales GM, Presales Director and Presales Manager; a vertical carries its Sales Director and Account Managers." />
      <TeamsPanel />
      <VerticalsPanel />
    </main>
  );
}

export type { Team, UserRef };

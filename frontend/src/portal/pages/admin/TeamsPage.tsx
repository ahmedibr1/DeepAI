import { useState } from "react";
import { api } from "../../api/client";
import type { Reference, Team } from "../../api/types";
import { Empty, ErrorAlert, Modal, useToast } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";

export function TeamsPanel() {
  const toast = useToast();
  const teams = useAsync(() => api.get<Team[]>("/admin/teams"), []);
  const ref = useAsync(() => api.get<Reference>("/meta/reference"), []);
  const [edit, setEdit] = useState<{ id?: string; name: string; director_id: string; manager_id: string; is_active: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");

  const save = async () => {
    if (!edit) return;
    setError(null);
    try {
      if (edit.id) await api.patch(`/admin/teams/${edit.id}`, {
        name: edit.name, director_id: edit.director_id || null, clear_director: !edit.director_id,
        manager_id: edit.manager_id || null, clear_manager: !edit.manager_id, is_active: edit.is_active });
      else await api.post("/admin/teams", { name: edit.name, director_id: edit.director_id || null, manager_id: edit.manager_id || null });
      toast(edit.id ? "Team updated." : "Team created.");
      setEdit(null);
      await teams.reload();
    } catch (e) { setError(e); }
  };

  return (
    <>
      <ErrorAlert error={teams.error} />
      <section className="card panel">
        <div className="panel-head">
          <h2 className="section">Portfolios ({teams.data?.length ?? 0})</h2>
          <div className="panel-tools">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." aria-label="Search portfolios" />
            <button className="btn primary" onClick={() => { setError(null); setEdit({ name: "", director_id: "", manager_id: "", is_active: true }); }}>
              Add Portfolio
            </button>
          </div>
        </div>
        {teams.data && teams.data.length === 0 ? <Empty title="No portfolios yet">Create a portfolio and choose its Director and Manager.</Empty> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Portfolio</th><th>Sales GM</th><th>Presales Director</th><th>Presales Manager</th>
  <th>Presales Leads</th><th>Status</th><th><span className="vh">Actions</span></th></tr></thead>
              <tbody>
                {(teams.data ?? []).filter((t) => t.name.toLowerCase().includes(query.toLowerCase())).map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.name}</b></td>
                    <td>{(t as { sales_gm?: { full_name: string } }).sales_gm?.full_name ?? <span className="muted">Not set</span>}</td>
                    <td>{t.director?.full_name ?? <span className="muted">Not set</span>}</td>
                    <td>{t.manager?.full_name ?? <span className="muted">Not set</span>}</td>
                    <td className="num">{t.member_count}</td>
                    <td>{t.is_active ? <span className="badge st-completed">Active</span> : <span className="badge st-draft">Inactive</span>}</td>
                    <td><button className="btn ghost small" onClick={() => { setError(null); setEdit({ id: t.id, name: t.name, director_id: t.director?.id ?? "", manager_id: t.manager?.id ?? "", is_active: t.is_active }); }}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="muted small" style={{ marginTop: 12 }}>Add Presales Lead users to a portfolio from the Users page.</p>

      {edit && (
        <Modal title={edit.id ? "Edit portfolio" : "Add portfolio"} onClose={() => setEdit(null)} footer={<>
          <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn primary" disabled={edit.name.trim().length < 2} onClick={() => void save()}>Save</button>
        </>}>
          <ErrorAlert error={error} />
          <div className="form-grid" style={{ marginTop: 10 }}>
            <div className="field span"><label htmlFor="t-name">Portfolio name</label><input id="t-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="t-dir">Portfolio Presales Director</label>
              <select id="t-dir" value={edit.director_id} onChange={(e) => setEdit({ ...edit, director_id: e.target.value })}>
                <option value="">Not set</option>
                {ref.data?.directors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="t-mgr">Portfolio Presales Manager</label>
              <select id="t-mgr" value={edit.manager_id} onChange={(e) => setEdit({ ...edit, manager_id: e.target.value })}>
                <option value="">Not set</option>
                {ref.data?.managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select></div>
            {edit.id && <label className="span" style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, fontSize: 14 }}>
              <input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Portfolio active</label>}
          </div>
        </Modal>
      )}
    </>
  );
}


export function TeamsPage() {
  return <TeamsPanel />;
}

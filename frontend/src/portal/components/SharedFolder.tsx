/* Shared folder panel on the DeepDive tab: connect the opportunity's folder once, then the portal watches it.
   A new or changed Builder PowerPoint/draft or Readiness checklist Excel becomes a new DeepDive version. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { OpportunityDetail } from "../api/types";
import { fmtDateTime } from "../lib/format";
import { folderSupported, getFolder, permission, pickFolder, readFolder, scanFolder, setFolder, type DirHandle,
         type FolderScan } from "../lib/folder";
import { Icon } from "./Icon";
import { useToast } from "./ui";

const CHECK_EVERY_MS = 15000;

export function SharedFolder({ opp, onChanged }: { opp: OpportunityDetail; onChanged: () => void }) {
  const [handle, setHandle] = useState<DirHandle | null>(null);
  const [perm, setPerm] = useState<"granted" | "denied" | "prompt" | null>(null);
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const failed = useRef<string | null>(null);      // a signature that could not be read, so it is not retried every tick
  const running = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const check = useCallback(async (h: DirHandle, signature: string | null) => {
    if (running.current) return;
    running.current = true;
    try {
      const s = await scanFolder(h);
      setScan(s); setChecked(new Date().toISOString());
      if ((!s.deepdive && !s.checklist) || s.signature === signature || s.signature === failed.current) return;
      const read = await readFolder(s);
      setWarnings(read.warnings);
      if (!read.data && !read.groups) { failed.current = s.signature; return; }
      const res = await api.post<{ changed: boolean; version_number?: number }>(`/opportunities/${opp.id}/folder-import`, {
        signature: s.signature, data: read.data, groups: read.groups,
        files: { deepdive: read.data ? s.deepdive?.name : null, checklist: read.groups ? s.checklist?.name : null },
      });
      if (res.changed) { toast(`DeepDive v${res.version_number} recorded from the shared folder.`); onChanged(); }
    } catch (e) {
      setWarnings([e instanceof Error ? e.message : "The shared folder could not be read."]);
    } finally { running.current = false; }
  }, [opp.id, onChanged, toast]);

  // Re-open the remembered folder; browsers ask again for access after a restart.
  useEffect(() => {
    let alive = true;
    void getFolder(opp.id).then(async (h) => {
      if (!alive || !h) return;
      setHandle(h);
      setPerm(await permission(h));
    });
    return () => { alive = false; };
  }, [opp.id]);

  // Watch the folder while the DeepDive tab is open, and whenever the window regains focus.
  useEffect(() => {
    if (!handle || perm !== "granted") return;
    void check(handle, opp.folder_signature ?? null);
    const timer = window.setInterval(() => void check(handle, opp.folder_signature ?? null), CHECK_EVERY_MS);
    const onFocus = () => void check(handle, opp.folder_signature ?? null);
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [handle, perm, opp.folder_signature, check]);

  const connect = async () => {
    setBusy(true);
    try {
      const h = await pickFolder();
      await setFolder(opp.id, h);
      await api.post(`/opportunities/${opp.id}/folder`, { name: h.name });
      failed.current = null;
      setHandle(h); setPerm(await permission(h, true, "readwrite"));
      toast(`Shared folder “${h.name}” connected.`);
      onChanged();
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") setWarnings(["The folder could not be opened."]);
    } finally { setBusy(false); }
  };
  const reconnect = async () => { if (handle) setPerm(await permission(handle, true, "readwrite")); };
  const disconnect = async () => {
    await setFolder(opp.id, null);
    await api.post(`/opportunities/${opp.id}/folder`, { name: null });
    setHandle(null); setPerm(null); setScan(null); setWarnings([]);
    onChanged();
  };

  // Manual upload: the same files the folder would hold, picked by hand. Always records a new version.
  const upload = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setBusy(true); setWarnings([]);
    try {
      const entry = (f: File) => ({ name: f.name, size: f.size, modified: f.lastModified, file: f });
      const pick = (re: RegExp) => files.filter((f) => re.test(f.name)).sort((a, b) => b.lastModified - a.lastModified)[0];
      const deck = pick(/\.(pptx|json)$/i);
      const sheet = pick(/\.xlsx$/i);
      if (!deck && !sheet) { setWarnings(["Choose the DeepDive PowerPoint (.pptx) or draft (.json), and/or the Readiness checklist (.xlsx)."]); return; }
      const s: FolderScan = { deepdive: deck ? entry(deck) : null, checklist: sheet ? entry(sheet) : null,
        signature: `upload:${Date.now()}`, files: files.length };
      const read = await readFolder(s);
      setWarnings(read.warnings);
      if (!read.data && !read.groups) return;
      const res = await api.post<{ changed: boolean; version_number?: number }>(`/opportunities/${opp.id}/folder-import`, {
        manual: true, signature: s.signature, data: read.data, groups: read.groups,
        files: { deepdive: read.data ? deck?.name : null, checklist: read.groups ? sheet?.name : null },
      });
      if (res.changed) { toast(`DeepDive v${res.version_number} recorded from the uploaded file${files.length > 1 ? "s" : ""}.`); onChanged(); }
    } catch (e) {
      setWarnings([e instanceof Error ? e.message : "The files could not be read."]);
    } finally { setBusy(false); }
  };
  const uploadButton = <>
    <input ref={fileInput} type="file" hidden multiple accept=".pptx,.json,.xlsx"
      onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
    <button className="btn ghost small" disabled={busy} onClick={() => fileInput.current?.click()}
      title="Upload the DeepDive PowerPoint (or draft .json) and/or the Readiness checklist Excel">
      <Icon name="doc" /> Upload DeepDive
    </button>
  </>;

  if (!folderSupported() && !handle) {
    return (
      <div className="folder-bar muted">
        <Icon name="archive" />
        <span className="folder-text">Upload the DeepDive PowerPoint and Readiness checklist here. Watching a shared
          folder needs Chrome or Microsoft Edge.</span>
        {uploadButton}
        {warnings.length > 0 && <ul className="folder-warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      </div>
    );
  }

  return (
    <div className="folder-bar">
      <span className="folder-icon"><Icon name="archive" /></span>
      {!handle ? (
        <>
          <div className="folder-text">
            <b>Shared folder</b>
            <span className="muted small">
              Connect the folder where the Presales Lead saves the DeepDive (PowerPoint from DeepDive Builder) and the
              Readiness checklist (Excel), or upload them by hand. Each new file becomes a new DeepDive version.
            </span>
          </div>
          {uploadButton}
          <button className="btn primary small" disabled={busy} onClick={() => void connect()}>Connect folder</button>
        </>
      ) : (
        <>
          <div className="folder-text">
            <b>{handle.name}</b>
            <span className="muted small">
              {perm !== "granted" ? "Allow access again to keep watching this folder."
                : scan ? <>
                    DeepDive: {scan.deepdive ? `${scan.deepdive.name} (${fmtDateTime(new Date(scan.deepdive.modified).toISOString())})` : "none yet"}
                    {" · "}Checklist: {scan.checklist ? scan.checklist.name : "none yet"}
                    {checked && <> · checked {fmtDateTime(checked)}</>}
                  </>
                : "Checking…"}
            </span>
          </div>
          {perm !== "granted"
            ? <button className="btn primary small" onClick={() => void reconnect()}>Allow access</button>
            : <button className="btn ghost small" onClick={() => void check(handle, opp.folder_signature ?? null)}>Check now</button>}
          {uploadButton}
          <button className="btn ghost small" onClick={() => void connect()}>Change</button>
          <button className="btn ghost small" onClick={() => void disconnect()}>Disconnect</button>
        </>
      )}
      {warnings.length > 0 && <ul className="folder-warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </div>
  );
}

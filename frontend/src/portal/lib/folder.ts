/* The opportunity's shared folder (e.g. a synced OneDrive/SharePoint folder on this computer), accessed with the
   browser's File System Access API (Chrome / Edge). The Presales Lead fills the DeepDive offline in DeepDive Builder
   and drops the exported PowerPoint (or a saved draft .json) and the Readiness checklist Excel here. The portal reads
   the newest of each; when they change, it records a new DeepDive version. Files the portal writes itself
   (<number>_DeepAI_vN.json) are never read back as a new version. */
import JSZip from "jszip";
import { readEmbeddedData, readTrackerXlsx } from "../../builder/deck.js";

type Perm = "granted" | "denied" | "prompt";
export interface DirHandle {
  kind: "directory"; name: string;
  values(): AsyncIterable<{ kind: string; name: string; getFile?: () => Promise<File> }>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }> }>;
  queryPermission?(o: { mode: "read" | "readwrite" }): Promise<Perm>;
  requestPermission?(o: { mode: "read" | "readwrite" }): Promise<Perm>;
}

export const folderSupported = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
export const OWN_FILE = /_DeepAI_v\d+\.json$/i;

/* Handles survive reloads in IndexedDB; a few test hooks keep in-memory ones instead. */
const memory = new Map<string, DirHandle>();
const DB = "deepai-folders", STORE = "handles";
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key: string): Promise<DirHandle | undefined> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as DirHandle | undefined);
      r.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}
async function idbSet(key: string, value: DirHandle | null) {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      if (value) tx.objectStore(STORE).put(value, key); else tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
    });
  } catch { /* storage unavailable: the folder is remembered for this page only */ }
}

export async function getFolder(oppId: string): Promise<DirHandle | null> {
  return memory.get(oppId) ?? (await idbGet(oppId)) ?? null;
}
export async function setFolder(oppId: string, handle: DirHandle | null, inMemoryOnly = false) {
  if (handle) memory.set(oppId, handle); else memory.delete(oppId);
  if (!inMemoryOnly) await idbSet(oppId, handle);
}
export async function pickFolder(): Promise<DirHandle> {
  const picker = (window as unknown as { showDirectoryPicker: (o?: object) => Promise<DirHandle> }).showDirectoryPicker;
  return picker({ mode: "readwrite", id: "deepai-opportunity" });
}

/** "granted" when the folder can be used now; "prompt" means a click is needed to allow it again. */
export async function permission(handle: DirHandle, ask = false, mode: "read" | "readwrite" = "read"): Promise<Perm> {
  if (!handle.queryPermission) return "granted";
  const now = await handle.queryPermission({ mode });
  if (now === "granted" || !ask || !handle.requestPermission) return now;
  return handle.requestPermission({ mode });
}

export interface FolderFile { name: string; size: number; modified: number; file: File }
export interface FolderScan {
  deepdive: FolderFile | null;      // newest Builder PowerPoint (.pptx) or saved draft (.json)
  checklist: FolderFile | null;     // newest Readiness checklist Excel (.xlsx)
  signature: string;                // changes whenever either file changes
  files: number;
}

const sig = (f: FolderFile | null) => (f ? `${f.name}:${f.size}:${f.modified}` : "-");

export async function scanFolder(handle: DirHandle): Promise<FolderScan> {
  const all: FolderFile[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file" || !entry.getFile || entry.name.startsWith("~$") || entry.name.startsWith(".")) continue;
    const file = await entry.getFile();
    all.push({ name: entry.name, size: file.size, modified: file.lastModified, file });
  }
  const newest = (list: FolderFile[]) => list.sort((a, b) => b.modified - a.modified)[0] ?? null;
  const deepdive = newest(all.filter((f) => /\.pptx$/i.test(f.name) || (/\.json$/i.test(f.name) && !OWN_FILE.test(f.name))));
  const xlsx = all.filter((f) => /\.xlsx$/i.test(f.name));
  const checklist = newest(xlsx.filter((f) => /readiness|checklist|tracker/i.test(f.name))) ?? newest(xlsx);
  return { deepdive, checklist, signature: `${sig(deepdive)}|${sig(checklist)}`, files: all.length };
}

/** Reads what the folder holds: the DeepDive data from the PowerPoint/draft and the checklist groups from Excel. */
export async function readFolder(scan: FolderScan): Promise<{ data: Record<string, unknown> | null; groups: unknown[] | null; warnings: string[] }> {
  const warnings: string[] = [];
  let data: Record<string, unknown> | null = null;
  let groups: unknown[] | null = null;
  if (scan.deepdive) {
    try {
      data = /\.pptx$/i.test(scan.deepdive.name)
        ? await readEmbeddedData(JSZip, scan.deepdive.file)
        : JSON.parse(await scan.deepdive.file.text());
      if (!data) warnings.push(`${scan.deepdive.name} was not made with DeepDive Builder, so its content can’t be read.`);
    } catch { warnings.push(`${scan.deepdive.name} is not a DeepDive Builder PowerPoint or draft, so it could not be read.`); data = null; }
  }
  if (scan.checklist) {
    try { groups = await readTrackerXlsx(JSZip, scan.checklist.file); }
    catch (e) {
      const missing = (e as { missing?: string[] }).missing;
      warnings.push(missing ? `${scan.checklist.name} is missing columns: ${missing.join(", ")}.`
        : `${scan.checklist.name} is not a Readiness checklist from DeepDive Builder (sheet “Readiness Checklist” with Group, Component, Quote received… columns).`);
    }
  }
  return { data, groups, warnings };
}

/** Writes the DeepDive as a Builder draft (.json) into the folder; the Presales Lead opens it with “Open”. */
export async function writeDraft(handle: DirHandle, name: string, data: unknown) {
  const fh = await handle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  await w.close();
}

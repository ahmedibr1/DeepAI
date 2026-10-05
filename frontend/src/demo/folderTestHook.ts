/* Demo-only test hook: lets an automated browser exercise the shared folder without the native folder picker,
   using in-memory files built with DeepDive Builder's own exporters. Not used by people. */
import JSZip from "jszip";
import { api } from "../portal/api/client";
import { setFolder, type DirHandle } from "../portal/lib/folder";
import { buildTrackerXlsx, embedData } from "../builder/deck.js";

const PPTX_SKELETON = {
  "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
};

export function fakeFolder(name: string) {
  const files = new Map<string, File>();
  const written: string[] = [];
  const handle: DirHandle = {
    kind: "directory", name,
    async *values() { for (const f of files.values()) yield { kind: "file", name: f.name, getFile: async () => f }; },
    async getFileHandle(fileName: string) {
      return { async createWritable() {
        const parts: BlobPart[] = [];
        return { async write(d: Blob | string) { parts.push(d); },
                 async close() { files.set(fileName, new File(parts, fileName, { lastModified: Date.now() })); written.push(fileName); } };
      } };
    },
    async queryPermission() { return "granted"; },
    async requestPermission() { return "granted"; },
  };
  return {
    handle, written,
    put(file: File) { files.set(file.name, file); },
    names: () => [...files.keys()],
  };
}

const hook = {
  fakeFolder,
  async use(oppId: string, folder: ReturnType<typeof fakeFolder>) {
    await setFolder(oppId, folder.handle, true);
    await api.post(`/opportunities/${oppId}/folder`, { name: folder.handle.name });
  },
  async pptx(name: string, data: unknown, modified = Date.now()) {
    const zip = new JSZip();
    Object.entries(PPTX_SKELETON).forEach(([p, c]) => zip.file(p, c));
    const base = await zip.generateAsync({ type: "blob" });
    return new File([await embedData(JSZip, base, data)], name, { lastModified: modified });
  },
  async checklist(name: string, groups: unknown, modified = Date.now()) {
    return new File([await buildTrackerXlsx(JSZip, { groups })], name, { lastModified: modified });
  },
};
(window as unknown as { __deepaiFolderTest?: typeof hook }).__deepaiFolderTest = hook;

/* Types for the parts of deck.js the portal reuses to read files exported by DeepDive Builder. */
type Zip = typeof import("jszip");
export function readEmbeddedData(JSZip: Zip, file: Blob): Promise<Record<string, unknown> | null>;
export function readTrackerXlsx(JSZip: Zip, file: Blob): Promise<{ name: string; rows: Record<string, string>[] }[]>;
export function embedData(JSZip: Zip, blob: Blob, data: unknown): Promise<Blob>;
export function buildTrackerXlsx(JSZip: Zip, S: unknown): Promise<Blob>;

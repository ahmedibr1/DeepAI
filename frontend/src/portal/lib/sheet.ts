/* Reads the opportunities sheet (Excel .xlsx or .csv) in the browser and maps its columns to opportunity fields.
   Column names are matched loosely (case, spaces and punctuation ignored), so an export from the CRM works as is. */
import JSZip from "jszip";

export interface OpportunityRow {
  number: string; title: string; account: string; type?: string; vertical?: string; value?: string;
  submission_date?: string; presales_received?: string;
}

const COLUMNS: [keyof OpportunityRow, string[]][] = [
  ["number", ["opportunity number", "opportunity no", "opportunity id", "opp number", "opp no", "op number", "number", "opportunity #"]],
  ["title", ["opportunity name", "opportunity title", "opportunity", "name", "title", "project name"]],
  ["account", ["account", "account name", "customer", "customer name", "client"]],
  ["type", ["type", "opportunity type", "rfx type"]],
  ["vertical", ["vertical", "sector", "industry"]],
  ["value", ["estimated value", "estimated solution value", "value", "amount", "deal value", "estimated value sar"]],
  ["submission_date", ["submission date", "customer submission date", "due date", "closing date", "close date"]],
  ["presales_received", ["presales received", "presales received date", "received date", "received"]],
];
export const REQUIRED_HEADERS = ["Opportunity Number", "Opportunity Name", "Account"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

/** Excel stores dates as days since 1899-12-30; text dates are passed through when they already look like dates. */
function asDate(v: string): string {
  const t = v.trim();
  if (/^\d{4,5}(\.\d+)?$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(t)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return iso[0];
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return t;
}

async function xlsxGrid(file: Blob): Promise<string[][]> {
  const zip = await JSZip.loadAsync(file);
  const xml = async (p: string) => {
    const f = zip.file(p);
    return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null;
  };
  const wb = await xml("xl/workbook.xml");
  if (!wb) throw new Error("This file is not an Excel workbook.");
  const rels = await xml("xl/_rels/workbook.xml.rels");
  const first = wb.getElementsByTagName("sheet")[0];
  const rid = first?.getAttribute("r:id")
    ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const rel = rels ? [...rels.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid) : null;
  let path = (rel?.getAttribute("Target") ?? "worksheets/sheet1.xml").replace(/^\//, "");
  if (!path.startsWith("xl/")) path = `xl/${path}`;
  const sst = await xml("xl/sharedStrings.xml");
  const shared = sst ? [...sst.getElementsByTagName("si")].map((si) =>
    [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("")) : [];
  const ws = await xml(path);
  if (!ws) throw new Error("The workbook has no readable sheet.");
  return [...ws.getElementsByTagName("row")].map((row) => {
    const out: string[] = [];
    [...row.getElementsByTagName("c")].forEach((c) => {
      const letters = (c.getAttribute("r") ?? "").replace(/[0-9]/g, "");
      let idx = 0;
      for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const text = type === "s" ? shared[Number(v)] ?? ""
        : type === "inlineStr" ? [...c.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("") : v;
      out[idx > 0 ? idx - 1 : out.length] = text.trim();
    });
    return out;
  });
}

function csvGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

/** Returns the rows, plus the headers that were recognised, so the preview can show what was read. */
export async function readOpportunitySheet(file: File): Promise<{ rows: OpportunityRow[]; matched: string[] }> {
  const grid = /\.csv$/i.test(file.name) ? csvGrid(await file.text()) : await xlsxGrid(file);
  const headerAt = grid.findIndex((r) => r.some((c) => COLUMNS[0][1].includes(norm(c ?? ""))));
  if (headerAt < 0) throw new Error(`No “Opportunity Number” column was found. The sheet needs: ${REQUIRED_HEADERS.join(", ")}.`);
  const header = grid[headerAt].map((h) => norm(h ?? ""));
  const col = new Map<keyof OpportunityRow, number>();
  COLUMNS.forEach(([key, names]) => {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col.set(key, i);
  });
  if (!col.has("title")) throw new Error("No “Opportunity Name” column was found.");
  const rows = grid.slice(headerAt + 1)
    .filter((r) => r.some((c) => (c ?? "").trim()))
    .map((r) => {
      const get = (k: keyof OpportunityRow) => (col.has(k) ? (r[col.get(k)!] ?? "").trim() : "");
      return {
        number: get("number"), title: get("title"), account: get("account"), type: get("type"), vertical: get("vertical"),
        value: get("value").replace(/[^0-9.]/g, ""), submission_date: asDate(get("submission_date")),
        presales_received: asDate(get("presales_received")),
      };
    });
  return { rows, matched: [...col.keys()] };
}

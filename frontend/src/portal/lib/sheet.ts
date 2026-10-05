/* Reads the opportunities sheet (Excel .xlsx or .csv) in the browser and maps its columns to opportunity fields.
   Column names are matched loosely (case, spaces and punctuation ignored), so an export from the CRM works as is. */
import JSZip from "jszip";

export interface OpportunityRow {
  number: string; title: string; account: string; type?: string; vertical?: string; value?: string;
  submission_date?: string; presales_received?: string;
  presales_lead?: string; account_manager?: string; sow?: string;
  strategic?: string; previous_projects?: string;      // DeepDive entry criteria, when the sheet carries them
}

const COLUMNS: [keyof OpportunityRow, string[]][] = [
  ["number", ["opportunity number", "opportunity no", "opportunity id", "opp number", "opp no", "op number", "number", "opportunity #"]],
  ["title", ["opportunity name", "opportunity title", "opportunity", "name", "title", "project name"]],
  ["account", ["account", "account name", "customer", "customer name", "client"]],
  // "Opportunity Record Type" (RFP / RFQ / RFI) wins over a generic "Type" column (e.g. "Sell Direct").
  ["type", ["opportunity record type", "record type", "opportunity type", "rfx type", "type"]],
  ["vertical", ["vertical", "sector", "industry"]],
  ["value", ["estimated solution value sar", "estimated solution value", "estimated value sar", "estimated value",
             "total contract value tcv", "total contract value", "value", "amount", "deal value"]],
  ["submission_date", ["submission date", "customer submission date", "due date", "closing date", "close date"]],
  ["presales_received", ["presales received date", "presales received", "received date", "received"]],
  ["presales_lead", ["presales lead", "presales owner", "presales engineer"]],
  ["account_manager", ["opportunity owner am", "account manager", "am", "opportunity owner"]],
  ["sow", ["presales sow", "scope of work", "sow"]],
  ["strategic", ["strategic", "strategic opportunity", "flagged strategic", "flagged", "is strategic"]],
  ["previous_projects", ["previous delivered projects", "previous projects", "delivered projects", "existing customer",
                         "previous projects delivered"]],
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

/* Excel files from some systems (e.g. a Dynamics CRM export) prefix every tag ("x:row", "x:c"), so elements are
   looked up by local name whatever the prefix. */
const tags = (el: Document | Element, name: string) => [...el.getElementsByTagNameNS("*", name)];

async function xlsxGrid(file: Blob): Promise<string[][]> {
  const zip = await JSZip.loadAsync(file);
  const xml = async (p: string) => {
    const f = zip.file(p);
    return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null;
  };
  const wb = await xml("xl/workbook.xml");
  if (!wb) throw new Error("This file is not an Excel workbook.");
  const rels = await xml("xl/_rels/workbook.xml.rels");
  // The first visible sheet (exports often add hidden helper sheets).
  const sheets = tags(wb, "sheet");
  const first = sheets.find((sh) => !["hidden", "veryHidden"].includes(sh.getAttribute("state") ?? "")) ?? sheets[0];
  const rid = first?.getAttribute("r:id")
    ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const rel = rels ? tags(rels, "Relationship").find((r) => r.getAttribute("Id") === rid) : null;
  let path = (rel?.getAttribute("Target") ?? "worksheets/sheet1.xml").replace(/^\//, "");
  if (!path.startsWith("xl/")) path = `xl/${path}`;
  const sst = await xml("xl/sharedStrings.xml");
  const shared = sst ? tags(sst, "si").map((si) => tags(si, "t").map((t) => t.textContent ?? "").join("")) : [];
  const ws = await xml(path);
  if (!ws) throw new Error("The workbook has no readable sheet.");
  return tags(ws, "row").map((row) => {
    const out: string[] = [];
    tags(row, "c").forEach((c) => {
      const letters = (c.getAttribute("r") ?? "").replace(/[0-9]/g, "");
      let idx = 0;
      for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
      const type = c.getAttribute("t");
      const v = tags(c, "v")[0]?.textContent ?? "";
      const text = type === "s" ? shared[Number(v)] ?? ""
        : type === "inlineStr" ? tags(c, "t").map((t) => t.textContent ?? "").join("") : v;
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
  // A Readiness checklist from DeepDive Builder belongs in the opportunity's shared folder, not here.
  const looksLikeChecklist = grid.slice(0, 5).some((r) => {
    const cells = r.map((c) => norm(c ?? ""));
    return cells.includes("component") && (cells.includes("quote received") || cells.includes("tp received"));
  });
  if (looksLikeChecklist) {
    throw new Error("This is a Readiness checklist from DeepDive Builder, not the opportunities sheet. Put it in the "
      + "opportunity’s shared folder instead: open the opportunity → DeepDive tab → Connect folder. "
      + "Import sheet expects the list of all opportunities, one row each.");
  }
  const headerAt = grid.findIndex((r) => r.some((c) => COLUMNS[0][1].includes(norm(c ?? ""))));
  if (headerAt < 0) throw new Error(`No “Opportunity Number” column was found. The sheet needs: ${REQUIRED_HEADERS.join(", ")}.`);
  const header = grid[headerAt].map((h) => norm(h ?? ""));
  const col = new Map<keyof OpportunityRow, number>();
  COLUMNS.forEach(([key, names]) => {
    for (const name of names) {               // names are in order of preference
      const i = header.indexOf(name);
      if (i >= 0) { col.set(key, i); break; }
    }
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
        presales_lead: get("presales_lead"), account_manager: get("account_manager"), sow: get("sow"),
        strategic: get("strategic"), previous_projects: get("previous_projects"),
      };
    });
  return { rows, matched: [...col.keys()] };
}

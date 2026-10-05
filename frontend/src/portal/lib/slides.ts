/* Shows the DeepDive slides in the portal. The Builder's own deck code (deck.js) runs against a small stand-in for
   PptxGenJS that records every text box, shape, image and table instead of writing a .pptx, so the slides on screen
   are laid out exactly like the PowerPoint the Presales Lead downloads. Positions are in inches (13.333 × 7.5). */
import JSZip from "jszip";
import ICONS from "../../builder/icons.json";
import { buildDeck, embedData } from "../../builder/deck.js";

export type Opts = Record<string, any>;
export type Run = { text?: string; options?: Opts };
export type Item =
  | { kind: "text"; text: string | Run[]; o: Opts }
  | { kind: "shape"; shape: string; o: Opts }
  | { kind: "image"; o: Opts }
  | { kind: "table"; rows: (Run | null)[][]; o: Opts };
export interface Slide { background: string | null; items: Item[] }

export const SLIDE_W = 13.333, SLIDE_H = 7.5;

class Recorder {
  layout = "LAYOUT_WIDE";
  title = "";
  shapes = { ROUNDED_RECTANGLE: "roundRect", OVAL: "ellipse", RECTANGLE: "rect" };
  slides: Slide[] = [];
  addSlide() {
    const slide: Slide = { background: null, items: [] };
    this.slides.push(slide);
    return {
      set background(b: { color?: string }) { slide.background = b?.color ?? null; },
      get background() { return slide.background ? { color: slide.background } : {}; },
      addText: (text: string | Run[], o: Opts = {}) => { slide.items.push({ kind: "text", text, o }); },
      addShape: (shape: string, o: Opts = {}) => { slide.items.push({ kind: "shape", shape, o }); },
      addImage: (o: Opts = {}) => { slide.items.push({ kind: "image", o }); },
      addTable: (rows: (Run | null)[][], o: Opts = {}) => { slide.items.push({ kind: "table", rows, o }); },
    };
  }
}

/** The Builder's cover background: two circles on the purple slide. */
export function coverPng(): string | null {
  try {
    const c = document.createElement("canvas"); c.width = 2666; c.height = 1500;
    const x = c.getContext("2d"); if (!x) return null;
    const k = 200;
    const circ = (l: number, t: number, d: number, col: string) => { x.beginPath(); x.arc((l + d / 2) * k, (t + d / 2) * k, d / 2 * k, 0, Math.PI * 2); x.fillStyle = col; x.fill(); };
    circ(8.2, -2.2, 7.5, "#5E13A0"); circ(10.4, 4.6, 4.2, "#FF375E");
    return c.toDataURL("image/png").replace(/^data:/, "");
  } catch { return null; }
}

const clean = (data: Record<string, unknown>) => JSON.parse(JSON.stringify(data ?? {}));

export function recordSlides(data: Record<string, unknown>): Slide[] {
  const rec = buildDeck(Recorder, clean(data), ICONS as Record<string, string>, coverPng()) as unknown as Recorder;
  return rec.slides;
}

/** The same PowerPoint the Builder exports, with the DeepDive data embedded so the Builder can reopen it. */
export async function buildPptx(data: Record<string, unknown>): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const S = clean(data);
  const raw = await buildDeck(PptxGenJS, S, ICONS as Record<string, string>, coverPng()).write({ outputType: "blob" });
  return embedData(JSZip, raw, S);
}

/** True when the version holds more than the opportunity's basic details. */
export function hasDeepDiveContent(d: Record<string, any> | null | undefined): boolean {
  if (!d) return false;
  const filled = (v: unknown) => Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : false;
  return ["background", "sow", "solution", "requirements", "driver", "differentiator", "riskTech", "riskFin", "support", "groups"]
    .some((k) => filled(d[k]));
}

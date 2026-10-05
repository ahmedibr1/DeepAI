/* Slides tab: the DeepDive as the deck the Builder produces, viewed in the portal, presented full screen, or
   downloaded as PowerPoint. */
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { OpportunityDetail, VersionDetail } from "../api/types";
import { buildPptx, hasDeepDiveContent, type Item, type Opts, recordSlides, type Run, type Slide, SLIDE_H, SLIDE_W } from "../lib/slides";
import { useAsync } from "../lib/useAsync";
import { Icon } from "./Icon";
import { ErrorAlert, useToast } from "./ui";

const DPI = 96;                                   // the slide is drawn at 1280 × 720 and scaled to fit
const PX = (inch: number) => inch * DPI;
const PT = (pt: number) => (pt * DPI) / 72;
const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const color = (c?: string) => (c ? `#${c}` : undefined);
const box = (o: Opts): CSSProperties => ({ position: "absolute", left: PX(o.x ?? 0), top: PX(o.y ?? 0), width: PX(o.w ?? 1), height: PX(o.h ?? 1) });

function textStyle(o: Opts): CSSProperties {
  return {
    fontFamily: `${o.fontFace ?? "Arial"}, "Segoe UI", Tahoma, sans-serif`,
    fontSize: o.fontSize ? PT(o.fontSize) : undefined,
    color: color(o.color), fontWeight: o.bold === undefined ? undefined : o.bold ? 700 : 400,
    fontStyle: o.italic ? "italic" : undefined,
    letterSpacing: o.charSpacing ? PT(o.charSpacing) : undefined,
  };
}

/** Splits runs into paragraphs the way PowerPoint does: a run with breakLine ends its paragraph. */
function paragraphs(text: string | Run[]): Run[][] {
  const runs: Run[] = Array.isArray(text) ? text : [{ text: String(text ?? "") }];
  const out: Run[][] = [[]];
  runs.forEach((r) => {
    String(r.text ?? "").split("\n").forEach((piece, i) => {
      if (i > 0) out.push([]);
      out[out.length - 1].push({ ...r, text: piece });
    });
    if (r.options?.breakLine) out.push([]);
  });
  if (out.length > 1 && !out[out.length - 1].length) out.pop();
  return out;
}

function Paragraphs({ text, o }: { text: string | Run[]; o: Opts }) {
  return <>{paragraphs(text).map((runs, i) => {
    const p = runs[0]?.options ?? {};
    const all = runs.map((r) => r.text).join("");
    const rtl = AR.test(all) || !!p.rtlMode || !!o.rtlMode;
    const align = p.align ?? o.align;
    const bullet = p.bullet ?? o.bullet;
    const after = p.paraSpaceAfter ?? o.paraSpaceAfter;
    return (
      <div key={i} dir={rtl ? "rtl" : "ltr"} style={{
        textAlign: align === "center" ? "center" : align === "right" ? (rtl ? "left" : "right") : "start",
        marginBottom: after ? PT(after) : 0, display: bullet ? "flex" : "block", gap: bullet ? 8 : undefined,
        paddingInlineStart: bullet ? 2 : 0, minHeight: "1.2em",
      }}>
        {bullet && <span aria-hidden="true">•</span>}
        <span>{runs.map((r, k) => <span key={k} style={textStyle(r.options ?? {})}>{r.text}</span>)}</span>
      </div>
    );
  })}</>;
}

const valign = (v?: string) => (v === "middle" ? "center" : v === "bottom" ? "flex-end" : "flex-start");

function SlideItem({ item }: { item: Item }) {
  const o = item.o;
  if (item.kind === "shape") {
    const line = o.line?.width ? `${PT(o.line.width)}px solid ${color(o.line.color)}` : undefined;
    return <div style={{ ...box(o), background: color(o.fill?.color), border: line, boxSizing: "border-box",
      borderRadius: item.shape === "ellipse" ? "50%" : item.shape === "roundRect" ? PX(o.rectRadius ?? 0.1) : 0 }} />;
  }
  if (item.kind === "image") {
    const src = String(o.data ?? o.path ?? "");
    return <img alt="" src={src.startsWith("data:") || src.startsWith("http") ? src : `data:${src}`} style={{ ...box(o), objectFit: "fill" }} />;
  }
  if (item.kind === "text") {
    return (
      <div style={{ ...box(o), ...textStyle(o), display: "flex", flexDirection: "column", justifyContent: valign(o.valign),
        lineHeight: 1.18, overflowWrap: "anywhere", padding: typeof o.margin === "number" ? PT(o.margin) : 0 }}>
        <div><Paragraphs text={item.text} o={o} /></div>
      </div>
    );
  }
  // table
  const colW: number[] = o.colW ?? [];
  const rowH = (i: number) => PX(Array.isArray(o.rowH) ? o.rowH[i] ?? 0.4 : o.rowH ?? 0.4);
  const m: number[] = Array.isArray(o.margin) ? o.margin : [0, 0.1, 0, 0.1];
  const border = o.border ? `${PT(o.border.pt ?? 1)}px solid ${color(o.border.color)}` : undefined;
  return (
    <table style={{ position: "absolute", left: PX(o.x ?? 0), top: PX(o.y ?? 0), width: PX(o.w ?? 1), tableLayout: "fixed",
      borderCollapse: "collapse", ...textStyle(o) }}>
      <colgroup>{colW.map((w, i) => <col key={i} style={{ width: PX(w) }} />)}</colgroup>
      <tbody>{item.rows.map((row, r) => (
        <tr key={r} style={{ height: rowH(r) }}>
          {row.map((cell, c) => {
            const co: Opts = cell?.options ?? {};
            const text = cell?.text as unknown as string | Run[] | undefined;
            return (
              <td key={c} colSpan={co.colspan} style={{ ...textStyle({ ...co, fontFace: undefined }), background: color(co.fill?.color),
                border, padding: `${PX(m[0])}px ${PX(m[1])}px ${PX(m[2])}px ${PX(m[3])}px`, lineHeight: 1.2,
                verticalAlign: (co.valign ?? o.valign) === "middle" ? "middle" : (co.valign ?? o.valign) === "bottom" ? "bottom" : "top",
                overflowWrap: "anywhere" }}>
                <Paragraphs text={text ?? ""} o={co} />
              </td>
            );
          })}
        </tr>
      ))}</tbody>
    </table>
  );
}

/** One slide, drawn at full size and scaled to the width of its frame. */
export function SlideView({ slide, className }: { slide: Slide; className?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = frame.current; if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / PX(SLIDE_W), el.clientHeight / PX(SLIDE_H)));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={frame} className={`slide-frame ${className ?? ""}`}>
      <div className="slide-canvas" style={{ width: PX(SLIDE_W), height: PX(SLIDE_H), background: color(slide.background ?? "FFFFFF"),
        transform: `scale(${scale})`, visibility: scale ? "visible" : "hidden" }}>
        {slide.items.map((it, i) => <SlideItem key={i} item={it} />)}
      </div>
    </div>
  );
}

const slideTitle = (s: Slide, i: number): string => {
  if (i === 0) return "Cover";
  const texts = s.items.filter((it): it is Extract<Item, { kind: "text" }> => it.kind === "text" && typeof it.text === "string");
  return texts[1]?.text as string ?? `Slide ${i + 1}`;
};

export function SlidesTab({ opp, versionId }: { opp: OpportunityDetail; versionId: string }) {
  const version = useAsync(() => api.get<VersionDetail>(`/opportunities/${opp.id}/versions/${versionId}`),
    [opp.id, versionId, opp.updated_at]);
  const data = version.data?.data as Record<string, unknown> | undefined;
  const built = useMemo(() => {
    if (!data || !hasDeepDiveContent(data)) return { slides: [] as Slide[], error: null as string | null };
    try { return { slides: recordSlides(data), error: null }; }
    catch (e) { return { slides: [], error: e instanceof Error ? e.message : "The slides could not be drawn." }; }
  }, [data]);
  const slides = built.slides;
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const toast = useToast();
  useEffect(() => { setIndex(0); }, [versionId]);
  const go = (d: number) => setIndex((i) => Math.max(0, Math.min(slides.length - 1, i + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const download = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const blob = await buildPptx(data);
      const safe = (t: unknown) => String(t ?? "").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").slice(0, 40);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${["DeepDive", safe(opp.account_name), opp.opportunity_number].filter(Boolean).join("_")}_v${version.data?.version_number}.pptx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      toast(`The PowerPoint couldn’t be built: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally { setBusy(false); }
  };
  const present = () => { void stage.current?.requestFullscreen?.().catch(() => undefined); };

  let body: ReactNode;
  if (version.loading && !version.data) body = <p className="muted card-pad">Loading…</p>;
  else if (built.error) body = <div className="empty-state"><b>The slides could not be drawn.</b><p className="muted">{built.error}</p></div>;
  else if (!slides.length) body = (
    <div className="empty-state">
      <Icon name="doc" />
      <b>No DeepDive in v{version.data?.version_number ?? "—"} yet</b>
      <p className="muted">Upload the DeepDive PowerPoint or fill it in the DeepDive Builder, and its slides appear here.</p>
      <Link className="btn primary small" to={`/opportunities/${opp.id}/deepdive`}>Go to DeepDive</Link>
    </div>
  );
  else body = (
    <>
      <div className="slide-stage" ref={stage} onClick={(e) => { if (document.fullscreenElement) go(e.clientX > window.innerWidth / 2 ? 1 : -1); }}>
        <SlideView slide={slides[index]} />
      </div>
      <div className="slide-controls">
        <button className="btn ghost small" disabled={index === 0} onClick={() => go(-1)} aria-label="Previous slide">‹ Previous</button>
        <span className="muted small"><b>{index + 1}</b> / {slides.length} · {slideTitle(slides[index], index)}</span>
        <button className="btn ghost small" disabled={index === slides.length - 1} onClick={() => go(1)} aria-label="Next slide">Next ›</button>
      </div>
      <div className="slide-thumbs" role="list">
        {slides.map((s, i) => (
          <button key={i} role="listitem" className={`slide-thumb${i === index ? " active" : ""}`} onClick={() => setIndex(i)}
            aria-label={`Slide ${i + 1}: ${slideTitle(s, i)}`} aria-current={i === index}>
            <SlideView slide={s} />
            <span>{i + 1}</span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <ErrorAlert error={version.error} />
      <div className="panel-head bare">
        <h2 className="section">Slides</h2>
        <span className="muted small">
          {version.data ? `DeepDive v${version.data.version_number}${slides.length ? ` · ${slides.length} slides` : ""}` : "Loading…"}
        </span>
        {slides.length > 0 && (
          <div className="row-actions" style={{ marginLeft: "auto" }}>
            <button className="btn ghost small" onClick={present}><Icon name="play" /> Present</button>
            <button className="btn primary small" disabled={busy} onClick={() => void download()}>
              <Icon name="download" /> {busy ? "Building…" : "Download PowerPoint"}
            </button>
          </div>
        )}
      </div>
      <section className="card slides-card">{body}</section>
    </>
  );
}

/* DeepDive deck generator — builds the stc-styled .pptx from form data */
/* Shared layout plan for the stakeholders slides (used by the deck and by the review page) */
const STAKE = { intCols: [2.6, 9.53], venCols: [1.75, 1.35, 1.35, 1.45, 6.23], top: 1.4, bottom: 6.85 };
function estLines(t, perLine) { return String(t || "").split("\n").reduce((a, l) => a + Math.max(1, Math.ceil(l.length / perLine)), 0); }
function planStakeholders(S) {
  const intRows = (S.internal || []).map((r) => ({ row: r, h: Math.max(0.36, 0.17 * Math.max(estLines(r.unit, 30), estLines(r.scope, 140)) + 0.1) }));
  const venRows = (S.vendors || []).map((r) => ({ row: r, h: Math.max(0.42, 0.15 * Math.max(estLines(r.name, 20), estLines(r.scope, 100) + (r.internal && r.justification ? estLines("Why a vendor / partner: " + r.justification, 100) : 0)) + 0.14) }));
  const pages = []; let page = []; let y = STAKE.top;
  const newPage = () => { if (page.length) pages.push(page); page = []; y = STAKE.top; };
  [["internal", intRows], ["vendor", venRows]].forEach(([type, rows]) => {
    let i = 0;
    while (i < rows.length) {
      if (y + 0.92 + rows[i].h > STAKE.bottom && page.length) newPage();
      const bl = { type, y, rows: [], heights: [], cont: i > 0 };
      y += 0.92;
      while (i < rows.length && (y + rows[i].h <= STAKE.bottom || !bl.rows.length)) { bl.rows.push(rows[i].row); bl.heights.push(rows[i].h); y += rows[i].h; i++; }
      page.push(bl); y += 0.25;
      if (i < rows.length) newPage();
    }
  });
  if (page.length || !pages.length) pages.push(page);
  return pages;
}

function buildDeck(PptxGenJS, S, I, coverPng) {
  const P = "4F008C", C = "FF375E", INK = "1B171F", MUTE = "6E6677", TINT = "F4EFF8", LINE = "E4DEE8", W = "FFFFFF", DEEP = "2A0049", LAV = "CDB8E6";
  const GREEN = "1E7B34", AMBER = "B26A00", RED = "C8102E";
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.title = "Strategic Opportunity DeepDive — " + (S.oppName || "");
  // Arabic support: any text containing Arabic letters is written right-to-left automatically
  const AR = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const isAr = (t) => AR.test(String(t || ""));
  const _addSlide = pres.addSlide.bind(pres);
  pres.addSlide = (...args) => {
    const sl = _addSlide(...args);
    const _addText = sl.addText.bind(sl), _addTable = sl.addTable.bind(sl);
    sl.addText = (text, opts) => {
      if (Array.isArray(text)) text = text.map((r) => (isAr(r.text) ? Object.assign({}, r, { options: Object.assign({}, r.options, { rtlMode: true, lang: "ar-SA" }) }) : r));
      else if (isAr(text)) opts = Object.assign({}, opts, { rtlMode: true, lang: "ar-SA" });
      return _addText(text, opts);
    };
    sl.addTable = (rows, opts) => _addTable(rows.map((row) => row.map((c) => (c && isAr(c.text) ? Object.assign({}, c, { options: Object.assign({}, c.options, { rtlMode: true, lang: "ar-SA" }) }) : c))), opts);
    return sl;
  };
  // Shrink long text to fit: [[maxChars, size], ...]
  const fit = (t, steps) => { const n = String(t || "").length; for (const [max, size] of steps) if (n <= max) return size; return steps[steps.length - 1][1]; };
  const T = (o) => Object.assign({ fontFace: "Arial", margin: 0, color: INK, valign: "top" }, o);
  const card = (s, x, y, w, h, fill, line) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: line ? { color: line, width: 1.25 } : { color: fill, width: 0 }, rectRadius: 0.12 });
  const badge = (s, x, y, d, icon, fill) => { s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 } }); s.addImage({ data: I[icon], x: x + d * 0.26, y: y + d * 0.26, w: d * 0.48, h: d * 0.48 }); };
  const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out.length ? out : [[]]; };
  const fmtDate = (d) => { if (!d) return ""; const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y}`; };
  const lines = (t) => (t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const part = (i, n) => (n > 1 ? `  (${i + 1} of ${n})` : "");

  function frame(s, num, title) {
    s.background = { color: W };
    s.addText(num, T({ x: 0.6, y: 0.42, w: 1.1, h: 0.8, fontSize: 40, bold: true, color: C, valign: "middle" }));
    s.addText(title, T({ x: 1.55, y: 0.42, w: 9.2, h: 0.8, fontSize: 30, bold: true, color: P, valign: "middle" }));
    s.addText(S.customer || "", T({ x: 9.73, y: 0.42, w: 3.0, h: 0.8, fontSize: fit(S.customer, [[30, 11], [45, 10], [999, 9]]), color: MUTE, align: "right", valign: "middle" }));
    s.addText("Strategic Opportunity DeepDive  •  Confidential", T({ x: 0.6, y: 7.0, w: 6, h: 0.25, fontSize: 9, color: MUTE, valign: "middle" }));
    s.addText("Classification: Internal", T({ x: 8.73, y: 7.0, w: 4, h: 0.25, fontSize: 9, color: MUTE, align: "right", valign: "middle" }));
  }

  // ---------- Cover
  let s = pres.addSlide();
  s.background = { color: P };
  if (coverPng) s.addImage({ data: coverPng, x: 0, y: 0, w: 13.333, h: 7.5 });
  s.addText("solutions by stc", T({ x: 0.7, y: 0.6, w: 5, h: 0.4, fontSize: 14, bold: true, color: W, valign: "middle" }));
  s.addText("STRATEGIC OPPORTUNITY", T({ x: 0.7, y: 1.6, w: 7, h: 0.4, fontSize: 14, bold: true, color: C, charSpacing: 4, valign: "middle" }));
  s.addText("DeepDive", T({ x: 0.7, y: 2.0, w: 7.5, h: 1.4, fontSize: 80, bold: true, color: W, valign: "middle" }));
  s.addText([{ text: "CUSTOMER", options: { fontSize: 10, bold: true, color: LAV, charSpacing: 3, breakLine: true } }, { text: S.customer, options: { fontSize: fit(S.customer, [[22, 20], [40, 15], [999, 12]]), bold: true, color: W } }], T({ x: 0.7, y: 3.7, w: 3.4, h: 0.85 }));
  s.addText([{ text: "OPPORTUNITY NUMBER", options: { fontSize: 10, bold: true, color: LAV, charSpacing: 3, breakLine: true } }, { text: S.oppNumber, options: { fontSize: fit(S.oppNumber, [[22, 20], [999, 15]]), bold: true, color: W } }], T({ x: 0.7, y: 4.6, w: 3.4, h: 0.8 }));
  s.addText([{ text: "OPPORTUNITY NAME", options: { fontSize: 10, bold: true, color: LAV, charSpacing: 3, breakLine: true } }, { text: S.oppName, options: { fontSize: fit(S.oppName, [[35, 20], [70, 16], [999, 13]]), bold: true, color: W } }], T({ x: 4.25, y: 3.7, w: 5.1, h: 1.7 }));
  card(s, 0.7, 5.55, 7.6, 1.25, DEEP);
  s.addText("ENTRY CRITERIA", T({ x: 0.95, y: 5.72, w: 3, h: 0.25, fontSize: 9, bold: true, color: C, charSpacing: 3, valign: "middle" }));
  [["≥ SAR 20M", "opportunity value"], ["Previous", "delivered projects"], ["Flagged", "strategic opportunity"]].forEach(([a, b], i) => {
    const x = 0.95 + i * 2.45;
    badge(s, x, 6.1, 0.3, "check", C);
    s.addText([{ text: a, options: { fontSize: 15, bold: true, color: W, breakLine: true } }, { text: b, options: { fontSize: 10, color: LAV } }], T({ x: x + 0.42, y: 6.02, w: 1.95, h: 0.62 }));
  });

  // ---------- 01 Snapshot
  s = pres.addSlide(); frame(s, "01", "Opportunity Snapshot");
  const value = S.value ? "SAR " + Number(S.value).toLocaleString("en-US") : "";
  const f2 = [["Account", S.customer, "account"], ["Opportunity name", S.oppName, "tag"], ["Opportunity number", S.oppNumber, "hash"], ["Estimated value", value, "coins"],
    ["Presales received", fmtDate(S.presalesReceived), "inbox"], ["Submission date", fmtDate(S.submissionDate), "cal"], ["Presales owner", S.presalesOwner, "owner"], ["Account manager", S.accountManager, "mgr"]];
  f2.forEach(([l, v, ic], i) => {
    const x = 0.6 + (i % 4) * 3.1, y = 1.5 + Math.floor(i / 4) * 1.3, hero = i === 3;
    card(s, x, y, 2.83, 1.05, hero ? P : TINT);
    s.addImage({ data: I[hero ? "coins" : ic], x: x + 0.22, y: y + 0.35, w: 0.36, h: 0.36 });
    s.addText([{ text: l.toUpperCase(), options: { fontSize: 8, bold: true, color: hero ? LAV : MUTE, charSpacing: 1, breakLine: true } }, { text: v || "", options: { fontSize: fit(v, [[40, 12], [75, 10], [999, 8]]), bold: true, color: hero ? W : INK } }], T({ x: x + 0.72, y: y + 0.12, w: 2.0, h: 0.81, valign: "middle" }));
  });
  s.addText("Opportunity Background / History", T({ x: 0.6, y: 4.3, w: 6, h: 0.45, fontSize: 20, bold: true, color: P, valign: "middle" }));
  card(s, 0.6, 4.9, 12.13, 1.85, TINT);
  const bg = lines(S.background);
  s.addText(bg.map((t, i) => ({ text: t, options: { bullet: { indent: 14 }, breakLine: i < bg.length - 1, paraSpaceAfter: 3 } })), T({ x: 0.9, y: 5.08, w: 11.55, h: 1.5, fontSize: 11 }));

  // ---------- 02 Scope (two slides: need & requirements, then scope of work & solution)
  const bullets = (txt, extra) => { const ls = lines(txt); return ls.map((t, i) => ({ text: t, options: Object.assign({ bullet: { indent: 14 }, breakLine: i < ls.length - 1, paraSpaceAfter: 3 }, extra || {}) })); };
  s = pres.addSlide(); frame(s, "02", "Opportunity Scope");
  // Left: customer business need / pain point (numbered list)
  card(s, 0.6, 1.5, 5.93, 5.25, "FFF0F3");
  badge(s, 0.85, 1.72, 0.55, "puzzle", C);
  s.addText("Customer Business Need / Pain Point", T({ x: 1.6, y: 1.72, w: 4.75, h: 0.55, fontSize: 16, bold: true, valign: "middle" }));
  const needs = (S.requirements || []).slice(0, 6);
  const needSize = Math.max(0, ...needs.map((r) => (r.text || "").length)) > 70 ? 11 : 12;
  needs.forEach((r, i) => {
    const y = 2.5 + i * 0.7;
    s.addShape(pres.shapes.OVAL, { x: 0.9, y: y + 0.17, w: 0.3, h: 0.3, fill: { color: C }, line: { color: C, width: 0 } });
    s.addText(String(i + 1), T({ x: 0.9, y: y + 0.17, w: 0.3, h: 0.3, fontSize: 10, bold: true, color: W, align: "center", valign: "middle" }));
    s.addText(r.text, T({ x: 1.38, y, w: 4.95, h: 0.64, fontSize: needSize, valign: "middle" }));
  });
  // Right: scope of work
  const sowLines = lines(S.sow).length;
  const sowSize = Math.min(fit(S.sow, [[450, 12], [700, 11], [9999, 10]]), sowLines <= 12 ? 12 : sowLines <= 14 ? 11 : 10);
  card(s, 6.8, 1.5, 5.93, 5.25, W, LINE);
  badge(s, 7.05, 1.72, 0.55, "clip", P);
  s.addText("Scope of Work", T({ x: 7.8, y: 1.72, w: 4.7, h: 0.55, fontSize: 16, bold: true, color: P, valign: "middle" }));
  s.addText(bullets(S.sow), T({ x: 7.1, y: 2.5, w: 5.4, h: 4.1, fontSize: sowSize, paraSpaceAfter: 3 }));

  s = pres.addSlide(); frame(s, "02", "Proposed Solution & Duration");
  card(s, 0.6, 1.5, 12.13, 3.95, W, LINE);
  badge(s, 0.85, 1.72, 0.55, "bulb", C);
  s.addText("Proposed Solution / Deliverables", T({ x: 1.6, y: 1.72, w: 9, h: 0.55, fontSize: 16, bold: true, color: P, valign: "middle" }));
  s.addText(bullets(S.solution, { paraSpaceAfter: 6 }), T({ x: 0.95, y: 2.5, w: 11.5, h: 2.8, fontSize: 13 }));
  [["PS Duration", "Professional services", S.psDuration], ["MS Duration", "Managed services", S.msDuration]].forEach(([l, sub, v], i) => {
    const x = 0.6 + i * 6.2;
    card(s, x, 5.6, 5.93, 1.15, P);
    s.addImage({ data: I.clock, x: x + 0.3, y: 5.97, w: 0.42, h: 0.42 });
    s.addText([{ text: l, options: { fontSize: 14, bold: true, color: W, breakLine: true } }, { text: sub, options: { fontSize: 10, color: LAV } }], T({ x: x + 0.95, y: 5.7, w: 2.6, h: 0.95, valign: "middle" }));
    s.addText(v || "", T({ x: x + 3.4, y: 5.7, w: 2.3, h: 0.95, fontSize: 22, bold: true, color: W, align: "right", valign: "middle" }));
  });

  // ---------- 03 Internal, Partners and Vendors (full-width tables, paginated by row height)
  const stakePages = planStakeholders(S);
  const statusColor = { "Registered": GREEN, "Not Registered": RED, "Protected": GREEN, "Fair Pricing": P, "Not Protected": RED, "Pending": AMBER };
  const hdr = (t, al) => ({ text: t, options: { bold: true, color: W, fill: { color: P }, fontSize: 10, align: al || "left" } });
  stakePages.forEach((pg, k) => {
    s = pres.addSlide(); frame(s, "03", "Internal, Partners and Vendors" + part(k, stakePages.length));
    pg.forEach((bl) => {
      const isInt = bl.type === "internal";
      badge(s, 0.6, bl.y, 0.42, isInt ? "sitemap" : "hand", isInt ? P : C);
      s.addText((isInt ? "Internal Stakeholders" : "Partners and Vendors") + (bl.cont ? " (continued)" : ""), T({ x: 1.12, y: bl.y, w: 8, h: 0.42, fontSize: 16, bold: true, color: P, valign: "middle" }));
      const ty = bl.y + 0.52;
      if (isInt) {
        const rows = [[hdr("Unit"), hdr("Scope")]].concat(bl.rows.map((r, i) => { const f = i % 2 ? TINT : W; return [{ text: r.unit, options: { bold: true, fill: { color: f } } }, { text: r.scope, options: { color: INK, fill: { color: f } } }]; }));
        s.addTable(rows, { x: 0.6, y: ty, w: 12.13, colW: STAKE.intCols, rowH: [0.4].concat(bl.heights), fontFace: "Arial", fontSize: 10, color: INK, valign: "middle", border: { type: "solid", pt: 1, color: W }, margin: [0.03, 0.1, 0.03, 0.1] });
      } else {
        const rows = [[hdr("Vendor / Partner"), hdr("Deal Registration", "center"), hdr("Pricing Status", "center"), hdr("Internal / Subsidiary", "center"), hdr("Scope")]].concat(bl.rows.map((r, i) => {
          const f = i % 2 ? TINT : W;
          return [{ text: r.name, options: { bold: true, fill: { color: f } } },
            { text: r.reg, options: { bold: true, fontSize: 9, align: "center", color: statusColor[r.reg] || INK, fill: { color: f } } },
            { text: r.pricing, options: { bold: true, fontSize: 9, align: "center", color: statusColor[r.pricing] || INK, fill: { color: f } } },
            { text: r.internal ? "Yes" : "No", options: { bold: true, fontSize: 9, align: "center", color: r.internal ? GREEN : MUTE, fill: { color: f } } },
            { text: r.internal && r.justification ? [{ text: r.scope, options: { breakLine: true, paraSpaceAfter: 3 } }, { text: "Why a vendor / partner: ", options: { bold: true, color: P } }, { text: r.justification, options: { color: MUTE } }] : r.scope, options: { color: INK, fontSize: 9, fill: { color: f } } }];
        }));
        s.addTable(rows, { x: 0.6, y: ty, w: 12.13, colW: STAKE.venCols, rowH: [0.4].concat(bl.heights), fontFace: "Arial", fontSize: 10, color: INK, valign: "middle", border: { type: "solid", pt: 1, color: W }, margin: [0.03, 0.1, 0.03, 0.1] });
      }
    });
  });

  // ---------- 04 Winning Strategy
  s = pres.addSlide(); frame(s, "04", "Winning Strategy");
  const numbered = (arr) => arr.filter((x) => x && x.trim()).map((t, i, a) => ({ text: `${i + 1}. ${t}`, options: { breakLine: i < a.length - 1, paraSpaceAfter: 5 } }));
  const pro = S.proactive === "Yes" ? [{ text: "Proactive: Yes", options: { bold: true, breakLine: true, paraSpaceAfter: 3 } }, { text: "Type: " + (Array.isArray(S.proactiveType) ? S.proactiveType : [S.proactiveType]).filter(Boolean).join(", ") }] : [{ text: "Proactive: No", options: { bold: true } }];
  [["Customer Decision Driver", "target", P, S.driver, 1.5], ["Our Differentiator", "star", C, S.differentiator, 2.9]].forEach(([h, ic, col, txt, y]) => {
    card(s, 0.6, y, 8.0, 1.3, TINT);
    badge(s, 0.8, y + 0.18, 0.45, ic, col);
    s.addText(h, T({ x: 1.4, y: y + 0.16, w: 6.9, h: 0.45, fontSize: 13, bold: true, valign: "middle" }));
    s.addText(txt || "", T({ x: 1.4, y: y + 0.55, w: 7.0, h: 0.7, fontSize: fit(txt, [[180, 11], [320, 10], [999, 9]]), color: INK }));
  });
  [["Competition", "chess", P, [{ text: (S.competitors || []).map((c) => c.name).filter(Boolean).join("  •  "), options: { fontSize: fit((S.competitors || []).map((c) => c.name).join("  •  "), [[90, 10], [140, 9], [999, 8]]) } }], 1.5], ["Proactive Engagement", "rocket", C, pro, 2.9]].forEach(([h, ic, col, runs, y]) => {
    card(s, 8.8, y, 3.93, 1.3, TINT);
    badge(s, 9.0, y + 0.18, 0.45, ic, col);
    s.addText(h, T({ x: 9.6, y: y + 0.16, w: 3.0, h: 0.45, fontSize: 13, bold: true, valign: "middle" }));
    s.addText(runs, T({ x: 9.6, y: y + 0.55, w: 3.0, h: 0.7, fontSize: 10, color: INK }));
  });
  [["How to Win — Technically", "gears", P, S.winTech || []], ["How to Win — Financially", "money", C, S.winFin || []]].forEach(([h, ic, col, acts], i) => {
    const x = 0.6 + i * 6.2;
    card(s, x, 4.3, 5.93, 2.45, W, LINE);
    badge(s, x + 0.25, 4.42, 0.45, ic, col);
    s.addText(h, T({ x: x + 0.85, y: 4.42, w: 4.6, h: 0.45, fontSize: 15, bold: true, color: P, valign: "middle" }));
    acts.slice(0, 3).forEach((a, n) => {
      const y = 4.97 + n * 0.59;
      card(s, x + 0.2, y, 5.53, 0.54, TINT);
      s.addText(String(n + 1), T({ x: x + 0.32, y, w: 0.3, h: 0.54, fontSize: 13, bold: true, color: col, valign: "middle" }));
      s.addText(a.action, T({ x: x + 0.65, y: y + 0.03, w: 3.6, h: 0.48, fontSize: fit(a.action, [[55, 10], [999, 9]]), valign: "middle" }));
      s.addText([{ text: a.owner, options: { breakLine: true } }, { text: fmtDate(a.date) }], T({ x: x + 4.3, y: y + 0.03, w: 1.35, h: 0.48, fontSize: 8, color: MUTE, align: "right", valign: "middle" }));
    });
  });

  // ---------- 05 Risks (auto-split, 5 per card)
  const rtC = chunk(S.riskTech || [], 5), rfC = chunk(S.riskFin || [], 5);
  const nRisk = Math.max(rtC.length, rfC.length);
  const lvl = { High: ["FFE0E6", RED], Medium: ["F2E6FF", P], Low: ["E3F4E4", GREEN] };
  for (let k = 0; k < nRisk; k++) {
    s = pres.addSlide(); frame(s, "05", "Risks, Gaps & Mitigation" + part(k, nRisk));
    [["Risks — Technically", "chip", P, rtC[k] || [], k * 5], ["Risks — Financially", "trend", C, rfC[k] || [], k * 5]].forEach(([h, ic, col, items, offset], i) => {
      const x = 0.6 + i * 6.2;
      card(s, x, 1.5, 5.93, 5.25, W, LINE);
      badge(s, x + 0.25, 1.7, 0.5, ic, col);
      s.addText(h, T({ x: x + 0.9, y: 1.7, w: 3.2, h: 0.5, fontSize: 16, bold: true, color: P, valign: "middle" }));
      s.addText("Impact", T({ x: x + 4.1, y: 1.7, w: 1.55, h: 0.5, fontSize: 9, bold: true, color: MUTE, align: "center", valign: "middle" }));
      if (!items.length) s.addText("No further risks in this category.", T({ x: x + 0.25, y: 2.4, w: 5.4, h: 0.4, fontSize: 11, color: MUTE, italic: true }));
      items.forEach((r, n) => {
        const y = 2.35 + n * 0.87;
        card(s, x + 0.2, y, 5.53, 0.8, TINT);
        s.addText(String(offset + n + 1), T({ x: x + 0.32, y, w: 0.4, h: 0.8, fontSize: 13, bold: true, color: col, valign: "middle" }));
        s.addText([{ text: r.risk, options: { bold: true, fontSize: fit(r.risk, [[60, 10], [999, 9]]), breakLine: true, paraSpaceAfter: 2 } }, { text: "Mitigation: ", options: { bold: true, fontSize: 9, color: MUTE } }, { text: r.mitigation, options: { fontSize: fit(r.mitigation, [[48, 9], [999, 8]]), color: MUTE } }], T({ x: x + 0.72, y: y + 0.04, w: 3.55, h: 0.72, valign: "middle" }));
        const [bg, fg] = lvl[r.impact] || [W, INK];
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 4.45, y: y + 0.12, w: 1.1, h: 0.26, fill: { color: bg }, line: { color: bg, width: 0 }, rectRadius: 0.13 });
        s.addText(r.impact, T({ x: x + 4.45, y: y + 0.12, w: 1.1, h: 0.26, fontSize: 9, bold: true, color: fg, align: "center", valign: "middle" }));
        s.addText([{ text: r.owner, options: { breakLine: true } }, { text: fmtDate(r.date) }], T({ x: x + 4.3, y: y + 0.42, w: 1.4, h: 0.34, fontSize: 8, color: MUTE, align: "center", valign: "middle" }));
      });
    });
  }

  // ---------- 06 Presales Readiness Checklist (auto-split, 12 rows per slide)
  const flat = [];
  (S.groups || []).forEach((g) => { flat.push({ group: g.name }); g.rows.forEach((r) => flat.push({ row: r, groupName: g.name })); });
  const pages = []; let cur = [], lastGroup = null;
  flat.forEach((it) => {
    if (cur.length >= 12 || (it.group && cur.length >= 11)) { pages.push(cur); cur = []; if (it.row) cur.push({ group: it.groupName + " (cont.)" }); }
    cur.push(it);
  });
  if (cur.length) pages.push(cur);
  const heads = ["Project Name", "Internal / Vendor / Partner", "Communicated", "Quote Received", "TP Received", "Quote Validated?", "TP Validated?", "Comments"].map((t) => ({ text: t, options: { bold: true, color: W, fill: { color: P }, fontSize: 9, align: "center" } }));
  const YES = { fill: { color: "E3F4E4" }, color: GREEN, bold: true, align: "center" }, NO = { fill: { color: "FFE7EC" }, color: RED, bold: true, align: "center" };
  pages.forEach((pg, k) => {
    s = pres.addSlide(); frame(s, "06", "Presales Readiness Checklist" + part(k, pages.length));
    const rows = [heads].concat(pg.map((it) => it.group !== undefined
      ? [{ text: it.group, options: { colspan: 8, bold: true, color: P, fill: { color: "EDE3F6" } } }]
      : [{ text: it.row.item }, { text: it.row.provider, options: { color: MUTE } }]
        .concat(["communicated", "quoteRec", "tpRec", "quoteVal", "tpVal"].map((key) => ({ text: it.row[key], options: it.row[key] === "Yes" ? YES : NO })))
        .concat([{ text: it.row.comments || "", options: { color: MUTE } }])));
    s.addTable(rows, { x: 0.6, y: 1.5, w: 12.13, colW: [2.2, 1.9, 1.25, 1.25, 1.25, 1.3, 1.25, 1.73], rowH: 0.42, fontFace: "Arial", fontSize: 10, color: INK, valign: "middle", border: { type: "solid", pt: 1, color: W }, margin: [0, 0.1, 0, 0.1] });
  });

  // ---------- 07 Support Needed (auto-split, 6 per slide)
  const supC = chunk(S.support || [], 6);
  supC.forEach((items, k) => {
    s = pres.addSlide(); frame(s, "07", "Support Needed" + part(k, supC.length));
    badge(s, 0.6, 1.4, 0.42, "support", C);
    s.addText("What we need to win this opportunity", T({ x: 1.12, y: 1.4, w: 8, h: 0.42, fontSize: 16, bold: true, color: P, valign: "middle" }));
    s.addText("Priority", T({ x: 9.25, y: 1.4, w: 1.5, h: 0.42, fontSize: 9, bold: true, color: MUTE, align: "center", valign: "middle" }));
    s.addText("Needed by", T({ x: 10.95, y: 1.4, w: 1.5, h: 0.42, fontSize: 9, bold: true, color: MUTE, align: "center", valign: "middle" }));
    items.forEach((r, n) => {
      const y = 2.0 + n * 0.8;
      card(s, 0.6, y, 12.13, 0.7, n % 2 ? W : TINT, n % 2 ? LINE : null);
      s.addText(String(k * 6 + n + 1), T({ x: 0.8, y, w: 0.45, h: 0.7, fontSize: 15, bold: true, color: C, valign: "middle" }));
      s.addText([{ text: r.need, options: { bold: true, fontSize: fit(r.need, [[70, 12], [999, 11]]), breakLine: true } }, { text: "From: ", options: { bold: true, fontSize: 10, color: MUTE } }, { text: r.from, options: { fontSize: 10, color: MUTE } }], T({ x: 1.35, y: y + 0.05, w: 7.7, h: 0.6, valign: "middle" }));
      const [bg, fg] = lvl[r.priority] || [W, INK];
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.4, y: y + 0.21, w: 1.2, h: 0.28, fill: { color: bg }, line: { color: bg, width: 0 }, rectRadius: 0.14 });
      s.addText(r.priority || "", T({ x: 9.4, y: y + 0.21, w: 1.2, h: 0.28, fontSize: 10, bold: true, color: fg, align: "center", valign: "middle" }));
      s.addText(r.date ? fmtDate(r.date) : "—", T({ x: 10.95, y, w: 1.5, h: 0.7, fontSize: 11, color: INK, align: "center", valign: "middle" }));
    });
  });

  return pres;
}

/* Store the form data inside the .pptx as custom document properties so the builder can reopen it */
const DD_PREFIX = "DeepDiveData_";
function b64encodeUtf8(str) { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin); }
function b64decodeUtf8(b64) { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
async function embedData(JSZip, blob, data) {
  const zip = await JSZip.loadAsync(blob);
  const b64 = b64encodeUtf8(JSON.stringify(data));
  const chunks = b64.match(/.{1,240}/g) || [];
  const fmt = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";
  let pid = 2;
  const props = [`<property fmtid="${fmt}" pid="${pid++}" name="DeepDiveBuilderVersion"><vt:lpwstr>2</vt:lpwstr></property>`]
    .concat(chunks.map((c, i) => `<property fmtid="${fmt}" pid="${pid++}" name="${DD_PREFIX}${String(i).padStart(3, "0")}"><vt:lpwstr>${c}</vt:lpwstr></property>`));
  zip.file("docProps/custom.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${props.join("")}</Properties>`);
  let rels = await zip.file("_rels/.rels").async("string");
  if (!rels.includes("custom-properties")) rels = rels.replace("</Relationships>", `<Relationship Id="rIdDeepDive" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>`);
  zip.file("_rels/.rels", rels);
  let ct = await zip.file("[Content_Types].xml").async("string");
  if (!ct.includes("/docProps/custom.xml")) ct = ct.replace("</Types>", `<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>`);
  zip.file("[Content_Types].xml", ct);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", compression: "DEFLATE" });
}
async function readEmbeddedData(JSZip, file) {
  const zip = await JSZip.loadAsync(file);
  const f = zip.file("docProps/custom.xml");
  if (!f) return null;
  const doc = new DOMParser().parseFromString(await f.async("string"), "application/xml");
  const parts = [...doc.getElementsByTagName("property")].filter((p) => (p.getAttribute("name") || "").startsWith(DD_PREFIX))
    .sort((a, b) => a.getAttribute("name").localeCompare(b.getAttribute("name"))).map((p) => p.textContent.trim());
  if (!parts.length) return null;
  return JSON.parse(b64decodeUtf8(parts.join("")));
}


/* ---------- Readiness tracker as an Excel workbook (built in the browser, no library needed beyond JSZip) ---------- */
const TRACKER_SHEET = "Readiness Checklist";
const TRACKER_COLS = [
  ["Group", "group", 22], ["Component", "item", 28], ["Provided by", "provider", 22],
  ["Communicated", "communicated", 15], ["Quote received", "quoteRec", 15], ["TP received", "tpRec", 13],
  ["Quote validated", "quoteVal", 15], ["TP validated", "tpVal", 13], ["Comments", "comments", 36]];
function xmlEsc(t) { return String(t == null ? "" : t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function colLetter(i) { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
async function buildTrackerXlsx(JSZip, S) {
  const zip = new JSZip();
  const cell = (ref, text, style) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
  const rows = [];
  rows.push(`<row r="1" ht="30" customHeight="1">${TRACKER_COLS.map((c, i) => cell(colLetter(i) + "1", c[0], 1)).join("")}</row>`);
  let r = 2;
  (S.groups || []).forEach((g) => g.rows.forEach((row) => {
    rows.push(`<row r="${r}">${TRACKER_COLS.map((c, i) => cell(colLetter(i) + r, c[1] === "group" ? g.name : row[c[1]], i >= 3 && i <= 7 ? 3 : 2)).join("")}</row>`);
    r++;
  }));
  if (r === 2) { rows.push(`<row r="2">${TRACKER_COLS.map((c, i) => cell(colLetter(i) + "2", "", i >= 3 && i <= 7 ? 3 : 2)).join("")}</row>`); r = 3; }
  const last = r - 1, maxRow = Math.max(last + 300, 500);
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:I${last}"/>
<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${TRACKER_COLS.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c[2]}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rows.join("")}</sheetData>
<conditionalFormatting sqref="D2:H${maxRow}"><cfRule type="cellIs" dxfId="0" priority="1" operator="equal"><formula>"Yes"</formula></cfRule><cfRule type="cellIs" dxfId="1" priority="2" operator="equal"><formula>"No"</formula></cfRule></conditionalFormatting>
<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Yes or No" error="Choose Yes or No from the list." sqref="D2:H${maxRow}"><formula1>"Yes,No"</formula1></dataValidation></dataValidations>
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
<tableParts count="1"><tablePart r:id="rId1"/></tableParts>
</worksheet>`;
  const help = [
    ["How to use this tracker", 4],
    ["", 0],
    ["1. Update the Readiness Checklist sheet. One row per component. To add a row, click the last cell of the table and press Tab.", 0],
    ["2. Group: repeat the group name on every row that belongs to it (e.g. Active Network). Rows with the same group stay together.", 0],
    ["3. Component and Provided by are required.", 0],
    ["4. Communicated, Quote received, TP received, Quote validated, TP validated: pick Yes or No from the dropdown.", 0],
    ["5. Comments are required. Write N/A if there is nothing to add.", 0],
    ["6. Keep the column headers exactly as they are.", 0],
    ["7. To use it: DeepDive Builder > Readiness checklist > Upload Excel sheet. The rows become normal checklist items you can still edit.", 0],
    ["", 0],
    ["Example row", 5],
  ];
  const hrows = help.map(([t, s], i) => `<row r="${i + 1}">${cell("A" + (i + 1), t, s)}</row>`);
  const exR = help.length + 1;
  hrows.push(`<row r="${exR}">${TRACKER_COLS.map((c, i) => cell(colLetter(i) + exR, c[0], 1)).join("")}</row>`);
  const ex = ["Active Network", "Switches & Routers", "Cisco", "Yes", "Yes", "No", "No", "No", "N/A"];
  hrows.push(`<row r="${exR + 1}">${ex.map((v, i) => cell(colLetter(i) + (exR + 1), v, i >= 3 && i <= 7 ? (v === "Yes" ? 6 : 7) : 2)).join("")}</row>`);
  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/>
<cols>${TRACKER_COLS.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c[2]}" customWidth="1"/>`).join("")}</cols>
<sheetData>${hrows.join("")}</sheetData><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="16"/><color rgb="FF4F008C"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF1E7B34"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFC8102E"/><name val="Arial"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F008C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3F4E4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE7EC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE4DEE8"/></left><right style="thin"><color rgb="FFE4DEE8"/></right><top style="thin"><color rgb="FFE4DEE8"/></top><bottom style="thin"><color rgb="FFE4DEE8"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="2"><dxf><font><b/><color rgb="FF1E7B34"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFE3F4E4"/><bgColor rgb="FFE3F4E4"/></patternFill></fill></dxf><dxf><font><b/><color rgb="FFC8102E"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFFE7EC"/><bgColor rgb="FFFFE7EC"/></patternFill></fill></dxf></dxfs>
</styleSheet>`;
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${TRACKER_SHEET}" sheetId="1" r:id="rId1"/><sheet name="How to use" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", sheet1);
  // Excel Table: pressing Tab in the last cell adds a new row with the same dropdowns and formatting
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>`);
  zip.file("xl/tables/table1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="ReadinessChecklist" displayName="ReadinessChecklist" ref="A1:I${last}" totalsRowShown="0"><autoFilter ref="A1:I${last}"/><tableColumns count="${TRACKER_COLS.length}">${TRACKER_COLS.map((c, i) => `<tableColumn id="${i + 1}" name="${xmlEsc(c[0])}"/>`).join("")}</tableColumns><tableStyleInfo name="TableStyleLight1" showFirstColumn="0" showLastColumn="0" showRowStripes="0" showColumnStripes="0"/></table>`);
  zip.file("xl/worksheets/sheet2.xml", sheet2);
  zip.file("xl/styles.xml", styles);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
}
/* Read the tracker back (works for files re-saved by Excel: shared strings, inline strings, any sheet order) */
async function readTrackerXlsx(JSZip, file) {
  const zip = await JSZip.loadAsync(file);
  const parse = async (p) => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null; };
  const wb = await parse("xl/workbook.xml"); if (!wb) throw new Error("not_xlsx");
  const rels = await parse("xl/_rels/workbook.xml.rels");
  const sheets = [...wb.getElementsByTagName("sheet")];
  const target = sheets.find((s) => (s.getAttribute("name") || "").trim().toLowerCase() === TRACKER_SHEET.toLowerCase()) || sheets[0];
  const rid = target.getAttribute("r:id") || target.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const rel = [...rels.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid);
  let path = rel.getAttribute("Target").replace(/^\//, ""); if (!path.startsWith("xl/")) path = "xl/" + path;
  const sst = await parse("xl/sharedStrings.xml");
  const shared = sst ? [...sst.getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join("")) : [];
  const ws = await parse(path);
  const grid = [...ws.getElementsByTagName("row")].map((row) => {
    const out = [];
    [...row.getElementsByTagName("c")].forEach((c) => {
      const ref = c.getAttribute("r") || ""; const letters = ref.replace(/[0-9]/g, "");
      let idx = 0; for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64); idx -= 1;
      const t = c.getAttribute("t"); let v = "";
      if (t === "s") v = shared[+((c.getElementsByTagName("v")[0] || {}).textContent)] || "";
      else if (t === "inlineStr") v = [...c.getElementsByTagName("t")].map((x) => x.textContent).join("");
      else v = (c.getElementsByTagName("v")[0] || {}).textContent || "";
      out[idx < 0 ? out.length : idx] = String(v).trim();
    });
    return out;
  });
  if (!grid.length) throw new Error("empty");
  const header = grid[0].map((h) => (h || "").toLowerCase());
  const colOf = {}; TRACKER_COLS.forEach(([label, key]) => { colOf[key] = header.indexOf(label.toLowerCase()); });
  const missing = TRACKER_COLS.filter(([, key]) => colOf[key] < 0).map(([label]) => label);
  if (missing.length) { const e = new Error("headers"); e.missing = missing; throw e; }
  const yn = (v) => { const x = (v || "").toLowerCase(); return ["yes", "y", "true", "1", "نعم"].includes(x) ? "Yes" : ["no", "n", "false", "0", "لا"].includes(x) ? "No" : ""; };
  const groups = [];
  grid.slice(1).forEach((cells) => {
    const get = (k) => (cells[colOf[k]] || "").trim();
    if (TRACKER_COLS.every(([, k]) => !get(k))) return;
    const gname = get("group");
    let g = groups[groups.length - 1];
    if (!g || g.name !== gname) { g = groups.find((x) => x.name === gname); if (!g) { g = { name: gname, rows: [] }; groups.push(g); } }
    g.rows.push({ item: get("item"), provider: get("provider"), communicated: yn(get("communicated")), quoteRec: yn(get("quoteRec")), tpRec: yn(get("tpRec")), quoteVal: yn(get("quoteVal")), tpVal: yn(get("tpVal")), comments: get("comments") });
  });
  return groups;
}

export { buildDeck, planStakeholders, embedData, readEmbeddedData, buildTrackerXlsx, readTrackerXlsx };

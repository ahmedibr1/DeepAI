/* UI Customization — accent colour, density and the product name shown in the sidebar.
   Stored per browser and applied through CSS variables, so nothing else has to change. */
import { useEffect, useState } from "react";
import { PageHeader, useToast } from "../../components/ui";

const KEY = "pp-appearance";
const ACCENTS = [
  { name: "stc Purple", value: "#4F008C" },
  { name: "Deep Violet", value: "#2A0049" },
  { name: "Indigo", value: "#3A3AA8" },
  { name: "Teal", value: "#0F6E6E" },
];

export interface Appearance { accent: string; density: "comfortable" | "compact"; product: string }
const DEFAULTS: Appearance = { accent: "#4F008C", density: "comfortable", product: "Presales DeepDive" };

export function readAppearance(): Appearance {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULTS; }
}

export function applyAppearance(a: Appearance = readAppearance()) {
  const root = document.documentElement;
  root.style.setProperty("--purple", a.accent);
  root.dataset.density = a.density;
  document.title = `${a.product} · solutions by stc`;
}

export function AppearancePage() {
  const [draft, setDraft] = useState<Appearance>(readAppearance);
  const toast = useToast();
  useEffect(() => { applyAppearance(draft); }, [draft]);

  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(draft));
    applyAppearance(draft);
    toast("Appearance saved for this browser.");
  };
  const reset = () => { localStorage.removeItem(KEY); setDraft(DEFAULTS); applyAppearance(DEFAULTS); };

  return (
    <main className="content wide">
      <PageHeader title="UI Customization" lede="Adjust the look of the portal. Saved for this browser." />
      <section className="card panel">
        <div className="panel-head"><h2 className="section">Appearance</h2></div>
        <div className="card-pad form-grid" style={{ paddingTop: 0 }}>
          <div className="field span">
            <label>Accent colour</label>
            <div className="swatches">
              {ACCENTS.map((a) => (
                <button key={a.value} type="button" className={`swatch${draft.accent === a.value ? " on" : ""}`}
                  style={{ background: a.value }} title={a.name} aria-label={a.name}
                  onClick={() => setDraft({ ...draft, accent: a.value })} />
              ))}
              <input type="color" value={draft.accent} aria-label="Custom accent colour"
                onChange={(e) => setDraft({ ...draft, accent: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="density">Table density</label>
            <select id="density" value={draft.density}
              onChange={(e) => setDraft({ ...draft, density: e.target.value as Appearance["density"] })}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="product">Product name</label>
            <input id="product" value={draft.product} maxLength={40}
              onChange={(e) => setDraft({ ...draft, product: e.target.value })} />
          </div>
          <div className="row-actions span">
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn ghost" onClick={reset}>Reset to stc defaults</button>
          </div>
        </div>
      </section>
    </main>
  );
}

/* AI Configuration — everything the analysis runs with, in one place:
   the system prompt, generation settings, retrieval settings and fine-tuning.
   Sections are independent, so new AI options can be added without reworking the page. */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ErrorAlert, PageHeader, useToast } from "../components/ui";
import { useAsync } from "../lib/useAsync";

interface Generation { temperature: number; max_output_tokens: number; response_format: string }
interface Retrieval { top_k: number; min_score: number; rerank: boolean }
interface FineTuning { base_model: string; adapter: string; status: string; dataset: string; notes: string }

interface AiSettings {
  system_prompt: string; prompt_is_default: boolean; prompt_version: string;
  llm_model: string; embedding_model: string; can_edit: boolean;
  generation: Generation; retrieval: Retrieval; fine_tuning: FineTuning;
}

const FINE_TUNE_STATUS = ["not_started", "collecting_data", "training", "evaluating", "deployed"];
const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started", collecting_data: "Collecting data", training: "Training",
  evaluating: "Evaluating", deployed: "Deployed",
};

export function AiPromptPage() {
  const settings = useAsync(() => api.get<AiSettings>("/admin/ai-settings"), []);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [tab, setTab] = useState<"prompt" | "generation" | "retrieval" | "fine_tuning">("prompt");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();

  useEffect(() => { if (settings.data) setDraft(settings.data); }, [settings.data]);
  const d = draft;
  const saved = settings.data;
  const dirty = !!d && !!saved && JSON.stringify(d) !== JSON.stringify(saved);

  const save = async () => {
    if (!d) return;
    setBusy(true); setError(null);
    try {
      await api.put("/admin/ai-settings", {
        system_prompt: d.system_prompt, generation: d.generation, retrieval: d.retrieval, fine_tuning: d.fine_tuning,
      });
      toast("AI configuration saved. The next analysis will use it.");
      await settings.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const set = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => d && setDraft({ ...d, [key]: value });

  return (
    <main className="content wide">
      <PageHeader title="AI Configuration"
        lede="The prompt, generation and retrieval settings, and fine-tuning used by AI Recommendations. Changes apply to the next run; completed runs keep what they used." />
      <ErrorAlert error={error ?? settings.error} />

      {d && (
        <>
          <div className="stat-grid" style={{ marginBottom: 14 }}>
            <div className="stat"><div className="kpi"><div><div className="l">Analysis model</div><b>{d.llm_model}</b></div></div></div>
            <div className="stat"><div className="kpi"><div><div className="l">Embedding model</div><b>{d.embedding_model}</b></div></div></div>
            <div className="stat"><div className="kpi"><div><div className="l">Prompt</div>
              <b>{d.prompt_is_default ? `Built-in (${d.prompt_version})` : "Edited in the portal"}</b></div></div></div>
            <div className="stat"><div className="kpi"><div><div className="l">Fine-tuning</div>
              <b>{STATUS_LABEL[d.fine_tuning.status] ?? d.fine_tuning.status}</b></div></div></div>
          </div>

          <section className="card panel">
            <nav className="tabs" aria-label="AI configuration sections">
              {([["prompt", "System prompt"], ["generation", "Generation"], ["retrieval", "Retrieval"],
                 ["fine_tuning", "Fine-tuning"]] as const).map(([key, label]) => (
                <button key={key} type="button" className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
              ))}
            </nav>

            <div className="card-pad">
              {tab === "prompt" && (
                <>
                  <p className="muted small" style={{ marginTop: 0 }}>
                    The instructions every analysis follows: what to look for, how to cite evidence, and what to say
                    when something is not in the sources.
                  </p>
                  <textarea className="prompt-box" rows={20} value={d.system_prompt} readOnly={!d.can_edit}
                    onChange={(e) => set("system_prompt", e.target.value)} aria-label="System prompt" />
                </>
              )}

              {tab === "generation" && (
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="temp">Temperature</label>
                    <input id="temp" type="number" step="0.05" min="0" max="1" readOnly={!d.can_edit}
                      value={d.generation.temperature}
                      onChange={(e) => set("generation", { ...d.generation, temperature: Number(e.target.value) })} />
                    <span className="hint">Lower keeps the analysis literal and repeatable.</span>
                  </div>
                  <div className="field">
                    <label htmlFor="maxtok">Maximum output tokens</label>
                    <input id="maxtok" type="number" min="500" max="16000" step="100" readOnly={!d.can_edit}
                      value={d.generation.max_output_tokens}
                      onChange={(e) => set("generation", { ...d.generation, max_output_tokens: Number(e.target.value) })} />
                  </div>
                  <div className="field">
                    <label htmlFor="fmt">Response format</label>
                    <select id="fmt" value={d.generation.response_format} disabled={!d.can_edit}
                      onChange={(e) => set("generation", { ...d.generation, response_format: e.target.value })}>
                      <option value="json">Structured JSON (required by the findings schema)</option>
                      <option value="text">Free text (diagnostics only)</option>
                    </select>
                  </div>
                </div>
              )}

              {tab === "retrieval" && (
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="topk">Passages per question (top K)</label>
                    <input id="topk" type="number" min="3" max="50" readOnly={!d.can_edit} value={d.retrieval.top_k}
                      onChange={(e) => set("retrieval", { ...d.retrieval, top_k: Number(e.target.value) })} />
                    <span className="hint">How much of the DeepDive, comments and documents each question sees.</span>
                  </div>
                  <div className="field">
                    <label htmlFor="minscore">Minimum match score</label>
                    <input id="minscore" type="number" step="0.05" min="0" max="1" readOnly={!d.can_edit}
                      value={d.retrieval.min_score}
                      onChange={(e) => set("retrieval", { ...d.retrieval, min_score: Number(e.target.value) })} />
                  </div>
                  <div className="field span">
                    <label className="check">
                      <input type="checkbox" checked={d.retrieval.rerank} disabled={!d.can_edit}
                        onChange={(e) => set("retrieval", { ...d.retrieval, rerank: e.target.checked })} />
                      Re-rank retrieved passages before answering (slower, more precise citations)
                    </label>
                  </div>
                </div>
              )}

              {tab === "fine_tuning" && (
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="base">Base model</label>
                    <input id="base" readOnly={!d.can_edit} value={d.fine_tuning.base_model} placeholder="e.g. Qwen3-27B"
                      onChange={(e) => set("fine_tuning", { ...d.fine_tuning, base_model: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="adapter">Adapter / checkpoint</label>
                    <input id="adapter" readOnly={!d.can_edit} value={d.fine_tuning.adapter} placeholder="e.g. presales-lora-v3"
                      onChange={(e) => set("fine_tuning", { ...d.fine_tuning, adapter: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="ftstatus">Status</label>
                    <select id="ftstatus" value={d.fine_tuning.status} disabled={!d.can_edit}
                      onChange={(e) => set("fine_tuning", { ...d.fine_tuning, status: e.target.value })}>
                      {FINE_TUNE_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="dataset">Training dataset</label>
                    <input id="dataset" readOnly={!d.can_edit} value={d.fine_tuning.dataset}
                      placeholder="e.g. 120 reviewed DeepDives, 2026 Q1–Q3"
                      onChange={(e) => set("fine_tuning", { ...d.fine_tuning, dataset: e.target.value })} />
                  </div>
                  <div className="field span">
                    <label htmlFor="ftnotes">Notes</label>
                    <textarea id="ftnotes" rows={4} readOnly={!d.can_edit} value={d.fine_tuning.notes}
                      placeholder="What this adapter changes, how it was evaluated, who approved it."
                      onChange={(e) => set("fine_tuning", { ...d.fine_tuning, notes: e.target.value })} />
                  </div>
                  <p className="muted small span">
                    Recorded here so every analysis can be traced to the model that produced it. Training itself runs
                    outside the portal on your own hardware.
                  </p>
                </div>
              )}

              {d.can_edit ? (
                <div className="row-actions" style={{ marginTop: 14 }}>
                  <button className="btn primary" disabled={busy || !dirty} onClick={() => void save()}>
                    {busy ? "Saving…" : "Save configuration"}
                  </button>
                  <button className="btn ghost" disabled={!dirty} onClick={() => saved && setDraft(saved)}>Discard changes</button>
                </div>
              ) : <p className="muted small">Read-only. An Admin can change these settings.</p>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

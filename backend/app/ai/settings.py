"""The AI settings an admin edits on the AI Configuration page, read the same way by the API and the worker.

Values are clamped here, so a typo on the page can never send an unusable request to the model."""
from __future__ import annotations

import hashlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AiSetting

DEFAULT_AI_SETTINGS = {
    "generation": {"temperature": 0.2, "max_output_tokens": 4000, "response_format": "json"},
    "retrieval": {"top_k": 12, "min_score": 0.25, "rerank": False},
    "fine_tuning": {"base_model": "", "adapter": "", "status": "not_started", "dataset": "", "notes": ""},
}


def _num(value, default: float, low: float, high: float) -> float:
    try:
        return min(high, max(low, float(value)))
    except (TypeError, ValueError):
        return default


def load(db: Session) -> dict:
    """The stored settings merged over the defaults, plus the system prompt the analysis will use."""
    from app.ai.prompts import PROMPT_VERSION, SYSTEM_PROMPT

    stored = {row.key: row.value for row in db.execute(select(AiSetting)).scalars()}
    prompt_row = stored.get("system_prompt")
    config = stored.get("config") or {}
    generation = {**DEFAULT_AI_SETTINGS["generation"], **config.get("generation", {})}
    retrieval = {**DEFAULT_AI_SETTINGS["retrieval"], **config.get("retrieval", {})}
    generation["temperature"] = _num(generation.get("temperature"), 0.2, 0.0, 1.0)
    generation["max_output_tokens"] = int(_num(generation.get("max_output_tokens"), 4000, 500, 16000))
    retrieval["top_k"] = int(_num(retrieval.get("top_k"), 12, 1, 50))
    retrieval["min_score"] = _num(retrieval.get("min_score"), 0.25, 0.0, 1.0)
    retrieval["rerank"] = bool(retrieval.get("rerank"))
    prompt = (prompt_row or {}).get("text") or SYSTEM_PROMPT
    return {
        "system_prompt": prompt,
        "prompt_is_default": prompt_row is None,
        # An edited prompt is traceable by its hash, so every run says exactly which wording produced it.
        "prompt_version": PROMPT_VERSION if prompt_row is None
        else f"custom-{hashlib.sha256(prompt.encode()).hexdigest()[:10]}",
        "generation": generation,
        "retrieval": retrieval,
        "fine_tuning": {**DEFAULT_AI_SETTINGS["fine_tuning"], **config.get("fine_tuning", {})},
    }

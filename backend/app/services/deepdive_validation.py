"""Server-side completeness check that mirrors the DeepDive Builder's required fields.

The builder validates as the user types; this check makes sure an incomplete DeepDive can never be
submitted through the API directly. Keep the two in sync when the builder form changes.
"""
from typing import Any

SIMPLE_REQUIRED = {
    "customer": "Customer / account name", "oppName": "Opportunity name", "oppNumber": "Opportunity number",
    "value": "Estimated value (SAR)", "presalesReceived": "Presales received", "submissionDate": "Submission date",
    "presalesOwner": "Presales owner", "accountManager": "Account manager", "background": "Opportunity background / history",
    "sow": "Scope of work", "solution": "Proposed solution / deliverables", "psDuration": "PS duration",
    "msDuration": "MS duration", "driver": "Customer decision driver", "differentiator": "Our differentiator",
    "proactive": "Was this proactive?",
}
LIST_RULES: dict[str, tuple[str, list[str]]] = {
    "requirements": ("Customer business need / pain point", ["text"]),
    "internal": ("Internal stakeholders", ["unit", "scope"]),
    "vendors": ("Partners and vendors", ["name", "reg", "pricing", "scope"]),
    "competitors": ("Competitors", ["name"]),
    "winTech": ("How to win — technically", ["owner", "date", "action"]),
    "winFin": ("How to win — financially", ["owner", "date", "action"]),
    "riskTech": ("Technical risks", ["owner", "date", "impact", "risk", "mitigation"]),
    "riskFin": ("Financial risks", ["owner", "date", "impact", "risk", "mitigation"]),
    "support": ("Support needed", ["need", "from", "priority"]),
}
ROW_FIELDS = ["item", "provider", "communicated", "quoteRec", "tpRec", "quoteVal", "tpVal", "comments"]
MAX_LINES = {"background": 6, "sow": 15, "solution": 7}


def _blank(v: Any) -> bool:
    if isinstance(v, list):
        return len(v) == 0
    return v is None or str(v).strip() == ""


def missing_fields(d: dict) -> list[str]:
    problems: list[str] = []
    for key, label in SIMPLE_REQUIRED.items():
        if _blank(d.get(key)):
            problems.append(label)
    for key, max_lines in MAX_LINES.items():
        if len([ln for ln in str(d.get(key) or "").split("\n") if ln.strip()]) > max_lines:
            problems.append(f"{SIMPLE_REQUIRED[key]} (use {max_lines} lines or fewer)")
    if d.get("proactive") == "Yes" and _blank(d.get("proactiveType")):
        problems.append("Engagement type")
    for key, (label, fields) in LIST_RULES.items():
        items = d.get(key) or []
        if not isinstance(items, list) or not items:
            problems.append(f"{label} (add at least 1)")
            continue
        for i, item in enumerate(items, 1):
            item = item if isinstance(item, dict) else {}
            for f in fields:
                if _blank(item.get(f)):
                    problems.append(f"{label} {i} — {f}")
            if key == "vendors" and item.get("internal") is True and _blank(item.get("justification")):
                problems.append(f"{label} {i} — justification")
            # A High priority support request drives the management monitoring view, so it needs a date.
            if key == "support" and str(item.get("priority", "")).strip().lower() == "high" and _blank(item.get("date")):
                problems.append(f"{label} {i} — needed by (required for High priority)")
    groups = d.get("groups") or []
    if not groups:
        problems.append("Readiness checklist (add at least 1 group)")
    for gi, g in enumerate(groups, 1):
        g = g if isinstance(g, dict) else {}
        if _blank(g.get("name")):
            problems.append(f"Checklist group {gi} — name")
        rows = g.get("rows") or []
        if not rows:
            problems.append(f"Checklist group {gi} (add at least 1 component)")
        for ri, r in enumerate(rows, 1):
            r = r if isinstance(r, dict) else {}
            for f in ROW_FIELDS:
                if _blank(r.get(f)):
                    problems.append(f"Checklist group {gi} row {ri} — {f}")
    return problems

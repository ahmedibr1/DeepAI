"""A no-GPU analyst used for demonstrations and pipeline testing.

It does not reason: it assembles a structured, fully cited result from the retrieved sources using simple
keyword rules, so the workflow, storage, citations and screens can be exercised before the models are in
place. Every finding it writes is grounded in a supplied chunk. Enable with PORTAL_LLM_PROVIDER=demo.
"""
from __future__ import annotations

import re

from app.ai.schema import NOT_FOUND

name = "demo-rule-based-analyst"

TOPICS = [
    ("sla", r"\bsla\b|service level|availability|uptime|99\.", "Service levels", "high"),
    ("integration", r"integrat|interface|api\b|opc-ua|scada", "Integration", "high"),
    ("residency", r"residency|in-?kingdom|data shall remain|sovereign", "Data residency and compliance", "critical"),
    ("security", r"security|cyber|iso 27|penetration|encryption", "Cybersecurity", "medium"),
    ("schedule", r"milestone|delivery date|penalt|schedule|deadline", "Schedule and penalties", "medium"),
    ("pricing", r"budget|ceiling|price|payment terms|bill of quantit", "Commercial", "high"),
    ("support", r"support|maintenance|warranty|managed service", "Support and managed services", "medium"),
]


def _chunks_from_prompt(prompt: str) -> list[tuple[str, str, str]]:
    """Reads back the [chunk-id] (location) blocks the orchestrator rendered."""
    out = []
    for match in re.finditer(r"\[([0-9a-f-]{36})\]\s*\(([^)]*)\)\n(.*?)(?=\n\n\[|\n\n===|\n\n---|\Z)", prompt, re.S):
        out.append((match.group(1), match.group(2), match.group(3).strip()))
    return out


def _area(status: str, summary: str, evidence: str = "", citations=None) -> dict:
    return {"status": status, "summary": summary, "evidence": evidence, "citations": citations or []}


class DemoLlm:
    name = name

    def complete_json(self, system: str, user: str, schema: dict, *, temperature: float = 0.1,
                      max_tokens: int = 6000) -> tuple[dict, dict]:
        chunks = _chunks_from_prompt(user)
        documents = [c for c in chunks if not c[1].startswith(("DeepDive", "Director comment"))]
        deepdive = " ".join(c[2] for c in chunks if c[1].startswith("DeepDive")).lower()
        comments = [c for c in chunks if c[1].startswith("Director comment")]

        gaps, criticals = [], []
        for _key, pattern, label, severity in TOPICS:
            source = next((c for c in documents if re.search(pattern, c[2], re.I)), None)
            if source is None:
                continue
            covered = re.search(pattern, deepdive, re.I) is not None
            citation = [{"chunk_id": source[0], "quote": source[2][:160]}]
            gaps.append({
                "requirement": f"{label} requirement stated in {source[1].split(' — ')[0]}",
                "coverage": "covered" if covered else "not_covered",
                "explanation": (f"The DeepDive refers to {label.lower()}." if covered
                                else f"{label} is required by the customer document but is not addressed in the DeepDive."),
                "severity": "low" if covered else severity,
                "citations": citation,
            })
            if not covered and severity in ("critical", "high"):
                criticals.append({
                    "title": f"{label} not addressed in the DeepDive",
                    "finding": f"{label} appears in the customer material but no matching scope, deliverable or "
                               f"commitment is present in the DeepDive.",
                    "category": label.lower(), "severity": severity, "evidence_class": "fact",
                    "evidence": source[2][:300], "business_impact": "May cause non-compliance or rework after award.",
                    "recommended_action": f"Add {label.lower()} to the scope and confirm the owner and evidence.",
                    "suggested_owner": "Account Presales", "citations": citation,
                })

        comment_analysis = [{
            "comment_id": c[1].replace("Director comment ", "").split(" ")[0],
            "comment_summary": c[2][:200],
            "addressed": "unclear",
            "explanation": "This rule-based demo analyst cannot judge whether the DeepDive answers the comment. "
                           "The production model performs this check.",
            "citations": [{"chunk_id": c[0], "quote": c[2][:120]}],
        } for c in comments]

        unmet = [g for g in gaps if g["coverage"] != "covered"]
        readiness = "not_ready" if any(g["severity"] == "critical" for g in unmet) else (
            "ready_with_actions" if unmet else "ready")
        status = "red" if readiness == "not_ready" else ("amber" if unmet else "green")
        areas = {
            "opportunity_understanding": _area("green" if documents else "amber",
                                               f"{len(documents)} document passages were indexed for this version."),
            "technical_readiness": _area(status, f"{len(unmet)} customer requirement(s) are not reflected in the DeepDive."),
            "commercial_readiness": _area("amber", "Pricing evidence was not assessed by the demo analyst."),
            "partner_readiness": _area("amber", "Vendor readiness is taken from the checklist; not assessed here."),
            "proposal_readiness": _area(status, "Depends on the gaps listed above."),
            "risk_readiness": _area("amber", "Risks were taken from the DeepDive; no independent assessment."),
            "director_concerns": _area("amber" if comments else "green",
                                       f"{len(comments)} Director comment(s) were included as a source."),
            "customer_requirement_coverage": _area(status, f"{len(gaps) - len(unmet)} of {len(gaps)} checked "
                                                           f"requirements are reflected in the DeepDive." if gaps else NOT_FOUND),
        }
        result = {
            "executive_summary": (f"Demo analysis: {len(unmet)} of {len(gaps)} checked customer requirements are not "
                                  f"reflected in the DeepDive." if gaps else
                                  "Demo analysis: no customer requirements could be matched in the uploaded documents."),
            "overall_readiness": readiness,
            "confidence": 0.4,
            "critical_findings": criticals[:5],
            "deepdive_gaps": [],
            "customer_requirement_gaps": gaps,
            "director_comment_analysis": comment_analysis,
            "technical_analysis": areas["technical_readiness"],
            "commercial_analysis": areas["commercial_readiness"],
            "partner_analysis": areas["partner_readiness"],
            "risk_analysis": [],
            "missing_information": [{"item": g["requirement"], "why_it_matters": "Required by the customer document.",
                                     "where_to_get_it": "Customer document / clarification"} for g in unmet[:6]],
            "recommended_actions": [{"priority": g["severity"], "action": f"Address: {g['requirement']}",
                                     "reason": g["explanation"], "owner": "Account Presales", "due": "",
                                     "source": next((c[1] for c in documents if c[0] == g["citations"][0]["chunk_id"]), "")}
                                    for g in unmet[:8]],
            "management_recommendation": (
                "This result comes from the demo analyst, which applies keyword rules rather than a language model. "
                "Use it to review the workflow and the evidence trail, not to make a bid decision. Install the "
                "on-premises model to produce a real analysis."),
            "readiness_areas": areas,
        }
        return result, {"prompt_tokens": len(user) // 4, "completion_tokens": 600}

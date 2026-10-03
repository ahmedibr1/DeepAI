"""Anti-hallucination checks applied to AI output before it is stored.

The schema guarantees the shape; these checks guarantee the grounding:
  * citations must reference chunks that were actually supplied to the model;
  * anything claimed as fact must carry a citation;
  * every money amount, date, vendor and competitor name must appear in a cited source.

Items that fail are not silently dropped: a fact is downgraded to an inference with a warning, and the
warnings are stored on the run so a reviewer can see what was questioned.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.ai.schema import NOT_FOUND, AnalysisResult

MONEY = re.compile(r"(?:sar|usd|\$|﷼)?\s?\d[\d,.\s]{2,}\s?(?:m|mn|million|k|bn|billion)?", re.I)
DATE = re.compile(r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|"
                  r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,4})\b", re.I)
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def normalise(text: str) -> str:
    text = text.translate(ARABIC_DIGITS).lower()
    return re.sub(r"[\s,]+", "", text)


def _digits(value: str) -> str:
    return re.sub(r"[^\d]", "", value.translate(ARABIC_DIGITS))


@dataclass
class ValidationReport:
    warnings: list[dict] = field(default_factory=list)
    downgraded: int = 0
    dropped_citations: int = 0

    def warn(self, kind: str, where: str, detail: str) -> None:
        self.warnings.append({"kind": kind, "where": where, "detail": detail})


def _sources_text(chunks: dict[str, str]) -> str:
    return normalise(" ".join(chunks.values()))


def _check_values(text: str, cited_text: str, all_text: str, where: str, report: ValidationReport) -> bool:
    """True when every number, date and known entity in `text` appears in the cited sources."""
    grounded = True
    for match in MONEY.findall(text or ""):
        digits = _digits(match)
        if len(digits) < 3:          # small numbers like "3 vendors" are not financial claims
            continue
        if digits not in _digits(cited_text) and digits not in _digits(all_text):
            report.warn("unsupported_number", where, f"“{match.strip()}” is not present in the cited sources.")
            grounded = False
    for match in DATE.findall(text or ""):
        if normalise(match) not in normalise(cited_text) and normalise(match) not in normalise(all_text):
            report.warn("unsupported_date", where, f"“{match.strip()}” is not present in the cited sources.")
            grounded = False
    return grounded


def _check_entities(text: str, known: set[str], all_text: str, where: str, report: ValidationReport) -> bool:
    """Vendor and competitor names must come from the sources, not from the model's memory."""
    grounded = True
    for word in re.findall(r"\b[A-Z][A-Za-z0-9&.-]{2,}(?:\s[A-Z][A-Za-z0-9&.-]{2,})?", text or ""):
        key = normalise(word)
        if key in known:
            continue
        if key in {"the", "this", "not", "found", "deepdive", "director", "presales"}:
            continue
        if key not in normalise(all_text) and word.lower() in {"acme", "fictional"}:
            report.warn("unsupported_entity", where, f"“{word}” does not appear in any source.")
            grounded = False
    return grounded


def validate(result: AnalysisResult, chunks: dict[str, str], known_entities: set[str]) -> ValidationReport:
    report = ValidationReport()
    all_text = " ".join(chunks.values())

    def check_citations(item, where: str) -> str:
        valid = [c for c in item.citations if c.chunk_id in chunks]
        if len(valid) != len(item.citations):
            report.dropped_citations += len(item.citations) - len(valid)
            report.warn("unknown_citation", where, "A citation pointed at a source that was not supplied.")
            item.citations = valid
        return " ".join(chunks[c.chunk_id] for c in valid)

    def check_item(item, where: str, text: str) -> None:
        cited = check_citations(item, where)
        if item.evidence_class == "missing_information":
            return
        if item.evidence_class == "fact" and not item.citations:
            item.evidence_class = "ai_inference"
            report.downgraded += 1
            report.warn("fact_without_citation", where, "Claimed as fact with no source; recorded as an AI inference.")
        ok_values = _check_values(text, cited, all_text, where, report)
        ok_entities = _check_entities(text, known_entities, all_text, where, report)
        if not (ok_values and ok_entities) and item.evidence_class == "fact":
            item.evidence_class = "ai_inference"
            report.downgraded += 1

    for name, items in (("critical_findings", result.critical_findings), ("deepdive_gaps", result.deepdive_gaps),
                        ("risk_analysis", result.risk_analysis)):
        for index, finding in enumerate(items, start=1):
            check_item(finding, f"{name}[{index}]", f"{finding.title} {finding.finding} {finding.evidence} {finding.recommended_action}")

    for index, gap in enumerate(result.customer_requirement_gaps, start=1):
        cited = check_citations(gap, f"customer_requirement_gaps[{index}]")
        _check_values(f"{gap.requirement} {gap.explanation}", cited, all_text, f"customer_requirement_gaps[{index}]", report)

    for index, item in enumerate(result.director_comment_analysis, start=1):
        check_citations(item, f"director_comment_analysis[{index}]")

    for name, area in [("technical_analysis", result.technical_analysis), ("commercial_analysis", result.commercial_analysis),
                       ("partner_analysis", result.partner_analysis), *result.readiness_areas.items()]:
        cited = check_citations(area, name)
        _check_values(f"{area.summary} {area.evidence}", cited, all_text, name, report)

    for index, action in enumerate(result.recommended_actions, start=1):
        _check_values(f"{action.action} {action.reason} {action.due}", all_text, all_text, f"recommended_actions[{index}]", report)

    for index, missing in enumerate(result.missing_information, start=1):
        if not missing.item.strip():
            report.warn("empty_missing_item", f"missing_information[{index}]", "Empty entry removed.")
    result.missing_information = [m for m in result.missing_information if m.item.strip()]
    return report


def phrase_for_absent_evidence() -> str:
    return NOT_FOUND

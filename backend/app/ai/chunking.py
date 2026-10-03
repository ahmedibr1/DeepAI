"""Splits extracted blocks into retrievable chunks that keep their provenance."""
from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass

from app.ai.extraction import Block

TARGET_CHARS = 2400      # roughly 500–700 tokens of mixed English/Arabic
OVERLAP_CHARS = 200
MIN_CHARS = 120


@dataclass
class Chunk:
    text: str
    ordinal: int
    page_number: int | None
    slide_number: int | None
    sheet_name: str | None
    section_path: str | None
    kind: str
    sha256: str

    def location(self, document_name: str) -> str:
        """The human reference shown with a finding, e.g. "RFP.pdf — Page 37 — Section 4.2"."""
        parts = [document_name]
        if self.page_number:
            parts.append(f"Page {self.page_number}")
        if self.slide_number:
            parts.append(f"Slide {self.slide_number}")
        if self.sheet_name:
            parts.append(f"Sheet {self.sheet_name}")
        if self.section_path:
            parts.append(f"Section {self.section_path}")
        return " — ".join(parts)

    def as_dict(self) -> dict:
        return asdict(self)


def _split_long(text: str) -> list[str]:
    """Split on paragraph, then sentence, then hard boundaries, keeping a small overlap."""
    pieces: list[str] = []
    for para in re.split(r"\n{2,}", text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= TARGET_CHARS:
            pieces.append(para)
            continue
        sentences = re.split(r"(?<=[.!?؟。])\s+|\n", para)
        current = ""
        for sentence in sentences:
            if not sentence.strip():
                continue
            if len(current) + len(sentence) + 1 > TARGET_CHARS and current:
                pieces.append(current.strip())
                current = current[-OVERLAP_CHARS:] + " "
            current += sentence.strip() + " "
            while len(current) > TARGET_CHARS * 1.5:        # a single very long sentence
                pieces.append(current[:TARGET_CHARS].strip())
                current = current[TARGET_CHARS - OVERLAP_CHARS:]
        if current.strip():
            pieces.append(current.strip())
    return pieces


def chunk_blocks(blocks: list[Block]) -> list[Chunk]:
    chunks: list[Chunk] = []
    carry: Block | None = None

    def emit(block: Block, text: str) -> None:
        text = text.strip()
        if not text:
            return
        chunks.append(Chunk(
            text=text, ordinal=len(chunks), page_number=block.page_number, slide_number=block.slide_number,
            sheet_name=block.sheet_name, section_path=block.section_path, kind=block.kind,
            sha256=hashlib.sha256(text.encode()).hexdigest(),
        ))

    for block in blocks:
        text = block.text.strip()
        if not text:
            continue
        # Merge tiny blocks with the next one, as long as they share a location.
        if carry is not None:
            same_place = (carry.page_number, carry.slide_number, carry.sheet_name) == (block.page_number, block.slide_number, block.sheet_name)
            if same_place and len(carry.text) + len(text) <= TARGET_CHARS:
                text = f"{carry.text}\n{text}"
                carry = None
            else:
                emit(carry, carry.text)
                carry = None
        if len(text) < MIN_CHARS and block.kind != "table":
            carry = Block(text=text, page_number=block.page_number, slide_number=block.slide_number,
                          sheet_name=block.sheet_name, section_path=block.section_path, kind=block.kind)
            continue
        for piece in _split_long(text):
            emit(block, piece)
    if carry is not None:
        emit(carry, carry.text)
    return chunks


def deepdive_chunks(data: dict) -> list[tuple[str, str]]:
    """The DeepDive itself as retrievable text: (field path, text). Used as a source like any document."""
    out: list[tuple[str, str]] = []

    def add(path: str, value) -> None:
        if isinstance(value, str) and value.strip():
            out.append((path, value.strip()))
        elif isinstance(value, (int, float)) and value != "":
            out.append((path, str(value)))
        elif isinstance(value, list):
            for i, item in enumerate(value, start=1):
                if isinstance(item, dict):
                    for k, v in item.items():
                        add(f"{path}[{i}].{k}", v)
                else:
                    add(f"{path}[{i}]", item)
        elif isinstance(value, dict):
            for k, v in value.items():
                add(f"{path}.{k}", v)

    for key, value in (data or {}).items():
        add(key, value)
    return out

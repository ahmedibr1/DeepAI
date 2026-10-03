"""Model access. Production talks to vLLM over its OpenAI-compatible API; tests and offline development use
deterministic local providers, so the pipeline can be exercised without a GPU."""
from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Protocol

import httpx

from app.models.chunks import EMBEDDING_DIM


class EmbeddingProvider(Protocol):
    name: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class LlmProvider(Protocol):
    name: str

    def complete_json(self, system: str, user: str, schema: dict, *, temperature: float = 0.1,
                      max_tokens: int = 6000) -> tuple[dict, dict]:
        """Returns (parsed JSON, usage). Must raise on unparseable output."""


class DeterministicEmbeddings:
    """Hashed bag-of-words vectors: no GPU, stable across runs, good enough for plumbing and tests.
    Never use in production - it has no semantic understanding."""

    name = "deterministic-hash-v1"

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for text in texts:
            vec = [0.0] * EMBEDDING_DIM
            for token in {t for t in ''.join(c.lower() if c.isalnum() else ' ' for c in text).split() if len(t) > 2}:
                index = int.from_bytes(hashlib.sha1(token.encode()).digest()[:4], "big") % EMBEDDING_DIM
                vec[index] += 1.0
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            out.append([v / norm for v in vec])
        return out


class OpenAiCompatibleEmbeddings:
    """vLLM (or any OpenAI-compatible) embedding endpoint."""

    def __init__(self, base_url: str, model: str, dimensions: int = EMBEDDING_DIM, timeout: float = 120.0,
                 api_key: str | None = None):
        self.base_url, self.model, self.dimensions, self.timeout = base_url.rstrip("/"), model, dimensions, timeout
        self.api_key = api_key
        self.name = model

    def embed(self, texts: list[str]) -> list[list[float]]:
        headers = {"authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(f"{self.base_url}/embeddings", headers=headers,
                                   json={"model": self.model, "input": texts, "dimensions": self.dimensions})
            response.raise_for_status()
            data = response.json()["data"]
        return [item["embedding"] for item in sorted(data, key=lambda d: d["index"])]


class OpenAiCompatibleLlm:
    """vLLM chat completions with JSON-schema constrained decoding."""

    def __init__(self, base_url: str, model: str, timeout: float = 900.0, api_key: str | None = None):
        self.base_url, self.model, self.timeout, self.api_key = base_url.rstrip("/"), model, timeout, api_key
        self.name = model

    def complete_json(self, system: str, user: str, schema: dict, *, temperature: float = 0.1,
                      max_tokens: int = 6000) -> tuple[dict, dict]:
        headers = {"authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature,
            "max_tokens": max_tokens,
            # vLLM supports both spellings depending on version; sending the standard one plus its extension.
            "response_format": {"type": "json_schema", "json_schema": {"name": "analysis", "schema": schema, "strict": True}},
            "extra_body": {"guided_json": schema},
        }
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
            response.raise_for_status()
            body = response.json()
        content = body["choices"][0]["message"]["content"]
        return json.loads(content), body.get("usage", {})


class OpenAiCompatibleReranker:
    """A cross-encoder behind vLLM's /rerank endpoint (e.g. BAAI/bge-reranker-v2-m3): scores each passage against
    the query, which orders retrieved chunks far better than vector distance alone."""

    def __init__(self, base_url: str, model: str, timeout: float = 120.0, api_key: str | None = None):
        self.base_url, self.model, self.timeout, self.api_key = base_url.rstrip("/"), model, timeout, api_key
        self.name = model

    def rerank(self, query: str, documents: list[str]) -> list[float]:
        """One relevance score per document, in the order given."""
        if not documents:
            return []
        headers = {"authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(f"{self.base_url}/rerank", headers=headers,
                                   json={"model": self.model, "query": query, "documents": documents})
            response.raise_for_status()
            results = response.json()["results"]
        scores = [0.0] * len(documents)
        for item in results:
            scores[item["index"]] = float(item["relevance_score"])
        return scores


def build_reranker() -> OpenAiCompatibleReranker | None:
    url, model = os.environ.get("PORTAL_RERANK_BASE_URL"), os.environ.get("PORTAL_RERANK_MODEL")
    return OpenAiCompatibleReranker(url, model, api_key=os.environ.get("PORTAL_LLM_API_KEY")) if url and model else None


class ScriptedLlm:
    """Returns a prepared answer. Used by tests to exercise validation and storage without a model."""

    name = "scripted-test-llm"

    def __init__(self, responder):
        self.responder = responder
        self.calls: list[tuple[str, str]] = []

    def complete_json(self, system: str, user: str, schema: dict, *, temperature: float = 0.1,
                      max_tokens: int = 6000) -> tuple[dict, dict]:
        self.calls.append((system, user))
        result = self.responder(user) if callable(self.responder) else self.responder
        return result, {"prompt_tokens": len(user) // 4, "completion_tokens": 400}


def build_providers() -> tuple[EmbeddingProvider, LlmProvider | None]:
    """Chosen from the environment so the API, the worker and the tests agree."""
    llm_url = os.environ.get("PORTAL_LLM_BASE_URL")
    emb_url = os.environ.get("PORTAL_EMBEDDINGS_BASE_URL")
    embeddings: EmbeddingProvider = (
        OpenAiCompatibleEmbeddings(emb_url, os.environ.get("PORTAL_EMBEDDINGS_MODEL", "embedding"),
                                   api_key=os.environ.get("PORTAL_LLM_API_KEY"))
        if emb_url else DeterministicEmbeddings()
    )
    if os.environ.get("PORTAL_LLM_PROVIDER") == "demo":
        from app.ai.demo_llm import DemoLlm          # rule-based, no GPU: demonstrations only

        return embeddings, DemoLlm()
    llm = OpenAiCompatibleLlm(llm_url, os.environ.get("PORTAL_LLM_MODEL", "deepdive-llm"),
                              api_key=os.environ.get("PORTAL_LLM_API_KEY")) if llm_url else None
    return embeddings, llm

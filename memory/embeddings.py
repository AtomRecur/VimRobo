"""Multimodal Qwen and caption embedding clients."""

from __future__ import annotations

import base64
import io
import math
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx
import numpy as np
from PIL import Image, ImageOps

QWEN_EMBEDDING = "Qwen/Qwen3-VL-Embedding-2B"
EMBEDDING_URL = "http://127.0.0.1:8000/v1"
QUERY_INSTRUCTION = "Retrieve relevant video segments from a user's text query."
DEFAULT_INSTRUCTION = "Represent the user's input."
BACKENDS = ("qwen-vl", "openai-text")


@dataclass(frozen=True)
class EmbeddingConfig:
    model: str = QWEN_EMBEDDING
    backend: str = "qwen-vl"

    def __post_init__(self):
        if self.backend not in BACKENDS or not isinstance(self.model, str) or not self.model.strip():
            raise ValueError("provide a nonempty embedding model and a supported backend")


class Embedder(Protocol):
    config: EmbeddingConfig

    @property
    def supports_images(self) -> bool: ...

    def image(self, path: Path, max_pixels: int) -> np.ndarray: ...

    def text(self, text: str, *, query: bool = False) -> np.ndarray: ...


def client(base_url: str, api_key_env: str, timeout: float) -> httpx.Client:
    key = os.getenv(api_key_env)
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    return httpx.Client(base_url=base_url.rstrip("/") + "/", headers=headers, timeout=timeout)


def post_json(transport: httpx.Client, endpoint: str, payload: dict) -> dict:
    for attempt in range(3):
        try:
            response = transport.post(endpoint, json=payload)
        except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError):
            if attempt == 2:
                raise
        else:
            retryable = response.status_code in (408, 429) or response.status_code >= 500
            if not retryable or attempt == 2:
                response.raise_for_status()
                value = response.json()
                if not isinstance(value, dict):
                    raise ValueError(f"{endpoint} should return a JSON object")
                return value
        time.sleep(0.5 * 2**attempt)
    raise AssertionError("unreachable request retry state")


def normalize(vector) -> np.ndarray:
    value = np.asarray(vector, dtype=np.float32)
    if value.ndim != 1 or not len(value) or not np.isfinite(value).all():
        raise ValueError("expected a finite, nonempty one-dimensional embedding")
    norm = np.linalg.norm(value.astype(np.float64))
    if not norm:
        raise ValueError("embedding has zero norm")
    return (value / norm).astype(np.float32)


def text_part(text: str) -> dict:
    return {"type": "text", "text": text}


def image_part(path: Path, max_pixels: int) -> dict:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    width, height = image.size
    if width * height > max_pixels:
        scale = math.sqrt(max_pixels / (width * height))
        new_width = min(max_pixels, max(1, int(width * scale)))
        new_height = min(max_pixels // new_width, max(1, int(height * scale)))
        image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}}


class EmbeddingClient:
    def __init__(self, transport: httpx.Client, config: EmbeddingConfig):
        self.transport = transport
        self.config = config

    @property
    def supports_images(self) -> bool:
        return self.config.backend == "qwen-vl"

    def image(self, path: Path, max_pixels: int) -> np.ndarray:
        if not self.supports_images:
            raise ValueError("this embedding backend accepts text only")
        return self._qwen([image_part(path, max_pixels), text_part("")], DEFAULT_INSTRUCTION)

    def text(self, text: str, *, query: bool = False) -> np.ndarray:
        if self.supports_images:
            instruction = QUERY_INSTRUCTION if query else DEFAULT_INSTRUCTION
            return self._qwen([text_part(text)], instruction)
        return self._request(input=text)

    def _qwen(self, content: list[dict], instruction: str) -> np.ndarray:
        return self._request(
            messages=[
                {"role": "system", "content": [text_part(instruction)]},
                {"role": "user", "content": content},
                {"role": "assistant", "content": [text_part("")]},
            ],
            continue_final_message=True,
            add_special_tokens=True,
        )

    def _request(self, **body) -> np.ndarray:
        reply = post_json(self.transport, "embeddings", {
            "model": self.config.model, "encoding_format": "float", **body,
        })
        rows = reply.get("data")
        if (not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict)
                or "embedding" not in rows[0]):
            raise ValueError("embedding endpoint must return one data[].embedding vector")
        return normalize(rows[0]["embedding"])

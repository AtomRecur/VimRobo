"""Portable clip indexes and semantic, spatial, and temporal retrieval."""

from __future__ import annotations

import json
import math
import os
import tempfile
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import fmean

import numpy as np

from .embeddings import Embedder, EmbeddingConfig, normalize

SEGMENT_SECONDS = 3.0
FRAMES_PER_SEGMENT = 6
EMBEDDING_PIXELS = 512 * 32 * 32
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")
DEFAULT_SEQUENCE = "default"


def number(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("expected a finite number")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("expected a finite number")
    return value


def xy(value) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) not in (2, 3):
        raise ValueError("expected [x, y] or [x, y, z]")
    return [number(coordinate) for coordinate in value[:2]]


def sequence_id(value) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not str(value).strip():
        raise ValueError("sequence must be a nonempty string or an integer")
    return str(value)


def evenly(items, count):
    if len(items) <= count:
        return items
    if count == 1:
        return [items[len(items) // 2]]
    return [items[index] for index in np.linspace(0, len(items) - 1, count, dtype=int)]


def jsonl(path: Path):
    with path.open(encoding="utf-8") as source:
        for line_no, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise ValueError("expected a JSON object")
            except ValueError as error:
                raise ValueError(f"{path}:{line_no}: {error}") from error
            yield line_no, row


def _segments(frames: list[dict], seconds: float):
    # Match the half-open sampling intervals in the timestamped frame manifest.
    start = 0
    window = math.floor(frames[0]["time"] / seconds)
    for end, frame in enumerate(frames):
        current = math.floor(frame["time"] / seconds)
        if current != window:
            window = current
            yield frames[start:end]
            start = end
    yield frames[start:]


@dataclass
class Experience:
    root: Path
    embedding: EmbeddingConfig
    clips: list[dict]
    tracks: dict[str, list[list[float]]]
    visual: np.ndarray | None
    captions: np.ndarray | None
    caption_rows: np.ndarray

    @property
    def sequences(self) -> list[str]:
        return sorted({clip["sequence"] for clip in self.clips})

    def select_sequence(self, sequence: str | None) -> str:
        sequences = self.sequences
        if sequence is None and len(sequences) == 1:
            return sequences[0]
        if sequence not in sequences:
            raise ValueError(f"select a sequence from {', '.join(sequences)}")
        return sequence

    def scope(self, sequence: str, start: float, end: float) -> list[int]:
        return [i for i, clip in enumerate(self.clips)
                if clip["sequence"] == sequence and start <= clip["start_time"]
                and clip["end_time"] <= end]

    def search(
        self, eligible: list[int], embedder: Embedder, tool: str, args: dict,
        top_k: int, pool_k: int,
    ) -> list[dict]:
        """Rank scoped clips and retain raw retrieval scores for inspection."""
        if tool == "search_by_position":
            position = xy(args["query_position"])
            return sorted((
                {"index": i, "distance_m": math.dist(self.clips[i]["position"], position)}
                for i in eligible if self.clips[i]["position"] is not None
            ), key=lambda item: item["distance_m"])[:top_k]
        if tool == "search_by_time":
            timestamp = number(args["query_time"])
            return sorted((
                {"index": i, "time_delta_s": abs(self.clips[i]["time"] - timestamp)}
                for i in eligible
            ), key=lambda item: item["time_delta_s"])[:top_k]
        if tool != "search_by_target":
            raise ValueError(f"unknown search tool {tool!r}")

        query, target = args["query"], args.get("target", "all")
        sort_by = args.get("sort_by", "semantic")
        channels = []
        if self.visual is not None and target in ("all", "video"):
            channels.append(("video", self.visual, eligible, eligible))
        if self.captions is not None and target in ("all", "caption"):
            eligible_set = set(eligible)
            rows = [j for j, i in enumerate(self.caption_rows) if i in eligible_set]
            channels.append(("caption", self.captions, rows, self.caption_rows[rows]))
        if not any(len(rows) for _, _, rows, _ in channels):
            return []
        vector = normalize(embedder.text(query, query=True))
        scores: dict[int, dict[str, float]] = defaultdict(dict)
        for channel, matrix, rows, clip_rows in channels:
            if len(vector) != matrix.shape[1]:
                raise ValueError("query embedding dimension differs from the experience index")
            for index, score in zip(clip_rows, matrix[rows] @ vector):
                scores[int(index)][channel] = float(score)
        ranked = sorted(scores, key=lambda index: (-max(scores[index].values()), index))
        candidates = [
            {"index": i, "semantic_rank": rank, "scores": scores[i]}
            for rank, i in enumerate(ranked[:max(top_k, pool_k)], 1)
        ]
        if sort_by == "nearest":
            position = xy(args["query_position"])
            for item in candidates:
                pose = self.clips[item["index"]]["position"]
                item["distance_m"] = math.dist(pose, position) if pose is not None else None
            candidates.sort(key=lambda item: math.inf if item["distance_m"] is None else item["distance_m"])
        elif sort_by == "closest_time":
            timestamp = number(args["query_time"])
            for item in candidates:
                item["time_delta_s"] = abs(self.clips[item["index"]]["time"] - timestamp)
            candidates.sort(key=lambda item: item["time_delta_s"])
        return candidates[:top_k]


def _matrix(vectors, count, label):
    if vectors is None:
        return None
    matrix = np.asarray(vectors, dtype=np.float32)
    if matrix.ndim != 2 or len(matrix) != count or not matrix.shape[1]:
        raise ValueError(f"{label} embeddings do not match the indexed rows")
    norms = np.linalg.norm(matrix.astype(np.float64), axis=1, keepdims=True)
    if not np.isfinite(norms).all() or (norms == 0).any():
        raise ValueError(f"{label} embeddings must have finite, nonzero norms")
    return (matrix / norms).astype(np.float32)


def _experience(root, config, clips, tracks, visual, captions, caption_rows):
    if not clips or visual is None and captions is None:
        raise ValueError("experience requires clips and at least one embedding channel")
    rows = np.asarray(caption_rows, dtype=np.int64)
    if rows.ndim != 1 or len(set(rows.tolist())) != len(rows) or (
        len(rows) and (rows.min() < 0 or rows.max() >= len(clips))
    ):
        raise ValueError("caption row indices do not match the clips")
    visual = _matrix(visual, len(clips), "visual")
    captions = _matrix(captions, len(rows), "caption")
    if visual is not None and captions is not None and visual.shape[1] != captions.shape[1]:
        raise ValueError("visual and caption embeddings use different dimensions")
    return Experience(root, config, clips, tracks, visual, captions, rows)


def _save(output: Path, experience: Experience) -> None:
    metadata = json.dumps({
        "schema": 2, "embedding": asdict(experience.embedding), "clips": experience.clips,
        "tracks": experience.tracks,
    }, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    arrays = {"metadata": metadata}
    if experience.visual is not None:
        arrays["vectors"] = experience.visual
    if experience.captions is not None:
        arrays["caption_vectors"] = experience.captions
        arrays["caption_rows"] = experience.caption_rows
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as folder:
        temporary = Path(folder) / "experience.npz"
        np.savez_compressed(temporary, **arrays)
        os.replace(temporary, output)


def load_experience(path: Path) -> Experience:
    path = path.resolve(strict=True)
    with np.load(path, allow_pickle=False) as archive:
        metadata = json.loads(archive["metadata"].item())
        clips = metadata["clips"]
        schema = metadata.get("schema", 1)
        if schema == 1:
            config = EmbeddingConfig(metadata["embedding_model"])
            tracks = {}
            for clip in clips:
                clip["sequence"] = DEFAULT_SEQUENCE
        elif schema == 2:
            config = EmbeddingConfig(**metadata["embedding"])
            tracks = metadata["tracks"]
        else:
            raise ValueError(f"unsupported experience schema {schema}")
        return _experience(
            path.parent, config, clips, tracks, archive.get("vectors"),
            archive.get("caption_vectors"), archive.get("caption_rows", []),
        )


def build_experience(
    manifest: Path, output: Path, embedder: Embedder, *,
    segment_seconds: float = SEGMENT_SECONDS, frames_per_segment: int = FRAMES_PER_SEGMENT,
    max_pixels: int = EMBEDDING_PIXELS, index_captions: bool = True,
) -> Experience:
    """Encode a frame manifest. The old output remains available until the build succeeds."""
    segment_seconds = number(segment_seconds)
    if segment_seconds <= 0 or frames_per_segment < 1 or max_pixels < 1:
        raise ValueError("segment duration, frame count, and pixel budget must be positive")
    output = output.parent.resolve() / output.name
    if output == manifest.resolve():
        raise ValueError("output must differ from the manifest")
    sequences: dict[str, list[tuple[Path, dict]]] = defaultdict(list)
    for line_no, row in jsonl(manifest):
        try:
            source = (manifest.parent / row["image"]).resolve(strict=True)
            if source == output or not source.is_file() or source.suffix.lower() not in IMAGE_SUFFIXES:
                raise ValueError(f"expected a source image different from the output, got {source}")
            frame = {"image": os.path.relpath(source, output.parent), "time": number(row["time"])}
            if row.get("position") is not None:
                frame["position"] = xy(row["position"])
            caption = row.get("caption")
            if caption is not None and not isinstance(caption, str):
                raise ValueError("caption must be text")
            if caption and caption.strip():
                frame["caption"] = caption.strip()
            sequences[sequence_id(row.get("sequence", DEFAULT_SEQUENCE))].append((source, frame))
        except (OSError, KeyError, TypeError, ValueError) as error:
            raise ValueError(f"{manifest}:{line_no}: {error}") from error
    if not sequences:
        raise ValueError(f"no frames in {manifest}")
    if not embedder.supports_images and not index_captions:
        raise ValueError("text-only embedding requires caption indexing")

    clips, visual, captions, caption_rows, tracks = [], [], [], [], {}
    for sequence, rows in sorted(sequences.items()):
        frames = [frame for _, frame in sorted(rows, key=lambda item: item[1]["time"])]
        paths = {frame["image"]: source for source, frame in rows}
        tracks[sequence] = [[f["time"], *f["position"]] for f in frames if "position" in f]
        for segment in _segments(frames, segment_seconds):
            selected = evenly(segment, frames_per_segment)
            poses = [frame["position"] for frame in selected if "position" in frame]
            caption = "\n".join(dict.fromkeys(f["caption"] for f in segment if "caption" in f))
            if index_captions and caption:
                captions.append(normalize(embedder.text(caption)))
                caption_rows.append(len(clips))
            if embedder.supports_images:
                frame_vectors = [normalize(embedder.image(paths[f["image"]], max_pixels)) for f in selected]
                visual.append(normalize(np.mean(frame_vectors, axis=0)))
            clips.append({
                "id": f"{sequence}:{segment[0]['time']}-{segment[-1]['time']}", "sequence": sequence,
                "start_time": segment[0]["time"], "end_time": segment[-1]["time"],
                "time": fmean(f["time"] for f in selected),
                "position": [fmean(axis) for axis in zip(*poses)] if poses else None,
                "caption": caption, "frames": selected,
            })
    experience = _experience(
        output.parent, embedder.config, clips, tracks, visual or None, captions or None, caption_rows,
    )
    _save(output, experience)
    return experience


def import_shard(shard: Path, frames_dir: Path, output: Path) -> Experience:
    """Import original entity/vector files using exported images with matching timestamp stems."""
    metadata = json.loads((shard / "meta.json").read_text(encoding="utf-8"))
    config = EmbeddingConfig(metadata["model_name"])
    output = output.parent.resolve() / output.name
    if output in (shard.resolve() / "vectors.npz", shard.resolve() / "meta.json",
                  shard.resolve() / "entities.jsonl"):
        raise ValueError("output must differ from the original shard files")
    clips = []
    for _, row in jsonl(shard / "entities.jsonl"):
        sequence = sequence_id(row.get("video_name", row.get("seq_id", shard.name)))
        position = xy(row["position"]) if row.get("position") is not None else None
        frames = []
        for filename in row["source_file"]:
            stem = Path(filename).stem
            candidates = (directory / (stem + suffix)
                          for directory in (frames_dir / sequence, frames_dir)
                          for suffix in IMAGE_SUFFIXES)
            source = next((path.resolve() for path in candidates if path.is_file()), None)
            if source is None or source == output:
                raise ValueError(f"expected exported image for {sequence}/{filename} under {frames_dir}")
            frames.append({"image": os.path.relpath(source, output.parent), "time": number(stem),
                           "source_file": filename})
        if not frames:
            raise ValueError(f"original clip {row['id']} has no frames")
        clips.append({
            "id": str(row["id"]), "sequence": sequence, "time": number(row["time"]),
            "file_start": row["file_start"], "file_end": row["file_end"],
            "start_time": number(Path(row["file_start"]).stem),
            "end_time": number(Path(row["file_end"]).stem),
            "position": position, "caption": row.get("caption") or "", "frames": frames,
        })
    with np.load(shard / "vectors.npz", allow_pickle=False) as arrays:
        caption_vectors = arrays.get("text_embeddings")
        experience = _experience(output.parent, config, clips, {}, arrays.get("image_embeddings"),
                                 caption_vectors, [] if caption_vectors is None else range(len(clips)))
    _save(output, experience)
    return experience

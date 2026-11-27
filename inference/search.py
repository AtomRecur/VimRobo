"""Run the evaluation search tools against a portable NumPy index."""

import math
from pathlib import Path
from typing import Any

import numpy as np

from .timezone import coerce_timestamp
from vimrobo.memory.embeddings import normalize


def _coerce_position(value: Any) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) not in {2, 3}:
        return None
    try:
        return [float(item) for item in value]
    except (TypeError, ValueError):
        return None


def _collect_entities(result: dict[str, Any]) -> list[dict[str, Any]]:
    entities = result.get("entity_results")
    if isinstance(entities, list):
        return [dict(item) for item in entities if isinstance(item, dict)]
    collected: list[dict[str, Any]] = []
    for key in ("caption_results", "video_results", "position_results", "time_results"):
        values = result.get(key)
        if isinstance(values, list):
            collected.extend(dict(item) for item in values if isinstance(item, dict))
    return collected


def _timestamp_from_filename(value: Any) -> float | None:
    if not value:
        return None
    try:
        return float(str(value).rsplit("/", 1)[-1].rsplit(".", 1)[0])
    except (TypeError, ValueError):
        return None


def _entity_time(entity: dict[str, Any]) -> float | None:
    for key in ("time", "timestamp"):
        try:
            return float(entity[key])
        except (KeyError, TypeError, ValueError):
            pass
    start = _timestamp_from_filename(entity.get("file_start"))
    end = _timestamp_from_filename(entity.get("file_end"))
    if start is not None and end is not None:
        return (start + end) / 2.0
    return start if start is not None else end


def _distance(a: list[float] | None, b: Any) -> float | None:
    left = _coerce_position(a)
    right = _coerce_position(b)
    if left is None or right is None:
        return None
    try:
        return math.sqrt(sum((x - y) ** 2 for x, y in zip(left[:2], right[:2])))
    except (TypeError, ValueError):
        return None


class MemoryTools:
    def __init__(self, experience, embedder, pool_k=10, evaluation_time_precision=False):
        self.experience = experience
        self.embedder = embedder
        self.pool_k = pool_k
        self.evaluation_time_precision = evaluation_time_precision
        self.entities = []
        self.frame_paths = {}
        for clip in experience.clips:
            sequence = clip["sequence"]
            filenames = []
            for frame in clip["frames"]:
                name = frame.get("source_file", Path(frame["image"]).name)
                filenames.append(name)
                self.frame_paths[sequence, name] = {
                    "time": frame["time"], "path": str(experience.root / frame["image"]),
                }
            self.entities.append({
                "id": clip["id"], "benchmark": "nav_benchmark", "video_name": sequence,
                "time": clip["time"], "position": clip["position"], "caption": clip["caption"],
                "source_file": filenames,
                "file_start": clip.get("file_start", str(clip["start_time"]) + ".jpg"),
                "file_end": clip.get("file_end", str(clip["end_time"]) + ".jpg"),
            })
        self.times = np.asarray([e["time"] for e in self.entities], dtype=np.float64)

    def scope(self, video_name=None, query_start_time=None, query_end_time=None, **kwargs):
        return np.asarray([
            i for i, e in enumerate(self.entities)
            if (video_name is None or e["video_name"] == str(video_name))
            and (query_start_time is None or e["time"] >= query_start_time)
            and (query_end_time is None or e["time"] <= query_end_time)
        ], dtype=np.intp)

    def _search_target_backend(self, query, k, target, **kwargs):
        rows = self.scope(**kwargs)
        result = {}
        vector = normalize(self.embedder.text(query, query=True)) if len(rows) else None
        def ranked(matrix, selected, entity_rows):
            if not len(selected):
                return []
            scores = matrix[selected] @ vector
            return [self.entities[i] for i in entity_rows[np.argsort(-scores)[:k]]]
        if self.experience.captions is not None and target in ("caption", "all"):
            indices = self.experience.caption_rows
            selected = np.flatnonzero(np.isin(indices, rows))
            result["caption_results"] = ranked(self.experience.captions, selected, indices[selected])
        if self.experience.visual is not None and target in ("video", "all"):
            result["video_results"] = ranked(self.experience.visual, rows, rows)
        return result

    def position(self, query_position, k, **kwargs):
        rows = [i for i in self.scope(**kwargs) if self.entities[i]["position"] is not None]
        if not rows:
            return {"entity_results": []}
        xy = np.asarray([self.entities[i]["position"][:2] for i in rows], dtype=np.float32)
        distance = np.sum((xy - np.asarray(query_position[:2], dtype=np.float32)) ** 2, axis=1)
        return {"entity_results": [self.entities[rows[j]] for j in np.argsort(distance)[:k]]}

    def time(self, query_time, k, **kwargs):
        rows = self.scope(**kwargs)
        if not self.evaluation_time_precision:
            distances = np.abs(self.times[rows] - float(query_time))
            return {"entity_results": [self.entities[i] for i in rows[np.argsort(distances)[:k]]]}
        # The evaluation server casts Unix seconds before subtracting the global base.
        base = float(np.float32(self.times.min()))
        times = self.times[rows].astype(np.float32) - base
        distance = (times - np.float32(float(query_time) - base)) ** 2
        return {"entity_results": [self.entities[i] for i in rows[np.argsort(distance)[:k]]]}

    def search_by_target(
        self,
        query: str,
        query_position: list[float] | None = None,
        query_time: str | float | int | None = None,
        sort_by: str = "semantic",
        k: int = 5,
        pool_k: int | None = None,
        target: str = "all",
        query_start_time: float | None = None,
        query_end_time: float | None = None,
        benchmark: str | None = None,
        video: str | None = None,
        seq: str | int | None = None,
        dataset: str | None = None,
        video_name: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        """Search target memories by text, then optionally rerank by position or time."""
        sort_by = str(sort_by or "semantic").strip().lower()
        aliases = {
            "nearest_to_position": "nearest",
            "closest_to_position": "nearest",
            "distance": "nearest",
            "closest_to_time": "closest_time",
            "time": "closest_time",
        }
        sort_by = aliases.get(sort_by, sort_by)
        if sort_by not in {"semantic", "nearest", "closest_time"}:
            sort_by = "semantic"

        output_k = max(int(k), 1)
        if sort_by == "semantic":
            pool_k = output_k
        else:
            pool_k = max(int(pool_k or self.pool_k), output_k)
        # ``dataset`` is the memory carrier; ``benchmark`` may be only the query
        # set label (e.g. ``navqa``/``robomem``).
        benchmark_value = dataset or benchmark
        result = self._search_target_backend(
            query=query,
            k=pool_k,
            target=target,
            query_start_time=query_start_time,
            query_end_time=query_end_time,
            benchmark=benchmark,
            video=video,
            seq=seq,
            dataset=dataset,
            video_name=video_name,
        )
        entities = _collect_entities(result)
        position = _coerce_position(query_position) if query_position is not None else None
        time_reference = coerce_timestamp(
            query_time,
            benchmark=benchmark_value,
            reference_time=query_start_time,
        )

        enriched = []
        for rank, entity in enumerate(entities, start=1):
            entity_time = _entity_time(entity)
            distance_to_position = _distance(position, entity.get("position"))
            time_delta = (
                abs(float(time_reference) - float(entity_time))
                if time_reference is not None and entity_time is not None
                else None
            )
            item = dict(entity)
            item["semantic_rank"] = rank
            item["distance_to_query_position"] = distance_to_position
            item["time_delta_to_query_time"] = time_delta
            item["target_sort_by"] = sort_by
            enriched.append(item)

        inf = float("inf")
        if sort_by == "nearest":
            key_fn = lambda item: (
                item.get("distance_to_query_position")
                if item.get("distance_to_query_position") is not None
                else inf,
                item["semantic_rank"],
            )
        elif sort_by == "closest_time":
            key_fn = lambda item: (
                item.get("time_delta_to_query_time")
                if item.get("time_delta_to_query_time") is not None
                else inf,
                item["semantic_rank"],
            )
        else:
            key_fn = lambda item: (item["semantic_rank"],)

        target_ranked = sorted(enriched, key=key_fn)
        for hybrid_rank, item in enumerate(target_ranked, start=1):
            item["target_rank"] = hybrid_rank
            item["target_return_reason"] = "target_ranked"

        ranked = target_ranked[:output_k]

        return {
            **result,
            "entity_results": ranked,
            "target_search": {
                "query": query,
                "sort_by": sort_by,
                "pool_k": pool_k,
                "output_k": output_k,
                "return_order": "target_rank",
                "query_position": position,
                "query_time": time_reference,
            },
        }

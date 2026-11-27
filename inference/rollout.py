from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import re
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import json5


from .pixels import allocate_adaptive_pixel_budget
from .prompts import (
    CODA_ANSWER_FORMAT_ADDENDUM,
    INITIAL_PROMPT,
    QUESTION_GUIDANCE_SKILLS,
    QUESTION_PATTERN_SKILL_HINTS,
    SUMMARY_PROMPT,
    SYSTEM_PROMPT,
    USER_PROMPT,
)
from .timezone import (
    canonical_benchmark,
    coerce_timestamp,
    format_local_timestamp,
    format_video_timestamp,
    uses_local_timezone,
)

VIMRAG_OBSERVATION_MAX_PIXELS = 128 * 32 * 32
VIMRAG_MULTIMODAL_MEMORY_TOTAL_PIXELS = 1024 * 32 * 32
VIMRAG_MULTIMODAL_MEMORY_IMAGE_MAX_PIXELS = 128 * 32 * 32

VIMRAG_MULTIMODAL_MEMORY_PROMPT_NOTE = (
    "Multimodal memory: when the user message includes "
    "### Multimodal Memory Frames, each frame is preceded by its timestamp "
    "and location/position stamp; use them only as evidence for the "
    "corresponding memory observation."
)
VIMRAG_NEXT_ACTION_PROMPT = "Choose the next action"
STRUCTED_ANSWER=True


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


class VimRAGAgent:
    """VimRAG-style agent over target, position, and time memory search."""

    def __init__(
        self,
        llm_client: Any,
        sem: dict[str, Any],
        tools: dict[str, Any],
        max_steps: int = 20,
        debug: bool = False,
        search_top_k: int = 6,
        max_frames_per_result: int = 3,
        max_images_per_search: int = 24,
        visualize_graph: bool = True,
        enable_vimrag_multimodal_memory: bool | None = None,
        preserve_thinking: bool = True,
        enable_adaptive_pixel_budget: bool | None = None,
    ) -> None:
        self.llm_client = llm_client
        self.sem = sem
        self.tools = tools
        self.max_steps = max_steps
        self.debug = debug
        self.history_limit = None
        self.search_limit = None
        self.observation_pixels = VIMRAG_OBSERVATION_MAX_PIXELS
        self.search_top_k = search_top_k
        self.max_frames_per_result = max_frames_per_result
        self.max_images_per_search = max_images_per_search
        self.visualize_graph = visualize_graph
        self.preserve_thinking = preserve_thinking
        self.enable_adaptive_pixel_budget = (
            _env_bool("VIMRAG_ADAPTIVE_PIXEL_BUDGET", False)
            if enable_adaptive_pixel_budget is None else bool(enable_adaptive_pixel_budget)
        )
        self.pixel_budget = int(os.getenv("VIMRAG_PIXEL_BUDGET", VIMRAG_MULTIMODAL_MEMORY_TOTAL_PIXELS))
        self._memory_image_sizes: dict[str, tuple[int, int]] = {}
        if enable_vimrag_multimodal_memory is None:
            enable_vimrag_multimodal_memory = _env_bool(
                "ENABLE_VIMRAG_MULTIMODAL_MEMORY",
                _env_bool("VIMRAG_MULTIMODAL_MEMORY", True),
            )
        self.enable_vimrag_multimodal_memory = bool(enable_vimrag_multimodal_memory)
        self.target_merge_gap_seconds = float(
            os.getenv(
                "VIMRAG_TARGET_MERGE_GAP_SECONDS",
                os.getenv("VIMRAG_TEXT_MERGE_GAP_SECONDS", "8.0"),
            )
        )

    async def call_tool(self, tool_name: str, tool_args: dict[str, Any]) -> Any:
        async with self.sem["tool"]:
            mode_by_tool = {
                "search_by_target": "target",
                "search_by_position": "position",
                "search_by_time": "time",
            }
            if tool_name not in mode_by_tool:
                await asyncio.sleep(1)
                return {"error": f"Tool {tool_name} does not exist."}

            mode = mode_by_tool[tool_name]
            tool = self.tools.get(mode)
            if tool is None:
                return {"error": f"Unsupported search mode: {mode}"}

            common_args = {
                "k": tool_args.get("k", self.search_top_k),
                "query_start_time": self._first_float(
                    tool_args.get("query_start_time_seconds"),
                    tool_args.get("start_time_seconds"),
                    tool_args.get("query_start_time"),
                    tool_args.get("start_time"),
                ),
                "query_end_time": self._first_float(
                    tool_args.get("query_end_time_seconds"),
                    tool_args.get("end_time_seconds"),
                    tool_args.get("query_end_time"),
                    tool_args.get("end_time"),
                ),
                "dataset": canonical_benchmark(tool_args.get("dataset")),
                "video_name": tool_args.get("video_name"),
            }
            if mode == "target":
                query = self._expand_semantic_query(
                    self._sanitize_target_query(tool_args.get("query", ""))
                )
                if not query:
                    return {"error": "Target search requires a non-empty 'query' string."}
                target_k = int(tool_args.get("k", self.search_top_k) or self.search_top_k)
                result = tool(
                    query=query,
                    query_position=self._coerce_position(
                        tool_args.get("query_position", tool_args.get("position"))
                    ),
                    query_time=self._coerce_tool_query_time(
                        tool_args.get("query_time", tool_args.get("time")),
                        common_args,
                    ),
                    sort_by=tool_args.get("sort_by", "semantic"),
                    pool_k=tool_args.get("pool_k"),
                    target="all",
                    **{**common_args, "k": target_k},
                )
            elif mode == "position":
                query_position = self._coerce_position(
                    tool_args.get("query_position", tool_args.get("position"))
                )
                if query_position is None:
                    return {
                        "error": (
                            "Position search requires "
                            "'query_position': [x, y]."
                        )
                    }
                result = tool(query_position=query_position, **common_args)
            else:
                query_time = tool_args.get("query_time", tool_args.get("time"))
                if query_time is None:
                    return {"error": "Time search requires 'query_time'."}
                result = tool(
                    query_time=self._coerce_tool_query_time(query_time, common_args),
                    **common_args,
                )

            if asyncio.iscoroutine(result):
                result = await result
            if isinstance(result, dict) and "entity_results" not in result:
                entity_results = []
                for key in ("caption_results", "video_results"):
                    values = result.get(key)
                    if isinstance(values, list):
                        entity_results.extend(values)
                if entity_results:
                    result = {**result, "entity_results": entity_results}
            return result

    def _parse_response(self, response: str) -> tuple[str | None, dict[str, Any]]:
        if "<tool_call>" not in response or "</tool_call>" not in response:
            return None, {}
        raw = response.split("<tool_call>")[-1].split("</tool_call>")[0].strip()
        parsed = self._parse_tool_call_payload(raw)
        if parsed is None:
            return None, {}
        if isinstance(parsed, list):
            parsed = parsed[0] if parsed else {}
        if not isinstance(parsed, dict):
            return None, {}
        args = parsed.get("arguments", parsed.get("args", {}) or {})
        return parsed.get("name"), args if isinstance(args, dict) else {}

    def _parse_tool_call_payload(self, raw: str) -> Any | None:
        repaired = re.sub(r'"evidence\s*=', '"evidence": "', raw)
        candidates = [raw]
        if repaired != raw:
            candidates.append(repaired)
        stripped = raw.rstrip()
        # Qwen occasionally appends one extra "}" after a long JSON tool call.
        # Try progressively trimming only trailing braces before giving up.
        while stripped.endswith("}") and len(candidates) < 4:
            stripped = stripped[:-1].rstrip()
            candidates.append(stripped)
            repaired = re.sub(r'"evidence\s*=', '"evidence": "', stripped)
            if repaired != stripped:
                candidates.append(repaired)
        for candidate in candidates:
            try:
                return json5.loads(candidate)
            except Exception:
                continue
        return None

    def _coerce_position(self, value: Any) -> list[float] | None:
        if isinstance(value, str):
            try:
                value = json5.loads(value)
            except Exception:
                return None
        if not isinstance(value, (list, tuple)) or len(value) not in {2, 3}:
            return None
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return None

    def _coerce_float(self, value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _sanitize_target_query(self, query: Any) -> str:
        text = str(query or "").strip()
        text = re.sub(r"\[[^\[\]]+\]", " ", text)
        text = re.sub(
            r"\b(?:near|nearest|closest|nearby|around|at|current|position|location|here|there|from|to|me|my)\b",
            " ",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(r"[-+]?\d+(?:\.\d+)?", " ", text)
        text = re.sub(r"[^\w\s/-]+", " ", text, flags=re.UNICODE)
        return re.sub(r"\s+", " ", text).strip()

    def _expand_semantic_query(self, query: str) -> str:
        text = re.sub(r"\s+", " ", str(query or "").strip())
        if not text:
            return text
        lower = text.lower()
        if re.search(r"\b(place\s+sit|place\s+to\s+sit|somewhere\s+to\s+sit)\b", lower):
            return "chair seating place sit"
        if (
            re.search(r"\b(food|eat|snack)\b", lower)
            and not re.search(r"\b(food\s+truck|restaurant|cafe|dining|coffee)\b", lower)
        ):
            return "restaurant food"
        additions: list[str] = []
        if re.search(r"\b(place\s+sit|sit|seat|seating|bench|chair|sofa)\b", lower):
            additions.extend(["bench", "chair", "seat", "seating", "sofa"])
        if re.search(r"\b(food|eat|dining|restaurant|cafe|coffee|snack)\b", lower):
            additions.extend(["food truck", "restaurant", "cafe", "dining"])
        if re.search(r"\bpolice\b", lower) and re.search(r"\b(pole|call|phone|help|emergency)\b", lower):
            additions.extend(["police call pole", "emergency phone", "yellow police pole"])
        if re.search(r"\b(18\s*wheeler|eighteen\s*wheeler)\b", lower):
            additions.extend(["semi truck", "tractor trailer"])
        if re.search(r"\baed\b|\bdefibrillator\b", lower):
            additions.extend(
                [
                    "automated external defibrillator",
                    "defibrillator",
                    "first aid emergency sign",
                    "red white AED sign",
                ]
            )
        if re.search(r"\blime\b|\bscooter\b", lower):
            additions.extend(["green electric scooter", "Lime scooter", "rental scooter"])
        if re.search(r"\bfood\s+truck\b", lower):
            additions.extend(["food truck signage", "food truck menu", "vendor brand"])
        if re.search(r"\bbank\b", lower):
            additions.extend(["bank sign", "financial center", "ATM"])
        existing = set(lower.split())
        output = [text]
        for addition in additions:
            if not all(part in existing for part in addition.lower().split()):
                output.append(addition)
        return re.sub(r"\s+", " ", " ".join(output)).strip()

    def _first_float(self, *values: Any) -> float | None:
        for value in values:
            coerced = self._coerce_float(value)
            if coerced is not None:
                return coerced
        return None

    def _coerce_tool_query_time(
        self,
        value: Any,
        common_args: dict[str, Any],
    ) -> Any:
        """Accept model-friendly HH:MM:SS while keeping backend numeric compatibility."""
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text:
            return value
        benchmark = common_args.get("dataset")
        reference_time = common_args.get("query_start_time") or common_args.get("query_end_time")
        coerced = coerce_timestamp(text, benchmark=benchmark, reference_time=reference_time)
        return coerced if coerced is not None else value

    def _extract_current_position_from_question(self, question: Any) -> list[float] | None:
        text = str(question or "")
        matches = list(re.finditer(r"located at\s*(\[[^\[\]]+\])", text, flags=re.IGNORECASE))
        if not matches:
            matches = list(re.finditer(r"current (?:[23]D )?position\s*(?:is|at)?\s*(\[[^\[\]]+\])", text, flags=re.IGNORECASE))
        if not matches:
            return None
        return self._coerce_position(matches[-1].group(1))

    def _question_requests_nearest(self, question: Any) -> bool:
        text = str(question or "").lower()
        return bool(
            re.search(
                r"\b(closest|nearest|nearby|near me|around me|where i am)\b",
                text,
            )
            or re.search(
                r"\b(?:near|around|at)\s+(?:the\s+)?current\s+(?:position|location|place|pose)\b",
                text,
            )
            or re.search(
                r"\bcurrent\s+(?:position|location|place|pose|vicinity)\b",
                text,
            )
        )

    def _distance_between(
        self,
        left: list[float] | None,
        right: list[float] | None,
    ) -> float | None:
        if left is None or right is None or len(left) < 2 or len(right) < 2:
            return None
        return sum((float(a) - float(b)) ** 2 for a, b in zip(left[:2], right[:2])) ** 0.5

    def _candidate_entities_for_node(self, node: dict[str, Any]) -> list[dict[str, Any]]:
        candidates = node.get("_candidate_entities")
        if not isinstance(candidates, list):
            candidates = node.get("candidate_entities")
        return [item for item in candidates if isinstance(item, dict)] if isinstance(candidates, list) else []

    def _best_semantic_position_candidate(
        self,
        graph: list[dict[str, Any]],
    ) -> list[float] | None:
        ranked = self._ranked_semantic_position_candidates(graph)
        return ranked[0][3] if ranked else None

    def _ranked_semantic_position_candidates(
        self,
        graph: list[dict[str, Any]],
    ) -> list[tuple[float, float, float, list[float]]]:
        ranked: list[tuple[float, float, float, list[float]]] = []
        for node_index, node in enumerate(graph):
            mode = node.get("search_mode")
            if mode != "target":
                continue
            for entity_index, entity in enumerate(self._candidate_entities_for_node(node)):
                if not isinstance(entity, dict):
                    continue
                observations = entity.get("observations")
                if not isinstance(observations, list) or not observations:
                    observations = [entity]
                for observation_index, observation in enumerate(observations):
                    if not isinstance(observation, dict):
                        continue
                    position = self._coerce_position(observation.get("position"))
                    if position is None:
                        position = self._coerce_position(entity.get("position"))
                    if position is None:
                        continue
                    rank = self._first_float(
                        observation.get("semantic_rank"),
                        entity.get("best_semantic_rank"),
                        observation.get("target_rank"),
                        entity.get("best_target_rank"),
                    )
                    if rank is None:
                        rank = float(entity_index + 1)
                    time_start = self._first_float(
                        observation.get("time_start"),
                        entity.get("time_start"),
                    )
                    ranked.append(
                        (
                            float(rank),
                            float(node_index),
                            float(time_start if time_start is not None else observation_index),
                            position,
                        )
                    )
        ranked.sort(key=lambda item: item[:3])
        return ranked

    def _matched_semantic_rank_for_position(
        self,
        graph: list[dict[str, Any]],
        position: list[float] | None,
    ) -> float | None:
        if position is None:
            return None
        best_rank: float | None = None
        for rank, _, _, candidate_position in self._ranked_semantic_position_candidates(graph):
            distance = self._distance_between(position, candidate_position)
            if distance is None or distance > 2.0:
                continue
            if best_rank is None or rank < best_rank:
                best_rank = rank
        return best_rank

    def _best_nearest_semantic_candidate(
        self,
        graph: list[dict[str, Any]],
        question: Any,
        *,
        max_rank: float = 20.0,
    ) -> list[float] | None:
        current_position = self._extract_current_position_from_question(question)
        if current_position is None:
            return None
        choices: list[tuple[float, float, float, list[float]]] = []
        for node_index, node in enumerate(graph):
            mode = node.get("search_mode")
            if mode != "target":
                continue
            for entity_index, entity in enumerate(self._candidate_entities_for_node(node)):
                observations = entity.get("observations")
                if not isinstance(observations, list) or not observations:
                    observations = [entity]
                for observation_index, observation in enumerate(observations):
                    if not isinstance(observation, dict):
                        continue
                    position = self._coerce_position(observation.get("position"))
                    if position is None:
                        position = self._coerce_position(entity.get("position"))
                    if position is None:
                        continue
                    rank = self._first_float(
                        observation.get("semantic_rank"),
                        entity.get("best_semantic_rank"),
                        observation.get("target_rank"),
                        entity.get("best_target_rank"),
                    )
                    if rank is None or rank > max_rank:
                        continue
                    context_rank = self._first_float(
                        observation.get("target_rank"),
                        entity.get("best_target_rank"),
                    )
                    distance = self._distance_between(position, current_position)
                    if distance is None:
                        continue
                    # Very near current-position matches with only marginal
                    # semantic rank are often trajectory/context neighbors,
                    # not the actual generic target such as seating.
                    if (
                        distance < 10.0
                        and rank > 10.0
                        and context_rank is not None
                        and context_rank <= 10.0
                    ):
                        continue
                    choices.append((distance, float(rank), float(node_index + entity_index + observation_index / 1000), position))
        if not choices:
            return None
        dense_choices = []
        for choice in choices:
            neighbors = 0
            for other in choices:
                if choice is other:
                    continue
                distance = self._distance_between(choice[3], other[3])
                if distance is not None and distance <= 15.0:
                    neighbors += 1
            if neighbors >= 2:
                dense_choices.append(choice)
        if dense_choices:
            dense_choices.sort(key=lambda item: item[:3])
            nearest_cluster_seed = dense_choices[0]
            cluster = [
                choice
                for choice in choices
                if (
                    self._distance_between(choice[3], nearest_cluster_seed[3])
                    is not None
                    and self._distance_between(choice[3], nearest_cluster_seed[3]) <= 15.0
                )
            ]
            if cluster:
                cluster.sort(key=lambda item: (item[1], item[0], item[2]))
                return cluster[0][3]
            choices = dense_choices
        choices.sort(key=lambda item: item[:3])
        return choices[0][3]

    def _guard_non_nearest_position_answer(
        self,
        answer: dict[str, Any],
        graph: list[dict[str, Any]],
        question: Any,
    ) -> dict[str, Any]:
        if answer.get("type") != "position":
            return answer
        predicted = self._coerce_position(answer.get("position"))
        if self._question_requests_nearest(question):
            nearest_semantic = self._best_nearest_semantic_candidate(graph, question)
            if nearest_semantic is not None:
                distance = self._distance_between(predicted, nearest_semantic)
                current_position = self._extract_current_position_from_question(question)
                predicted_to_current = self._distance_between(predicted, current_position)
                nearest_to_current = self._distance_between(nearest_semantic, current_position)
                nearest_is_better = (
                    predicted_to_current is not None
                    and nearest_to_current is not None
                    and nearest_to_current + 2.0 < predicted_to_current
                )
                if predicted is None or distance is None or distance > 10.0 or nearest_is_better:
                    guarded = dict(answer)
                    guarded["position"] = nearest_semantic
                    guarded["text"] = (
                        "The target location is "
                        f"{json.dumps(self._round_position(nearest_semantic), ensure_ascii=False)}."
                    )
                    return guarded
            semantic_candidates = self._ranked_semantic_position_candidates(graph)
            if not semantic_candidates:
                return answer
            best_rank, _, _, best_position = semantic_candidates[0]
            matched_rank = self._matched_semantic_rank_for_position(graph, predicted)
            current_position = self._extract_current_position_from_question(question)
            predicted_to_current = self._distance_between(predicted, current_position)
            predicted_to_best = self._distance_between(predicted, best_position)
            weak_predicted_match = matched_rank is None or matched_rank > 20
            suspicious_current_neighbor = (
                predicted_to_current is not None
                and predicted_to_current < 5.0
                and predicted_to_best is not None
                and predicted_to_best > 10.0
            )
            if best_rank <= 20 and weak_predicted_match and suspicious_current_neighbor:
                guarded = dict(answer)
                guarded["position"] = best_position
                guarded["text"] = (
                    "The target location is "
                    f"{json.dumps(self._round_position(best_position), ensure_ascii=False)}."
                )
                return guarded
            return answer
        semantic_position = self._best_semantic_position_candidate(graph)
        if semantic_position is None:
            return answer
        matched_rank = self._matched_semantic_rank_for_position(graph, predicted)
        if predicted is not None and matched_rank is not None and matched_rank <= 20:
            return answer
        distance = self._distance_between(predicted, semantic_position)
        if predicted is None or distance is None or distance > 10.0:
            guarded = dict(answer)
            guarded["position"] = semantic_position
            guarded["text"] = (
                "The target location is "
                f"{json.dumps(self._round_position(semantic_position), ensure_ascii=False)}."
            )
            return guarded
        return answer

    def _parse_question_datetime(self, question: Any, label_pattern: str) -> datetime | None:
        match = re.search(
            rf"{label_pattern}\s+(\d{{4}}-\d{{2}}-\d{{2}})\s+"
            r"(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)",
            str(question or ""),
            flags=re.IGNORECASE,
        )
        if not match:
            return None
        value = f"{match.group(1)} {match.group(2)}"
        for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        return None

    def _infer_temporal_answer_type(self, expected_type: Any, question: Any) -> str | None:
        normalized = self._normalize_answer_type(expected_type)
        if normalized in {"time", "duration"}:
            return normalized
        text = str(question or "").lower()
        if re.search(
            r"\b(how long|duration|for how many|how many\s+"
            r"(?:minutes?|mins?|seconds?|secs?|hours?))\b",
            text,
        ):
            return "duration"
        if re.search(
            r"\b(when did|when was|what time|at what time|"
            r"how many\s+(?:minutes?|mins?|seconds?|secs?)\s+ago)\b",
            text,
        ):
            return "time"
        return None

    def _clock_minutes_from_text(self, text: Any) -> float | None:
        if not isinstance(text, str):
            return None
        clock_match = re.search(
            r"\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d(?:\.\d+)?))?\b",
            text,
        )
        if clock_match:
            hours = int(clock_match.group(1))
            minutes = int(clock_match.group(2))
            seconds = float(clock_match.group(3) or 0.0)
            return hours * 60.0 + minutes + seconds / 60.0
        if re.search(r"\b(?:hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec)\b", text, re.IGNORECASE):
            return None
        decimal_match = re.fullmatch(r"\s*([01]?\d|2[0-3])\.(\d{3,})\s*", text)
        if not decimal_match:
            return None
        return float(decimal_match.group(0)) * 60.0

    def _mentions_temporal_unit(self, value: Any) -> bool:
        if value is None:
            return False
        if isinstance(value, (dict, list, tuple)):
            text = json.dumps(value, ensure_ascii=False, default=str)
        else:
            text = str(value)
        return bool(
            re.search(
                r"\b(?:ago|hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec)\b",
                text,
                re.IGNORECASE,
            )
        )

    def _clock_minutes_from_value(self, value: Any) -> float | None:
        if isinstance(value, dict):
            for key in ("answer", "text", "response"):
                if key in value:
                    minutes = self._clock_minutes_from_value(value.get(key))
                    if minutes is not None:
                        return minutes
            if any(self._mentions_temporal_unit(value.get(key)) for key in ("answer", "text", "response")):
                return None
            for key in ("time", "timestamp"):
                if key in value:
                    minutes = self._clock_minutes_from_value(value.get(key))
                    if minutes is not None:
                        return minutes
            return None
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return self._clock_minutes_from_text(format(float(value), ".12g"))
        return self._clock_minutes_from_text(value)

    def _minutes_ago_from_clock(
        self,
        current: datetime,
        event_clock_minutes: float,
    ) -> float | None:
        current_minutes = (
            current.hour * 60.0
            + current.minute
            + current.second / 60.0
            + current.microsecond / 60_000_000.0
        )
        minutes = current_minutes - event_clock_minutes
        if minutes < 0:
            minutes += 24 * 60.0
        if minutes < 0 or minutes > 24 * 60:
            return None
        return round(minutes, 2)

    def _format_minutes(self, value: float) -> str:
        return f"{value:g}"

    def _guard_time_answer(
        self,
        answer: dict[str, Any],
        question: Any,
        expected_type: Any = None,
        raw_answer: Any = None,
        guard_notes: list[str] | None = None,
    ) -> dict[str, Any]:
        def note(message: str) -> None:
            if guard_notes is not None:
                guard_notes.append(message)

        temporal_type = self._infer_temporal_answer_type(expected_type, question)
        if temporal_type is None and answer.get("type") not in {"time", "duration"}:
            return answer

        guarded = dict(answer)
        if temporal_type is not None and guarded.get("type") != temporal_type:
            guarded["type"] = temporal_type
            note(f"forced_answer_type_to_{temporal_type}")

        answer_type = guarded.get("type")
        text = str(guarded.get("text") or "")
        if answer_type == "duration":
            duration = self._extract_float(guarded.get("duration"))
            if duration is None:
                duration = self._extract_float(text)
            if duration is None and guarded.get("time") is not None:
                duration = self._extract_float(guarded.get("time"))
                if duration is not None:
                    note("moved_time_field_to_duration")
            guarded["time"] = None
            guarded["duration"] = duration
            if duration is not None:
                guarded["text"] = f"{self._format_minutes(duration)} minutes"

            current = self._parse_question_datetime(question, r"current time is")
            started = self._parse_question_datetime(question, r"started moving at")
            if current is not None and started is not None and duration is not None:
                elapsed = (current - started).total_seconds() / 60.0
                if elapsed >= 0 and abs(duration - elapsed) <= 0.25:
                    note("duration_matches_total_question_elapsed_time")
            return guarded

        if answer_type != "time":
            return guarded

        current = self._parse_question_datetime(question, r"current time is")
        clock_minutes = self._clock_minutes_from_value(raw_answer)
        raw_has_temporal_unit = self._mentions_temporal_unit(raw_answer)
        if clock_minutes is None and not raw_has_temporal_unit:
            clock_minutes = self._clock_minutes_from_text(text)
        if clock_minutes is None and not raw_has_temporal_unit:
            clock_minutes = self._clock_minutes_from_value(guarded.get("time"))
        if current is not None and clock_minutes is not None:
            minutes_ago = self._minutes_ago_from_clock(current, clock_minutes)
            if minutes_ago is not None:
                guarded["time"] = minutes_ago
                guarded["duration"] = None
                guarded["text"] = f"{self._format_minutes(minutes_ago)} minutes ago"
                note("converted_absolute_clock_to_minutes_ago")
                return guarded

        time_value = self._extract_float(guarded.get("time"))
        if time_value is None and guarded.get("duration") is not None:
            time_value = self._extract_float(guarded.get("duration"))
            if time_value is not None:
                note("moved_duration_field_to_time")
        guarded["time"] = time_value
        guarded["duration"] = None
        if time_value is not None and not re.search(r"\bago\b", text, re.IGNORECASE):
            guarded["text"] = f"{self._format_minutes(time_value)} minutes ago"
        return guarded

    def _coerce_sample_timestamp(
        self,
        value: Any,
        benchmark: object = None,
        reference_time: Any = None,
    ) -> float | None:
        return coerce_timestamp(value, benchmark=benchmark, reference_time=reference_time)

    def _sample_time_bounds(self, sample: dict[str, Any]) -> tuple[float | None, float | None]:
        benchmark = canonical_benchmark(
            sample.get("dataset") or sample.get("benchmark") or sample.get("_benchmark")
        )
        start_time = self._coerce_sample_timestamp(
            sample.get("start_time_seconds"),
            benchmark,
        )
        end_time = self._coerce_sample_timestamp(
            sample.get("end_time_seconds"),
            benchmark,
            reference_time=start_time,
        )

        time_reference_seconds = sample.get("time_reference_seconds")
        if isinstance(time_reference_seconds, (list, tuple)) and len(time_reference_seconds) >= 2:
            if start_time is None:
                start_time = self._coerce_sample_timestamp(time_reference_seconds[0], benchmark)
            if end_time is None:
                end_time = self._coerce_sample_timestamp(
                    time_reference_seconds[1],
                    benchmark,
                    reference_time=start_time,
                )

        if start_time is None:
            start_time = self._coerce_sample_timestamp(sample.get("start_time"), benchmark)
        if end_time is None:
            end_time = self._coerce_sample_timestamp(
                sample.get("end_time"),
                benchmark,
                reference_time=start_time,
            )
        return start_time, end_time


    async def _request_message(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        async with self.sem["llm"]:
            message = await self.llm_client.request(
                messages=self._prepare_messages_for_llm(messages),
                return_type="message",
            )
        return message if isinstance(message, dict) else {"content": str(message or "")}


    def _assistant_history_message(
        self,
        assistant_message: dict[str, Any],
        content: str | None = None,
    ) -> dict[str, Any]:
        if content is None:
            content = str(assistant_message.get("content") or "")
        message = {"role": "assistant"}
        reasoning_content = assistant_message.get("reasoning_content")
        if self.preserve_thinking and reasoning_content:
            message["reasoning_content"] = str(reasoning_content)
        message["content"] = content
        return message

    def _sanitize_for_trajectory(self, value: Any) -> Any:
        """Return a JSON-safe copy for trajectory logs without embedded image bytes.

        VimRAG sends images to the LLM by converting local ``image_path`` parts to
        base64 data URLs at request time. Training trajectories should keep only
        paths, so this sanitizer intentionally strips bytes/data URLs while
        preserving text, parsed tool calls, tool outputs, graph nodes, and local
        image paths.
        """
        if value is None or isinstance(value, (bool, int, float, str)):
            if isinstance(value, str) and value.startswith("data:image"):
                return "[embedded image data omitted]"
            return value
        if isinstance(value, bytes):
            return f"[{len(value)} image/data bytes omitted]"
        if isinstance(value, (list, tuple)):
            return [self._sanitize_for_trajectory(item) for item in value]
        if isinstance(value, dict):
            if value.get("type") == "image_url":
                image_url = value.get("image_url")
                url = image_url.get("url") if isinstance(image_url, dict) else image_url
                if isinstance(url, str) and url.startswith("data:image"):
                    return {"type": "image_url", "image_url": "[embedded image data omitted]"}
            sanitized = {}
            for key, item in value.items():
                lowered = str(key).lower()
                if lowered in {"image_bytes", "image_data", "rgb", "pixels"}:
                    sanitized[key] = "[image data omitted]"
                else:
                    sanitized[key] = self._sanitize_for_trajectory(item)
            return sanitized
        try:
            json.dumps(value)
            return value
        except TypeError:
            return repr(value)

    def _public_graph_node(self, node: dict[str, Any]) -> dict[str, Any]:
        hidden_keys = {"candidate_entities", "useful_result_ids", "_candidate_entities"}
        public: dict[str, Any] = {}
        for key, value in node.items():
            key_text = str(key)
            if key_text.startswith("_") or key_text in hidden_keys:
                continue
            if key_text == "entities" and "observations" in node:
                continue
            public[key_text] = self._sanitize_for_trajectory(value)
        return public

    def _graph_for_model(self, graph: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [self._public_graph_node(node) for node in graph]

    def _compact_json_for_prompt(self, value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


    def _trajectory_context_section(self, trajectory_context: str | None) -> str:
        if not trajectory_context:
            return ""
        return (
            "### Trajectory Context\n"
            "Computed from dense XY trajectory over the question time window. "
            "This is motion context only, not object evidence.\n"
            f"{trajectory_context.strip()}\n\n"
        )

    def _question_focus_text(self, question: Any) -> str:
        raw_text = str(question or "")
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        return (lines[-1] if lines else raw_text).lower()

    def _extract_user_question(self, question: Any) -> str:
        raw_text = str(question or "")
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        return lines[-1] if lines else raw_text.strip()

    def _append_skill(self, skills: list[str], skill: str, max_skills: int = 6) -> None:
        if (
            skill in QUESTION_GUIDANCE_SKILLS
            and skill not in skills
            and len(skills) < max_skills
        ):
            skills.append(skill)


    def _infer_question_skills(self, question: Any, answer_type: str | None = None) -> list[str]:
        text = self._question_focus_text(question)
        skills: list[str] = []

        def add(skill: str) -> None:
            self._append_skill(skills, skill)

        normalized_answer_type = self._normalize_answer_type(answer_type)
        binary_question = bool(
            re.search(
                r"^\s*(did|do|does|is|are|was|were|could|can i|whether)\b|\byes or no\b",
                text,
            )
        ) and not re.search(r"\b(can you take me|take me to|where)\b", text)
        affordance_question = bool(
            re.search(
                r"\b(can i|safe|allowed|permit|permitted|walk outside|loading zone|no parking|blocked)\b",
                text,
            )
        )
        current_relation_question = bool(
            re.search(r"\b(now|right now|currently|current)\b", text)
            and re.search(r"\b(near|nearby|in|inside|outside|at|around)\b", text)
        )
        visual_attribute_question = bool(
            re.search(
                r"\b(color|colour|material|wearing|carrying|holding|hand)\b",
                text,
            )
        )
        visual_scene_question = bool(
            re.search(
                r"\b(weather|sky|cloud|rain|wet|crowd|crowded|busy|traffic|line|queue|occupancy|available|empty|full|people|vehicles?)\b",
                text,
            )
        )
        text_reading_question = bool(
            re.search(
                r"\b(what does|what is written|what did .* say|written|says?|label|storefront|menu|brand|ocr|name of|sell)\b",
                text,
            )
        )
        count_question = bool(re.search(r"\b(how many|count|in total|number of)\b", text))
        route_motion_question = bool(
            re.search(
                r"\b(turn|turned|turning|route|wait|waiting|stopped|moving|drive|driving|get to|get off|walk by|walk(?:ed|ing)? along|drive along|pass(?:ed)?|pass through|passed through|cross(?:ed)?|enter(?:ed)?|leave|left the|exit(?:ed)?|reach(?:ed)?)\b",
                text,
            )
            or re.search(r"\b(which|what)\s+side\b|\bside of\b|\b(left|right)\s+side\b", text)
        )

        if normalized_answer_type == "duration":
            add("target_retrieval")
            add("temporal_boundary")
            add("interval_duration")
        elif normalized_answer_type == "time":
            add("target_retrieval")
            add("temporal_boundary")
        elif normalized_answer_type == "binary":
            add("binary_decision")
        elif normalized_answer_type == "text":
            pass
        elif normalized_answer_type == "position":
            add("target_retrieval")
            add("spatial_context")

        if (
            route_motion_question
            and not affordance_question
            and normalized_answer_type in {"time", "duration"}
        ):
            add("route_motion")
        if re.search(r"\b(how long|duration|for how many)\b", text):
            add("temporal_boundary")
            add("interval_duration")
        if re.search(
            r"\b(when did|when was|what time|at what time|first|last|latest|earliest)\b",
            text,
        ):
            add("target_retrieval")
            add("temporal_boundary")
        if self._question_requests_nearest(text):
            add("spatial_context")
            add("target_retrieval")
            if re.search(r"\b(available|empty|not\s+empty|occupied|place\s+to\s+sit|sit|seating|busy|trash\s+can|bike\s+rack)\b", text):
                add("visual_grounding")
        if current_relation_question:
            add("spatial_context")
            add("target_retrieval")
            add("visual_grounding")
        if text_reading_question:
            add("text_reading")
            add("target_retrieval")
        if visual_attribute_question:
            add("visual_grounding")
            add("target_retrieval")
        if visual_scene_question:
            add("visual_grounding")
        if route_motion_question and not affordance_question:
            add("route_motion")
        if binary_question:
            add("binary_decision")
            if re.search(r"\b(see|saw|seen|pass|passed|stop|stopped|near|in|at|through|any)\b", text):
                add("target_retrieval")
            if re.search(r"\b(did\s+you\s+stop|stopped|waiting|loading\s+zone|intersection)\b", text):
                add("temporal_boundary")
                add("route_motion")
            add("answer_canonicalization")
        if affordance_question:
            add("affordance_constraints")
            add("binary_decision")
            add("visual_grounding")
            if re.search(r"\b(sign|written|says?|label|no parking|loading zone)\b", text):
                add("text_reading")
        if count_question:
            add("counting_dedup")
            add("target_retrieval")
            if re.search(r"\b(turn|turned|route|before|after|pass|passed|enter|leave|exit|open(?:ed)?|doors?|letting\s+you\s+out)\b", text):
                add("temporal_boundary")
            if re.search(r"\b(turn|turned|route|walking|pass|passed|enter|leave|exit|open(?:ed)?|doors?|letting\s+you\s+out)\b", text):
                add("route_motion")
            add("answer_canonicalization")
        if re.search(r"\b(which|option|choice|better|more|less|compare|between)\b", text):
            add("option_comparison")
        if route_motion_question and normalized_answer_type == "text":
            if re.search(r"\b(after|before|leave|left\s+the|exit|enter|cross)\b", text):
                add("temporal_boundary")
            add("visual_grounding")
            add("answer_canonicalization")
        if not skills:
            add("target_retrieval")
        return skills[:6]

    def _normalize_question_skill(self, value: Any, question: Any = None) -> str:
        text = str(value or "").strip().lower()
        text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
        aliases = {
            "direct": "target_retrieval",
            "direct_lookup": "target_retrieval",
            "direct_target_lookup": "target_retrieval",
            "target_lookup": "target_retrieval",
            "canonical": "answer_canonicalization",
            "canonical_answer": "answer_canonicalization",
            "canonicalization": "answer_canonicalization",
            "short_answer": "answer_canonicalization",
            "text_answer": "answer_canonicalization",
            "nearest": "spatial_context",
            "nearest_spatial": "spatial_context",
            "spatial": "spatial_context",
            "temporal": "temporal_boundary",
            "time": "temporal_boundary",
            "temporal_event": "temporal_boundary",
            "duration": "interval_duration",
            "duration_event": "interval_duration",
            "binary": "binary_decision",
            "yes_no": "binary_decision",
            "binary_state": "binary_decision",
            "visual": "visual_grounding",
            "attribute": "visual_grounding",
            "visual_attribute": "visual_grounding",
            "ocr": "text_reading",
            "signage": "text_reading",
            "sign": "text_reading",
            "text_sign": "text_reading",
            "count": "counting_dedup",
            "counting": "counting_dedup",
            "route": "route_motion",
            "ego": "route_motion",
            "affordance": "affordance_constraints",
            "comparison": "option_comparison",
            "option": "option_comparison",
        }
        text = aliases.get(text, text)
        if text in QUESTION_GUIDANCE_SKILLS:
            return text
        return ""

    def _normalize_question_skills(
        self,
        value: Any,
        question: Any = None,
        answer_type: str | None = None,
        fallback_skills: list[str] | None = None,
    ) -> list[str]:
        parsed = self._parse_structured_value(value)
        if isinstance(parsed, dict):
            parsed = (
                parsed.get("question_skills")
                or parsed.get("skills")
                or parsed.get("question_skill")
                or parsed.get("skill")
            )
        if isinstance(parsed, str):
            parsed_text = parsed.strip()
            if not parsed_text:
                parsed = []
            elif "," in parsed_text:
                parsed = [part.strip() for part in parsed_text.split(",")]
            else:
                parsed = [parsed_text]
        elif not isinstance(parsed, (list, tuple, set)):
            parsed = [parsed] if parsed is not None else []

        skills: list[str] = []
        for item in parsed:
            skill = self._normalize_question_skill(item, question)
            if skill and skill not in skills:
                skills.append(skill)
        if not skills:
            skills = list(fallback_skills or [])
        if not skills:
            skills = self._infer_question_skills(question, answer_type=answer_type)
        return skills[:6]

    def _question_skill_guidance(self, question_skills: Any) -> str:
        skills = self._normalize_question_skills(question_skills)
        blocks: list[str] = []
        for skill in skills:
            meta = QUESTION_GUIDANCE_SKILLS.get(skill, {})
            guidance = str(meta.get("guidance") or "").strip()
            if guidance:
                blocks.append(guidance)
        return "\n\n".join(blocks)

    def _build_system_prompt(
        self,
        question_skills: Any,
        include_multimodal_memory: bool = False,
    ) -> str:
        return SYSTEM_PROMPT.replace(
            "{question_skill_guidance}",
            self._question_skill_guidance(question_skills),
        )

    async def _initialize_root(
        self,
        question: str,
        answer_type: str | None = None,
        trajectory_context: str | None = None,
    ) -> tuple[dict[str, Any], str, list[str]]:
        user_content = question
        trajectory_section = self._trajectory_context_section(trajectory_context)
        if trajectory_section:
            user_content = trajectory_section
            user_content += f"### Question\n{question}"
        messages = [
            {"role": "system", "content": INITIAL_PROMPT},
            {"role": "user", "content": user_content},
        ]
        assistant_message = await self._request_message(messages)
        response = str(assistant_message.get("content") or "")
        name, args = self._parse_response(response)
        question_skills = self._infer_question_skills(question, answer_type=answer_type)
        if name != "initialize_root":
            content = f"Initial user question: {question}"
            root_node = {
                "id": "root",
                "original_query": question,
                "content": content,
            }
            refined = content
        else:
            content = str(
                args.get("content")
                or args.get("root_summary")
                or args.get("refined_query")
                or question
            )
            question_skills = self._normalize_question_skills(
                args.get(
                    "question_skills",
                    args.get("skills", args.get("question_skill", args.get("skill"))),
                ),
                question,
                answer_type=answer_type,
            )
            root_node = {
                "id": "root",
                "original_query": question,
                "content": content,
            }
            refined = content

        if len(question_skills) < 2:
            for skill in [*self._infer_question_skills(question, answer_type), "target_retrieval", "visual_grounding"]:
                self._append_skill(question_skills, skill)
                if len(question_skills) >= 2:
                    break
        return root_node, refined, question_skills

    def _build_user_prompt(
        self,
        question: str,
        graph: list[dict[str, Any]],
        answer_type: str | None = None,
        trajectory_context: str | None = None,
    ) -> str:
        prompt = USER_PROMPT.format(
            trajectory_context_section=self._trajectory_context_section(trajectory_context),
            query=question,
            graph=self._compact_json_for_prompt(self._graph_for_model(graph)),
        )
        return prompt

    def _build_trajectory_context(self, sample: dict[str, Any], enabled: bool) -> str:
        if not enabled:
            return ""
        for key in ("trajectory_history_context", "trajectory_context"):
            value = sample.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        from .trajectory import load_query_trajectory_pattern

        start, end = self._sample_time_bounds(sample)
        return load_query_trajectory_pattern(
            sample, start_time=start, end_time=end, points=sample.get("_track"),
            max_segments=20, rdp_epsilon_m=2.0,
        )

    def _expected_answer_type(self, sample: dict[str, Any]) -> str | None:
        value = sample.get("type")
        if isinstance(value, str) and value:
            return self._normalize_answer_type(value)

        question_type = sample.get("question_type")
        if isinstance(question_type, list) and question_type:
            value = question_type[0]
            if value is not None:
                return self._normalize_answer_type(str(value))
        if isinstance(question_type, str) and question_type:
            return self._normalize_answer_type(question_type)

        answers = sample.get("answers") or {}
        if isinstance(answers, dict):
            for key in ("position", "binary", "time", "duration", "text"):
                if key in answers:
                    return key
        return None

    def _normalize_answer_type(self, value: Any, fallback: str | None = None) -> str | None:
        text = str(value or "").strip().lower()
        aliases = {
            "general": "text",
            "description": "text",
            "descriptive": "text",
            "when": "time",
            "temporal": "time",
            "how long": "duration",
            "yes/no": "binary",
            "bool": "binary",
            "boolean": "binary",
            "location": "position",
            "pose": "position",
            "spatial": "position",
        }
        text = aliases.get(text, text)
        if text in {"position", "binary", "time", "duration", "text"}:
            return text
        return fallback

    def _empty_coda_answer(self, answer_type: str | None) -> dict[str, Any]:
        return {
            "type": answer_type or "text",
            "text": "",
            "binary": None,
            "position": None,
            "time": None,
            "duration": None,
        }

    def _parse_structured_value(self, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if not stripped:
            return value
        try:
            return json5.loads(stripped)
        except Exception:
            return value

    def _extract_float(self, value: Any) -> float | None:
        parsed = self._parse_structured_value(value)
        if isinstance(parsed, (int, float)):
            return float(parsed)
        if isinstance(parsed, str):
            half_hour_match = re.search(
                r"\bhalf\s+(?:an?\s+)?hours?\b",
                parsed,
                re.IGNORECASE,
            )
            if half_hour_match:
                return 30.0
            hour_match = re.search(
                r"-?\d+(?:\.\d+)?(?=\s*(?:hours?|hrs?|hr)\b)",
                parsed,
                re.IGNORECASE,
            )
            if hour_match:
                return float(hour_match.group(0)) * 60.0
            minute_match = re.search(
                r"-?\d+(?:\.\d+)?(?=\s*(?:minutes?|mins?|min)\b)",
                parsed,
                re.IGNORECASE,
            )
            if minute_match:
                return float(minute_match.group(0))
            second_match = re.search(
                r"-?\d+(?:\.\d+)?(?=\s*(?:seconds?|secs?|sec)\b)",
                parsed,
                re.IGNORECASE,
            )
            if second_match:
                return float(second_match.group(0)) / 60.0
            match = re.search(r"-?\d+(?:\.\d+)?", parsed)
            if match:
                return float(match.group(0))
        return None

    def _coerce_vector(self, value: Any) -> list[float] | None:
        parsed = self._parse_structured_value(value)
        if not isinstance(parsed, (list, tuple)) or not parsed:
            return None
        try:
            return [float(item) for item in parsed]
        except (TypeError, ValueError):
            return None

    def _extract_position_from_text(self, text: Any) -> list[float] | None:
        if not isinstance(text, str):
            return None
        for match in re.finditer(r"\[[^\[\]]+\]", text):
            vector = self._coerce_vector(match.group(0))
            if vector is not None and len(vector) in {2, 3}:
                return vector
        return None

    def _coerce_binary_answer(self, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip().lower()
        if not text:
            return None
        normalized = re.sub(r"[^a-z0-9\s]+", " ", text)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if normalized in {"yes", "no"}:
            return normalized
        if normalized.startswith("yes ") or normalized.startswith("yeah ") or normalized.startswith("yep "):
            return "yes"
        if normalized.startswith("no ") or normalized.startswith("not ") or normalized.startswith("none "):
            return "no"
        if re.search(r"\b(no|not|none|did not|didn t|cannot|can t|could not)\b", normalized):
            return "no"
        if re.search(r"\b(yes|saw|seen|there is|there are|observed|found)\b", normalized):
            return "yes"
        return None

    def _strip_short_answer(self, text: str) -> str:
        value = " ".join(str(text or "").strip().split())
        value = re.sub(r"^[\"'`]+|[\"'`]+$", "", value).strip()
        value = re.sub(
            r"^(?:the\s+answer\s+is|answer\s*[:\-]?|it\s+(?:is|was)|they\s+(?:are|were)|this\s+(?:is|was))\s+",
            "",
            value,
            flags=re.IGNORECASE,
        ).strip()
        return value.rstrip(" .")

    def _canonical_text_from_question(self, text: Any, question: Any) -> str | None:
        value = self._strip_short_answer(str(text or ""))
        if not value:
            return None
        question_text = str(question or "").lower()
        value_text = value.lower()

        if re.search(r"\bwhat\s+colou?r\b|\bcolou?r\s+(?:is|was|were|are)\b", question_text):
            colors = (
                "black", "white", "gray", "grey", "red", "blue", "green", "yellow",
                "orange", "purple", "pink", "brown", "tan", "beige", "silver", "gold",
            )
            for color in colors:
                if re.search(rf"\b{re.escape(color)}\b", value_text):
                    return "gray" if color == "grey" else color

        if re.search(r"\bmaterial\b|\bmade\s+of\b", question_text):
            materials = (
                "metal", "wood", "wooden", "plastic", "glass", "concrete", "brick",
                "stone", "fabric", "cloth", "leather", "rubber", "paper", "cardboard",
            )
            for material in materials:
                if re.search(rf"\b{re.escape(material)}\b", value_text):
                    return "wood" if material == "wooden" else material

        if re.search(r"\b(left|right)\b|\bwhich\s+side\b|\bwhat\s+side\b|\bdirection\b", question_text):
            if re.search(r"\bleft\b", value_text) and not re.search(r"\bright\b", value_text):
                return "left"
            if re.search(r"\bright\b", value_text) and not re.search(r"\bleft\b", value_text):
                return "right"

        if re.search(r"\bhow\s+many\b|\bnumber\s+of\b", question_text):
            number = re.search(r"\b\d+\b", value)
            if number:
                return number.group(0)

        quoted = re.search(r"[\"'“”‘’]([^\"'“”‘’]{1,80})[\"'“”‘’]", value)
        if quoted and re.search(r"\b(say|says|said|read|reads|written|name|called|street|sign|label|text)\b", question_text):
            return self._strip_short_answer(quoted.group(1))

        # Many NavQA descriptive gold answers are short attributes.  When the
        # model emits "The color/material/... was red", recover the final noun
        # phrase only for clearly attribute-style questions.
        if re.search(r"\b(what\s+(?:color|material|kind|type)|which\s+(?:side|direction))\b", question_text):
            tail = re.search(r"\b(?:is|was|are|were)\s+(?:a\s+|an\s+|the\s+)?([^,.;]{1,40})$", value, flags=re.IGNORECASE)
            if tail:
                return self._strip_short_answer(tail.group(1))

        return value

    def _canonicalize_navqa_answer(
        self,
        answer: dict[str, Any],
        question: Any,
        expected_type: Any = None,
    ) -> dict[str, Any]:
        answer_type = self._normalize_answer_type(expected_type) or self._normalize_answer_type(answer.get("type"))
        if answer_type not in {"binary", "text"}:
            return answer
        guarded = dict(answer)
        if answer_type == "binary":
            binary = self._coerce_binary_answer(guarded.get("binary")) or self._coerce_binary_answer(guarded.get("text"))
            if binary in {"yes", "no"}:
                guarded["type"] = "binary"
                guarded["binary"] = binary
                guarded["text"] = binary
            return guarded
        canonical = self._canonical_text_from_question(guarded.get("text"), question)
        if canonical:
            guarded["type"] = "text"
            guarded["text"] = canonical
        return guarded

    def _normalize_coda_answer(
        self,
        raw_answer: Any,
        outer_type: Any = None,
        expected_type: str | None = None,
    ) -> dict[str, Any]:
        parsed = self._parse_structured_value(raw_answer)

        outer_answer_type = self._normalize_answer_type(outer_type)
        expected_answer_type = self._normalize_answer_type(expected_type)
        answer_type = expected_answer_type or outer_answer_type

        if isinstance(parsed, dict):
            parsed_type = self._normalize_answer_type(parsed.get("type"))
            answer_type = expected_answer_type or parsed_type or answer_type or "text"

            has_coda_fields = any(
                key in parsed
                for key in ("text", "binary", "position", "time", "duration")
            )
            if "answer" in parsed and not has_coda_fields:
                return self._normalize_coda_answer(
                    parsed.get("answer"),
                    outer_type=parsed.get("type") or outer_type,
                    expected_type=expected_type,
                )

            answer = self._empty_coda_answer(answer_type)
            for key in ("text", "binary", "position", "time", "duration"):
                if key in parsed:
                    answer[key] = parsed[key]

            if not answer["text"]:
                for key in ("answer", "response"):
                    if parsed.get(key) is not None:
                        answer["text"] = str(parsed[key])
                        break

            position = self._coerce_position(answer.get("position"))
            if position is None:
                position = self._extract_position_from_text(answer.get("text"))
            answer["position"] = position

            answer["time"] = self._extract_float(answer.get("time"))
            answer["duration"] = self._extract_float(answer.get("duration"))
            answer["binary"] = self._coerce_binary_answer(answer.get("binary"))

        elif isinstance(parsed, (list, tuple)):
            answer_type = answer_type or ("position" if len(parsed) in {2, 3} else "text")
            answer = self._empty_coda_answer(answer_type)
            if answer_type == "position":
                answer["position"] = self._coerce_position(parsed)
                answer["text"] = (
                    f"The position is {json.dumps(answer['position'], ensure_ascii=False)}."
                    if answer["position"] is not None
                    else str(parsed)
                )
            else:
                answer["text"] = json.dumps(list(parsed), ensure_ascii=False)

        elif isinstance(parsed, (int, float)):
            answer_type = answer_type or "time"
            answer = self._empty_coda_answer(answer_type)
            value = float(parsed)
            if answer_type == "duration":
                answer["duration"] = value
                answer["text"] = f"{value:g} minutes"
            elif answer_type == "time":
                answer["time"] = value
                answer["text"] = f"{value:g} minutes ago"
            else:
                answer["text"] = str(value)

        else:
            text = str(parsed or "")
            answer_type = answer_type or "text"
            answer = self._empty_coda_answer(answer_type)
            answer["text"] = text
            if answer_type == "position":
                answer["position"] = self._extract_position_from_text(text)
            elif answer_type == "binary":
                answer["binary"] = self._coerce_binary_answer(text)
            elif answer_type == "time":
                answer["time"] = self._extract_float(text)
            elif answer_type == "duration":
                answer["duration"] = self._extract_float(text)

        # Keep the selected field populated whenever a recoverable value exists.
        if answer["type"] == "position" and answer["position"] is None:
            answer["position"] = self._extract_position_from_text(answer.get("text"))
        elif answer["type"] == "binary" and answer["binary"] is None:
            answer["binary"] = self._coerce_binary_answer(answer.get("text"))
        elif answer["type"] == "time" and answer["time"] is None:
            answer["time"] = self._extract_float(answer.get("text"))
        elif answer["type"] == "duration" and answer["duration"] is None:
            answer["duration"] = self._extract_float(answer.get("text"))

        if answer["position"] is not None:
            position = self._coerce_position(answer.get("position"))
            answer["position"] = position[:2] if position is not None else None

        if answer["type"] == "binary" and answer["binary"] in {"yes", "no"}:
            # NavQA binary scoring expects the canonical label, not an explanatory
            # sentence beginning with the label.
            answer["text"] = answer["binary"]

        if expected_answer_type is not None:
            answer["type"] = expected_answer_type
        return answer

    def _parse_coda_rewrite_payload(self, response: str) -> Any:
        parsed = self._parse_structured_value(response)
        if isinstance(parsed, dict):
            return parsed

        tool_name, tool_args = self._parse_response(response)
        if tool_name == "add_answer_node" and isinstance(tool_args, dict):
            return tool_args.get("answer", tool_args)

        fenced = re.search(
            r"```(?:json)?\s*(\{.*?\})\s*```",
            response,
            flags=re.IGNORECASE | re.DOTALL,
        )
        candidates = []
        if fenced:
            candidates.append(fenced.group(1))
        first = response.find("{")
        last = response.rfind("}")
        if first != -1 and last > first:
            candidates.append(response[first : last + 1])
        for candidate in candidates:
            parsed = self._parse_structured_value(candidate)
            if isinstance(parsed, dict):
                return parsed
        return response


    async def _rewrite_coda_answer(
        self,
        raw_answer: Any,
        outer_type: Any,
        expected_type: str | None,
        question: str,
        graph: list[dict[str, Any]],
    ) -> dict[str, Any]:
        raw_payload = {
            "type": outer_type,
            "answer": self._sanitize_for_trajectory(raw_answer),
        }
        user_prompt = (
            "### Question\n"
            f"{question}\n\n"
            "### Structured Output Type\n"
            f"{expected_type or 'unknown'}\n\n"
            "### Current Graph\n"
            f"{self._compact_json_for_prompt(self._graph_for_model(graph))}\n\n"
            "### Raw Final Answer\n"
            f"{self._compact_json_for_prompt(raw_payload)}\n\n"
            "Rewrite the raw final answer into the structured evaluation JSON object. "
            "Keep the supported meaning, but make the fields evaluator-friendly: strict expected type, "
            "non-empty primary field when recoverable, canonical short text, and yes/no-only binary."
        )
        messages = [
            {"role": "system", "content": CODA_ANSWER_FORMAT_ADDENDUM},
            {"role": "user", "content": user_prompt},
        ]
        assistant_message = await self._request_message(messages)
        response = str(assistant_message.get("content") or "")
        parsed = self._parse_coda_rewrite_payload(response)
        normalized = self._normalize_coda_answer(
            parsed,
            outer_type=outer_type,
            expected_type=expected_type,
        )
        return normalized

    def _fallback_intermediate_node(
        self,
        last_search_args: dict[str, Any],
    ) -> dict[str, Any]:
        observation_entities = (
            last_search_args.get("observation_entities")
            if isinstance(last_search_args.get("observation_entities"), list)
            else []
        )
        return {
            "id": str(last_search_args.get("node_id") or "intermediate"),
            "parent_ids": self._normalize_parent_ids(
                last_search_args.get("parent_ids"),
                ["root"],
            ),
            "query": last_search_args.get("query"),
            "search_mode": last_search_args.get("search_mode"),
            "summary": (
                "Fallback extraction: the model returned a malformed summary tool call."
            ),
            "observations": self._fallback_summary_observations(observation_entities),
            "_candidate_entities": observation_entities,
        }

    def _short_summary(self, text: Any, limit: int = 96) -> str:
        summary = " ".join(str(text or "").split())
        if len(summary) <= limit:
            return summary
        return summary[: limit - 3] + "..."

    def _search_query_for_node(self, tool_name: str, tool_args: dict[str, Any]) -> Any:
        mode = self._tool_mode(tool_name, tool_args)
        if mode == "position":
            query_position = self._coerce_position(
                tool_args.get("query_position", tool_args.get("position"))
            )
            return query_position if query_position is not None else tool_args.get("query_position")
        if mode == "time":
            return tool_args.get("query_time", tool_args.get("time"))
        if mode == "target":
            return {
                "query": self._sanitize_target_query(
                    tool_args.get("query", "")
                ),
                "sort_by": tool_args.get("sort_by", "semantic"),
                "query_position": self._coerce_position(
                    tool_args.get("query_position", tool_args.get("position"))
                ),
                "query_time": tool_args.get("query_time", tool_args.get("time")),
            }
        return self._sanitize_target_query(tool_args.get("query", ""))

    def _tool_mode(self, tool_name: str, tool_args: dict[str, Any]) -> str:
        mode_by_tool = {
            "search_by_target": "target",
            "search_by_position": "position",
            "search_by_time": "time",
        }
        mode = mode_by_tool.get(tool_name, "target")
        return mode if mode in {"target", "position", "time"} else "target"

    def _normalize_parent_ids(self, value: Any, fallback: list[str]) -> list[str]:
        if value is None:
            return fallback
        if isinstance(value, str):
            parsed = self._parse_structured_value(value)
            if isinstance(parsed, str):
                return [parsed]
            value = parsed
        if not isinstance(value, (list, tuple)):
            return [str(value)]
        parent_ids = [str(item) for item in value if item is not None]
        return parent_ids or fallback


    def _select_source_files(self, entity: dict[str, Any]) -> list[str]:
        files = entity.get("source_file") or entity.get("source_files") or []
        if isinstance(files, str):
            files = [files]
        if not files:
            files = [item for item in (entity.get("file_start"), entity.get("file_end")) if item]
        files = [str(item) for item in files]
        if len(files) <= self.max_frames_per_result:
            return files
        if self.max_frames_per_result <= 1:
            return files[:1]
        indices = [
            round(i * (len(files) - 1) / (self.max_frames_per_result - 1))
            for i in range(self.max_frames_per_result)
        ]
        return [files[index] for index in indices]

    def _supported_frame_path(self, value: Any) -> Path | None:
        if not value:
            return None
        path = Path(str(value))
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".pkl"}:
            return None
        return path if path.is_file() else None

    def _frame_timestamp_from_item(
        self,
        item: Any,
        path: Any = None,
        fallback: Any = None,
    ) -> float | None:
        if isinstance(item, dict):
            for key in (
                "timestamp_seconds",
                "timestamp",
                "time",
                "time_start",
                "frame_time",
            ):
                timestamp = self._coerce_float(item.get(key))
                if timestamp is not None:
                    return timestamp
        timestamp = self._timestamp_from_filename(path)
        if timestamp is not None:
            return timestamp
        return self._coerce_float(fallback)

    def _explicit_frame_items_for_entity(
        self,
        entity: dict[str, Any],
    ) -> list[tuple[float | None, str]]:
        items: list[tuple[float | None, str]] = []

        def add(path_value: Any, source: Any = None) -> None:
            path = self._supported_frame_path(path_value)
            if path is None:
                return
            timestamp = self._frame_timestamp_from_item(
                source,
                path,
                entity.get("time"),
            )
            items.append((timestamp, str(path)))

        for key in ("frame_path", "image_path", "image_file"):
            value = entity.get(key)
            values = value if isinstance(value, list) else [value]
            for item in values:
                add(item, entity)

        for key in ("frames", "frame_paths"):
            value = entity.get(key)
            if not isinstance(value, list):
                continue
            for item in value:
                if isinstance(item, dict):
                    path_value = (
                        item.get("path")
                        or item.get("frame_path")
                        or item.get("image_path")
                        or item.get("image_file")
                    )
                    add(path_value, item)
                else:
                    add(item, entity)
        return items

    def _frame_items_for_entity(self, sample: dict[str, Any], entity: dict[str, Any]) -> list[tuple[float | None, str]]:
        items = self._explicit_frame_items_for_entity(entity)
        paths = sample.get("_frame_paths", {})
        sequence = str(entity.get("video_name") or sample.get("seq_id"))
        for filename in self._select_source_files(entity):
            frame = paths.get((sequence, filename))
            if frame is not None:
                items.append((frame["time"], frame["path"]))
        unique: list[tuple[float | None, str]] = []
        seen: set[str] = set()
        for timestamp, path in items:
            if path in seen:
                continue
            seen.add(path)
            unique.append((timestamp, path))
        return unique

    def _timestamp_from_filename(self, filename: Any) -> float | None:
        if not filename:
            return None
        stem = Path(str(filename)).stem
        try:
            return float(stem)
        except ValueError:
            return None

    def _segment_bounds_for_entity(self, entity: dict[str, Any]) -> tuple[float | None, float | None]:
        start = self._timestamp_from_filename(entity.get("file_start"))
        end = self._timestamp_from_filename(entity.get("file_end"))
        source_files = entity.get("source_file") or entity.get("source_files") or []
        if isinstance(source_files, str):
            source_files = [source_files]
        source_times = [
            timestamp
            for timestamp in (self._timestamp_from_filename(item) for item in source_files)
            if timestamp is not None
        ]

        if start is None and source_times:
            start = source_times[0]
        if end is None and source_times:
            end = source_times[-1]
        if start is None and end is None:
            fallback = entity.get("time")
            try:
                start = end = float(fallback)
            except (TypeError, ValueError):
                pass
        return start, end

    def _benchmark_for_time(self, sample: dict[str, Any], entity: dict[str, Any]) -> str:
        return str(canonical_benchmark(
            entity.get("dataset")
            or entity.get("benchmark")
            or sample.get("dataset")
            or sample.get("benchmark")
            or sample.get("_benchmark")
        ) or "")

    def _format_timestamp(
        self,
        timestamp: float | int | str | None,
        benchmark: object = None,
    ) -> str:
        if timestamp is None:
            return "unknown time"
        try:
            seconds = float(timestamp)
        except (TypeError, ValueError):
            return str(timestamp)
        if uses_local_timezone(benchmark) and abs(seconds) >= 86400:
            return format_local_timestamp(seconds)
        return format_video_timestamp(seconds)

    def _image_path_to_data_url(
        self, path: str, target_size: tuple[int, int] | None = None, *, size_only: bool = False,
    ) -> str | tuple[int, int]:
        from PIL import Image as PILImage

        with PILImage.open(path) as source:
            image = source.convert("RGB")

        if size_only:
            return image.size
        if target_size is not None and tuple(target_size) != image.size:
            image = image.resize(tuple(target_size), PILImage.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG")
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"

    def _prepare_messages_for_llm(
        self,
        messages: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        prepared: list[dict[str, Any]] = []
        for message in messages:
            content = message.get("content")
            if not isinstance(content, list):
                prepared.append(dict(message))
                continue

            converted = []
            for part in content:
                if part.get("type") == "image_path":
                    try:
                        image_part = {
                            "type": "image_url",
                            "image_url": {"url": self._image_path_to_data_url(
                                part["path"], target_size=part.get("target_size"),
                            )},
                        }
                        if part.get("max_pixels") is not None:
                            image_part["max_pixels"] = part.get("max_pixels")
                        converted.append(image_part)
                    except Exception as exc:
                        converted.append(
                            {
                                "type": "text",
                                "text": f"[Image load failed: {part.get('path')}, error={exc}]",
                            }
                        )
                else:
                    converted.append(part)
            copied = dict(message)
            copied["content"] = converted
            prepared.append(copied)
        return prepared

    def _entities_from_result(self, result: Any) -> list[dict[str, Any]]:
        if not isinstance(result, dict):
            return []
        entities = result.get("entity_results")
        if isinstance(entities, list):
            return [item for item in entities if isinstance(item, dict)]
        collected: list[dict[str, Any]] = []
        for key in ("caption_results", "video_results", "position_results", "time_results"):
            values = result.get(key)
            if isinstance(values, list):
                collected.extend(item for item in values if isinstance(item, dict))
        return collected

    def _entity_time_span(self, entity: dict[str, Any]) -> tuple[float | None, float | None]:
        start, end = self._segment_bounds_for_entity(entity)
        fallback_time = self._coerce_float(entity.get("time"))
        if start is None:
            start = fallback_time
        if end is None:
            end = fallback_time
        if start is not None and end is not None and start > end:
            start, end = end, start
        return start, end

    def _entity_sort_key(self, entity: dict[str, Any]) -> tuple[float, str]:
        start, end = self._entity_time_span(entity)
        time_value = start if start is not None else end
        if time_value is None:
            time_value = float("inf")
        return (time_value, str(entity.get("id") or ""))

    def _entity_video_key(self, entity: dict[str, Any], sample: dict[str, Any]) -> str:
        return str(
            entity.get("video_name")
            or entity.get("seq_id")
            or sample.get("video_name")
            or sample.get("video")
            or sample.get("seq_id")
            or ""
        )

    def _entity_position(self, entity: dict[str, Any]) -> list[float] | None:
        return self._coerce_position(entity.get("position"))

    def _round_position(self, position: list[float] | None) -> list[float] | None:
        if position is None:
            return None
        return [round(float(value), 2) for value in position[:2]]

    def _average_position(self, positions: list[list[float]]) -> list[float] | None:
        if not positions:
            return None
        positions = [position for position in positions if len(position) >= 2]
        if not positions:
            return None
        count = float(len(positions))
        return [
            round(sum(position[index] for position in positions) / count, 2)
            for index in range(2)
        ]

    def _entity_evidence(self, entity: dict[str, Any]) -> str:
        for key in ("caption", "memory", "text", "description"):
            value = entity.get(key)
            if value:
                return " ".join(str(value).split())
        return ""

    def _timestamp_seconds(self, value: float | None) -> float | None:
        if value is None:
            return None
        return round(float(value), 6)

    def _coerce_summary_timestamp(self, value: Any, fallback: Any = None) -> float | None:
        coerced = self._coerce_float(value)
        if coerced is not None:
            return coerced
        if not isinstance(value, str):
            return None
        reference_time = self._coerce_float(fallback)
        # HH:MM:SS summaries may be local clock time (CODA/NavQA) or video time.
        # For small fallback values, treat as video seconds; otherwise preserve the
        # fallback date for local-clock benchmark timestamps.
        if reference_time is not None and abs(reference_time) < 86400:
            coerced = coerce_timestamp(value)
            if coerced is not None:
                return coerced
        if reference_time is not None:
            coerced = coerce_timestamp(value, benchmark="coda", reference_time=reference_time)
            if coerced is not None:
                return coerced
        return coerce_timestamp(value)

    def _format_summary_timestamp(self, value: float | None) -> str:
        if value is None:
            return "unknown time"
        benchmark = None if abs(float(value)) < 86400 else "coda"
        return self._format_timestamp(value, benchmark)

    def _format_time_range_for_entity(
        self,
        observation_entity: dict[str, Any],
        benchmark: object,
    ) -> str:
        start = observation_entity.get("time_start")
        end = observation_entity.get("time_end")
        if start is not None and end is not None:
            return (
                f"{self._format_timestamp(start, benchmark)} to "
                f"{self._format_timestamp(end, benchmark)} "
                f"(timestamp_seconds={start} to {end})"
            )
        timestamp = start if start is not None else end
        if timestamp is not None:
            return f"{self._format_timestamp(timestamp, benchmark)} (timestamp_seconds={timestamp})"
        return "null"

    def _can_merge_target_entity(
        self,
        group: list[tuple[int, dict[str, Any]]],
        entity: dict[str, Any],
        sample: dict[str, Any],
    ) -> bool:
        if not group:
            return False
        previous_entity = group[-1][1]
        if self._entity_video_key(previous_entity, sample) != self._entity_video_key(entity, sample):
            return False
        _, previous_end = self._entity_time_span(previous_entity)
        current_start, _ = self._entity_time_span(entity)
        if previous_end is None or current_start is None:
            return False
        return current_start - previous_end <= self.target_merge_gap_seconds

    def _observation_entity_from_group(
        self,
        group: list[tuple[int, dict[str, Any]]],
        entity_index: int,
        sample: dict[str, Any],
        mode: str,
    ) -> dict[str, Any]:
        sorted_group = sorted(group, key=lambda item: self._entity_sort_key(item[1]))
        include_target = mode == "target"
        starts: list[float] = []
        ends: list[float] = []
        positions: list[list[float]] = []
        observations: list[dict[str, Any]] = []

        for raw_index, entity in sorted_group:
            start, end = self._entity_time_span(entity)
            if start is not None:
                starts.append(float(start))
            if end is not None:
                ends.append(float(end))
            position = self._entity_position(entity)
            if position is not None:
                positions.append(position)
            benchmark = self._benchmark_for_time(sample, entity)
            observation = {
                "raw_result_id": str(entity.get("id") or f"result_{raw_index}"),
                "time_start": self._timestamp_seconds(start),
                "time_end": self._timestamp_seconds(end),
                "time_text": (
                    f"{self._format_timestamp(start, benchmark)} to "
                    f"{self._format_timestamp(end, benchmark)}"
                    if start is not None and end is not None
                    else self._format_timestamp(start if start is not None else end, benchmark)
                ),
                "position": self._round_position(position),
                "evidence": self._entity_evidence(entity),
                "_entity": entity,
            }
            if include_target:
                for key in (
                    "semantic_rank",
                    "target_rank",
                    "distance_to_query_position",
                    "time_delta_to_query_time",
                    "target_sort_by",
                    "target_return_reason",
                ):
                    if entity.get(key) is not None:
                        observation[key] = entity.get(key)
            observations.append(observation)

        output = {
            "entity_id": f"entity_{entity_index}",
            "raw_result_ids": [item["raw_result_id"] for item in observations],
            "time_start": self._timestamp_seconds(min(starts) if starts else None),
            "time_end": self._timestamp_seconds(max(ends) if ends else None),
            "time_text": (
                f"{self._format_timestamp(min(starts), self._benchmark_for_time(sample, sorted_group[0][1]))} to "
                f"{self._format_timestamp(max(ends), self._benchmark_for_time(sample, sorted_group[-1][1]))}"
                if starts and ends
                else None
            ),
            "position": self._average_position(positions),
            "observations": observations,
        }
        if include_target:
            semantic_ranks = [
                int(entity["semantic_rank"])
                for _, entity in group
                if entity.get("semantic_rank") is not None
            ]
            target_ranks = [
                int(entity["target_rank"])
                for _, entity in group
                if entity.get("target_rank") is not None
            ]
            if semantic_ranks:
                output["best_semantic_rank"] = min(semantic_ranks)
            if target_ranks:
                output["best_target_rank"] = min(target_ranks)
        return output

    def _target_sort_by(self, result: Any) -> str:
        if not isinstance(result, dict):
            return "semantic"
        metadata = result.get("target_search")
        if isinstance(metadata, dict):
            return str(metadata.get("sort_by") or "semantic").strip().lower()
        return "semantic"

    def _organize_observation_entities(
        self,
        mode: str,
        result: Any,
        sample: dict[str, Any],
    ) -> list[dict[str, Any]]:
        raw_entities = self._entities_from_result(result)
        if not raw_entities:
            return []

        indexed_entities = list(enumerate(raw_entities, start=1))
        target_sort_by = self._target_sort_by(result) if mode == "target" else ""
        preserve_target_order = mode == "target" and target_sort_by != "semantic"
        if not preserve_target_order:
            indexed_entities = sorted(
                indexed_entities,
                key=lambda item: self._entity_sort_key(item[1]),
            )
        groups: list[list[tuple[int, dict[str, Any]]]] = []
        if mode == "target" and target_sort_by == "semantic":
            for item in indexed_entities:
                if groups and self._can_merge_target_entity(groups[-1], item[1], sample):
                    groups[-1].append(item)
                else:
                    groups.append([item])
        else:
            groups = [[item] for item in indexed_entities]

        return [
            self._observation_entity_from_group(group, index, sample, mode)
            for index, group in enumerate(groups, start=1)
        ]

    def _compact_observation_entities(
        self,
        observation_entities: list[dict[str, Any]],
        sample: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        compact: list[dict[str, Any]] = []
        for entity in observation_entities:
            compact_observations = []
            for observation in entity.get("observations", []):
                compact_observation = {
                    "raw_result_id": observation.get("raw_result_id"),
                    "time_start": observation.get("time_start"),
                    "time_end": observation.get("time_end"),
                    "time_text": observation.get("time_text"),
                    "position": observation.get("position"),
                    "evidence": observation.get("evidence"),
                }
                for key in (
                    "semantic_rank",
                    "target_rank",
                    "distance_to_query_position",
                    "time_delta_to_query_time",
                    "target_sort_by",
                    "target_return_reason",
                ):
                    if observation.get(key) is not None:
                        compact_observation[key] = observation.get(key)
                raw_entity = observation.get("_entity")
                if sample is not None and isinstance(raw_entity, dict):
                    frames = [
                        {
                            "timestamp": self._timestamp_seconds(timestamp),
                            "path": path,
                        }
                        for timestamp, path in self._frame_items_for_entity(sample, raw_entity)
                    ]
                    if frames:
                        compact_observation["frames"] = frames
                compact_observations.append(compact_observation)
            compact_entity = {
                "entity_id": entity.get("entity_id"),
                "raw_result_ids": entity.get("raw_result_ids", []),
                "time_start": entity.get("time_start"),
                "time_end": entity.get("time_end"),
                "time_text": entity.get("time_text"),
                "position": entity.get("position"),
                "observations": compact_observations,
            }
            for key in ("best_semantic_rank", "best_target_rank"):
                if entity.get(key) is not None:
                    compact_entity[key] = entity.get(key)
            compact.append(compact_entity)
        return compact

    def _best_observation_for_summary(self, entity: dict[str, Any]) -> dict[str, Any]:
        observations = entity.get("observations")
        if not isinstance(observations, list) or not observations:
            return entity

        def sort_key(observation: dict[str, Any]) -> tuple[float, float]:
            rank = self._first_float(
                observation.get("semantic_rank"),
                observation.get("target_rank"),
                entity.get("best_semantic_rank"),
                entity.get("best_target_rank"),
            )
            time_value = self._first_float(observation.get("time_start"), entity.get("time_start"))
            return (
                rank if rank is not None else float("inf"),
                time_value if time_value is not None else float("inf"),
            )

        dict_observations = [item for item in observations if isinstance(item, dict)]
        return min(dict_observations, key=sort_key) if dict_observations else entity

    def _caption_text_fallback(
        self,
        observation: dict[str, Any],
        entity: dict[str, Any],
    ) -> str:
        evidence = str(observation.get("evidence") or entity.get("evidence") or "").strip()
        caption = self._short_summary(evidence, limit=1000) if evidence else "No concise target caption was extracted."
        rank_parts = []
        for label, key, source in (
            ("semantic_rank", "semantic_rank", observation),
            ("target_rank", "target_rank", observation),
            ("distance_to_query_position", "distance_to_query_position", observation),
        ):
            if source.get(key) is not None:
                rank_parts.append(f"{label}={source.get(key)}")
        return "; ".join(rank_parts + [caption]) if rank_parts else caption

    def _fallback_summary_observations(
        self,
        observation_entities: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        summaries: list[dict[str, Any]] = []
        for entity in observation_entities:
            observation = self._best_observation_for_summary(entity)
            time_value = self._first_float(
                observation.get("time_start"),
                observation.get("time"),
                entity.get("time_start"),
            )
            position = self._coerce_position(observation.get("position"))
            if position is None:
                position = self._coerce_position(entity.get("position"))
            summaries.append(
                {
                    "time": (
                        self._format_summary_timestamp(time_value)
                        if time_value is not None
                        else None
                    ),
                    "position": self._round_position(position),
                    "status": "unclear",
                    "caption": self._caption_text_fallback(observation, entity),
                }
            )
        return summaries

    def _normalize_summary_status(self, value: Any) -> str:
        text = str(value or "").strip().lower()
        if text in {"target", "distractor", "unclear"}:
            return text
        if text in {"yes", "visible", "present", "direct", "match", "matched"}:
            return "target"
        if text in {"no", "absent", "nearby", "non-target", "nontarget", "negative"}:
            return "distractor"
        return "unclear"

    def _normalize_summary_observations(
        self,
        value: Any,
        fallback_observation_entities: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        parsed = self._parse_structured_value(value)
        if isinstance(parsed, dict):
            parsed = parsed.get("observations") or parsed.get("entities")
        if not isinstance(parsed, list):
            return self._fallback_summary_observations(fallback_observation_entities)

        fallback_by_id = {
            str(entity.get("entity_id")): entity
            for entity in fallback_observation_entities
            if entity.get("entity_id") is not None
        }
        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(parsed, start=1):
            if not isinstance(item, dict):
                continue
            fallback = {}
            entity_id = item.get("entity_id") or item.get("id")
            if entity_id is not None:
                fallback = fallback_by_id.get(str(entity_id), {})
            if not fallback and index <= len(fallback_observation_entities):
                fallback = fallback_observation_entities[index - 1]
            fallback_observation = (
                self._best_observation_for_summary(fallback)
                if isinstance(fallback, dict)
                else {}
            )
            fallback_time = self._first_float(
                fallback_observation.get("time_start"),
                fallback_observation.get("time"),
                fallback.get("time_start") if isinstance(fallback, dict) else None,
            )
            time_value = self._coerce_summary_timestamp(
                item.get("time")
                or item.get("best_frame_time")
                or item.get("time_start")
                or item.get("timestamp"),
                fallback_time,
            )
            if time_value is None:
                time_value = fallback_time
            position = self._coerce_position(item.get("position"))
            if position is None:
                position = self._coerce_position(fallback_observation.get("position"))
            if position is None and isinstance(fallback, dict):
                position = self._coerce_position(fallback.get("position"))
            caption = str(
                item.get("caption")
                or item.get("summary")
                or item.get("evidence")
                or item.get("content")
                or item.get("description")
                or ""
            ).strip()
            if not caption:
                caption = self._caption_text_fallback(fallback_observation, fallback)
            normalized.append(
                {
                    "time": (
                        self._format_summary_timestamp(time_value)
                        if time_value is not None
                        else None
                    ),
                    "position": self._round_position(position),
                    "status": self._normalize_summary_status(item.get("status")),
                    "caption": caption,
                }
            )
        return normalized or self._fallback_summary_observations(fallback_observation_entities)

    def _memory_frame_candidates(
        self,
        observation_entities: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        candidates: list[dict[str, Any]] = []
        for entity_index, entity in enumerate(observation_entities):
            if not isinstance(entity, dict):
                continue
            observations = entity.get("observations")
            if not isinstance(observations, list):
                observations = []
            for observation_index, observation in enumerate(observations):
                if not isinstance(observation, dict):
                    continue
                frames = observation.get("frames")
                if not isinstance(frames, list):
                    frames = []
                position = self._coerce_position(observation.get("position"))
                if position is None:
                    position = self._coerce_position(entity.get("position"))
                observation_time = self._first_float(
                    observation.get("time_start"),
                    observation.get("time"),
                    entity.get("time_start"),
                )
                observation_end = self._first_float(
                    observation.get("time_end"),
                    entity.get("time_end"),
                )
                for frame_index, frame in enumerate(frames):
                    if not isinstance(frame, dict) or not frame.get("path"):
                        continue
                    timestamp = self._first_float(
                        frame.get("timestamp"),
                        observation_time,
                        observation_end,
                    )
                    candidates.append(
                        {
                            "path": str(frame["path"]),
                            "timestamp_seconds": timestamp,
                            "position": self._round_position(position),
                            "observation_time": observation_time,
                            "observation_end": observation_end,
                            "entity_index": entity_index,
                            "observation_index": observation_index,
                            "frame_index": frame_index,
                        }
                    )
        return candidates

    def _summary_observation_time_for_candidate(
        self,
        observation: dict[str, Any],
        candidate: dict[str, Any],
    ) -> float | None:
        fallback = self._first_float(
            candidate.get("timestamp_seconds"),
            candidate.get("observation_time"),
            candidate.get("observation_end"),
        )
        return self._coerce_summary_timestamp(
            observation.get("time")
            or observation.get("timestamp")
            or observation.get("time_start"),
            fallback,
        )

    def _summary_observation_position(self, observation: dict[str, Any]) -> list[float] | None:
        for key in ("position", "location", "place", "viewpoint"):
            position = self._coerce_position(observation.get(key))
            if position is not None:
                return position
        return None

    def _memory_frame_match_score(
        self,
        observation: dict[str, Any],
        candidate: dict[str, Any],
    ) -> tuple[float, float, int, int, int]:
        target_time = self._summary_observation_time_for_candidate(observation, candidate)
        frame_time = self._first_float(
            candidate.get("timestamp_seconds"),
            candidate.get("observation_time"),
        )
        if target_time is not None and frame_time is not None:
            time_score = abs(float(target_time) - float(frame_time))
        else:
            time_score = float("inf")

        observation_position = self._summary_observation_position(observation)
        candidate_position = self._coerce_position(candidate.get("position"))
        distance = self._distance_between(observation_position, candidate_position)
        position_score = distance if distance is not None else float("inf")
        return (
            time_score,
            position_score,
            int(candidate.get("entity_index") or 0),
            int(candidate.get("observation_index") or 0),
            int(candidate.get("frame_index") or 0),
        )

    def _memory_frames_for_summary_observations(
        self,
        observations: list[dict[str, Any]],
        observation_entities: list[dict[str, Any]],
        sample: dict[str, Any],
    ) -> list[dict[str, Any]]:
        candidates = self._memory_frame_candidates(observation_entities)
        if not observations or not candidates:
            return []

        benchmark = canonical_benchmark(
            sample.get("dataset") or sample.get("benchmark") or sample.get("_benchmark")
        )
        frames: list[dict[str, Any]] = []
        used_paths: set[str] = set()
        for summary_index, observation in enumerate(observations):
            if not isinstance(observation, dict):
                continue
            available = [candidate for candidate in candidates if candidate["path"] not in used_paths]
            if not available:
                break
            best = min(
                available,
                key=lambda candidate: self._memory_frame_match_score(observation, candidate),
            )
            used_paths.add(best["path"])

            timestamp_seconds = self._first_float(
                self._summary_observation_time_for_candidate(observation, best),
                best.get("timestamp_seconds"),
                best.get("observation_time"),
            )
            timestamp_text = str(observation.get("time") or "").strip()
            if not timestamp_text:
                timestamp_text = self._format_timestamp(timestamp_seconds, benchmark)
            position = self._summary_observation_position(observation)
            if position is None:
                position = self._coerce_position(best.get("position"))
            frames.append(
                {
                    "path": best["path"],
                    "timestamp": timestamp_text,
                    "timestamp_seconds": timestamp_seconds,
                    "location": self._round_position(position),
                    "summary_index": summary_index,
                }
            )

        frames.sort(
            key=lambda frame: (
                frame.get("timestamp_seconds")
                if frame.get("timestamp_seconds") is not None
                else float("inf"),
                int(frame.get("summary_index") or 0),
                str(frame.get("path") or ""),
            )
        )
        return frames

    def _graph_multimodal_memory_frames(
        self,
        graph: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        frames: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for node_index, node in enumerate(graph):
            if self.enable_adaptive_pixel_budget and not any(
                item.get("status") == "target" for item in node.get("observations", [])
                if isinstance(item, dict)
            ):
                continue
            node_frames = node.get("_multimodal_memory_frames")
            if not isinstance(node_frames, list):
                continue
            for frame in node_frames:
                if not isinstance(frame, dict) or not frame.get("path"):
                    continue
                key = (str(frame.get("path")), str(frame.get("timestamp") or ""))
                if key in seen:
                    continue
                seen.add(key)
                item = dict(frame)
                item["_node_index"] = node_index
                frames.append(item)
        frames.sort(
            key=lambda frame: (
                frame.get("timestamp_seconds")
                if frame.get("timestamp_seconds") is not None
                else float("inf"),
                int(frame.get("_node_index") or 0),
                int(frame.get("summary_index") or 0),
                str(frame.get("path") or ""),
            )
        )
        return frames

    def _multimodal_memory_content_parts(
        self,
        graph: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        frames = self._graph_multimodal_memory_frames(graph)[:self.history_limit]
        if not frames:
            return []
        per_image_pixels = min(
            VIMRAG_MULTIMODAL_MEMORY_IMAGE_MAX_PIXELS,
            self.pixel_budget // max(len(frames), 1),
        )
        if self.enable_adaptive_pixel_budget:
            outdegrees = Counter(parent for node in graph for parent in set(node.get("parent_ids", [])))
            images = []
            for frame in frames:
                path = str(frame["path"])
                if path not in self._memory_image_sizes:
                    self._memory_image_sizes[path] = self._image_path_to_data_url(path, size_only=True)
                width, height = self._memory_image_sizes[path]
                node_index = frame["_node_index"]
                images.append({
                    "width": width, "height": height, "node_id": node_index,
                    "node_weight": min(1 + outdegrees[graph[node_index].get("id")], 5),
                    "semantic_gate": True,
                })
            allocations = allocate_adaptive_pixel_budget(images, self.pixel_budget)
            frames = [dict(frame, **allocation) for frame, allocation in zip(frames, allocations)
                      if allocation["allocated_pixels"]]
            if not frames:
                return []
        parts: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": (
                    "\n\n### Multimodal Memory Frames\n"
                    "Historical frames from summarized observations.\n\n"
                    f"{VIMRAG_MULTIMODAL_MEMORY_PROMPT_NOTE}"
                ),
            }
        ]
        for index, frame in enumerate(frames, start=1):
            location = frame.get("location")
            location_text = (
                json.dumps(location, ensure_ascii=False)
                if location is not None
                else "unknown"
            )
            timestamp = frame.get("timestamp") or self._format_timestamp(
                frame.get("timestamp_seconds"),
                None,
            )
            parts.append(
                {
                    "type": "text",
                    "text": (
                        f"Memory frame {index}: "
                        f"timestamp={timestamp}; location/position={location_text}"
                    ),
                }
            )
            parts.append(
                {
                    "type": "image_path",
                    "path": str(frame["path"]),
                    "max_pixels": frame.get("allocated_pixels", per_image_pixels),
                    **({"target_size": frame["target_size"]} if "target_size" in frame else {}),
                }
            )
        return parts

    def _build_user_content(
        self,
        question: str,
        graph: list[dict[str, Any]],
        answer_type: str | None = None,
        trajectory_context: str | None = None,
    ) -> str | list[dict[str, Any]]:
        prompt = self._build_user_prompt(
            question,
            graph,
            answer_type=answer_type,
            trajectory_context=trajectory_context,
        )
        action_prompt = "\n\n" + VIMRAG_NEXT_ACTION_PROMPT
        if not self.enable_vimrag_multimodal_memory:
            return prompt + action_prompt
        memory_parts = self._multimodal_memory_content_parts(graph)
        if not memory_parts:
            return prompt + action_prompt
        return [
            {"type": "text", "text": prompt},
            *memory_parts,
            {"type": "text", "text": action_prompt},
        ]

    def _format_search_response(
        self,
        tool_name: str,
        tool_args: dict[str, Any],
        result: Any,
        sample: dict[str, Any],
        observation_entities: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        content: list[dict[str, Any]] = []
        mode = self._tool_mode(tool_name, tool_args)
        if observation_entities is None:
            observation_entities = self._organize_observation_entities(mode, result, sample)

        lines = ["<tool_response>"]

        emitted_images = 0
        max_images = max(0, int(self.max_images_per_search))

        if not observation_entities:
            if isinstance(result, dict) and result.get("error"):
                lines.append(f"error: {result.get('error')}")
            else:
                lines.append("No matching memory observations were returned.")
        for entity_index, entity in enumerate(observation_entities, start=1):
            first_raw_entity = None
            for observation in entity.get("observations", []):
                if isinstance(observation.get("_entity"), dict):
                    first_raw_entity = observation["_entity"]
                    break
            benchmark = (
                self._benchmark_for_time(sample, first_raw_entity)
                if first_raw_entity is not None
                else canonical_benchmark(sample.get("dataset") or sample.get("benchmark"))
            )
            observations = [
                observation
                for observation in entity.get("observations", [])
                if isinstance(observation, dict)
            ]
            lines.append(f"Result {entity_index}:")
            lines.extend(
                [
                    f"- time_start/time_end: {self._format_time_range_for_entity(entity, benchmark)}",
                    f"- position: {json.dumps(entity.get('position'), ensure_ascii=False)}",
                    "- evidence:",
                ]
            )
            for observation in observations:
                lines.append(
                    "  - "
                    f"time={observation.get('time_text')}; "
                    f"position={json.dumps(observation.get('position'), ensure_ascii=False)}; "
                    f"evidence={observation.get('evidence')}"
                )
                raw_entity = observation.get("_entity")
                if not isinstance(raw_entity, dict):
                    continue
                if emitted_images >= max_images:
                    continue
                raw_benchmark = self._benchmark_for_time(sample, raw_entity)
                for frame_timestamp, frame_path in self._frame_items_for_entity(sample, raw_entity):
                    if emitted_images >= max_images:
                        break
                    marker_time = self._format_timestamp(frame_timestamp, raw_benchmark)
                    marker_position = observation.get("position") or entity.get("position")
                    marker_position_text = (
                        f" position={json.dumps(self._round_position(marker_position), ensure_ascii=False)}"
                        if marker_position is not None
                        else ""
                    )
                    lines.append(f"<time={marker_time}{marker_position_text}>")
                    content.append({"type": "text", "text": "\n".join(lines)})
                    lines = []
                    content.append(
                        {
                            "type": "image_path",
                            "path": frame_path,
                            "max_pixels": self.observation_pixels,
                        }
                    )
                    emitted_images += 1

        lines.append("</tool_response>")
        if lines:
            content.append({"type": "text", "text": "\n".join(lines)})
        return content

    async def agent_rollout(self, sample: dict[str, Any]) -> dict[str, Any]:
        question = sample.get("question") or sample.get("query")
        if not question:
            raise ValueError("VimRAGAgent requires sample['question'] or sample['query'].")
        raw_question = self._extract_user_question(question)
        if not raw_question:
            raise ValueError("VimRAGAgent requires a non-empty user question.")

        dataset = canonical_benchmark(
            sample.get("dataset") or sample.get("benchmark") or sample.get("_benchmark")
        )
        # nav_benchmark is the shared carrier for the NavQA and RoboMem query
        # sets.  Keep the CODA-style trajectory/answer guidance enabled for
        # both query sets while still routing memory lookups by ``dataset``.
        is_coda = str(dataset or "").lower() in {"coda", "coda_full", "nav_benchmark"}
        trajectory_context = self._build_trajectory_context(sample, enabled=is_coda)
        expected_answer_type = self._expected_answer_type(sample) if is_coda else None

        root_node, refined_query, question_skills = await self._initialize_root(
            raw_question,
            answer_type=expected_answer_type,
            trajectory_context=trajectory_context,
        )
        graph: list[dict[str, Any]] = [root_node]
        # self._print_graph(graph)
        system_prompt = self._build_system_prompt(
            question_skills,
            include_multimodal_memory=self.enable_vimrag_multimodal_memory,
        )
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": self._build_user_content(
                    raw_question,
                    graph,
                    answer_type=expected_answer_type,
                    trajectory_context=trajectory_context,
                ),
            },
        ]
        search_count = 0
        last_search_args: dict[str, Any] | None = None

        for turn in range(self.max_steps):
            assistant_message = await self._request_message(messages)
            response = str(assistant_message.get("content") or "")
            messages.append(
                self._assistant_history_message(
                    assistant_message,
                    content=response,
                )
            )
            tool_name, tool_args = self._parse_response(response)

            if tool_name is None:
                if last_search_args is not None and "summarize_intermediate_node" in response:
                    fallback_node = self._fallback_intermediate_node(last_search_args)
                    graph.append(fallback_node)
                    last_search_args = None
                    messages = [
                        {"role": "system", "content": system_prompt},
                        {
                            "role": "user",
                            "content": self._build_user_content(
                                raw_question,
                                graph,
                                answer_type=expected_answer_type,
                                trajectory_context=trajectory_context,
                            ),
                        },
                    ]
                    continue
                messages.append(
                    {
                        "role": "user",
                        "content": "Could not parse your response. Return exactly one valid <tool_call> XML block.",
                    }
                )
                continue

            if tool_name in {
                "search_by_target",
                "search_by_position",
                "search_by_time",
            }:
                if last_search_args is not None:
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                "The latest search result must first be summarized with "
                                "summarize_intermediate_node. After that node is in the "
                                "graph, choose the next search or answer."
                            ),
                        }
                    )
                    continue

                tool_args["parent_ids"] = self._normalize_parent_ids(
                    tool_args.get("parent_ids"),
                    ["root"],
                )
                tool_args.setdefault("node_id", f"intermediate_{turn}")
                if tool_name == "search_by_target":
                    sort_by = str(tool_args.get("sort_by", "semantic")).strip().lower()
                    if sort_by not in {"semantic", "nearest", "closest_time"}:
                        sort_by = "semantic"
                        tool_args["sort_by"] = sort_by
                    if sort_by == "nearest":
                        if self._question_requests_nearest(question):
                            query_position = self._coerce_position(
                                tool_args.get("query_position", tool_args.get("position"))
                            )
                            if not query_position:
                                current_position = self._extract_current_position_from_question(
                                    question
                                )
                                if current_position is not None:
                                    tool_args["query_position"] = current_position
                                else:
                                    tool_args["sort_by"] = "semantic"
                        else:
                            tool_args["sort_by"] = "semantic"
                    if tool_args.get("sort_by") == "semantic":
                        tool_args.pop("query_position", None)
                        tool_args.pop("position", None)
                        tool_args.pop("query_time", None)
                        tool_args.pop("time", None)
                    elif tool_args.get("sort_by") == "closest_time":
                        tool_args.pop("query_position", None)
                        tool_args.pop("position", None)
                    elif tool_args.get("sort_by") == "nearest":
                        tool_args.pop("query_time", None)
                        tool_args.pop("time", None)
                query_start_time, query_end_time = self._sample_time_bounds(sample)
                runtime_args = {
                    "query_start_time": query_start_time,
                    "query_end_time": query_end_time,
                    "dataset": canonical_benchmark(
                        sample.get("dataset") or sample.get("benchmark") or sample.get("_benchmark")
                    ),
                    "video_name": sample.get("video_name") or sample.get("video") or sample.get("seq_id"),
                }
                if self.search_limit is not None and search_count >= self.search_limit:
                    messages.append({"role": "user", "content": "The search limit has been reached. Use add_answer_node."})
                    continue
                search_count += 1
                result = await self.call_tool(tool_name, {**tool_args, **runtime_args})
                if (
                    isinstance(result, dict)
                    and result.get("error")
                    and not self._entities_from_result(result)
                ):
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                f"Tool call failed: {result.get('error')} "
                                "Stay in the graph decision phase and issue one corrected "
                                "search tool call with all required arguments, or answer if "
                                "the graph already has enough evidence. Do not call "
                                "summarize_intermediate_node for this failed tool call."
                            ),
                        }
                    )
                    continue
                search_mode = self._tool_mode(tool_name, tool_args)
                observation_entities = self._organize_observation_entities(
                    search_mode,
                    result,
                    sample,
                )
                last_search_args = {
                    "node_id": str(tool_args.get("node_id")),
                    "parent_ids": tool_args["parent_ids"],
                    "query": self._search_query_for_node(tool_name, tool_args),
                    "search_mode": search_mode,
                    "observation_entities": self._compact_observation_entities(
                        observation_entities,
                        sample,
                    ),
                }
                tool_response_content = self._format_search_response(
                    tool_name,
                    tool_args,
                    result,
                    sample,
                    observation_entities=observation_entities,
                )
                messages.append({"role": "user", "content": tool_response_content})
                messages.append({"role": "user", "content": SUMMARY_PROMPT})
                continue

            if tool_name == "summarize_intermediate_node":
                if last_search_args is None:
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                "There is no unsummarized search result. In the graph "
                                "decision phase, choose a search tool or add_answer_node."
                            ),
                        }
                    )
                    continue

                node_id = str((last_search_args or {}).get("node_id") or f"intermediate_{turn}")
                # print(json.dumps(messages[1:], ensure_ascii=False, indent=2))

                parent_ids = self._normalize_parent_ids(
                    (last_search_args or {}).get("parent_ids"),
                    ["root"],
                )
                observation_entities = (
                    (last_search_args or {}).get("observation_entities")
                    if isinstance((last_search_args or {}).get("observation_entities"), list)
                    else []
                )
                observations = self._normalize_summary_observations(
                    tool_args.get("observations", tool_args.get("entities")),
                    observation_entities,
                )
                summary = str(tool_args.get("summary", tool_args.get("content", ""))).strip()
                if not summary and observations:
                    summary = f"Extracted {len(observations)} compact observation(s)."
                node = {
                    "id": node_id,
                    "parent_ids": parent_ids,
                    "query": (last_search_args or {}).get("query", tool_args.get("query")),
                    "search_mode": (last_search_args or {}).get("search_mode"),
                    "summary": summary,
                    "observations": observations,
                    "_candidate_entities": observation_entities,
                }
                if self.enable_vimrag_multimodal_memory:
                    memory_frames = self._memory_frames_for_summary_observations(
                        observations,
                        observation_entities,
                        sample,
                    )
                    if memory_frames:
                        node["_multimodal_memory_frames"] = memory_frames
                graph.append(node)
                # self._print_graph(graph)
                last_search_args = None
                messages = [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": self._build_user_content(
                            raw_question,
                            graph,
                            answer_type=expected_answer_type,
                            trajectory_context=trajectory_context,
                        ),
                    },
                ]
                continue

            if tool_name == "add_answer_node":
                if last_search_args is not None:
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                "The latest search result must first be summarized with "
                                "summarize_intermediate_node so the graph node stores its "
                                "query, summary, and observation captions. Do not answer until the "
                                "next graph decision phase."
                            ),
                        }
                    )
                    continue

                raw_answer = tool_args.get("answer", "")
                if is_coda and STRUCTED_ANSWER:
                    prediction_structured = await self._rewrite_coda_answer(
                        raw_answer,
                        tool_args.get("type", "general"),
                        expected_answer_type,
                        raw_question,
                        graph,
                    )
                    prediction_structured = self._guard_non_nearest_position_answer(
                        prediction_structured,
                        graph,
                        question,
                    )
                    prediction_structured = self._guard_time_answer(
                        prediction_structured,
                        question,
                        expected_type=expected_answer_type,
                        raw_answer=raw_answer,
                    )
                    prediction_structured = self._canonicalize_navqa_answer(
                        prediction_structured,
                        question,
                        expected_type=expected_answer_type,
                    )
                    return {"answer": prediction_structured.get("text") or raw_answer}
                return {"answer": raw_answer}

            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"Unknown tool '{tool_name}'. Use search_by_target, search_by_position, "
                        "search_by_time, or add_answer_node. "
                        "Use summarize_intermediate_node only immediately after a search "
                        "result is returned."
                    ),
                }
            )

        return {"answer": None}

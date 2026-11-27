from __future__ import annotations

import bisect
import re
from datetime import datetime, time, timedelta, timezone, tzinfo
from vimrobo.memory.index import number
import math
from typing import Any

from .timezone import format_local_timestamp, format_video_timestamp


def load_query_trajectory_context(
    sample_or_sequence: dict[str, Any] | str | int,
    start_time: float | None = None,
    end_time: float | None = None,
    points: list[list[float]] | None = None,
    rdp_epsilon_m: float = 2.0,
    min_step_m: float = 0.2,
    min_turn_angle_deg: float = 30.0,
    min_turn_segment_m: float = 1.0,
    merge_turns_within_s: float = 3.0,
    merge_turns_within_m: float = 2.0,
    max_keypoints: int = 16,
) -> dict[str, Any]:
    """Load one sequence track and compute a compact route/turn sketch for a query window."""
    sequence, start_time, end_time = _resolve_query_args(sample_or_sequence, start_time, end_time)
    if sequence is None:
        return {"error": "missing_sequence"}

    raw_points = points
    if not raw_points:
        return {"sequence": str(sequence), "error": "empty_track"}

    times = [point[0] for point in raw_points]
    start_time = times[0] if start_time is None else float(start_time)
    end_time = times[-1] if end_time is None else float(end_time)
    if end_time < start_time:
        start_time, end_time = end_time, start_time

    left = max(0, bisect.bisect_left(times, start_time) - 1)
    right = min(len(raw_points), bisect.bisect_right(times, end_time) + 1)
    points = _drop_small_steps(raw_points[left:right], min_step_m=min_step_m)
    if len(points) < 2:
        return {
            "sequence": str(sequence),
            "time_window": {"start": start_time, "end": end_time},
            "point_count": len(points),
            "error": "not_enough_points",
        }

    path_length = _path_length(points)
    net_displacement = _distance(points[0], points[-1])
    straightness = net_displacement / path_length if path_length > 1e-9 else 0.0

    keypoints = _rdp_points(points, epsilon=max(0.0, float(rdp_epsilon_m)))
    epsilon = float(rdp_epsilon_m)
    while max_keypoints > 1 and len(keypoints) > max_keypoints:
        epsilon *= 1.5
        keypoints = _rdp_points(points, epsilon=epsilon)

    turn_events = _turn_events(
        keypoints,
        min_angle_deg=min_turn_angle_deg,
        min_segment_m=min_turn_segment_m,
        merge_within_s=merge_turns_within_s,
        merge_within_m=merge_turns_within_m,
    )

    return {
        "sequence": str(sequence),
        "time_window": {"start": round(start_time, 6), "end": round(end_time, 6)},
        "point_count": len(points),
        "start": _point_obj(points[0]),
        "current": _point_obj(points[-1]),
        "path_length_m": round(path_length, 3),
        "net_displacement_m": round(net_displacement, 3),
        "straightness": round(straightness, 3),
        "coarse_direction": _direction(points[0], points[-1]),
        "route_keypoints": [_point_obj(point) for point in keypoints],
        "route_segments": [
            {
                "from_t": round(a[0], 6),
                "to_t": round(b[0], 6),
                "from_xy": _xy(a),
                "to_xy": _xy(b),
                "length_m": round(_distance(a, b), 3),
                "direction": _direction(a, b),
            }
            for a, b in zip(keypoints, keypoints[1:])
        ],
        "turn_events": turn_events,
    }


def load_query_trajectory_pattern(
    sample_or_sequence: dict[str, Any] | str | int,
    start_time: float | None = None,
    end_time: float | None = None,
    points: list[list[float]] | None = None,
    max_segments: int = 10,
    include_xy: bool = True,
    **context_kwargs: Any,
) -> str:
    """Return a short English route sentence focused on turns and distance."""
    context_kwargs.setdefault("max_keypoints", max(2, int(max_segments) + 1))
    context = load_query_trajectory_context(
        sample_or_sequence,
        start_time=start_time,
        end_time=end_time,
        points=points,
        **context_kwargs,
    )
    if context.get("error"):
        return ""

    segments = [
        segment
        for segment in context.get("route_segments", [])
        if float(segment.get("length_m") or 0.0) >= 0.5
    ]
    if not segments:
        window = context.get("time_window") or {}
        start_text = _format_track_time(window.get("start"))
        end_text = _format_track_time(window.get("end"))
        return f"From {start_text} to {end_text}, the robot was nearly stationary."

    turn_events = context.get("turn_events", [])
    phrases: list[str] = []
    for index, segment in enumerate(segments[:max_segments]):
        start_text = _format_track_time(segment.get("from_t"))
        distance = _format_meters(float(segment.get("length_m") or 0.0))
        xy_text = _segment_xy_text(segment) if include_xy else ""

        if index == 0:
            phrases.append(f"Starting at {start_text}{xy_text}, moved about {distance}")
            continue

        turn = _matching_turn(turn_events, segment.get("from_t"))
        if turn is None:
            phrases.append(f"at {start_text}{xy_text}, continued about {distance}")
        else:
            turn_text = _turn_phrase_en(turn)
            phrases.append(f"at {start_text}{xy_text}, {turn_text} and continued about {distance}")

    if len(segments) > max_segments:
        last = segments[-1]
        phrases.append(f"then continued along the route until {_format_track_time(last.get('to_t'))}")

    current = context.get("current") or {}
    current_time = _format_track_time(current.get("t"))
    if current_time:
        phrases.append(f"finally reached the current point at {current_time}{_point_xy_text(current)}")

    return "; ".join(phrases) + "."


def _resolve_query_args(
    sample_or_sequence: dict[str, Any] | str | int,
    start_time: float | None,
    end_time: float | None,
) -> tuple[str | None, float | None, float | None]:
    if not isinstance(sample_or_sequence, dict):
        return str(sample_or_sequence), start_time, end_time

    sample = sample_or_sequence
    sequence = None
    for key in ("video_name", "video", "seq_id", "seq", "sequence"):
        value = sample.get(key)
        if value is not None and str(value) != "":
            sequence = value
            break
    if start_time is None:
        start_time = _first_float(
            sample.get("start_time_seconds"),
            sample.get("query_start_time"),
            sample.get("start_time"),
        )
    if end_time is None:
        end_time = _first_float(
            sample.get("end_time_seconds"),
            sample.get("query_end_time"),
            sample.get("end_time"),
        )
    bounds = sample.get("time_reference_seconds")
    if isinstance(bounds, (list, tuple)) and len(bounds) >= 2:
        start_time = _as_float(bounds[0]) if start_time is None else start_time
        end_time = _as_float(bounds[1]) if end_time is None else end_time
    return str(sequence) if sequence is not None else None, start_time, end_time


def _rdp_points(points: list[list[float]], epsilon: float) -> list[list[float]]:
    if len(points) <= 2:
        return points[:]
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue
        split, max_dist = None, -1.0
        for index in range(start + 1, end):
            dist = _perpendicular_distance(points[index], points[start], points[end])
            if dist > max_dist:
                split, max_dist = index, dist
        if split is not None and max_dist > epsilon:
            keep.add(split)
            stack.append((start, split))
            stack.append((split, end))
    return [points[index] for index in sorted(keep)]


def _turn_events(
    keypoints: list[list[float]],
    min_angle_deg: float,
    min_segment_m: float,
    merge_within_s: float,
    merge_within_m: float,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for before, point, after in zip(keypoints, keypoints[1:], keypoints[2:]):
        len_before = _distance(before, point)
        len_after = _distance(point, after)
        if len_before < min_segment_m or len_after < min_segment_m:
            continue
        angle = _signed_angle(before, point, after)
        angle_deg = math.degrees(angle)
        if abs(angle_deg) < min_angle_deg:
            continue
        event = {
            "t": round(point[0], 6),
            "xy": _xy(point),
            "direction": "left" if angle_deg > 0 else "right",
            "angle_deg": round(abs(angle_deg), 1),
            "strength": _turn_strength(abs(angle_deg)),
        }
        close_in_time = events and abs(event["t"] - events[-1]["t"]) <= merge_within_s
        close_in_space = events and (
            math.hypot(
                event["xy"][0] - events[-1]["xy"][0],
                event["xy"][1] - events[-1]["xy"][1],
            )
            <= merge_within_m
        )
        if close_in_time and close_in_space:
            if event["angle_deg"] > events[-1]["angle_deg"]:
                events[-1] = event
        else:
            events.append(event)
    return events


def _drop_small_steps(points: list[list[float]], min_step_m: float) -> list[list[float]]:
    if not points:
        return []
    kept = [points[0]]
    for point in points[1:-1]:
        if _distance(kept[-1], point) >= min_step_m:
            kept.append(point)
    if len(points) > 1 and points[-1] != kept[-1]:
        kept.append(points[-1])
    return kept


def _path_length(points: list[list[float]]) -> float:
    return sum(_distance(a, b) for a, b in zip(points, points[1:]))


def _distance(a: list[float], b: list[float]) -> float:
    return math.hypot(b[1] - a[1], b[2] - a[2])


def _perpendicular_distance(point: list[float], start: list[float], end: list[float]) -> float:
    sx, sy = start[1], start[2]
    ex, ey = end[1], end[2]
    px, py = point[1], point[2]
    dx, dy = ex - sx, ey - sy
    denom = math.hypot(dx, dy)
    if denom < 1e-9:
        return math.hypot(px - sx, py - sy)
    return abs(dy * px - dx * py + ex * sy - ey * sx) / denom


def _signed_angle(before: list[float], point: list[float], after: list[float]) -> float:
    v1x, v1y = point[1] - before[1], point[2] - before[2]
    v2x, v2y = after[1] - point[1], after[2] - point[2]
    return math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y)


def _direction(a: list[float], b: list[float]) -> str:
    dx, dy = b[1] - a[1], b[2] - a[2]
    if math.hypot(dx, dy) < 1e-6:
        return "stationary"
    labels = [
        "east",
        "northeast",
        "north",
        "northwest",
        "west",
        "southwest",
        "south",
        "southeast",
    ]
    index = int(round((math.degrees(math.atan2(dy, dx)) % 360) / 45.0)) % 8
    return labels[index]


def _turn_strength(angle_deg: float) -> str:
    if angle_deg >= 100.0:
        return "sharp"
    if angle_deg >= 45.0:
        return "clear"
    return "slight"


def _format_track_time(value: Any) -> str:
    timestamp = _as_float(value)
    if timestamp is None:
        return ""
    if abs(timestamp) >= 24 * 3600:
        return format_local_timestamp(timestamp)
    return format_video_timestamp(timestamp)


def _format_meters(value: float) -> str:
    if value >= 10.0:
        return f"{value:.0f} m"
    return f"{value:.1f} m"


def _turn_phrase_en(turn: dict[str, Any]) -> str:
    angle = float(turn.get("angle_deg") or 0.0)
    direction = str(turn.get("direction") or "").strip().lower()
    if angle >= 135.0:
        return "made a U-turn"
    if direction not in {"left", "right"}:
        return "changed course"
    if angle >= 100.0:
        return f"made a sharp {direction} turn"
    return f"turned {direction}"


def _matching_turn(turn_events: list[dict[str, Any]], timestamp: Any) -> dict[str, Any] | None:
    target = _as_float(timestamp)
    if target is None:
        return None
    best: dict[str, Any] | None = None
    best_delta = float("inf")
    for event in turn_events:
        event_time = _as_float(event.get("t"))
        if event_time is None:
            continue
        delta = abs(event_time - target)
        if delta < best_delta:
            best = event
            best_delta = delta
    return best if best_delta <= 1e-3 else None


def _segment_xy_text(segment: dict[str, Any]) -> str:
    xy = segment.get("from_xy")
    if not isinstance(xy, list) or len(xy) < 2:
        return ""
    return f" at [{float(xy[0]):.2f}, {float(xy[1]):.2f}]"


def _point_xy_text(point: dict[str, Any]) -> str:
    xy = point.get("xy")
    if not isinstance(xy, list) or len(xy) < 2:
        return ""
    return f" at [{float(xy[0]):.2f}, {float(xy[1]):.2f}]"


def _point_obj(point: list[float]) -> dict[str, Any]:
    return {"t": round(point[0], 6), "xy": _xy(point)}


def _xy(point: list[float]) -> list[float]:
    return [round(point[1], 3), round(point[2], 3)]


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_float(*values: Any) -> float | None:
    for value in values:
        parsed = _as_float(value)
        if parsed is not None:
            return parsed
    return None


def _as_float_list(value: Any) -> list[float] | None:
    if value is None:
        return None
    try:
        return [float(item) for item in value]
    except (TypeError, ValueError):
        return None


def parse_time(value, reference: float | None, zone: tzinfo = timezone.utc) -> float:
    """Resolve a clock to the day nearest the reference on the recording timeline."""
    try:
        return number(value)
    except ValueError:
        if not isinstance(value, str):
            raise
    if re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?", value.strip()):
        clock = value.strip().split(":")
        seconds = float(clock[2]) if len(clock) == 3 else 0.0
        hour, minute = int(clock[0]), int(clock[1])
        if hour > 23 or minute > 59 or seconds >= 60:
            raise ValueError(f"invalid clock reading {value!r}")
        offset = hour * 3600 + minute * 60 + seconds
        if reference is None:
            return offset
        if abs(reference) >= 100_000_000:
            day = datetime.fromtimestamp(reference, zone).date()
            base = datetime.combine(day, time(hour, minute), tzinfo=zone) + timedelta(seconds=seconds)
            candidates = [(base + timedelta(days=delta)).timestamp() for delta in (0, -1, 1)]
        else:
            base = math.floor(reference / 86400) * 86400 + offset
            candidates = [base, base - 86400, base + 86400]
        return min(candidates, key=lambda timestamp: abs(timestamp - reference))
    try:
        stamp = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"invalid timestamp {value!r}; use seconds, HH:MM:SS, or ISO 8601") from error
    return (stamp if stamp.tzinfo is not None else stamp.replace(tzinfo=zone)).timestamp()

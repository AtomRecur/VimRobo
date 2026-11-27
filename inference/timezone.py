import datetime
import re
from typing import Any


LOCAL_TZ = datetime.timezone(datetime.timedelta(hours=-6))
LOCAL_TIME_BENCHMARKS = {"coda", "navqa", "oc_navqa", "nav_benchmark"}
HMS_RE = re.compile(r"^(?P<h>\d{1,2}):(?P<m>\d{2}):(?P<s>\d{2})(?:\.\d+)?$")


def uses_local_timezone(benchmark: object) -> bool:
    value = str(benchmark or "").lower()
    return any(name in value for name in LOCAL_TIME_BENCHMARKS)


def canonical_benchmark(benchmark: Any) -> str | None:
    value = str(benchmark or "").strip()
    if not value:
        return None
    lowered = value.lower()
    # ``nav_benchmark`` is a shared carrier containing both the coda and
    # coda_full sequence ranges.  Keep it distinct from ``coda``: the memory
    # server uses this value as an exact shard filter.
    if "nav_benchmark" in lowered or "nav-benchmark" in lowered or "nav benchmark" in lowered:
        return "nav_benchmark"
    if "coda_full" in lowered or "coda-full" in lowered or "coda full" in lowered:
        return "coda_full"
    if any(name in lowered for name in LOCAL_TIME_BENCHMARKS):
        return "coda"
    known = {
        "lvbench": "LVBench",
        "streamingbench": "StreamingBench",
        "videomme": "VideoMME",
    }
    for key, canonical in known.items():
        if key in lowered:
            return canonical
    return value


def parse_hms_seconds(value: str) -> float | None:
    match = HMS_RE.match(value.strip())
    if not match:
        return None
    hours = int(match.group("h"))
    minutes = int(match.group("m"))
    seconds = int(match.group("s"))
    return float(hours * 3600 + minutes * 60 + seconds)


def coerce_timestamp(
    value: Any,
    benchmark: Any = None,
    reference_time: Any = None,
) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        pass

    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    hms_seconds = parse_hms_seconds(text)
    if hms_seconds is not None:
        if uses_local_timezone(benchmark):
            try:
                ref_dt = datetime.datetime.fromtimestamp(float(reference_time), tz=LOCAL_TZ)
            except (TypeError, ValueError):
                return None
            hours, remainder = divmod(int(hms_seconds), 3600)
            minutes, seconds = divmod(remainder, 60)
            dt = datetime.datetime.combine(
                ref_dt.date(),
                datetime.time(hours, minutes, seconds),
                tzinfo=LOCAL_TZ,
            )
            return dt.timestamp()
        return hms_seconds

    try:
        dt = datetime.datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        if not uses_local_timezone(benchmark):
            return None
        dt = dt.replace(tzinfo=LOCAL_TZ)
    return dt.timestamp()


def seconds_since_midnight(timestamp: float) -> float:
    dt = datetime.datetime.fromtimestamp(float(timestamp), tz=LOCAL_TZ)
    return float(dt.hour * 3600 + dt.minute * 60 + dt.second)


def format_local_timestamp(timestamp: float, include_date: bool = False) -> str:
    fmt = "%Y-%m-%d %H:%M:%S" if include_date else "%H:%M:%S"
    return datetime.datetime.fromtimestamp(float(timestamp), tz=LOCAL_TZ).strftime(fmt)


def format_video_timestamp(timestamp: float) -> str:
    total_seconds = int(round(float(timestamp)))
    sign = "-" if total_seconds < 0 else ""
    total_seconds = abs(total_seconds)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{sign}{hours:02d}:{minutes:02d}:{seconds:02d}"

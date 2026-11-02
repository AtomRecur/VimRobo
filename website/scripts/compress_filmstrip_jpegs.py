"""Generate smaller, full-frame progressive JPGs for both filmstrip densities.

Run after optimize_case_jpegs.py. Source photos and the previous image URLs are
retained for cached pages. Requires Pillow; never recompresses a thumbnail.
"""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from PIL import Image
from optimize_case_jpegs import WEBSITE, error_metrics, selected_ids


def compress(source: Path, manifest: Path) -> dict:
    ids = selected_ids(manifest)
    destination = source / "filmstrip-v2"
    destination.mkdir(exist_ok=True)
    report = {}
    for name, width, quality, suffix, previous in [
        ("standard", 320, 76, "", source / "filmstrip"),
        ("highDensity", 400, 74, "-400", source),
    ]:
        frames = []
        for identifier in ids:
            output = destination / f"{identifier}{suffix}.jpg"
            with Image.open(source / f"{identifier}.jpg") as original:
                original = original.convert("RGB")
                if original.width < width:
                    raise ValueError(f"Source frame is too small: {identifier}")
                resized = original.resize((width, round(original.height * width / original.width)), Image.Resampling.LANCZOS)
                resized.save(output, format="JPEG", quality=quality, subsampling=2, optimize=True, progressive=True)
                with Image.open(output) as encoded:
                    metrics = error_metrics(resized, encoded.convert("RGB"))
            frames.append({"file": output.name, "beforeBytes": (previous / f"{identifier}.jpg").stat().st_size,
                           "afterBytes": output.stat().st_size, **metrics})
        before = sum(frame["beforeBytes"] for frame in frames)
        after = sum(frame["afterBytes"] for frame in frames)
        sizes = [frame["afterBytes"] for frame in frames]
        report[name] = {"count": len(frames), "width": width, "quality": quality,
                        "beforeBytes": before, "afterBytes": after, "savedPercent": 100 * (1 - after / before),
                        "minBytes": min(sizes), "medianBytes": statistics.median(sizes), "maxBytes": max(sizes), "frames": frames}
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=WEBSITE / "public" / "cases")
    parser.add_argument("--manifest", type=Path, default=WEBSITE / "src" / "data" / "evidenceFilmstrip.json")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = compress(args.source, args.manifest)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({name: {key: value for key, value in item.items() if key != "frames"}
                      for name, item in result.items()}, indent=2))

"""Optimize evidence JPGs without changing their pixels, then make filmstrip thumbnails.

Requires Pillow and jpegtran. Originals use lossless DCT transcoding; thumbnails
preserve the entire frame and use progressive JPEG at quality 86 by default.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import statistics
import subprocess
import tempfile

from PIL import Image, ImageChops, ImageStat


WEBSITE = Path(__file__).resolve().parent.parent


def selected_ids(manifest: Path) -> list[str]:
    data = json.loads(manifest.read_text(encoding="utf-8"))
    ids = list(dict.fromkeys(frame["evidenceId"] for case in data["cases"] for frame in case["frames"]))
    if any(not isinstance(value, str) or Path(value).name != value or value in (".", "..") for value in ids):
        raise ValueError("Every evidence ID must be a filename stem, without directories.")
    return ids


def error_metrics(reference: Image.Image, encoded: Image.Image) -> dict:
    statistics = ImageStat.Stat(ImageChops.difference(reference, encoded))
    mse = sum(value * value for value in statistics.rms) / 3
    return {
        "meanAbsoluteError": sum(statistics.mean) / 3,
        "psnrDb": 10 * math.log10(255 * 255 / mse) if mse else None,
    }


def optimize(source: Path, manifest: Path, jpegtran: str, width: int, quality: int) -> dict:
    ids = selected_ids(manifest)
    files = sorted(source.glob("*.jpg"))
    if not files:
        raise ValueError(f"No source JPG files found in {source}")
    if any(not (source / f"{value}.jpg").is_file() for value in ids):
        raise ValueError("The filmstrip manifest references a missing source JPG.")
    originals = []
    with tempfile.TemporaryDirectory(prefix="vimrobo-jpeg-") as temporary:
        candidate = Path(temporary) / "optimized.jpg"
        for path in files:
            before = path.stat().st_size
            subprocess.run([jpegtran, "-copy", "none", "-optimize", "-progressive", "-outfile", str(candidate), str(path)], check=True)
            with Image.open(path) as old, Image.open(candidate) as new:
                if old.size != new.size or old.convert("RGB").tobytes() != new.convert("RGB").tobytes():
                    raise ValueError(f"Lossless optimization altered decoded pixels: {path.name}")
            if candidate.stat().st_size <= before:
                shutil.copyfile(candidate, path)
            originals.append({"file": path.name, "beforeBytes": before, "afterBytes": path.stat().st_size})
    destination = source / "filmstrip"
    destination.mkdir(exist_ok=True)
    thumbnails = []
    for value in ids:
        path, output = source / f"{value}.jpg", destination / f"{value}.jpg"
        with Image.open(path) as original:
            original = original.convert("RGB")
            size = (min(width, original.width), round(original.height * min(width, original.width) / original.width))
            resized = original.resize(size, Image.Resampling.LANCZOS)
            resized.save(output, format="JPEG", quality=quality, subsampling=2, optimize=True, progressive=True)
            with Image.open(output) as encoded:
                metrics = error_metrics(resized, encoded.convert("RGB"))
        thumbnails.append({
            "file": output.name, "sourceBytes": path.stat().st_size, "thumbnailBytes": output.stat().st_size,
            "width": size[0], "height": size[1], "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), **metrics,
        })
    original_before = sum(item["beforeBytes"] for item in originals)
    original_after = sum(item["afterBytes"] for item in originals)
    selected_before = sum(item["sourceBytes"] for item in thumbnails)
    selected_after = sum(item["thumbnailBytes"] for item in thumbnails)
    originals_by_name = {item["file"]: item for item in originals}
    selected_initial = sum(originals_by_name[item["file"]]["beforeBytes"] for item in thumbnails)
    psnr_values = [item["psnrDb"] for item in thumbnails if item["psnrDb"] is not None]
    return {
        "originalCount": len(originals), "originalBeforeBytes": original_before,
        "originalAfterBytes": original_after, "originalSavedBytes": original_before - original_after,
        "originalDecodedPixelsIdentical": True,
        "thumbnailCount": len(thumbnails), "thumbnailWidth": width, "thumbnailQuality": quality,
        "selectedOptimizedOriginalBytes": selected_before, "thumbnailTotalBytes": selected_after,
        "thumbnailSavedPercent": 100 * (selected_before - selected_after) / selected_before if selected_before else 0,
        "selectedOriginalBeforeBytes": selected_initial,
        "selectedEndToEndSavedPercent": 100 * (selected_initial - selected_after) / selected_initial if selected_initial else 0,
        "thumbnailMinBytes": min((item["thumbnailBytes"] for item in thumbnails), default=0),
        "thumbnailMedianBytes": statistics.median(item["thumbnailBytes"] for item in thumbnails) if thumbnails else 0,
        "thumbnailMaxBytes": max((item["thumbnailBytes"] for item in thumbnails), default=0),
        "thumbnailMeanPsnrDb": statistics.mean(psnr_values) if psnr_values else None,
        "thumbnailMinPsnrDb": min(psnr_values, default=None),
        "thumbnailMeanAbsoluteError": statistics.mean(item["meanAbsoluteError"] for item in thumbnails) if thumbnails else 0,
        "originals": originals, "thumbnails": thumbnails,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=WEBSITE / "public" / "cases")
    parser.add_argument("--manifest", type=Path, default=WEBSITE / "src" / "data" / "evidenceFilmstrip.json")
    parser.add_argument("--jpegtran", default=shutil.which("jpegtran"))
    parser.add_argument("--width", type=int, default=320)
    parser.add_argument("--quality", type=int, default=86)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if not args.jpegtran:
        parser.error("jpegtran is required for lossless original optimization.")
    if args.width < 1 or not 1 <= args.quality <= 95:
        parser.error("Use a positive width and a JPEG quality from 1 to 95.")
    report = optimize(args.source, args.manifest, args.jpegtran, args.width, args.quality)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in ("originals", "thumbnails")}, indent=2))


if __name__ == "__main__":
    main()

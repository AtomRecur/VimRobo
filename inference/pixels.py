"""Deterministic weighted pixel allocation for historical evidence frames."""

from collections import Counter
from math import ceil, floor, isfinite, sqrt
from typing import Any


def allocate_adaptive_pixel_budget(
    images: list[dict[str, Any]],
    global_budget: int,
    min_pixels: int = 64 * 32 * 32,
) -> list[dict[str, Any]]:
    """Return allocations in input order; dropped images have zero pixels/size.

    Each image supplies width, height, node_id, node_weight and semantic_gate.
    Node weights are divided by that node's eligible image count *before* any
    budget eviction. Equal-weight eviction preserves earlier input images.
    Integer dimensions approximate the source aspect ratio; minimum sizes round
    up, so even the actual resized images satisfy the minimum. allocated_pixels
    is a budget ceiling, and target_size never exceeds it or the source size.
    """
    if global_budget < 0 or min_pixels < 1:
        raise ValueError("global_budget must be nonnegative and min_pixels positive")
    result = [{"allocated_pixels": 0, "target_size": None} for _ in images]
    eligible = [i for i, image in enumerate(images) if image["semantic_gate"]]
    counts = Counter(images[i]["node_id"] for i in eligible)
    sizes, minima, caps, weights = {}, {}, {}, {}
    for i in eligible:
        image = images[i]
        width, height = int(image["width"]), int(image["height"])
        weight = float(image["node_weight"])
        if min(width, height) < 1 or not isfinite(weight) or weight <= 0:
            raise ValueError("Image dimensions and node weights must be positive")
        caps[i] = width * height
        scale = sqrt(min(min_pixels, caps[i]) / caps[i])
        sizes[i] = (min(width, ceil(width * scale)), min(height, ceil(height * scale)))
        minima[i] = sizes[i][0] * sizes[i][1]
        weights[i] = min(weight, 5.0) / counts[image["node_id"]]

    retained = set(eligible)
    required = sum(minima.values())
    for i in sorted(eligible, key=lambda i: (weights[i], -i)):
        if required <= global_budget:
            break
        retained.remove(i)
        required -= minima[i]
    allocated = {i: minima[i] for i in sorted(retained)}
    remaining = min(global_budget, sum(caps[i] for i in retained)) - required
    active = [i for i in allocated if allocated[i] < caps[i]]
    while remaining > 0 and active:
        total_weight = sum(weights[i] for i in active)
        shares = {i: remaining * weights[i] / total_weight for i in active}
        saturated = [i for i in active if caps[i] - allocated[i] <= shares[i]]
        if saturated:
            for i in saturated:
                extra = caps[i] - allocated[i]
                allocated[i] += extra
                remaining -= extra
            active = [i for i in active if allocated[i] < caps[i]]
            continue
        extras = {i: floor(shares[i]) for i in active}
        # Largest remainders, then input order, make integer allocation stable.
        order = sorted(active, key=lambda i: (-(shares[i] - extras[i]), i))
        for i in order[:remaining - sum(extras.values())]:
            extras[i] += 1
        for i in active:
            allocated[i] += extras[i]
        remaining = 0

    for i, pixels in allocated.items():
        width, height = int(images[i]["width"]), int(images[i]["height"])
        scale = sqrt(pixels / caps[i])
        min_width, min_height = sizes[i]
        target_width = min(width, max(min_width, floor(width * scale)))
        target_height = min(height, max(min_height, floor(height * scale)))
        # Rounding near the minimum can raise one dimension; keep the ceiling.
        target_width = max(min_width, min(target_width, pixels // target_height))
        target_height = min(target_height, pixels // target_width)
        result[i] = {"allocated_pixels": pixels, "target_size": (target_width, target_height)}
    return result

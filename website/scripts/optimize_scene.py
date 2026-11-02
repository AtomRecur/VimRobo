#!/usr/bin/env python3
"""Build deterministic, measured-data-only web assets for capture-dense.

Requires NumPy and Pillow. Run from any directory with:
    python3 website/scripts/optimize_scene.py

The originals are never modified. VPC1 is gzip-compressed and little-endian:
  0: magic 'VPC1'; 4: uint32 count; 8: uint32 flags (RGB=1, delta=2)
 12: float32 minimum XYZ; 24: float32 step XYZ; 36: planar uint16 XYZ
Each coordinate plane contains modulo-65536 deltas, starting from zero.
Original interleaved uint8 RGB follows the three planes when flag 1 is set.
Decode each plane with a modulo-65536 prefix sum, then min + value * step.

Morton sorting improves locality; reduced levels select evenly across that
whole ordering. Every selected coordinate and color comes from the originals.
Every emitted point is decoded and checked, including Float32 buffer rounding.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image


HEADER = struct.Struct('<4sII6f')
COLOR_FLAG = 1
DELTA_FLAG = 2
ERROR_EPSILON = 1e-6
MAX_DISPLAY_ERROR = 0.0002


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def spread_bits(values: np.ndarray) -> np.ndarray:
    """Spread 16 coordinate bits into every third bit of a uint64."""
    values = values.astype(np.uint64)
    for shift, mask in (
        (32, 0x001F00000000FFFF),
        (16, 0x001F0000FF0000FF),
        (8, 0x100F00F00F00F00F),
        (4, 0x10C30C30C30C30C3),
        (2, 0x1249249249249249),
    ):
        values = (values | (values << np.uint64(shift))) & np.uint64(mask)
    return values


def evenly_spaced_indices(total: int, count: int) -> np.ndarray:
    if count < 2 or count > total:
        raise ValueError(f'Cannot select {count} points from {total}')
    # Integer arithmetic makes the sampling deterministic and includes both ends.
    return np.arange(count, dtype=np.int64) * (total - 1) // (count - 1)


def read_cloud(source: Path, position_name: str, color_name: str | None):
    positions = np.fromfile(source / position_name, dtype='<f4').reshape(-1, 3)
    if not len(positions) or not np.isfinite(positions).all():
        raise ValueError(f'{position_name} must contain finite XYZ positions')
    colors = None
    if color_name:
        colors = np.fromfile(source / color_name, dtype=np.uint8).reshape(-1, 3)
        if len(colors) != len(positions):
            raise ValueError('Every color must correspond to a measured point')
    minimum = positions.min(axis=0).astype('<f4')
    maximum = positions.max(axis=0).astype('<f4')
    step = ((maximum.astype(np.float64) - minimum) / 65535).astype('<f4')
    # A constant axis has value zero and reconstructs exactly at its minimum.
    divisor = np.where(step > 0, step, 1).astype(np.float64)
    quantized = np.rint((positions.astype(np.float64) - minimum) / divisor)
    quantized = np.clip(quantized, 0, 65535).astype('<u2')
    morton = spread_bits(quantized[:, 0])
    morton |= spread_bits(quantized[:, 1]) << np.uint64(1)
    morton |= spread_bits(quantized[:, 2]) << np.uint64(2)
    order = np.argsort(morton, kind='stable')
    return positions, colors, minimum, maximum, step, quantized, order


def gzip_bytes(data: bytes) -> bytes:
    # No filename or timestamp, and GzipFile writes a platform-independent OS byte.
    output = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=output, compresslevel=9, mtime=0) as stream:
        stream.write(data)
    return output.getvalue()


def decode_cloud(path: Path):
    raw = gzip.decompress(path.read_bytes())
    magic, count, flags, *bounds = HEADER.unpack_from(raw)
    if magic != b'VPC1' or flags & ~3 or not flags & DELTA_FLAG:
        raise ValueError('Invalid VPC1 header')
    expected = HEADER.size + count * (9 if flags & COLOR_FLAG else 6)
    if len(raw) != expected:
        raise ValueError(f'Incorrect decoded length: {len(raw)} != {expected}')
    deltas = np.frombuffer(raw, dtype='<u2', count=count * 3, offset=HEADER.size)
    values = (np.cumsum(deltas.reshape(3, count), axis=1, dtype=np.uint64) & 65535).T
    minimum, step = np.array(bounds[:3]), np.array(bounds[3:])
    # Match JavaScript Number arithmetic followed by a Float32Array assignment.
    positions = (minimum + values.astype(np.float64) * step).astype('<f4')
    colors = None
    if flags & COLOR_FLAG:
        colors = np.frombuffer(raw, dtype=np.uint8, offset=HEADER.size + count * 6).reshape(-1, 3)
    return positions, colors, len(raw)


def write_level(output: Path, name: str, cloud, count: int, point_size: float,
                position_name: str, color_name: str | None) -> dict:
    positions, colors, minimum, maximum, step, quantized, order = cloud
    selected = order[evenly_spaced_indices(len(order), count)]
    selected_values = quantized[selected]
    deltas = selected_values.T.copy()
    deltas[:, 1:] = np.subtract(selected_values[1:].T, selected_values[:-1].T, dtype=np.uint16)
    flags = DELTA_FLAG | (COLOR_FLAG if colors is not None else 0)
    header = HEADER.pack(b'VPC1', count, flags, *minimum, *step)
    raw = header + deltas.astype('<u2', copy=False).tobytes(order='C')
    if colors is not None:
        raw += colors[selected].tobytes(order='C')
    path = output / f'{name}.vpc.gz'
    path.write_bytes(gzip_bytes(raw))

    decoded_positions, decoded_colors, raw_bytes = decode_cloud(path)
    error = np.abs(decoded_positions.astype(np.float64) - positions[selected])
    max_axis_error = error.max(axis=0)
    tolerance = step.astype(np.float64) / 2 + ERROR_EPSILON
    if not np.all(max_axis_error <= tolerance):
        raise ValueError(f'{name}: coordinate error exceeds half-step plus epsilon')
    if float(max_axis_error.max()) >= MAX_DISPLAY_ERROR:
        raise ValueError(f'{name}: coordinate error exceeds display-unit limit')
    if colors is not None and not np.array_equal(decoded_colors, colors[selected]):
        raise ValueError(f'{name}: original RGB values changed')
    if len(np.unique(selected)) != count:
        raise ValueError(f'{name}: duplicate source indices')
    samples = []
    for encoded_index in evenly_spaced_indices(count, min(9, count)):
        original_index = int(selected[encoded_index])
        sample = {'encodedIndex': int(encoded_index), 'originalIndex': original_index,
                  'sourcePosition': positions[original_index].tolist()}
        if colors is not None:
            sample['sourceColor'] = colors[original_index].tolist()
        samples.append(sample)

    original_bytes = count * (15 if colors is not None else 12)
    descriptor = {
        'file': path.name,
        'points': count,
        'pointSize': point_size,
        'bytes': path.stat().st_size,
        'uncompressedBytes': raw_bytes,
        'sourceEquivalentBytes': original_bytes,
        'bytesSaved': original_bytes - path.stat().st_size,
        'sha256': sha256(path),
        'verification': {
            'sourcePositionsFile': f'../{position_name}',
            'sourceColorsFile': f'../{color_name}' if color_name else None,
            'sourcePointCount': len(positions),
            'allPointsChecked': True,
            'allSourcePointsRetained': count == len(positions),
            'colorsExact': True if colors is not None else None,
            'minimum': minimum.tolist(),
            'maximum': maximum.tolist(),
            'step': step.tolist(),
            'maxAxisError': max_axis_error.tolist(),
            'maxCoordinateError': float(max_axis_error.max()),
            'errorEpsilon': ERROR_EPSILON,
            'positionPlaneOffsets': [HEADER.size + axis * count * 2 for axis in range(3)],
            'colorsOffset': HEADER.size + count * 6 if colors is not None else None,
            'samples': samples,
        },
    }
    color_check = ', original RGB exact' if colors is not None else ''
    print(f'{name}: {count:,} points, {path.stat().st_size:,} bytes, '
          f'max error {max_axis_error.max():.9f}{color_check}', flush=True)
    return descriptor


def write_maps(source: Path, output: Path, name: str) -> dict:
    with Image.open(source / name) as image:
        original = image.convert('RGBA')
    levels = {}
    for level, width, quality in (('preview', 1024, 72), ('mid', 2048, 90), ('full', 4096, 90)):
        height = int(original.height * width / original.width + 0.5)
        resized = original.resize((width, height), Image.Resampling.LANCZOS)
        path = output / f'map-{level}.webp'
        # WebP preserves the resized alpha channel losslessly at every RGB quality.
        resized.save(path, format='WEBP', quality=quality, method=6, exact=True)
        with Image.open(path) as check:
            decoded = check.convert('RGBA')
            if decoded.size != resized.size:
                raise ValueError(f'{path.name}: invalid dimensions')
            if not np.array_equal(np.asarray(decoded.getchannel('A')), np.asarray(resized.getchannel('A'))):
                raise ValueError(f'{path.name}: alpha was not preserved')
        levels[level] = {
            'width': width, 'height': height, 'bytes': path.stat().st_size,
            'sha256': sha256(path), 'alphaExactAfterResize': True,
            'resize': 'Lanczos', 'webpQuality': quality,
        }
        print(f'{path.name}: {width}x{height}, {path.stat().st_size:,} bytes, alpha exact', flush=True)
    return {'preview': 'map-preview.webp', 'mid': 'map-mid.webp', 'full': 'map-full.webp',
            'sourceFile': f'../{name}', 'levels': levels}


def write_poster(source: Path, output: Path, name: str) -> dict:
    with Image.open(source / name) as image:
        original = image.convert('RGB')
    width = 1440
    height = int(original.height * width / original.width + 0.5)
    resized = original.resize((width, height), Image.Resampling.LANCZOS)
    path = output / 'poster.webp'
    resized.save(path, format='WEBP', quality=72, method=6, exact=True)
    with Image.open(path) as check:
        if check.size != resized.size:
            raise ValueError('Poster dimensions do not match the resized original')
    print(f'{path.name}: {width}x{height}, {path.stat().st_size:,} bytes', flush=True)
    return {'sourceFile': f'../{name}', 'width': width, 'height': height,
            'bytes': path.stat().st_size, 'sha256': sha256(path),
            'resize': 'Lanczos', 'webpQuality': 72}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path,
                        default=Path(__file__).resolve().parents[1] / 'public' / 'capture-dense')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    output = (args.output or source / 'optimized-v1').resolve()
    output.mkdir(parents=True, exist_ok=True)
    scene = json.loads((source / 'scene.json').read_text())
    env = scene['environment']
    full_source_names = [env['positionsFile'], env['colorsFile'], scene['positionsFile'], scene['baseMap']]
    source_names = [*full_source_names, scene['preview']]
    source_files = {name: {'file': f'../{name}', 'bytes': (source / name).stat().st_size,
                           'sha256': sha256(source / name)} for name in source_names}
    environment = read_cloud(source, env['positionsFile'], env['colorsFile'])
    scan = read_cloud(source, scene['positionsFile'], None)
    if len(environment[0]) != env['pointCount'] or len(scan[0]) != scene['pointCount']:
        raise ValueError('Source counts do not match scene.json')
    manifest = {
        'version': 1,
        'sourceScene': '../scene.json',
        'format': {
            'magic': 'VPC1', 'compression': 'gzip', 'byteOrder': 'little-endian',
            'headerBytes': HEADER.size, 'countOffset': 4, 'flagsOffset': 8,
            'minimumOffset': 12, 'stepOffset': 24, 'colorsFlag': COLOR_FLAG,
            'deltaPositionsFlag': DELTA_FLAG,
            'positions': 'three planar uint16 axes; modulo-65536 deltas from zero',
            'colors': 'optional interleaved original uint8 RGB',
            'order': 'stable 16-bit XYZ Morton order',
            'sampling': 'evenly spaced Morton indices, including both endpoints',
        },
        'environment': {},
        'scan': {},
    }
    for level, count, size in (('preview', 40_000, .049), ('mobile', 400_000, .016),
                               ('full', env['pointCount'], env['pointSize'])):
        manifest['environment'][level] = write_level(
            output, f'environment-{level}', environment, count, size,
            env['positionsFile'], env['colorsFile'])
    for level, count, size in (('preview', 16_000, .04), ('mid', 80_000, .02), ('full', scene['pointCount'], .009)):
        manifest['scan'][level] = write_level(
            output, f'scan-{level}', scan, count, size, scene['positionsFile'], None)
    manifest['map'] = write_maps(source, output, scene['baseMap'])
    manifest['poster'] = 'poster.webp'
    manifest['posterMetadata'] = write_poster(source, output, scene['preview'])
    descriptors = [*manifest['environment'].values(), *manifest['scan'].values()]
    original_bytes = sum(source_files[name]['bytes'] for name in full_source_names)
    preview_bytes = (manifest['environment']['preview']['bytes'] + manifest['scan']['preview']['bytes']
                     + manifest['map']['levels']['preview']['bytes'])
    full_bytes = (manifest['environment']['full']['bytes'] + manifest['scan']['full']['bytes']
                  + manifest['map']['levels']['full']['bytes'])
    manifest['verification'] = {
        'sourceFiles': source_files,
        'decodedPointsChecked': sum(item['points'] for item in descriptors),
        'fullEnvironmentRetainsEverySourcePoint': True,
        'fullScanRetainsEverySourcePoint': True,
        'allColorBytesExact': True,
        'maxCoordinateError': max(item['verification']['maxCoordinateError'] for item in descriptors),
        'maxAllowedCoordinateError': MAX_DISPLAY_ERROR,
        'originalAssetBytes': original_bytes,
        'previewAssetBytes': preview_bytes,
        'fullDetailAssetBytes': full_bytes,
        'fullDetailBytesSaved': original_bytes - full_bytes,
        'fullDetailSavingsPercent': round(100 * (1 - full_bytes / original_bytes), 2),
    }
    # Ensure this generator did not modify any original asset.
    for name, metadata in source_files.items():
        if sha256(source / name) != metadata['sha256']:
            raise ValueError(f'Original source changed: {name}')
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Full detail: {full_bytes:,} / {original_bytes:,} bytes '
          f'({manifest["verification"]["fullDetailSavingsPercent"]}% saved). '
          f'Preview assets: {preview_bytes:,} bytes.', flush=True)


if __name__ == '__main__':
    main()

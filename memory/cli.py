"""Command-line entry point for building or importing an experience."""

import argparse
from pathlib import Path

import httpx

from .embeddings import BACKENDS, EMBEDDING_URL, QWEN_EMBEDDING, EmbeddingClient, EmbeddingConfig, client
from .index import EMBEDDING_PIXELS, FRAMES_PER_SEGMENT, SEGMENT_SECONDS, build_experience, import_shard, number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="frame JSONL or an original memory shard directory")
    parser.add_argument("output", type=Path, help="output experience .npz")
    parser.add_argument("--frames-dir", type=Path, help="exported image directory for original shards")
    parser.add_argument("--embedding-url", default=EMBEDDING_URL)
    parser.add_argument("--embedding-model", help=f"served model ID (Qwen default: {QWEN_EMBEDDING})")
    parser.add_argument("--embedding-backend", choices=BACKENDS, default="qwen-vl")
    parser.add_argument("--segment-seconds", type=float, default=SEGMENT_SECONDS)
    parser.add_argument("--frames-per-segment", type=int, default=FRAMES_PER_SEGMENT)
    parser.add_argument("--embedding-max-pixels", type=int, default=EMBEDDING_PIXELS)
    parser.add_argument("--no-caption-index", action="store_true")
    parser.add_argument("--timeout", type=float, default=120, help="model request timeout in seconds")
    args = parser.parse_args()
    try:
        if number(args.timeout) <= 0:
            raise ValueError("--timeout must be positive")
        if args.source.is_dir():
            if args.frames_dir is None:
                parser.error("an original memory shard requires --frames-dir")
            experience = import_shard(args.source, args.frames_dir, args.output)
        else:
            if args.embedding_backend == "openai-text" and args.embedding_model is None:
                parser.error("--embedding-model is required with openai-text")
            config = EmbeddingConfig(args.embedding_model or QWEN_EMBEDDING, args.embedding_backend)
            with client(args.embedding_url, "VIMROBO_EMBEDDING_API_KEY", args.timeout) as transport:
                experience = build_experience(
                    args.source, args.output, EmbeddingClient(transport, config),
                    segment_seconds=args.segment_seconds, frames_per_segment=args.frames_per_segment,
                    max_pixels=args.embedding_max_pixels, index_captions=not args.no_caption_index,
                )
    except (OSError, KeyError, ValueError, httpx.HTTPError) as error:
        parser.exit(1, f"VimRobo build: {error}\n")
    channels = [name for name, matrix in (("visual", experience.visual), ("caption", experience.captions))
                if matrix is not None]
    print(f"Saved {len(experience.clips)} clips across {len(experience.sequences)} sequences "
          f"({', '.join(channels)}) to {args.output}")


if __name__ == "__main__":
    main()

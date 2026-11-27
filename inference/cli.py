"""Run VimRobo over one question or a JSONL question set."""

import argparse
import json
import os
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from vimrobo.memory.embeddings import EMBEDDING_URL, EmbeddingClient, client
from vimrobo.memory.index import jsonl, load_experience, number

from .agent import ANSWER_TYPES, InferenceConfig, Question
from .runtime import EvaluationRunner
from .chat import ChatClient

CHAT_MODEL = "AtomRecur/VimRobo-9B"
CHAT_URL = "http://127.0.0.1:8001/v1"
RUN_ERRORS = (OSError, KeyError, ValueError, httpx.HTTPError)
ANSWER_ALIASES = {
    "general": "text", "description": "text", "descriptive": "text",
    "when": "time", "temporal": "time", "how long": "duration", "yes/no": "binary",
    "bool": "binary", "boolean": "binary", "location": "position", "pose": "position",
    "spatial": "position",
}


@contextmanager
def _output(path):
    if path is None:
        yield sys.stdout
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=path.parent) as directory:
        temporary = Path(directory) / "results.jsonl"
        with temporary.open("w", encoding="utf-8") as output:
            yield output
        os.replace(temporary, path)


def _question(row, defaults):
    answer_type = row.get("answer_type", row.get("type", row.get("question_type", defaults.answer_type)))
    if isinstance(answer_type, list):
        answer_type = answer_type[0] if answer_type else defaults.answer_type
    if isinstance(answer_type, str):
        answer_type = answer_type.strip().lower()
        answer_type = ANSWER_ALIASES.get(answer_type, answer_type)
    return Question(
        text=row.get("question") or row.get("query"),
        sequence=row.get("sequence", row.get("seq_id", row.get("video_name", defaults.sequence))),
        start_time=row.get("start_time", row.get("start_time_seconds", defaults.start_time)),
        end_time=row.get("end_time", row.get("end_time_seconds", defaults.end_time)),
        answer_type=answer_type,
        reference_time=row.get("reference_time", row.get("current_time", defaults.reference_time)),
        trajectory_context=row.get("trajectory_context", row.get("trajectory_history_context")),
    )


def _track(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    rows = value.get("points") if isinstance(value, dict) else value
    if not isinstance(rows, list) or any(not isinstance(row, list) or len(row) != 3 for row in rows):
        raise ValueError("track must contain [time, x, y] rows")
    return sorted([number(value) for value in row] for row in rows)


def _run_batch(path, output, run, defaults):
    errors, count = 0, 0
    for line_no, row in jsonl(path):
        count += 1
        try:
            result = run(_question(row, defaults))
        except RUN_ERRORS as error:
            errors += 1
            print(f"{path}:{line_no}: {error}", file=sys.stderr)
            result = {"answer": None}
        output.write(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
    if not count:
        raise ValueError(f"no questions in {path}")
    return count, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experience", type=Path, help="experience .npz produced by vimrobo-build")
    parser.add_argument("question", nargs="?", help="one question")
    parser.add_argument("--questions", type=Path, help="read a JSONL question set")
    parser.add_argument("--output", type=Path, help="write JSON or JSONL to this file")
    parser.add_argument("--sequence", help="sequence ID, required for multi-sequence indexes")
    parser.add_argument("--start-time", help="earliest clip start")
    parser.add_argument("--end-time", help="latest clip end")
    parser.add_argument("--reference-time", help="current time used for relative answers and clock queries")
    parser.add_argument("--timezone", default="Etc/GMT+6", help="IANA time zone for clock readings on Unix time axes")
    parser.add_argument("--track", type=Path, help="optional [time, x, y] track JSON for one sequence")
    parser.add_argument("--answer-type", choices=ANSWER_TYPES)
    parser.add_argument("--base-url", default=CHAT_URL, help="OpenAI-compatible chat API base URL")
    parser.add_argument("--model", default=CHAT_MODEL, help="served reasoning model ID")
    parser.add_argument("--embedding-url", default=EMBEDDING_URL)
    parser.add_argument("--tool-mode", choices=("xml", "native"), default="xml")
    parser.add_argument("--chat-extra", default="{}", help="JSON object of provider-specific chat fields")
    parser.add_argument("--max-steps", type=int, default=20, help="evaluation graph turns")
    parser.add_argument("--trajectory", action="store_true", help="generate motion context from indexed poses at runtime")
    parser.add_argument("--evaluation-time-precision", action="store_true",
                        help="reproduce the original float32 Unix-time search ranking")
    parser.add_argument("--max-tokens", type=int, default=8192)
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--timeout", type=float, default=120, help="model request timeout in seconds")
    parser.add_argument("--top-k", type=int, default=6, help="clips per search")
    parser.add_argument("--pool-k", type=int, default=10, help="semantic candidate pool for reranking")
    parser.add_argument("--max-searches", type=int, default=None)
    parser.add_argument("--search-image-limit", type=int, default=24)
    parser.add_argument("--search-max-pixels", type=int, default=128 * 32 * 32)
    parser.add_argument("--history-image-limit", type=int, default=None)
    parser.add_argument("--history-pixel-budget", type=int, default=1024 * 1024)
    parser.add_argument("--fixed-history-budget", action="store_true")
    args = parser.parse_args()
    if (args.question is None) == (args.questions is None):
        parser.error("provide a question or --questions")
    if args.track is not None and args.questions is not None:
        parser.error("--track is for single-question mode; use trajectory_context in batch rows")
    if args.output and any(args.output.resolve() == file.resolve()
                           for file in (args.experience, args.questions, args.track) if file):
        parser.error("--output must differ from the experience, question set, and track inputs")
    try:
        if number(args.timeout) <= 0 or args.max_tokens < 1 or number(args.temperature) < 0:
            raise ValueError("timeout and token limit must be positive, and temperature nonnegative")
        extra = json.loads(args.chat_extra)
        if not isinstance(extra, dict):
            raise ValueError("--chat-extra must be a JSON object")
        config = InferenceConfig(
            max_steps=args.max_steps, include_trajectory=args.trajectory,
            evaluation_time_precision=args.evaluation_time_precision,
            top_k=args.top_k, pool_k=args.pool_k, max_searches=args.max_searches,
            search_image_limit=args.search_image_limit, search_max_pixels=args.search_max_pixels,
            history_image_limit=args.history_image_limit, history_pixel_budget=args.history_pixel_budget,
            adaptive_pixels=not args.fixed_history_budget, zone=ZoneInfo(args.timezone),
        )
        defaults = Question(args.question, args.sequence, args.start_time, args.end_time,
                            args.answer_type, args.reference_time)
        experience = load_experience(args.experience)
        track = _track(args.track) if args.track is not None else None
        with (
            client(args.base_url, "VIMROBO_CHAT_API_KEY", args.timeout) as chat_transport,
            client(args.embedding_url, "VIMROBO_EMBEDDING_API_KEY", args.timeout) as embedding_transport,
            _output(args.output) as output,
        ):
            chat = ChatClient(chat_transport, args.model, max_tokens=args.max_tokens,
                              temperature=args.temperature, tool_mode=args.tool_mode, extra=extra)
            embedder = EmbeddingClient(embedding_transport, experience.embedding)

            runner = EvaluationRunner(experience, embedder, chat, config)

            def run(question):
                return runner.run(question, track)

            if args.questions is None:
                output.write(json.dumps(run(defaults), ensure_ascii=False, indent=2, allow_nan=False) + "\n")
                return
            count, errors = _run_batch(args.questions, output, run, defaults)
    except RUN_ERRORS as error:
        parser.exit(1, f"VimRobo inference: {error}\n")
    if errors:
        parser.exit(1, f"VimRobo inference: {errors} of {count} questions failed; see the result rows\n")


if __name__ == "__main__":
    main()

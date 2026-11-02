"""Export only the original assistant prose preserved in the four case logs.

No system/user messages, tool arguments, or reconstructed reasoning are exported.
Character spans are Unicode code-point offsets in the original assistant content.
The sha256 field hashes the UTF-8 encoded prose itself.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


WEBSITE = Path(__file__).resolve().parent.parent
SOURCE = WEBSITE.parent / "private" / "cases-source"
OUTPUT = WEBSITE / "src" / "data" / "recordedThinking.json"
CASE_IDS = ("01", "04", "08", "13")
EXPECTED_KEYS = {
    ("04", "seating_near_stairs"),
    ("04", "answer"),
    ("08", "brick_street_crossing_time"),
}
TOOL_CALL = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)


def extract_records(source: Path) -> tuple[list[dict], int]:
    records: dict[tuple[str, str], dict] = {}
    original_calls: dict[tuple[str, str], dict] = {}
    duplicates = 0
    for case_id in CASE_IDS:
        path = source / f"case_{case_id}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        for trajectory_index, messages in enumerate(data["trajs"]):
            for message_index, message in enumerate(messages):
                if message.get("role") != "assistant":
                    continue
                content = message.get("content")
                if not isinstance(content, str):
                    continue
                matches = list(TOOL_CALL.finditer(content))
                if not matches:
                    continue
                prefix = content[:matches[0].start()]
                prose = prefix.strip()
                if not prose:
                    continue
                calls = [json.loads(match.group(1)) for match in matches]
                selected = [call for call in calls if (
                    str(call.get("name", "")).startswith("search_")
                    or call.get("name") == "add_answer_node"
                )]
                if not selected:
                    continue
                if len(selected) != 1:
                    raise ValueError(f"Ambiguous prose-to-node mapping: {path.name}, trajectory {trajectory_index}")
                call = selected[0]
                node_id = "answer" if call["name"] == "add_answer_node" else call["arguments"].get("node_id")
                if not isinstance(node_id, str) or not node_id:
                    raise ValueError(f"Missing node_id: {path.name}, trajectory {trajectory_index}")
                start = len(prefix) - len(prefix.lstrip())
                end = len(prefix.rstrip())
                assert content[start:end] == prose
                key = (case_id, node_id)
                record = {
                    "caseId": case_id,
                    "nodeId": node_id,
                    "text": prose,
                    "sourceFile": path.name,
                    "trajectoryIndex": trajectory_index,
                    "messageIndex": message_index,
                    "start": start,
                    "end": end,
                    "sha256": hashlib.sha256(prose.encode("utf-8")).hexdigest(),
                }
                if key in records:
                    if records[key]["text"] != prose or original_calls[key] != call:
                        raise ValueError(f"Conflicting original prose for {case_id}/{node_id}")
                    # Repeated conversation history is represented once, at the
                    # earliest source pointer; distinct nodes are never merged.
                    duplicates += 1
                    continue
                records[key] = record
                original_calls[key] = call
    if set(records) != EXPECTED_KEYS:
        raise ValueError(f"Expected exactly the three audited prose blocks; found {sorted(records)}")
    return list(records.values()), duplicates


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    records, duplicates = extract_records(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"records": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(records)} original prose blocks; {duplicates} identical historical repeats deduplicated.")


if __name__ == "__main__":
    main()

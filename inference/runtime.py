"""Connect the evaluation agent to portable recording indexes and the chat endpoint."""

import asyncio

from vimrobo.memory.index import sequence_id
from .chat import nonempty
from .trajectory import parse_time
from .rollout import VimRAGAgent
from .search import MemoryTools


class EvaluationRunner:
    def __init__(self, experience, embedder, chat, config):
        if embedder.config != experience.embedding:
            raise ValueError("embedding model and backend must match the experience metadata")
        if config.max_steps < 1:
            raise ValueError("max_steps must be positive")
        self.experience = experience
        self.chat = chat
        self.config = config
        self.memory = MemoryTools(experience, embedder, config.pool_k, config.evaluation_time_precision)

    def run(self, question, track=None):
        text = nonempty(question.text, "question")
        sequence = self.experience.select_sequence(
            sequence_id(question.sequence) if question.sequence is not None else None
        )
        clips = [c for c in self.experience.clips if c["sequence"] == sequence]
        first = min(c["start_time"] for c in clips)
        last = max(c["end_time"] for c in clips)
        reference = parse_time(question.reference_time, last, self.config.zone) if question.reference_time is not None else last
        start = parse_time(question.start_time, reference, self.config.zone) if question.start_time is not None else first
        end = parse_time(question.end_time, reference, self.config.zone) if question.end_time is not None else last
        if end < start:
            raise ValueError("query end time precedes start time")
        if self.config.include_trajectory and track is None:
            track = self.experience.tracks.get(sequence)
        sample = {
            "question": text, "seq_id": sequence, "dataset": "nav_benchmark",
            "start_time": start, "end_time": end, "type": question.answer_type,
            "_track": track, "_frame_paths": self.memory.frame_paths,
        }
        if question.trajectory_context:
            sample["trajectory_context"] = question.trajectory_context
        return asyncio.run(self.rollout(sample))

    async def rollout(self, sample):
        agent = VimRAGAgent(
            self.chat, {"llm": asyncio.Semaphore(1), "tool": asyncio.Semaphore(1)},
            {"target": self.memory.search_by_target, "position": self.memory.position, "time": self.memory.time},
            max_steps=self.config.max_steps, search_top_k=self.config.top_k,
            max_images_per_search=self.config.search_image_limit, visualize_graph=False,
            enable_adaptive_pixel_budget=self.config.adaptive_pixels,
        )
        agent.pixel_budget = self.config.history_pixel_budget
        agent.history_limit = self.config.history_image_limit
        agent.observation_pixels = self.config.search_max_pixels
        agent.search_limit = self.config.max_searches
        return await agent.agent_rollout(sample)

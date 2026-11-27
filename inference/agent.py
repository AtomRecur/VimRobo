"""Public inference API for a single question."""

from dataclasses import dataclass
from datetime import tzinfo

from .runtime import EvaluationRunner
from .timezone import LOCAL_TZ

ANSWER_TYPES = ("text", "binary", "position", "time", "duration")


@dataclass(frozen=True)
class Question:
    text: str
    sequence: str | None = None
    start_time: float | str | None = None
    end_time: float | str | None = None
    answer_type: str | None = None
    reference_time: float | str | None = None
    trajectory_context: str | None = None


@dataclass(frozen=True)
class InferenceConfig:
    top_k: int = 6
    pool_k: int = 10
    max_searches: int | None = None
    search_image_limit: int = 24
    search_max_pixels: int = 128 * 32 * 32
    history_image_limit: int | None = None
    history_pixel_budget: int = 1024 * 1024
    adaptive_pixels: bool = True
    zone: tzinfo = LOCAL_TZ
    max_steps: int = 20
    include_trajectory: bool = False
    evaluation_time_precision: bool = False

    def __post_init__(self):
        if min(self.top_k, self.pool_k, self.search_max_pixels, self.max_steps) < 1:
            raise ValueError("top-k, pixel cap and max_steps must be positive")
        limits = (self.max_searches, self.search_image_limit, self.history_image_limit, self.history_pixel_budget)
        if any(value is not None and value < 0 for value in limits):
            raise ValueError("search and image limits must be nonnegative")


def answer_question(experience, question, chat, embedder, config=InferenceConfig(), *, track=None):
    return EvaluationRunner(experience, embedder, chat, config).run(question, track)

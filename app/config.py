import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    token: str
    allowed_origins: tuple[str, ...] = ()
    max_bytes: int = 10 * 1024 * 1024
    max_pixels: int = 16_000_000
    request_timeout: float = 15.0
    inference_timeout: float = 10.0
    cache_size: int = 128
    cache_ttl: float = 300.0
    requests_per_minute: int = 120
    real_max: float = 0.2
    ai_min: float = 0.8

    def __post_init__(self):
        if len(self.token) < 32:
            raise ValueError("AI_GUARD_TOKEN must contain at least 32 characters.")
        if not 0 <= self.real_max < self.ai_min <= 1:
            raise ValueError("Invalid decision thresholds.")
        if any(not origin.startswith("chrome-extension://") for origin in self.allowed_origins):
            raise ValueError("Only configured Chrome extension origins are accepted.")

    @classmethod
    def from_env(cls):
        return cls(
            token=os.environ.get("AI_GUARD_TOKEN", ""),
            allowed_origins=tuple(filter(None, os.environ.get("AI_GUARD_ALLOWED_ORIGINS", "").split(","))),
        )

from dataclasses import dataclass
from typing import Protocol

from PIL import Image


@dataclass(frozen=True)
class ModelInfo:
    ready: bool = False
    version: str | None = None
    input_size: tuple[int, int] | None = None
    preprocessing_version: str | None = None
    calibrated: bool = False


@dataclass(frozen=True)
class Prediction:
    ai_probability: float
    # Only a calibrated adapter may supply confidence. UNKNOWN is not a third class.
    confidence: float | None = None


class Predictor(Protocol):
    info: ModelInfo

    def predict(self, image: Image.Image) -> Prediction: ...


class UnavailablePredictor:
    info = ModelInfo()

    def predict(self, image: Image.Image) -> Prediction:
        raise RuntimeError("No trained model has been configured.")


def load_predictor() -> Predictor:
    # Replace only after weights, architecture, class order and transforms are supplied.
    # No guessed model, random probabilities, or automatic model downloads.
    return UnavailablePredictor()

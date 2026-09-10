import asyncio
import hashlib
import io
import math
import time
import warnings
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import Settings
from .inference.predictor import Predictor


def fail(status: int, code: str, message: str):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def classify(probability: float, settings: Settings):
    if not isinstance(probability, (float, int)) or isinstance(probability, bool) or not math.isfinite(probability) or not 0 <= probability <= 1:
        raise ValueError("Invalid model output")
    if probability >= settings.ai_min:
        return "AI", "warning"
    if probability <= settings.real_max:
        return "REAL", "normal"
    return "UNKNOWN", "uncertain"


class InferenceService:
    def __init__(self, predictor: Predictor, settings: Settings):
        self.predictor = predictor
        self.settings = settings
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ai-guard")
        self.in_flight = None
        self.cache = OrderedDict()

    def close(self):
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.cache.clear()

    def decode(self, data: bytes, media_type: str):
        formats = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as source:
                    if source.format != formats[media_type]:
                        fail(415, "FORMAT_MISMATCH", "이미지 내용과 파일 형식이 일치하지 않습니다.")
                    if source.width * source.height > self.settings.max_pixels:
                        fail(413, "TOO_MANY_PIXELS", "이미지 해상도는 1,600만 픽셀 이하여야 합니다.")
                    if getattr(source, "n_frames", 1) != 1:
                        fail(415, "ANIMATED_IMAGE", "움직이는 이미지는 지원하지 않습니다.")
                    source.load()
                    return ImageOps.exif_transpose(source).convert("RGB")
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            fail(413, "TOO_MANY_PIXELS", "이미지 해상도가 너무 큽니다.")
        except (UnidentifiedImageError, OSError, ValueError):
            fail(422, "INVALID_IMAGE", "이미지를 읽을 수 없습니다.")

    def compute(self, data: bytes, media_type: str):
        image = self.decode(data, media_type)
        try:
            if not self.predictor.info.ready:
                fail(503, "MODEL_NOT_READY", "학습 모델이 아직 연결되지 않았습니다.")
            output = self.predictor.predict(image)
            label, decision = classify(output.ai_probability, self.settings)
            confidence = output.confidence if self.predictor.info.calibrated else None
            if confidence is not None:
                classify(confidence, self.settings)  # Validate finite [0, 1] without inferring confidence.
            return {
                "label": label, "ai_probability": output.ai_probability,
                "confidence": confidence, "decision": decision,
                "model_version": self.predictor.info.version,
            }
        finally:
            image.close()

    async def predict(self, data: bytes, media_type: str):
        started = time.monotonic()
        info = self.predictor.info
        digest = hashlib.sha256(data).hexdigest()
        key = (digest, media_type, info.version, info.preprocessing_version, info.calibrated,
               self.settings.real_max, self.settings.ai_min)
        cached = self.cache.get(key)
        if cached and started - cached[0] < self.settings.cache_ttl:
            self.cache.move_to_end(key)
            return {**cached[1], "cached": True, "latency_ms": round((time.monotonic() - started) * 1000, 2)}
        self.cache.pop(key, None)
        # No unbounded queue. A timed-out thread keeps this slot until it actually exits.
        if self.in_flight is not None and not self.in_flight.done():
            fail(429, "BUSY", "다른 이미지를 분석 중입니다. 잠시 후 다시 시도하세요.")
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(self.executor, self.compute, data, media_type)
        self.in_flight = future
        future.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
        try:
            result = await asyncio.wait_for(asyncio.shield(future), self.settings.inference_timeout)
        except asyncio.TimeoutError:
            fail(504, "INFERENCE_TIMEOUT", "분석 제한 시간을 초과했습니다.")
        except HTTPException:
            raise
        except Exception:
            fail(500, "INFERENCE_FAILED", "모델 실행 중 오류가 발생했습니다.")
        if self.settings.cache_size > 0:
            self.cache[key] = (time.monotonic(), result)
            while len(self.cache) > self.settings.cache_size:
                self.cache.popitem(last=False)
        return {**result, "cached": False, "latency_ms": round((time.monotonic() - started) * 1000, 2)}

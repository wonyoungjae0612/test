import asyncio
import secrets
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import asdict

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Settings
from .inference.predictor import load_predictor
from .service import InferenceService, fail


def create_app(settings=None, predictor_factory=load_predictor):
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        app.state.service = InferenceService(predictor_factory(), settings)
        app.state.receiving = 0
        yield
        app.state.service.close()

    app = FastAPI(title="AI-Guard Local API", version="0.1.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
    recent_requests = deque()

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in settings.allowed_origins:
            return JSONResponse({"detail": {"code": "ORIGIN_DENIED", "message": "허용되지 않은 출처입니다."}}, status_code=403)
        if request.url.path != "/health":
            auth = request.headers.get("authorization", "")
            if not secrets.compare_digest(auth.encode(), f"Bearer {settings.token}".encode()):
                return JSONResponse({"detail": {"code": "UNAUTHORIZED", "message": "연결 토큰을 확인하세요."}}, status_code=401)
            now = time.monotonic()
            while recent_requests and recent_requests[0] < now - 60:
                recent_requests.popleft()
            if len(recent_requests) >= settings.requests_per_minute:
                return JSONResponse({"detail": {"code": "RATE_LIMITED", "message": "요청이 너무 많습니다."}}, status_code=429)
            recent_requests.append(now)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/health")
    async def health(request: Request):
        return {"status": "ok", "model_ready": request.app.state.service.predictor.info.ready}

    @app.get("/model/info")
    async def model_info(request: Request):
        return {**asdict(request.app.state.service.predictor.info),
                "thresholds": {"real_max": settings.real_max, "ai_min": settings.ai_min},
                "thresholds_calibrated": False,
                "max_bytes": settings.max_bytes, "max_pixels": settings.max_pixels,
                "transport": "raw-image-bytes", "original_storage": False}

    @app.post("/predict")
    async def predict(request: Request):
        media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if media_type not in {"image/png", "image/jpeg", "image/webp"}:
            fail(415, "UNSUPPORTED_FORMAT", "JPG, PNG, WEBP 이미지만 지원합니다.")
        try:
            size_hint = int(request.headers.get("content-length", "0"))
        except ValueError:
            fail(400, "INVALID_LENGTH", "잘못된 요청 크기입니다.")
        if size_hint > settings.max_bytes:
            fail(413, "FILE_TOO_LARGE", "10MB 이하 이미지를 사용하세요.")
        if request.app.state.receiving >= 2:
            fail(429, "BUSY", "요청을 처리 중입니다.")
        request.app.state.receiving += 1
        try:
            data = bytearray()
            try:
                async with asyncio.timeout(settings.request_timeout):
                    async for chunk in request.stream():
                        if len(data) + len(chunk) > settings.max_bytes:
                            fail(413, "FILE_TOO_LARGE", "10MB 이하 이미지를 사용하세요.")
                        data.extend(chunk)
            except TimeoutError:
                fail(408, "UPLOAD_TIMEOUT", "이미지 수신 제한 시간을 초과했습니다.")
            if not data:
                fail(422, "EMPTY_IMAGE", "빈 이미지입니다.")
            return await request.app.state.service.predict(bytes(data), media_type)
        finally:
            request.app.state.receiving -= 1

    return app

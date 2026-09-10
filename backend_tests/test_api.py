import asyncio
import io
import time
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.inference.predictor import ModelInfo, Prediction
from app.main import create_app

TOKEN = 'test-only-token-never-use-in-production-1234'
AUTH = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'image/png'}
ORIGIN = 'chrome-extension://' + 'a' * 32


def png(size=(100, 100)):
    stream = io.BytesIO()
    Image.new('RGB', size, '#39745b').save(stream, 'PNG')
    return stream.getvalue()


class TestPredictor:
    __test__ = False
    info = ModelInfo(True, 'unit-test-only', (224, 224), 'test-rgb', False)

    def __init__(self, probability=0.72, delay=0):
        self.calls = 0
        self.probability = probability
        self.delay = delay

    def predict(self, image):
        self.calls += 1
        assert image.mode == 'RGB'
        time.sleep(self.delay)
        return Prediction(self.probability, 0.99)


def client(settings=None, model=None):
    return TestClient(create_app(settings or Settings(TOKEN), **({'predictor_factory': lambda: model} if model else {})), base_url='http://127.0.0.1')


def test_no_model_is_service_ready_but_never_a_prediction():
    with client() as api:
        assert api.get('/health').json() == {'status': 'ok', 'model_ready': False}
        assert api.get('/model/info', headers=AUTH).json()['version'] is None
        response = api.post('/predict', headers=AUTH, content=png())
        assert response.status_code == 503
        assert response.json()['detail']['code'] == 'MODEL_NOT_READY'
        assert 'label' not in response.json()


def test_token_origin_and_host_boundaries():
    with client(Settings(TOKEN, allowed_origins=(ORIGIN,))) as api:
        assert api.get('/model/info').status_code == 401
        assert api.get('/model/info', headers={**AUTH, 'Origin': 'https://attacker.example'}).status_code == 403
        assert api.get('/model/info', headers={**AUTH, 'Origin': 'null'}).status_code == 403
        assert api.get('/model/info', headers={**AUTH, 'Origin': ORIGIN}).status_code == 200
        assert api.get('/health', headers={'Host': 'attacker.example'}).status_code == 400


@pytest.mark.parametrize('probability,label', [(0, 'REAL'), (0.2, 'REAL'), (0.20001, 'UNKNOWN'), (0.72, 'UNKNOWN'), (0.79999, 'UNKNOWN'), (0.8, 'AI'), (1, 'AI')])
def test_labels_and_no_uncalibrated_confidence(probability, label):
    with client(model=TestPredictor(probability)) as api:
        result = api.post('/predict', headers=AUTH, content=png()).json()
        assert result['label'] == label
        assert result['confidence'] is None
        assert result['latency_ms'] >= 0


def test_image_limits_and_invalid_bytes_before_model():
    with client(Settings(TOKEN, max_bytes=1024, max_pixels=10_000)) as api:
        for body, headers, status, code in [
            (b'', AUTH, 422, 'EMPTY_IMAGE'),
            (b'broken', AUTH, 422, 'INVALID_IMAGE'),
            (b'x' * 1025, AUTH, 413, 'FILE_TOO_LARGE'),
            (png(), {**AUTH, 'Content-Type': 'image/jpeg'}, 415, 'FORMAT_MISMATCH'),
            (png(), {**AUTH, 'Content-Type': 'image/svg+xml'}, 415, 'UNSUPPORTED_FORMAT'),
            (png((101, 100)), AUTH, 413, 'TOO_MANY_PIXELS'),
        ]:
            result = api.post('/predict', headers=headers, content=body)
            assert result.status_code == status
            assert result.json()['detail']['code'] == code


def test_cache_uses_bytes_and_model_version():
    model = TestPredictor()
    with client(model=model) as api:
        assert not api.post('/predict', headers=AUTH, content=png()).json()['cached']
        assert api.post('/predict', headers=AUTH, content=png()).json()['cached']
        assert model.calls == 1
        model.info = replace(model.info, version='test-new-version')
        assert not api.post('/predict', headers=AUTH, content=png()).json()['cached']
        assert model.calls == 2


def test_errors_not_cached_and_no_invalid_probabilities():
    model = TestPredictor(float('nan'))
    with client(model=model) as api:
        for _ in range(2):
            response = api.post('/predict', headers=AUTH, content=png())
            assert response.status_code == 500
            assert response.json()['detail']['code'] == 'INFERENCE_FAILED'
        assert model.calls == 2


def test_timeout_keeps_worker_slot_and_health_responds():
    async def scenario():
        model = TestPredictor(delay=0.2)
        app = create_app(Settings(TOKEN, inference_timeout=0.02), lambda: model)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://127.0.0.1') as api:
                result = await api.post('/predict', headers=AUTH, content=png())
                assert result.status_code == 504
                assert (await api.get('/health')).status_code == 200
                assert (await api.post('/predict', headers=AUTH, content=png())).status_code == 429
                await asyncio.sleep(0.25)
                model.delay = 0
                assert (await api.post('/predict', headers=AUTH, content=png())).status_code == 200
    asyncio.run(scenario())


def test_streamed_upload_limit_without_content_length():
    async def scenario():
        app = create_app(Settings(TOKEN, max_bytes=10))
        async def chunks():
            yield b'12345'
            yield b'123456'
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://127.0.0.1') as api:
                result = await api.post('/predict', headers=AUTH, content=chunks())
                assert result.status_code == 413
    asyncio.run(scenario())


def test_rate_limit_is_bounded():
    with client(Settings(TOKEN, requests_per_minute=2)) as api:
        assert api.get('/model/info', headers=AUTH).status_code == 200
        assert api.get('/model/info', headers=AUTH).status_code == 200
        assert api.get('/model/info', headers=AUTH).status_code == 429
        assert api.get('/health').status_code == 200

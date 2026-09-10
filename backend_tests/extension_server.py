"""Explicit test fixture. The production service never imports this module."""
from fastapi import Request

from app.main import create_app
from app.inference.predictor import UnavailablePredictor
from backend_tests.test_api import TestPredictor


def create_test_app():
    app = create_app()

    @app.post('/_test/model/{mode}')
    async def set_model(mode: str, request: Request):
        service = request.app.state.service
        service.cache.clear()
        service.predictor = UnavailablePredictor() if mode == 'off' else TestPredictor(float(mode))
        return {'ok': True}

    @app.get('/_test/calls')
    async def calls(request: Request):
        return {'calls': getattr(request.app.state.service.predictor, 'calls', 0)}

    return app

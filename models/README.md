# 모델 연결 지점

현재 학습 가중치는 없습니다. 파일을 여기에 복사해도 자동으로 로드되지 않습니다.

`app/inference/predictor.py`의 `load_predictor()`를 실제 어댑터로 교체합니다. 필요한 자료:

- 가중치와 모델 클래스 코드
- AI/REAL 클래스 인덱스 순서
- 입력 크기, 색상 순서, 정규화, resize/crop 방식
- 모델 및 전처리 버전
- calibration 방식과 검증 데이터

어댑터는 `ModelInfo`와 `predict(PIL.Image RGB) -> Prediction`을 구현합니다. 서비스 시작 시 한 번 로드하며 eval/no_grad 등의 설정은 모델 어댑터가 담당합니다. 클래스 confidence를 정의·보정하지 않았다면 `confidence=None`을 반환합니다. 가중치가 없을 때 임의 점수를 반환하는 fallback은 사용하지 않습니다.

모델 파일은 Git에서 제외됩니다. 모델을 연결한 후 실제 처리 시간·정확도 평가와 프로세스 격리도 수행해야 합니다.

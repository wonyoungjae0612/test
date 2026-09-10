# AI-Guard 로컬 API + Chrome 확장 프로그램

이 단계에서는 **서버 실행과 이미지 자동 감지**를 사용할 수 있습니다. 학습 모델이 없으므로 실제 AI 판별은 아직 제공하지 않습니다. 모델 미연결은 UNKNOWN 판정과 다릅니다.

## 1. 로컬 환경 설치

프로젝트 폴더의 PowerShell에서 실행합니다. 최초 설치에만 다운로드가 필요합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1
```

프로젝트 안에 Python 3.12와 가상환경, 고정된 의존성을 설치합니다. 전역 Python이나 PATH를 바꾸지 않습니다. 설치별 연결 토큰은 `.local-state/token.txt`에 생성되며 Git에서 제외됩니다. 이 파일은 타인에게 공유하지 않습니다. 이 노트북은 환경 설치를 완료한 상태입니다.

## 2. Chrome 확장 프로그램 설치

1. Chrome 주소창에 `chrome://extensions`를 입력합니다.
2. 오른쪽 위 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누르고 이 프로젝트의 `extension` 폴더를 선택합니다.
4. AI-Guard 카드의 **ID**(32자)를 복사합니다.

전달용 파일은 `release/ai-guard-extension.zip`입니다. ZIP은 먼저 압축을 풀고 `manifest.json`이 들어 있는 폴더를 로드합니다. 프로젝트를 다른 경로에 설치하면 확장 ID가 달라질 수 있습니다. 실제 설치된 ID를 사용하세요.

## 3. 서버 시작

아래 `복사한확장ID`를 실제 값으로 바꿉니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -ExtensionId 복사한확장ID
```

서버는 `http://127.0.0.1:8765`에서 실행됩니다. 실행한 터미널을 유지하고 종료할 때는 `Ctrl+C`를 누릅니다. 트레이 앱은 아직 없습니다.

`http://127.0.0.1:8765/health`에 접속하면 `status: ok`, `model_ready: false`가 나옵니다. 서비스는 켜졌지만 모델은 아직 없다는 뜻입니다.

## 4. 브라우저 연결

1. 일반 웹페이지를 열고 도구 모음의 AI-Guard 아이콘을 누릅니다.
2. **로컬 서비스 연결**을 펼칩니다.
3. `.local-state/token.txt`의 값을 복사해 연결 토큰에 붙여넣고 저장합니다.
4. **서버 연결됨 · 모델 미연결** 상태를 확인합니다.
5. **이 탭에서 감지 켜기**를 누릅니다.

보이는 이미지 위에 **AI-Guard · 모델 미연결** 배지가 붙습니다. 모델이 없는 동안 원본 다운로드·추론 요청은 하지 않습니다. 배지를 누르면 이유를 볼 수 있습니다. OFF를 누르면 배지와 관찰이 해제됩니다. 다른 사이트로 이동하거나 Chrome을 종료하면 해당 탭의 감지는 유지되지 않습니다. 같은 출처에서 새로고침하면 다시 연결합니다.

이 MVP는 사용자가 켠 탭만 감지합니다. 모든 사이트를 영구 감시하는 기능이나 전체 감지 스위치는 아직 없습니다.

## 지원 범위

- 화면에 보이는 `<img>`: PNG, JPG, WEBP, 10MB 이하
- 원본 가로·세로가 각각 80px 이상, 표시 크기 50px 이상
- 한 문서에서 최대 120개 이미지 추적, 서비스 동시 추론 1개
- 동적으로 추가되거나 주소가 바뀐 이미지 처리
- 결과 AI / REAL / UNKNOWN 배지와 상세 설명
- SHA-256 기반 서버 캐시: 128개, 5분, 원본은 저장하지 않음
- 출처 간 이동 시 OFF, 개별 탭별 ON/OFF

다른 이미지 서버(CDN)는 팝업의 **외부 이미지 호스트 허용**에서 사용자가 직접 해당 호스트만 허용합니다. 쿠키가 필요한 이미지와 리디렉션 주소는 이 버전에서 분석하지 않습니다. `blob:` 이미지, canvas, CSS 배경, iframe 내부, 120개를 넘는 나머지 이미지는 후속 범위입니다. 접근 실패를 UNKNOWN으로 표시하지 않습니다.

## 로컬 API 계약

| 요청 | 인증 | 결과 |
|---|---|---|
| `GET /health` | 불필요 | 서버 및 모델 준비 여부 |
| `GET /model/info` | Bearer 토큰 | 모델·전처리 버전, 임계값, 업로드 제한 |
| `POST /predict` | Bearer 토큰 | 이미지 한 장 판정 |

`/predict`는 **이미지 원본 bytes**를 body로 받고 `Content-Type: image/png`, `image/jpeg`, `image/webp`를 사용합니다. multipart 임시 파일 저장을 피하기 위한 선택입니다. 서버는 URL을 받아 외부 이미지를 대신 다운로드하지 않습니다.

실제 모델 연결 시 정상 응답:

```json
{
  "label": "UNKNOWN",
  "ai_probability": 0.72,
  "confidence": null,
  "decision": "uncertain",
  "model_version": "실제-모델-버전",
  "cached": false,
  "latency_ms": 123.4
}
```

위 값은 계약 설명용 예시입니다. 운영 모델에 confidence 보정이 없으면 `null`입니다. 임계값 20%/80%는 초기 정책이며, 검증 데이터로 보정한 수치가 아닙니다.

대표 오류: 401 UNAUTHORIZED, 403 ORIGIN_DENIED, 413 FILE_TOO_LARGE/TOO_MANY_PIXELS, 415 UNSUPPORTED_FORMAT, 422 INVALID_IMAGE, 429 BUSY/RATE_LIMITED, **503 MODEL_NOT_READY**, 504 INFERENCE_TIMEOUT.

이미지 수신은 최대 15초, 추론 응답은 최대 10초입니다. 추론 시간 초과 후에도 실제 작업이 종료될 때까지 실행 슬롯을 유지합니다. 현재 추론은 별도 스레드에서 동작하며, 강제 종료 가능한 별도 모델 프로세스는 후속 단계입니다. 실제 모델이 멈추면 서버 재시작이 필요할 수 있습니다.

## 검증 명령

```powershell
.\.venv\Scripts\python.exe -m pytest backend_tests -q
npm test
npx playwright install chromium
npm run test:extension
```

확장 검사는 포트 8765의 기존 서버를 종료한 뒤 실행합니다. 테스트 전용 모델 어댑터로 세 가지 배지를 검증하며, 운영 `load_predictor()`는 계속 모델 미연결 상태입니다. Chromium은 실제 확장을 설치한 headless 모드로 실행됩니다. 테스트는 임시 브라우저 프로필을 사용합니다.

이 노트북의 검증용 Chromium은 OneDrive 파일 잠금 문제를 피하기 위해 임시 경로에 설치했습니다. 해당 설치를 쓰려면:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:TEMP 'ai-guard-playwright'
npm run test:extension
```

## 다음 단계

데스크톱에서 학습 가중치·모델 구조·전처리·라벨 순서를 가져오면 `app/inference/predictor.py`에 어댑터를 연결합니다. 파일만 놓으면 자동으로 로드되는 구조는 아닙니다. `models/README.md`의 확인 항목을 따릅니다. 그 뒤 실제 성능 검증, FFT/Grad-CAM, Windows 트레이를 순서대로 진행합니다.

공식 참고: [FastAPI](https://fastapi.tiangolo.com/), [Chrome 확장 네트워크 요청](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [activeTab 권한](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [uv Python 관리](https://docs.astral.sh/uv/guides/install-python/).

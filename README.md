# AI-Guard — 이미지 신뢰도 검증 시스템

2026-09-10 설계서를 기준으로 실시간 탐지 시스템으로 확장합니다. 상세 구성과 단계별 구현 상태는 [구현 계획](docs/AI-GUARD-IMPLEMENTATION.md)을 참고하세요.

현재 노트북에는 기존 학습 모델이 없습니다. 업로드 UI 데모와 **로컬 FastAPI + Chrome 확장 프로그램**을 실행할 수 있습니다. 모델이 없으면 API는 503 MODEL_NOT_READY를 반환하고 확장은 '모델 미연결' 배지를 표시합니다. Windows 앱과 실제 모델 추론은 아직 연결 전입니다. 웹의 72% 예시는 초기 정책(20%/80%)에 따라 UNKNOWN으로 표시합니다. Vercel 배포 흐름은 웹 화면만을 위한 것입니다.

로컬 서버·확장 프로그램의 설치와 실행은 **[로컬 실행 안내](docs/LOCAL-QUICKSTART.md)**를 따릅니다. `extension/` 폴더를 Chrome에서 로드하고 `scripts/start-local.ps1`로 서버를 시작합니다.

Vite로 빌드하고 GitHub 저장소를 Vercel에 연결해 배포하는 웹페이지입니다.

**배포 구성:** GitHub `wonyoungjae0612/test`의 `main` 브랜치가 Vercel에 연결되어 있습니다. 아래 첫 배포 절차는 새 환경에서 구성을 재현할 때 사용하는 안내입니다. 모델 연결 여부와 각 기능의 구현 상태는 위 구현 계획을 기준으로 확인합니다.

## 첫 배포

1. https://github.com/new 에서 본인 계정에 빈 저장소를 만듭니다. 이름 예시: `verif-ai`. 소스 공개가 필요하지 않다면 Private을 선택합니다. README, .gitignore, License 자동 추가는 선택하지 않습니다.
2. 이 프로젝트 소스를 해당 저장소에 푸시합니다. `node_modules`, `dist`, `release`, 환경변수 파일은 Git에서 제외됩니다.
3. https://vercel.com/new 에서 GitHub로 로그인하고 해당 저장소를 Import합니다. 저장소가 보이지 않으면 Vercel의 GitHub 연동에 해당 저장소 접근 권한을 부여합니다.
4. 다음 설정을 확인하고 Deploy를 누릅니다.
   - Framework Preset: Vite
   - Root Directory: 프로젝트 최상위
   - Install Command: `npm ci`
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Node.js: 24.x
5. 성공한 배포 화면에서 실제 발급된 HTTPS 주소를 확인합니다.

빌드 설정과 HTTP 헤더는 `vercel.json`에 포함되어 있습니다. `dist`나 ZIP을 GitHub에 올리는 것이 아니라 원본 소스를 올리면 Vercel이 서버에서 빌드합니다. API 키 등 별도의 환경변수 없이 데모를 배포할 수 있습니다.

## 이후 수정과 배포

`main` 브랜치에 변경 사항을 푸시하면 Vercel의 Git 연동이 새 배포를 시작합니다. PR이나 다른 브랜치의 변경은 미리보기 배포로 검토할 수 있습니다. Vercel 프로젝트의 운영 브랜치가 `main`인지 확인합니다.

GitHub Actions는 푸시와 PR에서 빌드 및 브라우저 테스트를 실행합니다. 테스트 통과를 병합 조건으로 강제하려면 GitHub 브랜치 보호 설정에서 `verify` 검사를 필수로 지정하고 직접 푸시를 제한해야 합니다. Vercel 배포 자체가 이 GitHub 검사의 완료를 기다리도록 설정된 것은 아닙니다.

## 개발 및 검증

Node.js 24 LTS가 필요합니다.

```sh
npm ci
npm run dev
```

개발 서버는 작업 중 미리보기용입니다. 사용자에게 제공하는 주소는 Vercel에서 발급하는 배포 주소입니다.

```sh
npm run build
npx playwright install chromium
npm test
```

테스트는 빌드한 결과를 임시 서버에서 실행해 이미지 업로드, 잘못된 파일 처리, 데모 결과, 초기화, 다양한 화면 크기를 검사합니다. `CHROME_PATH` 환경변수에 기존 Chrome 실행 파일 경로를 지정해도 됩니다.

## 파일 구성

- `index.html`, `styles.css`, `app.js`: 웹페이지 원본
- `public/`: 파비콘과 404 페이지
- `package.json`, `package-lock.json`, `.nvmrc`: 빌드 도구 및 버전 설정
- `vercel.json`: Vercel 빌드와 HTTP 헤더 설정
- `.github/workflows/verify.yml`: GitHub 자동 검증
- `tests/`, `playwright.config.js`: 브라우저 테스트
- `dist/`: 빌드 산출물, Git에서 제외

Vite가 JS/CSS를 번들링하고 파일명에 콘텐츠 해시를 붙입니다. 해시 자산은 장기 캐시하도록 설정했습니다. Google Fonts를 사용할 수 없으면 시스템 글꼴로 표시됩니다. `release/`에 남아 있는 이전 Netlify용 ZIP은 이번 Vercel 배포에 사용하지 않습니다.

## 실제 AI 판별 기능

현재 분석 버튼은 1.6초 후 고정된 예시 수치(72%)를 표시합니다. 실제 AI 생성 여부와 무관하며 이미지 파일은 서버로 전송되지 않습니다.

실제 서비스를 만들 때는 HTTPS 분석 API와 판별 모델이 필요합니다. `app.js`의 데모 처리를 API 호출로 바꾸고 서버의 파일 검증·요청 제한·오류 처리를 구현합니다. 서버 API 키를 프런트엔드나 `VITE_` 환경변수에 넣지 않습니다. API 연결 시에는 화면의 이미지 전송 안내와 `vercel.json`의 콘텐츠 보안 정책도 수정해야 합니다.

## 공식 문서

- Vite 배포: https://vercel.com/docs/frameworks/frontend/vite
- GitHub 자동 배포: https://vercel.com/docs/git/vercel-for-github
- 설정 파일: https://vercel.com/docs/project-configuration/vercel-json

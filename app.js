'use strict';

const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const preview = document.getElementById('preview');
const previewImage = document.getElementById('preview-image');
const uploadPrompt = document.getElementById('upload-prompt');
const analyzeButton = document.getElementById('analyze-button');
const resultContent = document.getElementById('result-content');
const resultState = document.getElementById('result-state');
const errorMessage = document.getElementById('error-message');
const emptyResult = resultContent.innerHTML;
let imageUrl = null;
let selectedFile = null;
let analysisTimer = null;
let selectionVersion = 0;
let busy = false;
let dragDepth = 0;

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function clearResult() {
  clearTimeout(analysisTimer);
  busy = false;
  dropZone.classList.remove('busy');
  resultContent.removeAttribute('aria-busy');
  resultContent.innerHTML = emptyResult;
  resultState.textContent = '대기 중';
  analyzeButton.querySelector('span').textContent = '데모 분석 시작';
}

function resetUpload() {
  selectionVersion++;
  clearResult();
  selectedFile = null;
  fileInput.value = '';
  previewImage.removeAttribute('src');
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  preview.hidden = true;
  uploadPrompt.hidden = false;
  analyzeButton.disabled = true;
  errorMessage.hidden = true;
}

async function selectImage(files) {
  if (busy || !files.length) return;
  if (files.length !== 1) return showError('이미지는 한 번에 1장만 선택해 주세요.');
  const file = files[0];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return showError('JPG, PNG 또는 WEBP 이미지 파일을 선택해 주세요.');
  }
  if (file.size > 10 * 1024 * 1024) return showError('10MB 이하의 이미지를 선택해 주세요.');
  if (file.size === 0) return showError('비어 있는 파일입니다. 다른 이미지를 선택해 주세요.');

  const version = ++selectionVersion;
  const candidateUrl = URL.createObjectURL(file);
  const candidate = new Image();
  candidate.src = candidateUrl;
  try {
    await candidate.decode();
    if (version !== selectionVersion) {
      URL.revokeObjectURL(candidateUrl);
      return;
    }
    clearResult();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = candidateUrl;
    selectedFile = file;
    previewImage.src = imageUrl;
    document.getElementById('file-name').textContent = file.name;
    const size = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`;
    document.getElementById('file-meta').textContent = `${candidate.naturalWidth} × ${candidate.naturalHeight} · ${size}`;
    uploadPrompt.hidden = true;
    preview.hidden = false;
    errorMessage.hidden = true;
    analyzeButton.disabled = false;
  } catch {
    URL.revokeObjectURL(candidateUrl);
    if (version === selectionVersion) showError('이미지를 읽을 수 없습니다. 올바른 이미지 파일인지 확인해 주세요.');
  }
}

document.getElementById('select-file').addEventListener('click', () => {
  fileInput.value = '';
  fileInput.click();
});
fileInput.addEventListener('change', () => selectImage(fileInput.files));
document.getElementById('remove-file').addEventListener('click', () => {
  resetUpload();
  document.getElementById('select-file').focus();
});

// Prevent a dropped file from navigating away from the page.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
dropZone.addEventListener('dragenter', event => {
  event.preventDefault();
  dragDepth++;
  if (!busy) dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('drag-over');
  selectImage(event.dataTransfer.files);
});

analyzeButton.addEventListener('click', () => {
  if (!selectedFile || busy) return;
  busy = true;
  analyzeButton.disabled = true;
  analyzeButton.querySelector('span').textContent = '데모 결과 준비 중…';
  resultState.textContent = '준비 중';
  errorMessage.hidden = true;
  dropZone.classList.add('busy');
  resultContent.setAttribute('aria-busy', 'true');
  resultContent.innerHTML = '<div class="loading-result"><div class="spinner" aria-hidden="true"></div><h4>데모 결과를 준비하고 있어요</h4><p>실제 판별이 아닌 결과 화면 체험입니다.</p></div>';

  // Fixed illustrative values. Replace with a real model API before presenting predictions.
  analysisTimer = setTimeout(() => {
    busy = false;
    dropZone.classList.remove('busy');
    resultContent.removeAttribute('aria-busy');
    resultState.textContent = '데모 완료';
    analyzeButton.disabled = false;
    analyzeButton.querySelector('span').textContent = '데모 다시 보기';
    resultContent.innerHTML = '<div class="completed-result"><div class="result-label"><svg><use href="#i-info"/></svg> 예시 결과 · 실제 판별 아님</div><h4>AI 생성 가능성</h4><div class="score">72<span>%</span><small>화면 체험용 고정 수치</small></div><div class="score-bar" aria-hidden="true"><span></span></div><div class="score-legend"><span>AI 생성 72%</span><span>일반 이미지 28%</span></div><p class="demo-explanation">이 수치는 업로드한 이미지와 관계없는 예시입니다.<br>실제 분석 결과는 판별 모델 연결 후 제공됩니다.</p><button class="reset-button" id="try-again" type="button">다른 이미지 선택하기 ↗</button></div>';
    document.getElementById('try-again').addEventListener('click', () => {
      resetUpload();
      document.getElementById('select-file').focus();
      fileInput.click();
    });
  }, 1600);
});

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(item => item.classList.remove('active'));
    link.classList.add('active');
  });
});

window.addEventListener('pagehide', () => {
  clearTimeout(analysisTimer);
  if (imageUrl) URL.revokeObjectURL(imageUrl);
});

window.addEventListener('pageshow', event => {
  if (event.persisted) resetUpload();
});

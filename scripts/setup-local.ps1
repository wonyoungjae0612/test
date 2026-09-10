$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Path '.tools' -Force | Out-Null
$uvExe = Join-Path $projectRoot '.tools\uv\uv.exe'
if (-not (Test-Path -LiteralPath $uvExe)) {
    $zipPath = Join-Path $projectRoot '.tools\uv.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/astral-sh/uv/releases/download/0.12.12/uv-x86_64-pc-windows-msvc.zip' -OutFile $zipPath
    $expected = '3D54912924C36E862C14F427D04F2ED70A99E8001D1C30CAA101F6D5711626D5'
    if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ne $expected) { throw 'uv download checksum mismatch' }
    Expand-Archive -LiteralPath $zipPath -DestinationPath '.tools\uv' -Force
}
$env:UV_CACHE_DIR = Join-Path $projectRoot '.tools\uv-cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $projectRoot '.tools\python'
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    & $uvExe venv --python 3.12 .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create Python environment' }
}
& $uvExe pip sync requirements.txt --python .venv\Scripts\python.exe
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
& '.\.venv\Scripts\python.exe' -m app.setup_token
if ($LASTEXITCODE -ne 0) { throw 'Token setup failed' }
Write-Output 'Setup complete. See docs/LOCAL-QUICKSTART.md.'

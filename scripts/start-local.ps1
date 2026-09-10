param([ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'First run scripts/setup-local.ps1.' }
& $pythonExe -m app.setup_token
if ($LASTEXITCODE -ne 0) { throw 'Token setup failed' }
$env:AI_GUARD_TOKEN = [System.IO.File]::ReadAllText((Join-Path $projectRoot '.local-state\token.txt')).Trim()
$env:AI_GUARD_ALLOWED_ORIGINS = if ($ExtensionId) { "chrome-extension://$ExtensionId" } else { '' }
Write-Output 'AI-Guard: http://127.0.0.1:8765 | Stop: Ctrl+C'
Write-Output 'No trained model is bundled. Connect the extension using .local-state/token.txt.'
try {
    & $pythonExe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8765 --no-access-log --limit-concurrency 16
} finally {
    Remove-Item Env:AI_GUARD_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:AI_GUARD_ALLOWED_ORIGINS -ErrorAction SilentlyContinue
}

<#
    Starts the Presales DeepDive Portal locally: API on :8000, web on :5173.
    Run .\scripts\setup-windows.ps1 once before this.
    Each part opens in its own PowerShell window; close those windows to stop.
#>
$ErrorActionPreference = "Stop"
$root     = Split-Path -Parent $PSScriptRoot
$backend  = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$venvPy   = Join-Path $backend ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPy))                          { throw "Backend is not set up yet. Run .\scripts\setup-windows.ps1 first." }
if (-not (Test-Path (Join-Path $frontend "node_modules"))) { throw "Frontend is not set up yet. Run .\scripts\setup-windows.ps1 first." }

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command", "Set-Location '$backend'; & '$venvPy' -m uvicorn app.main:app --port 8000"
) -WindowStyle Normal
Start-Sleep -Seconds 4
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command", "Set-Location '$frontend'; npm run dev"
) -WindowStyle Normal
Start-Sleep -Seconds 6
Start-Process "http://localhost:5173"

Write-Host "API:  http://localhost:8000/api/docs" -ForegroundColor Green
Write-Host "Web:  http://localhost:5173" -ForegroundColor Green
Write-Host "Close the two PowerShell windows to stop the portal."

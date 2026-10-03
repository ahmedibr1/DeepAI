<#
    Presales DeepDive Portal - local setup for Windows.

    Prerequisites (install once, from the official installers):
      - Python 3.12   (tick "Add python.exe to PATH")
      - Node.js 22 LTS
      - PostgreSQL 16 (remember the postgres password, keep port 5432)

    Usage (PowerShell, from the folder where you unzipped the project):
      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
      .\scripts\setup-windows.ps1

    It creates the database, installs dependencies, applies migrations and creates the first admin.
    Run it again any time; it skips whatever is already done.
#>
[CmdletBinding()]
param(
    [string]$DbName        = "portal",
    [string]$DbUser        = "portal",
    [string]$DbPassword    = "portal",
    [string]$DbHost        = "localhost",
    [int]$DbPort           = 5432,
    [string]$AdminUser     = "admin",
    [string]$AdminPassword = "FirstAdmin2026"
)

$ErrorActionPreference = "Stop"
$root     = Split-Path -Parent $PSScriptRoot
$backend  = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$venvPy   = Join-Path $backend ".venv\Scripts\python.exe"

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Magenta }
function Ok($text)   { Write-Host "    $text" -ForegroundColor DarkGray }
function Need($exe, $hint) {
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
        throw "'$exe' was not found. $hint"
    }
}

Step "Checking prerequisites"
Need "python" "Install Python 3.12 from python.org and tick 'Add python.exe to PATH'."
Need "npm"    "Install Node.js 22 LTS from nodejs.org."
$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    $candidate = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
                 Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $candidate) { throw "psql.exe was not found. Install PostgreSQL 16 from enterprisedb.com." }
    $env:Path = "$($candidate.Directory.FullName);$env:Path"
}
Ok ((python --version) + ", node " + (node --version) + ", " + (psql --version))

Step "Creating the database"
Write-Host "    Enter the password of the PostgreSQL 'postgres' superuser when prompted." -ForegroundColor Yellow
$sql = @"
SELECT 'CREATE ROLE $DbUser LOGIN PASSWORD ''$DbPassword'' CREATEDB'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DbUser')\gexec
SELECT 'CREATE DATABASE $DbName OWNER $DbUser'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DbName')\gexec
"@
$sqlFile = Join-Path $env:TEMP "pp_setup.sql"
Set-Content -Path $sqlFile -Value $sql -Encoding ASCII
& psql -U postgres -h $DbHost -p $DbPort -v ON_ERROR_STOP=1 -f $sqlFile
Remove-Item $sqlFile -Force
if ($LASTEXITCODE -ne 0) { throw "Could not create the database. Is the PostgreSQL service running?" }
Ok "database '$DbName' and user '$DbUser' are ready"

Step "Installing backend dependencies (a few minutes the first time)"
Push-Location $backend
if (-not (Test-Path $venvPy)) { python -m venv .venv }
& $venvPy -m pip install --upgrade pip --quiet
& $venvPy -m pip install -r requirements-dev.txt --quiet
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "pip install failed." }

Step "Writing .env"
$envFile = Join-Path $backend ".env"
if (Test-Path $envFile) {
    Ok ".env already exists - keeping it (delete it to regenerate)"
} else {
    $secret = & $venvPy -c "import secrets; print(secrets.token_urlsafe(48))"
    @(
        "PORTAL_ENVIRONMENT=development",
        "PORTAL_DATABASE_URL=postgresql+psycopg://${DbUser}:${DbPassword}@${DbHost}:${DbPort}/${DbName}",
        "PORTAL_JWT_SECRET=$secret",
        "PORTAL_COOKIE_SECURE=false",
        "PORTAL_SESSION_MINUTES=60"
    ) | Set-Content -Path $envFile -Encoding ASCII
    Ok "created backend\.env with a fresh session secret"
}

Step "Creating database tables"
& $venvPy -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Migrations failed." }

Step "Creating the first admin"
$env:PORTAL_BOOTSTRAP_ADMIN_USERNAME = $AdminUser
$env:PORTAL_BOOTSTRAP_ADMIN_PASSWORD = $AdminPassword
& $venvPy -m scripts.bootstrap_admin
Remove-Item Env:\PORTAL_BOOTSTRAP_ADMIN_PASSWORD
Pop-Location

Step "Installing frontend dependencies (a few minutes the first time)"
Push-Location $frontend
if (Test-Path (Join-Path $frontend "package-lock.json")) { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed." }
Pop-Location

Write-Host "`nSetup finished." -ForegroundColor Green
Write-Host "Start the portal with:  .\scripts\start-windows.ps1"
Write-Host "Then open http://localhost:5173 and sign in as '$AdminUser' with the password you set."
Write-Host "You will be asked to choose a new password at first sign-in.`n"

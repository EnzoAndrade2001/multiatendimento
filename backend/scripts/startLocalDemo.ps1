param(
  [int]$Port = 3002,
  [int]$FrontendPort = 5174
)

$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$envLine = Get-Content (Join-Path $backendRoot '.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $envLine) { throw 'DATABASE_URL nao encontrado em backend/.env' }
$databaseUrl = $envLine.Substring($envLine.IndexOf('=') + 1).Trim().Trim('"')
$databaseUrl = $databaseUrl -replace '/multiatendimento_db(?:\?.*)?$', "/multiatendimento_demo"
$databaseUrl = $databaseUrl -replace 'localhost', '127.0.0.1'

$env:DATABASE_URL = $databaseUrl
$env:JWT_SECRET = 'local-demo-only-secret-change-me'
$env:PORT = [string]$Port
$env:FRONTEND_URL = "http://localhost:$FrontendPort"
$env:PUBLIC_URL = "http://localhost:$Port"
$env:DEFAULT_EVOLUTION_URL = ''
$env:DEFAULT_EVOLUTION_KEY = ''
$env:PRINTGUARD_URL = ''
$env:PRINTGUARD_ENCRYPTION_KEY = ''
$env:LOCAL_DEMO = 'true'

$outputDir = Join-Path (Split-Path -Parent $backendRoot) 'output'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$stdout = Join-Path $outputDir 'local-demo-backend.log'
$stderr = Join-Path $outputDir 'local-demo-backend.err.log'

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Write-Output "Backend local ja esta em execucao na porta $Port."
  exit 0
}

Start-Process node.exe -ArgumentList 'src/app.js' -WorkingDirectory $backendRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 3
Write-Output "Backend local iniciado em http://localhost:$Port"
if (Test-Path $stdout) { Get-Content $stdout -Tail 20 }
if (Test-Path $stderr) { Get-Content $stderr -Tail 20 }

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'

Write-Output 'Preparando banco demo local...'
$dbLine = Get-Content (Join-Path $backendRoot '.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $dbLine) { throw 'DATABASE_URL nao encontrado em backend/.env' }
$databaseUrl = $dbLine.Substring($dbLine.IndexOf('=') + 1).Trim().Trim('"')
$databaseUrl = $databaseUrl -replace '/multiatendimento_db(?:\?.*)?$', '/multiatendimento_demo'
$databaseUrl = $databaseUrl -replace 'localhost', '127.0.0.1'
$dbUri = [Uri]($databaseUrl -replace '^postgresql://', 'postgres://')
$dbUser = $dbUri.UserInfo.Split(':', 2)[0]
$dbPassword = [Uri]::UnescapeDataString($dbUri.UserInfo.Split(':', 2)[1])
$pgBin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter psql.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgBin) {
  $env:PGPASSWORD = $dbPassword
  $exists = & $pgBin.FullName -h 127.0.0.1 -U $dbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='multiatendimento_demo'" 2>$null
  if ([string]::IsNullOrWhiteSpace($exists)) {
    $createdb = Join-Path (Split-Path $pgBin.FullName) 'createdb.exe'
    & $createdb -h 127.0.0.1 -U $dbUser multiatendimento_demo
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel criar o banco multiatendimento_demo.' }
  }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
$env:DATABASE_URL = $databaseUrl
$previousLocation = Get-Location
Set-Location $backendRoot
try { npx prisma db push --schema prisma/schema.prisma --accept-data-loss --skip-generate | Out-Host; node scripts/seedLocalDemo.js | Out-Host } finally { Set-Location $previousLocation }

Write-Output 'Iniciando backend local...'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $backendRoot 'scripts/startLocalDemo.ps1')

if (-not (Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue)) {
  Write-Output 'Iniciando frontend local...'
  Start-Process npm.cmd -ArgumentList 'run', 'dev' -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 3
} else {
  Write-Output 'Frontend ja esta em execucao na porta 5174.'
}

Write-Output ''
Write-Output 'Ambiente local pronto:'
Write-Output '  http://localhost:5174/demo-lcd/login'
Write-Output '  Login: admin@demo.local / demo1234'
Write-Output '  Banco: multiatendimento_demo (isolado da VPS)'

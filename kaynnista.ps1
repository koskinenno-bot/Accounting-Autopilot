# AI ACCOUNT_V3 - koko kehitysympäristön käynnistys yhdellä komennolla.
# Käyttö (PowerShell, projektikansiossa):
#   powershell -ExecutionPolicy Bypass -File .\kaynnista.ps1
# Valinnaiset: -SkipInstall (ohita npm/pip install), -SkipDb (ohita prisma-vaiheet)
#   -Kevyt: kaikki palvelut yhdessä ikkunassa ja portissa 3000, Dockerista vain Postgres ja MinIO
#           (ei Kafkaa, Kongia eikä Redistä). Sama kuin KAYNNISTA-KEVYT.bat. Ilman tätä käynnistys toimii kuten ennen.
param([switch]$SkipInstall, [switch]$SkipDb, [switch]$Kevyt)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root
# Koko tuloste myös tiedostoon kaynnistys.log, jotta virheen voi lukea ikkunan sulkemisen jälkeen
try { Start-Transcript -Path (Join-Path $root 'kaynnistys.log') -Force | Out-Null } catch { }

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# 1. Docker
Step 'Tarkistetaan Docker'
try { docker info *> $null } catch { }
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Docker ei ole käynnissä. Käynnistä Docker Desktop ja aja skripti uudelleen.' -ForegroundColor Red
  exit 1
}
if ($Kevyt) {
  # MinIO vain vanhoja tositteita varten; uudet tositteet tallentuvat levylle
  Step 'Käynnistetään Postgres ja MinIO (kevyt tila)'
  docker compose up -d postgres minio
} else {
  Step 'Käynnistetään Postgres, Kafka, Redis, MinIO ja Kong'
  docker compose up -d
}
if ($LASTEXITCODE -ne 0) { throw 'docker compose up epäonnistui' }

Write-Host 'Odotetaan Postgresia...'
for ($i = 0; $i -lt 30; $i++) {
  docker exec ai-accountant-postgres pg_isready -U admin *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
}
# init-db.sh ajetaan vain uudelle volyymille: varmistetaan kaikki kannat
foreach ($db in 'user_service','accounting_service','voucher_service','billing_service','document_service','common_audit_log','notification_service','bank_service') {
  $exists = docker exec ai-accountant-postgres psql -U admin -d main_db -tAc "SELECT 1 FROM pg_database WHERE datname='$db'"
  if ($exists -ne '1') {
    docker exec ai-accountant-postgres psql -U admin -d main_db -c "CREATE DATABASE $db;" | Out-Null
    Write-Host "  luotiin tietokanta $db"
  }
}

# 2. Riippuvuudet
if (-not $SkipInstall) {
  Step 'npm install'
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install epäonnistui' }
  Step 'Python-riippuvuudet (reporting-service, ml-service)'
  # anthropic = tositteiden tekoälyluku, pypdf = PDF-tositteiden luku ilman avainta, reportlab = PDF-raportit
  python -m pip install -q fastapi uvicorn httpx python-dotenv PyJWT anthropic pypdf reportlab
}

# 3. Prisma: client + skeema tietokantaan
# bank-service: pankkiyhteydet tarvitsevat oman kannan; lisätään osoite vanhaan .env-tiedostoon, jos puuttuu
$bankEnv = "$root\apps\bank-service\.env"
if ((Test-Path $bankEnv) -and -not (Select-String -Path $bankEnv -Pattern '^DATABASE_URL=' -Quiet)) {
  Add-Content -Path $bankEnv -Value 'DATABASE_URL="postgresql://admin:password@localhost:5432/bank_service?schema=public"'
  Write-Host '  bank-service/.env: lisättiin DATABASE_URL'
}
$prismaServices = 'user-service','accounting-service','audit-service','invoicing-service','bank-service','voucher-service','document-service','notification-service'
if (-not $SkipDb) {
  foreach ($svc in $prismaServices) {
    Step "Prisma: $svc"
    Push-Location "apps/$svc"
    npx prisma generate
    # db push = kehityksen skeemasynkronointi; pysähtyy (ei poista dataa) jos muutos vaatisi tietojen poistoa
    npx prisma db push --skip-generate
    if ($LASTEXITCODE -ne 0) { Write-Host "  VAROITUS: $svc skeeman päivitys epäonnistui, katso virhe yltä" -ForegroundColor Yellow }
    Pop-Location
  }
}

# 4a. Kevyt tila: dashboard käännetään ja kaikki ajetaan yhdessä prosessissa (apps\server)
if ($Kevyt) {
  Step 'Käännetään dashboard (kevyt tila)'
  npm run build:single --workspace admin-dashboard
  if ($LASTEXITCODE -ne 0) { throw 'Dashboardin käännös epäonnistui' }
  Step 'Käynnistetään palvelin'
  Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle='AI Accountant (kaikki palvelut)'; Set-Location '$root\apps\server'; npm start"
  for ($i = 0; $i -lt 45; $i++) {
    try { Invoke-WebRequest -UseBasicParsing http://localhost:3000/health -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 2 }
  }
  Start-Process 'http://localhost:3000'
  Write-Host "`nValmis. Osoite: http://localhost:3000  (kaikki palvelut samassa ikkunassa; sulje ikkuna pysäyttääksesi)" -ForegroundColor Green
  Write-Host 'Uudet tositteet tallentuvat kansioon apps\voucher-service\files (mukana varmuuskopiossa).'
  exit 0
}

# 4. Palvelut omiin ikkunoihin
Step 'Käynnistetään palvelut omiin ikkunoihin'
$node = 'user-service','accounting-service','audit-service','invoicing-service','bank-service','voucher-service','document-service','notification-service'
foreach ($svc in $node) {
  Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle='$svc'; Set-Location '$root\apps\$svc'; npm run dev"
}
Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle='reporting-service'; Set-Location '$root\apps\reporting-service\src'; python main.py"
# ml-service: pankin lähtevien maksujen tiliöintiehdotukset (portti 8001)
Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle='ml-service'; Set-Location '$root\apps\ml-service\src'; python main.py"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle='admin-dashboard'; Set-Location '$root\apps\admin-dashboard'; npm run dev"

Step 'Odotetaan dashboardia'
for ($i = 0; $i -lt 30; $i++) {
  try { Invoke-WebRequest -UseBasicParsing http://localhost:5173 -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 2 }
}
Start-Process 'http://localhost:5173'
Write-Host "`nValmis. Dashboard: http://localhost:5173  (palvelut näkyvät omissa ikkunoissaan; sulje ikkuna pysäyttääksesi palvelun)" -ForegroundColor Green
if (-not (Get-ChildItem "$root\apps\bank-service\salaiset\*.pem" -ErrorAction SilentlyContinue)) {
  Write-Host 'Pankkiyhteys pois päältä: siirrä Enable Bankingin .pem-avain kansioon apps\bank-service\salaiset (ks. PARANNUKSET.md)' -ForegroundColor Yellow
}
Write-Host "Saapuneet-kansio: $root\inbox\<yhtiön tunnus>\tiliotteet ja \tositteet (ks. inbox\LUEMINUT.md)"
if (-not (Select-String -Path "$root\apps\ml-service\.env" -Pattern '^ANTHROPIC_API_KEY=.+' -Quiet)) {
  Write-Host 'Tekoälyluku pois päältä: lisää ANTHROPIC_API_KEY tiedostoon apps\ml-service\.env (ks. PARANNUKSET.md)' -ForegroundColor Yellow
}

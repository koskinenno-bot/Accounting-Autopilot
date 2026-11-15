# Varmuuskopio: kaikki tietokannat, ladatut dokumentit ja tositteet (MinIO).
# Käyttö (PowerShell, kansiossa AI ACCOUNT_V3):
#   powershell -ExecutionPolicy Bypass -File .\scripts\varmuuskopio.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\varmuuskopio.ps1 -Kohde "D:\Varmuuskopiot" -Sailyta 30
# Ajasta päivittäin: Tehtävien ajoitus (Task Scheduler) -> Luo perustehtävä -> Ohjelma: powershell.exe,
#   argumentit: -ExecutionPolicy Bypass -File "<polku>\scripts\varmuuskopio.ps1"
# Palautus: scripts\palauta-varmuuskopio.ps1
param(
  [string]$Kohde = (Join-Path $PSScriptRoot '..\varmuuskopiot'),
  [int]$Sailyta = 30
)
$ErrorActionPreference = 'Stop'
$juuri = Resolve-Path (Join-Path $PSScriptRoot '..')
$aika = Get-Date -Format 'yyyyMMdd-HHmm'
$kansio = Join-Path $Kohde "varmuuskopio-$aika"
New-Item -ItemType Directory -Force -Path $kansio | Out-Null

Write-Host "1/3 Tietokannat (pg_dumpall)..."
docker exec ai-accountant-postgres sh -c "pg_dumpall -U admin --clean --if-exists | gzip > /tmp/kannat.sql.gz"
if ($LASTEXITCODE -ne 0) { throw 'Tietokantojen varmuuskopio epäonnistui. Onko Docker ja ai-accountant-postgres käynnissä?' }
docker cp ai-accountant-postgres:/tmp/kannat.sql.gz (Join-Path $kansio 'kannat.sql.gz')
docker exec ai-accountant-postgres rm -f /tmp/kannat.sql.gz | Out-Null

Write-Host "2/3 Tositteet (MinIO)..."
docker exec ai-accountant-minio sh -c "tar czf /tmp/minio.tgz -C /bitnami/minio data"
if ($LASTEXITCODE -ne 0) { throw 'MinIO-varmuuskopio epäonnistui' }
docker cp ai-accountant-minio:/tmp/minio.tgz (Join-Path $kansio 'minio.tgz')
docker exec ai-accountant-minio rm -f /tmp/minio.tgz | Out-Null

Write-Host "3/3 Dokumentit ja arkisto (document-service\uploads)..."
$uploads = Join-Path $juuri 'apps\document-service\uploads'
if (Test-Path $uploads) {
  Compress-Archive -Path (Join-Path $uploads '*') -DestinationPath (Join-Path $kansio 'dokumentit.zip') -Force -ErrorAction SilentlyContinue
}

# Tiivisteet eheyden tarkistukseen
Get-ChildItem $kansio -File | Get-FileHash -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash)  $(Split-Path $_.Path -Leaf)" } | Set-Content (Join-Path $kansio 'SHA256SUMS.txt')

$koko = (Get-ChildItem $kansio -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Valmis: {0} ({1:N1} Mt)" -f $kansio, $koko)

# Vanhat pois (säilytetään $Sailyta uusinta)
Get-ChildItem $Kohde -Directory -Filter 'varmuuskopio-*' | Sort-Object Name -Descending | Select-Object -Skip $Sailyta |
  ForEach-Object { Remove-Item $_.FullName -Recurse -Force; Write-Host "Poistettu vanha: $($_.Name)" }

Write-Host "Muista: säilytä kopio myös toisessa paikassa (ulkoinen levy tai pilvi). Kopiot sisältävät henkilötietoja."

# Palauttaa varmuuskopion (scripts\varmuuskopio.ps1). KORVAA nykyiset tiedot.
#   powershell -ExecutionPolicy Bypass -File .\scripts\palauta-varmuuskopio.ps1 -Kansio .\varmuuskopiot\varmuuskopio-20261115-2200
# Sulje ensin ohjelman palvelut (PowerShell-ikkunat). Docker jää päälle.
param([Parameter(Mandatory = $true)][string]$Kansio)
$ErrorActionPreference = 'Stop'
$juuri = Resolve-Path (Join-Path $PSScriptRoot '..')
$Kansio = Resolve-Path $Kansio

# Eheys ensin
$summat = Join-Path $Kansio 'SHA256SUMS.txt'
if (Test-Path $summat) {
  foreach ($rivi in Get-Content $summat) {
    $osat = $rivi -split '  ', 2
    $h = (Get-FileHash (Join-Path $Kansio $osat[1]) -Algorithm SHA256).Hash
    if ($h -ne $osat[0]) { throw "Tiedosto $($osat[1]) on muuttunut tai vioittunut. Palautus keskeytetty." }
  }
  Write-Host 'Tiivisteet täsmäävät.'
}

$vastaus = Read-Host "Palautetaanko $Kansio? Nykyiset tiedot korvataan. Kirjoita KYLLÄ"
if ($vastaus -ne 'KYLLÄ') { Write-Host 'Peruttu.'; exit 1 }

Write-Host '1/3 Tietokannat...'
docker cp (Join-Path $Kansio 'kannat.sql.gz') ai-accountant-postgres:/tmp/kannat.sql.gz
docker exec ai-accountant-postgres sh -c "gunzip -c /tmp/kannat.sql.gz | psql -q -U admin -d postgres > /tmp/palautus.log 2>&1; rm -f /tmp/kannat.sql.gz"
if ($LASTEXITCODE -ne 0) { throw 'Tietokantojen palautus epäonnistui (docker exec ai-accountant-postgres cat /tmp/palautus.log)' }

Write-Host '2/3 Tositteet (MinIO)...'
docker cp (Join-Path $Kansio 'minio.tgz') ai-accountant-minio:/tmp/minio.tgz
docker exec ai-accountant-minio sh -c "rm -rf /bitnami/minio/data/* && tar xzf /tmp/minio.tgz -C /bitnami/minio && rm -f /tmp/minio.tgz"
docker restart ai-accountant-minio | Out-Null

Write-Host '3/3 Dokumentit...'
$zip = Join-Path $Kansio 'dokumentit.zip'
if (Test-Path $zip) {
  Expand-Archive -Path $zip -DestinationPath (Join-Path $juuri 'apps\document-service\uploads') -Force
}
Write-Host 'Palautus valmis. Käynnistä ohjelma (KAYNNISTA.bat).'

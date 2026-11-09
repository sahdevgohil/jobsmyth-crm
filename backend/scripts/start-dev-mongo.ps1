# Starts a local MongoDB as a single-node replica set (the CRM needs transactions) using the
# MongoDB Server you already have installed, WITHOUT administrator rights or the Windows service.
# Data lives in backend/.mongo-data-dev. Leave the minimized mongod window open while you work.
#   usage (from the backend folder):  .\scripts\start-dev-mongo.ps1
param([int]$Port = 27017)

$mongod = Get-ChildItem 'C:\Program Files\MongoDB\Server\*\bin\mongod.exe' -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $mongod) { Write-Error 'mongod.exe not found under C:\Program Files\MongoDB\Server'; exit 1 }

$data = Join-Path $PSScriptRoot '..\.mongo-data-dev'
New-Item -ItemType Directory -Force $data | Out-Null

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "Port $Port is already in use (MongoDB may already be running). Skipping start."
} else {
  Start-Process -FilePath $mongod.FullName -WindowStyle Minimized `
    -ArgumentList "--dbpath `"$data`" --replSet rs0 --port $Port --bind_ip 127.0.0.1"
  Start-Sleep -Seconds 6
}

$env:DEV_MONGO_PORT = "$Port"
node (Join-Path $PSScriptRoot 'dev-mongod-init.mjs')
Write-Host ''
Write-Host "Set backend/.env:  MONGODB_URI=mongodb://127.0.0.1:$Port/legacy-roofing-crm?replicaSet=rs0"

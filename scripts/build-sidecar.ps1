# Compile le backend NEX et le place la ou Tauri l'attend pour l'embarquer.
#
# Lance automatiquement par `npm run tauri build`, via le beforeBuildCommand qui pointe sur
# `npm run build:app` (sidecar puis frontend). Ne pas revenir a un appel manuel : l'oubli
# est invisible, l'installeur embarque alors un backend perime et l'application se lance
# normalement en affichant seulement des champs vides.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    cargo build --release -p nex-backend
    $triple = (rustc -vV | Select-String '^host: ').Line -replace '^host: ', ''
    $dest = Join-Path $root "src-tauri\binaries"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Force (Join-Path $root "target\release\nex-backend.exe") (Join-Path $dest "nex-backend-$triple.exe")
    "backend embarque pret : nex-backend-$triple.exe"
} finally {
    Pop-Location
}

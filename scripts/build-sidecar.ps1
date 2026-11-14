# Compile le backend NEX et le place la ou Tauri l'attend pour l'embarquer.
# A lancer avant `npx tauri build` des que le backend change.
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

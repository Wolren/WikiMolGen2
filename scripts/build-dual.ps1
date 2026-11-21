# Build both renderers side by side: patinae at /, classic molar_vis at /classic/.
#
# The classic renderer was removed in fda3c56, so it is built from its last commit in a
# separate worktree. Nothing is merged and the current branch is not touched.
#
#   pwsh -File scripts/build-dual.ps1
#   pwsh -File scripts/build-dual.ps1 -SkipClassic   # reuse the previous classic build
param(
    [string]$ClassicCommit = '57e912e',
    [string]$Worktree = 'D:\Scratch\dsh\molplate-classic',
    [string]$Site = 'D:\Scratch\dsh\dual-site',
    [int]$Port = 5182,
    [switch]$SkipClassic,
    [switch]$NoServe
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'dev-env.ps1')

function Step($text) { Write-Host "== $text" -ForegroundColor Cyan }

if (-not $SkipClassic) {
    Step "classic worktree at $ClassicCommit"
    if (-not (Test-Path $Worktree)) {
        git -C $repo worktree add --detach $Worktree $ClassicCommit
    }

    Step 'classic wasm build'
    $env:CARGO_TARGET_DIR = 'D:\Projects\tools\rust\tmp\classic-target'
    cargo build --manifest-path (Join-Path $Worktree 'Cargo.toml') --target wasm32-unknown-unknown --release -p molplate_wasm

    # wasm-bindgen cannot write into the worktree on some machines (os error 5), so it
    # writes to a temp dir and the files are copied in.
    Step 'classic bindings'
    $pkg = Join-Path $Worktree 'web\pkg'
    New-Item -ItemType Directory -Force -Path $pkg | Out-Null
    $tmp = 'D:\Projects\tools\rust\tmp\classic-pkg'
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $wasm = Join-Path $env:CARGO_TARGET_DIR 'wasm32-unknown-unknown\release\molplate_wasm.wasm'
    wasm-bindgen --target web --out-dir $tmp --out-name molplate_wasm $wasm
    Copy-Item (Join-Path $tmp '*') $pkg -Recurse -Force

    Step 'classic web build'
    Push-Location (Join-Path $Worktree 'web')
    if (-not (Test-Path node_modules)) { npm ci }
    npx tsc --noEmit
    npx vite build --base=/classic/
    Pop-Location
}

Step 'patinae web build'
Push-Location (Join-Path $repo 'web')
npm run build
Pop-Location

Step "assemble $Site"
# Clear the contents, not the directory: a running server may hold it open.
New-Item -ItemType Directory -Force -Path $Site | Out-Null
Get-ChildItem $Site -Force | Remove-Item -Recurse -Force -ErrorAction Continue
New-Item -ItemType Directory -Force -Path (Join-Path $Site 'classic') | Out-Null
Copy-Item (Join-Path $repo 'web\dist\*') $Site -Recurse -Force
Copy-Item (Join-Path $Worktree 'web\dist\*') (Join-Path $Site 'classic') -Recurse -Force

Write-Host "new:     http://127.0.0.1:$Port/"
Write-Host "classic: http://127.0.0.1:$Port/classic/"

if (-not $NoServe) {
    node (Join-Path $PSScriptRoot 'dual-serve.mjs') $Site $Port
}

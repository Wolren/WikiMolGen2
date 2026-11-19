# Build environment for this workstation.
#
# Dot-source it before any cargo/npm command: `. .\scripts\dev-env.ps1`
#
# Why the unusual locations: this machine's Rust toolchain lives in the registered
# `tools` workspace instead of the user profile, and the sandbox that runs build
# processes is low-integrity — so it can only write inside trees carrying the low
# integrity label (D:\Projects and its `tools` subtree) and cannot use the default
# %TEMP%. TMP points at a labelled scratch directory so the linker can write.

$env:RUSTUP_HOME = 'D:\Projects\tools\rust\up'
$env:CARGO_HOME = 'D:\Projects\tools\rust\cargo'
$env:TMP = 'D:\Projects\tools\rust\tmp'
$env:TEMP = $env:TMP
# Toolchain binaries plus the installed cargo tools (wasm-bindgen).
$env:PATH = "D:\Projects\tools\rust\up\toolchains\stable-x86_64-pc-windows-msvc\bin;D:\Projects\tools\rust\cargo\bin;$env:PATH"

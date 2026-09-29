# test-guard.ps1 — tests for guard.ps1 (run: powershell -NoProfile -ExecutionPolicy Bypass -File test-guard.ps1)
$ErrorActionPreference = 'Stop'
$fails = 0

# sandbox: guard resolves the project root from its own script location
# ($PSScriptRoot two levels up), so the sandbox must mirror the real
# <root>/.claude/hooks/guard.ps1 layout and we must invoke THAT copy.
$sandbox = Join-Path $env:TEMP ("guard-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path (Join-Path $sandbox 'docs/architecture') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $sandbox '.claude/hooks') | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'guard.ps1') (Join-Path $sandbox '.claude/hooks/guard.ps1')
$guard = Join-Path $sandbox '.claude/hooks/guard.ps1'
Push-Location $sandbox

function Test-Case([string]$name, [string]$json, [int]$expected) {
    # Local override: on PowerShell 5.1, redirecting a native command's stderr
    # (2>$null) while $ErrorActionPreference = 'Stop' is active turns each
    # stderr line into a terminating NativeCommandError. Scoping 'Continue'
    # here (function-local, reverts on return) keeps guard.ps1's stderr
    # output non-fatal so $LASTEXITCODE can be checked below.
    $ErrorActionPreference = 'Continue'
    $json | powershell -NoProfile -ExecutionPolicy Bypass -File $guard 2>$null | Out-Null
    if ($LASTEXITCODE -ne $expected) {
        Write-Host "FAIL: $name (exit $LASTEXITCODE, expected $expected)"
        $script:fails++
    } else { Write-Host "PASS: $name" }
}

# 1
Test-Case "code blocked before marker"  '{"tool_input":{"file_path":"src/Program.cs"}}' 2
# 2
Test-Case "md allowed before marker"    '{"tool_input":{"file_path":"docs/architecture/stack.md"}}' 0
# 2b — NotebookEdit sends "notebook_path" instead of "file_path"; guard must fall
#      back to it rather than fail-closed on a missing file_path.
Test-Case "notebook_path fallback blocked before marker (code file)" '{"tool_input":{"notebook_path":"src/analysis.ipynb"}}' 2
# 3-4 — templates/ is no longer read-only (ADR-0011): .md allowed before the marker, code still blocked
Test-Case "template md allowed"          '{"tool_input":{"file_path":"templates/adr-template.md"}}' 0
Test-Case "code under templates blocked before marker" '{"tool_input":{"file_path":"templates/x.ts"}}' 2
# 5 — fail-closed: tool_input present but file_path missing/empty/non-string must BLOCK,
#     not allow (previously this expected 0; a Write/Edit call with no path cannot be verified).
Test-Case "tool_input without file_path blocked (fail-closed)" '{"tool_input":{}}' 2

# Absolute paths must be normalized against the sandbox root before matching.
$sandboxFwd = ($sandbox -replace '\\', '/')
# 6
Test-Case "absolute path to code blocked before marker" ('{"tool_input":{"file_path":"' + $sandboxFwd + '/src/x.cs"}}') 2
# 7
Test-Case "absolute path to docs allowed" ('{"tool_input":{"file_path":"' + $sandboxFwd + '/docs/architecture/stack.md"}}') 0

# Path-traversal: ".." segments must be resolved BEFORE the allowlist regex checks run,
# so they cannot be used to dodge them.
# 8
Test-Case "traversal resolves to blocked code path" '{"tool_input":{"file_path":"docs/../src/x.cs"}}' 2
# 9
Test-Case "nested traversal resolves to blocked code path" '{"tool_input":{"file_path":"a/docs/../../src/y.cs"}}' 2
# 9b — native Windows backslash separators in the traversal sequence must be
#      normalized the same way as forward slashes before matching.
Test-Case "backslash traversal resolves to blocked code path" '{"tool_input":{"file_path":"docs\\..\\src\\x.cs"}}' 2

# Malformed input must fail closed, not silently allow.
# 10
Test-Case "malformed JSON blocked (fail-closed)" 'not-json' 2

# A normalized path that lies outside this project's tree entirely is not this
# guard's concern (it only governs the project's own tree) — allow it.
$outsidePath = Join-Path $env:TEMP ("guard-test-outside-" + [guid]::NewGuid().ToString('N') + '/x.cs')
$outsidePathFwd = ($outsidePath -replace '\\', '/')
# 11
Test-Case "absolute path outside project root allowed" ('{"tool_input":{"file_path":"' + $outsidePathFwd + '"}}') 0

New-Item -ItemType File -Force -Path 'docs/architecture/.workflow-complete' | Out-Null
# 12
Test-Case "code allowed after marker"   '{"tool_input":{"file_path":"src/Program.cs"}}' 0
# 14
Test-Case "traversal allowed after marker" '{"tool_input":{"file_path":"docs/../src/x.cs"}}' 0

Pop-Location
Remove-Item -Recurse -Force $sandbox
if ($fails -gt 0) { Write-Host "$fails test(s) FAILED"; exit 1 } else { Write-Host "All tests passed"; exit 0 }

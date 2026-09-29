# guard.ps1 — PreToolUse hook for Write|Edit|NotebookEdit|MultiEdit.
# Blocks: (a) application code until docs/architecture/.workflow-complete exists,
#         (b) any write to tech-radar/** or templates/** (always).
# Exit 0 = allow, exit 2 = block (reason on stderr, returned to Claude).
#
# Input handling (fail-closed):
#   - stdin is not valid JSON                          -> exit 2 (cannot verify intent)
#   - JSON parses, "tool_input" is absent entirely      -> exit 0 (not a file-editing tool call)
#   - "tool_input" present but "file_path" is missing,
#     empty, or not a string                            -> exit 2 (a Write/Edit-family call
#                                                          must carry a path; refuse to guess)
#
# Scope and honesty note: this hook is a guardrail against ACCIDENTAL drift via the
# Write/Edit/NotebookEdit/MultiEdit tools. It is not a security boundary — it does not
# stop writes made via Bash (e.g. redirection, git, scripts) or a deliberate bypass.
# The real controls are the Architecture Committee review gate and human code review.

$raw = [Console]::In.ReadToEnd()
try {
    $data = $raw | ConvertFrom-Json
} catch {
    [Console]::Error.WriteLine("BLOCKED: guard could not parse hook input (fail-closed)")
    exit 2
}

$toolInput = $data.tool_input
if ($null -eq $toolInput) { exit 0 }

# NotebookEdit sends the target path as "notebook_path" rather than "file_path";
# fall back to it so notebook edits are not fail-closed after finalization.
$path = $toolInput.file_path
if (-not ($path -is [string]) -or [string]::IsNullOrEmpty($path)) { $path = $toolInput.notebook_path }
if (-not ($path -is [string]) -or [string]::IsNullOrEmpty($path)) {
    [Console]::Error.WriteLine("BLOCKED: guard could not determine target file path (fail-closed)")
    exit 2
}

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$rootFull = [System.IO.Path]::GetFullPath($root)
$rootNorm = (($rootFull -replace '\\', '/').TrimEnd('/')) + '/'

# Resolve to an absolute, ".."-free path before any string/regex matching, so a
# traversal sequence (e.g. "docs/../src/x.cs") cannot dodge the checks below.
if ([System.IO.Path]::IsPathRooted($path)) {
    $full = [System.IO.Path]::GetFullPath($path)
} else {
    $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $path))
}
$fullFwd = ($full -replace '\\', '/')

if (-not $fullFwd.ToLower().StartsWith($rootNorm.ToLower())) {
    # Normalized path resolves outside this project's tree entirely. This guard
    # only governs the project's own tree, so let it through.
    exit 0
}
$rel = $fullFwd.Substring($rootNorm.Length)

if ($rel -match '(^|/)tech-radar/' -or $rel -match '(^|/)templates/') {
    [Console]::Error.WriteLine("BLOCKED: tech-radar/ and templates/ are read-only in projects. Changes go through the central ai-project-start repository (see tech-radar/GOVERNANCE.md). To refresh the local radar copy use /update-radar.")
    exit 2
}

$marker = Join-Path $root 'docs/architecture/.workflow-complete'
if (Test-Path $marker) { exit 0 }

$allowedExt = @('.md', '.mmd', '.txt', '.bak')
$ext = [System.IO.Path]::GetExtension($rel).ToLower()
$isAllowed = ($ext -in $allowedExt) -or ($rel -match '(^|/)docs/') -or ($rel -match '(^|/)\.claude/')
if (-not $isAllowed) {
    [Console]::Error.WriteLine("BLOCKED: application code is not allowed until the design workflow is complete: /01-select-stack, /02-c4-model, /03-adr, Architecture Review (docs/architecture/APPROVAL.md), then /04-generate-claude-md. See CLAUDE.md.")
    exit 2
}
exit 0

# Run with: powershell -ExecutionPolicy Bypass -File .\push-session.ps1 "message"
# ══════════════════════════════════════════════════════
# Project Manhattan — Session Push & Weekly Backup
# Run this at the end of every session
# Usage: .\push-session.ps1 "what you worked on today"
# ══════════════════════════════════════════════════════

param(
    [string]$Message = ""
)

$Date     = Get-Date -Format "yyyy-MM-dd"
$Time     = Get-Date -Format "HH:mm"
$WeekNum  = "$(Get-Date -Format 'yyyy')-W$(Get-Date -UFormat '%V')"
$Tag      = "backup-$WeekNum"

if ($Message -ne "") {
    $CommitMsg = "[$Date] $Message"
} else {
    $CommitMsg = "[$Date $Time] Session update"
}

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Project Manhattan — Session Push        ║" -ForegroundColor Cyan
Write-Host "╠══════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "║  Date    : $Date" -ForegroundColor Cyan
Write-Host "║  Message : $CommitMsg" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Show changed files ──
Write-Host "📂 Changed files:" -ForegroundColor Yellow
git status --short
Write-Host ""

# ── Stage all changes ──
git add -A

# ── Commit if there's anything staged ──
$staged = git diff --cached --name-only
if ($staged) {
    git commit -m $CommitMsg
    Write-Host "✓ Committed: $CommitMsg" -ForegroundColor Green
} else {
    Write-Host "✓ Nothing to commit — working tree clean" -ForegroundColor Green
}

# ── Push to main ──
git push origin main
Write-Host "✓ Pushed to GitHub (main)" -ForegroundColor Green

# ── Weekly backup tag ──
$existingTags = git tag
if ($existingTags -notcontains $Tag) {
    Write-Host ""
    Write-Host "📅 Creating weekly backup tag: $Tag" -ForegroundColor Yellow
    git tag -a $Tag -m "Weekly backup — $Date"
    git push origin $Tag
    Write-Host "✓ Weekly backup tagged: $Tag" -ForegroundColor Green
    Write-Host ""
    Write-Host "  To restore a file from this backup:" -ForegroundColor DarkGray
    Write-Host "  .\restore-file.ps1 filename.html $Tag" -ForegroundColor DarkGray
} else {
    Write-Host "✓ Weekly backup tag $Tag already exists" -ForegroundColor Green
}

# ── Log the session ──
$LogFile = Join-Path $PSScriptRoot "session-log.md"
if (-not (Test-Path $LogFile)) {
    "# Project Manhattan — Session Log`n" | Set-Content $LogFile
}

$changedFiles = git diff HEAD~1 --name-only 2>$null
$logEntry = @"

## $Date $Time
**$CommitMsg**

Files changed:
$(($changedFiles | ForEach-Object { "- $_" }) -join "`n")

"@
Add-Content $LogFile $logEntry
Write-Host "✓ Session logged to session-log.md" -ForegroundColor Green

Write-Host ""
Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  All done! Live site updates in ~30s" -ForegroundColor Cyan
Write-Host "  https://species-3r1.pages.dev" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

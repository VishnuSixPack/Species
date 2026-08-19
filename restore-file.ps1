# Run with: powershell -ExecutionPolicy Bypass -File .\restore-file.ps1 filename.html
# ══════════════════════════════════════════════════════
# Project Manhattan — File Restore Helper
# Restore any file from any backup tag or commit
#
# Usage:
#   .\restore-file.ps1 fishery.html
#   .\restore-file.ps1 product-details.html backup-2026-W30
#   .\restore-file.ps1 product-details.html HEAD~1
# ══════════════════════════════════════════════════════

param(
    [string]$File    = "",
    [string]$FromTag = ""
)

if ($File -eq "") {
    Write-Host "Usage: .\restore-file.ps1 <filename> [tag or commit]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Available weekly backups:" -ForegroundColor Cyan
    git tag | Where-Object { $_ -like "backup-*" } | Sort-Object -Descending | Select-Object -First 20
    Write-Host ""
    Write-Host "Recent commits:" -ForegroundColor Cyan
    git log --oneline -10
    exit
}

if (-not (Test-Path $File)) {
    Write-Host "⚠ File not found locally: $File" -ForegroundColor Red
    Write-Host "  (It may have been deleted — restore will recreate it)" -ForegroundColor DarkGray
}

# If no tag/commit specified, show options and ask
if ($FromTag -eq "") {
    Write-Host ""
    Write-Host "Available weekly backups:" -ForegroundColor Cyan
    git tag | Where-Object { $_ -like "backup-*" } | Sort-Object -Descending | Select-Object -First 10
    Write-Host ""
    Write-Host "Recent commits:" -ForegroundColor Cyan
    git log --oneline -8
    Write-Host ""
    $FromTag = Read-Host "Restore '$File' from which tag/commit?"
}

if ($FromTag -eq "") {
    Write-Host "✗ Cancelled" -ForegroundColor Red
    exit
}

# Back up the current broken version first
$Timestamp   = Get-Date -Format "yyyyMMdd_HHmmss"
$Ext         = [System.IO.Path]::GetExtension($File)
$BaseName    = [System.IO.Path]::GetFileNameWithoutExtension($File)
$BackupName  = "${BaseName}_BEFORE_RESTORE_${Timestamp}${Ext}"

if (Test-Path $File) {
    Copy-Item $File $BackupName
    Write-Host "✓ Current version saved as: $BackupName" -ForegroundColor Yellow
}

# Restore from git
git checkout $FromTag -- $File

Write-Host ""
Write-Host "✓ Restored: $File  ←  $FromTag" -ForegroundColor Green
Write-Host ""
Write-Host "If this isn't right, your broken version is in:" -ForegroundColor DarkGray
Write-Host "  $BackupName" -ForegroundColor DarkGray
Write-Host ""

# Project Manhattan — Session Log

Generated automatically by push-session.ps1.

---

## How to use

**End of every session:**
```powershell
powershell -ExecutionPolicy Bypass -File .\push-session.ps1 "what you worked on"
```

**If you accidentally overwrite a file:**
```powershell
powershell -ExecutionPolicy Bypass -File .\restore-file.ps1 product-details.html
```

**Or restore from a specific backup:**
```powershell
powershell -ExecutionPolicy Bypass -File .\restore-file.ps1 product-details.html backup-2026-W31
```

**See all weekly backups:**
```powershell
git tag | Where-Object { $_ -like "backup-*" } | Sort-Object -Descending
```

**If PowerShell blocks (alternative):**
```powershell
git add -A
git commit -m "[date] message"
git push origin main
```

---

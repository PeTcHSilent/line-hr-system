@echo off
setlocal enabledelayedexpansion

echo.
echo ==========================================
echo   line-hr-system  --  Quick Update (no migration)
echo ==========================================
echo.

cd /d "%~dp0"

where git >nul 2>&1
if !errorlevel! neq 0 ( echo [ERROR] git not found & pause & exit /b 1 )

echo [1/3] Checking changes...
echo ------------------------------------------
git status --short
echo.

git add -A

git diff --cached --quiet
if !errorlevel! equ 0 (
    echo   No changes to commit.
    echo.
    pause
    exit /b 0
)

echo [2/3] Commit message
echo ------------------------------------------
set "MSG=%~1"
if "!MSG!"=="" (
    set /p MSG=Enter commit message (leave blank for "update: auto"):
)
if "!MSG!"=="" set "MSG=update: auto"

git commit -m "!MSG!"
if !errorlevel! neq 0 ( echo [ERROR] git commit failed & pause & exit /b 1 )
echo   Committed: !MSG!

echo.
echo [3/3] Pushing to origin/main...
echo ------------------------------------------
git push origin main
if !errorlevel! neq 0 ( echo [ERROR] git push failed & pause & exit /b 1 )

echo.
echo ==========================================
echo   Update pushed. Railway will redeploy automatically.
echo   Check: https://railway.app/dashboard
echo ==========================================
echo.
echo   NOTE: If this update includes a new database migration,
echo   run deploy.bat instead so migrations get applied.
echo.
pause

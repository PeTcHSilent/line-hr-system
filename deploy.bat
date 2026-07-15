@echo off
setlocal enabledelayedexpansion

echo.
echo ==========================================
echo   line-hr-system  --  Deploy Script
echo ==========================================
echo.

cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 ( echo [ERROR] Node.js not found & pause & exit /b 1 )

where git >nul 2>&1
if %errorlevel% neq 0 ( echo [ERROR] git not found & pause & exit /b 1 )

if not exist ".env" ( echo [ERROR] .env file not found & pause & exit /b 1 )

echo [1/4] Migration status...
echo ------------------------------------------
node database/migrate.js --status
if %errorlevel% neq 0 ( echo [ERROR] Cannot connect to database & pause & exit /b 1 )

echo.
echo [2/4] Running migrations...
echo ------------------------------------------
node database/migrate.js
if %errorlevel% neq 0 ( echo [ERROR] Migration failed -- deploy cancelled & pause & exit /b 1 )

echo.
echo [3/4] Git commit and push...
echo ------------------------------------------

set "MSG=%~1"
if "!MSG!"=="" set "MSG=deploy: auto"

git add -A

git diff --cached --quiet
if %errorlevel% equ 0 (
    echo   No changes to commit
) else (
    git commit -m "!MSG!"
    if %errorlevel% neq 0 ( echo [ERROR] git commit failed & pause & exit /b 1 )
    echo   Committed: !MSG!
)

git push origin main
if %errorlevel% neq 0 ( echo [ERROR] git push failed & pause & exit /b 1 )

echo.
echo [4/4] Railway deploying...
echo ------------------------------------------
echo   Check: https://railway.app/dashboard
echo.
echo ==========================================
echo   Deploy complete!
echo ==========================================
echo.
pause

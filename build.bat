@echo off
REM Basic Pitch Audio-to-MIDI & Stem Extractor
REM Automated Build & Launch Script for Windows

echo ============================================================
echo  Basic Pitch Audio-to-MIDI Toolkit - Windows Setup
echo ============================================================

if "%1"=="clean" goto do_clean
if "%1"=="--clean" goto do_clean
goto check_node

:do_clean
echo Removing build artifacts (dist/, release/, node_modules/.vite)...
if exist dist rmdir /s /q dist
if exist release rmdir /s /q release
if exist node_modules\.vite rmdir /s /q node_modules\.vite
echo [SUCCESS] Clean completed.
if "%2"=="" exit /b 0

:check_node
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js 18+ from https://nodejs.org or via winget:
    echo   winget install OpenJS.NodeJS.LTS
    pause
    exit /b 1
)

REM Execute the cross-platform Node script with any passed arguments
node scripts\build.mjs %*
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build script failed.
    pause
    exit /b %ERRORLEVEL%
)

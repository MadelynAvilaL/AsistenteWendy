@echo off
title WENDY
cd /d "%~dp0"

rem ==========================================================
rem  Doble clic para iniciar a Wendy:
rem  1) Arranca el servidor (si no estaba corriendo)
rem  2) Abre Wendy en una ventana propia de Chrome o Edge
rem     que la deja hablar sin tener que tocar la pagina.
rem ==========================================================

if not exist "node_modules" (
  echo Instalando librerias por primera vez, espera un momento...
  call npm.cmd install
)

call :servidor_listo
if errorlevel 1 (
  echo Iniciando el servidor de Wendy...
  start "WENDY - servidor (no cierres esta ventana)" /min cmd /k "npm.cmd start"
  for /l %%i in (1,1,20) do (
    timeout /t 1 /nobreak >nul
    call :servidor_listo
    if not errorlevel 1 goto abrir
  )
  echo No pude iniciar el servidor. Revisa la ventana "WENDY - servidor".
  pause
  exit /b 1
)

:abrir
set "URL=http://localhost:3000"
set "PERFIL=%LOCALAPPDATA%\WendyNavegador"

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=%URL% --user-data-dir="%PERFIL%" --autoplay-policy=no-user-gesture-required
  exit /b 0
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app=%URL% --user-data-dir="%PERFIL%" --autoplay-policy=no-user-gesture-required
  exit /b 0
)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
  start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --app=%URL% --user-data-dir="%PERFIL%" --autoplay-policy=no-user-gesture-required
  exit /b 0
)
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=%URL% --user-data-dir="%PERFIL%" --autoplay-policy=no-user-gesture-required
  exit /b 0
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=%URL% --user-data-dir="%PERFIL%" --autoplay-policy=no-user-gesture-required
  exit /b 0
)
echo No encontre Chrome ni Edge. Abre %URL% en tu navegador.
start "" %URL%
exit /b 0

:servidor_listo
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3000/api/status | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%

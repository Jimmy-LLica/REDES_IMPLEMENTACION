@echo off
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Instala Node.js 22 o 24 para ejecutar Node-RED.
  echo Puedes abrir index.html para usar la simulacion sin instalar nada.
  pause
  exit /b 1
)
if not exist "node_modules\.bin\node-red.cmd" (
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm.cmd start -- --abrir
pause

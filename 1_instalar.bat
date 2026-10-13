@echo off
chcp 65001 >nul
title Relevamiento Ley Pierri - instalacion
echo ============================================
echo   Relevamiento Ley Pierri - instalacion
echo ============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo No encuentro Node.js. Instalalo desde https://nodejs.org (version LTS, siguiente-siguiente-listo)
  echo y despues volve a abrir este archivo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v" %%a in ('node -v') do set NV=%%a
echo Node encontrado: 
node -v
echo.
echo Instalando las tres librerias que usa la aplicacion (una sola vez)...
call npm.cmd install pdfjs-dist@4.10.38 pdf-lib@1.17.1 xlsx@0.18.5 --no-fund --no-audit
if errorlevel 1 (
  echo.
  echo Algo fallo en la instalacion. Copia el mensaje de arriba y mandaselo a Balta.
  pause
  exit /b 1
)
echo.
echo Listo. Ahora abri 2_abrir.bat
pause

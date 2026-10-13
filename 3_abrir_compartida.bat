@echo off
chcp 65001 >nul
title Relevamiento Ley Pierri (compartida en la red)
cd /d "%~dp0"
set /p CLAVE=Elegi una contrasena para que entren los demas (usuario: pierri): 
echo.
echo Abriendo compartida en la red de la oficina... (esta ventana tiene que quedar abierta)
node pierri.js --compartir --clave-acceso %CLAVE%
pause

@echo off
chcp 65001 >nul
title Relevamiento Ley Pierri
cd /d "%~dp0"
echo Abriendo la aplicacion... (esta ventana tiene que quedar abierta; para cerrar, Ctrl+C o cerrar la ventana)
node pierri.js
pause

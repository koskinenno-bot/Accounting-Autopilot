@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kaynnista.ps1"
echo.
echo Jos jokin meni pieleen, kopioi yllaoleva teksti Claudelle.
pause

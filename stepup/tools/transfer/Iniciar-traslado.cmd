@echo off
rem Ensayo del traslado de TeacherFlow: abre un formulario para ingresar tus datos una sola vez y ejecuta todo el circuito.
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0Iniciar-traslado.ps1" %*
set TF_EXIT=%ERRORLEVEL%
echo.
pause
exit /b %TF_EXIT%

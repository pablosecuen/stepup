@echo off
rem Traslado de TeacherFlow a la web (pasos 1 a 7): abre UN formulario para ingresar tus datos una sola vez y ejecuta todo el circuito con esa unica sesion.
rem Nunca congela el origen ni borra nada. Si se interrumpe, se puede volver a abrir: retoma donde quedo sin duplicar.
rem Opciones utiles: --fases backup,esquema,archivo,despliegue,proteccion,importar,archivos,final   --rehacer
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0Iniciar-traslado.ps1" -Modo traslado %*
set TF_EXIT=%ERRORLEVEL%
echo.
pause
exit /b %TF_EXIT%

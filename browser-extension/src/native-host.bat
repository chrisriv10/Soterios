@echo off
REM Soterios Native Messaging Host
set SOTERIOS_APP_PATH=%INSTDIR%\Soterios.exe
set NODE_PATH=%~dp0..\node_modules
node "%~dp0native-host.js" %*

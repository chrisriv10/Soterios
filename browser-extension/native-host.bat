@echo off
REM Soterios Native Messaging Host
REM This batch file launches the Node.js native host that communicates with the desktop app

set NODE_PATH=%~dp0..\..\node_modules
node "%~dp0native-host.js" %*
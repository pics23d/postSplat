@echo off
setlocal
rem [custom] Launch the SuperSplat desktop DEV build without packaging.
rem   - runs node_modules\electron\dist\electron.exe on this repo (dist\ + electron\dist\
rem     as last built by `npm run desktop:build`); builds once if either is missing
rem   - drop .ply / .sog / .spz / .ssproj files on this file to open them
rem   - keeps DevTools port 9222 and writes the renderer log to %LOCALAPPDATA%\Temp\supersplat-dev.log
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "ELECTRON=%ROOT%\node_modules\electron\dist\electron.exe"
set "LOG=%LOCALAPPDATA%\Temp\supersplat-dev.log"
rem VS Code terminals export this; it would turn Electron into a plain Node process
set ELECTRON_RUN_AS_NODE=

if not exist "%ELECTRON%" (
    echo Electron is not installed. Run "npm ci" in %ROOT% first.
    pause
    exit /b 1
)
if not exist "%ROOT%\dist\index.js" goto build
if not exist "%ROOT%\electron\dist\main.js" goto build
goto launch

:build
echo No dev bundle yet - building it (about 40 s)...
pushd "%ROOT%"
call npm run desktop:build
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" (
    echo Build failed.
    pause
    exit /b 1
)

:launch
if exist "%LOG%" del "%LOG%"
start "" "%ELECTRON%" "%ROOT%" --remote-debugging-port=9222 "--log-file=%LOG%" %*
endlocal

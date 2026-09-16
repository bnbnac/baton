@echo off
setlocal
cd /d "%~dp0"
set "DOTNET_CLI_HOME=%CD%\.buildhome"
set "DOTNET_CLI_TELEMETRY_OPTOUT=1"
set "DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1"
set "NUGET_PACKAGES=%CD%\.packages"
set "NUGET_HTTP_CACHE_PATH=%CD%\.buildhome\nuget-http"
dotnet restore src\Baton.App --configfile NuGet.Config
if errorlevel 1 exit /b 1
dotnet restore tests\Baton.Tests --configfile NuGet.Config
if errorlevel 1 exit /b 1
dotnet build src\Baton.App -c Release --no-restore
if errorlevel 1 exit /b 1
dotnet build src\Baton.Adapter -c Release --no-restore
if errorlevel 1 exit /b 1
if /i "%~1"=="test" goto test
if /i "%~1"=="publish" goto publish
exit /b 0
:test
call npm.cmd ci --ignore-scripts --no-audit --no-fund --cache .buildhome\npm-cache
if errorlevel 1 exit /b 1
dotnet test tests\Baton.Tests -c Release --no-restore
exit /b %errorlevel%
:publish
dotnet publish src\Baton.App -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o artifacts\Baton\app
if errorlevel 1 exit /b 1
dotnet publish src\Baton.Adapter -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o artifacts\Baton\adapter
if errorlevel 1 exit /b 1
copy /y README.md artifacts\Baton\README.md >nul
if errorlevel 1 exit /b 1
xcopy docs artifacts\Baton\docs\ /e /i /y >nul
if errorlevel 1 exit /b 1
exit /b 0

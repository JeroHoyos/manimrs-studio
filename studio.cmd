@echo off
rem Slide Studio. Double click or "studio" opens the panel; "studio help" lists the commands.
uv run --no-project --quiet "%~dp0engine\studio.py" %*
if errorlevel 1 if "%~1"=="" pause

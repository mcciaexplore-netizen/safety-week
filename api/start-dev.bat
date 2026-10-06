@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements-dev.txt
)
.venv\Scripts\python start_dev.py
pause

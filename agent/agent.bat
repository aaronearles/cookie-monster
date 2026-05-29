@echo off
REM Cookie-Monster native messaging host launcher.
REM Called directly by the browser — must not open a window or print to stderr.
REM
REM install.ps1 rewrites the python path below to a full absolute path
REM so the browser's PATH-less environment can find it.

python "%~dp0agent.py"

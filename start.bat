@echo off
echo ===================================================
echo Starting ChroniX Backend and Frontend...
echo ===================================================

start "ChroniX Backend (FastAPI)" cmd /k "cd backend && python main.py"

echo Waiting for backend to become ready...
curl.exe -s -f -o NUL --connect-timeout 1 --retry 15 --retry-max-time 30 --retry-connrefused http://127.0.0.1:8000/api/health
if errorlevel 1 (
	echo Backend did not become ready. The frontend was not started.
	pause
	exit /b 1
)

start "ChroniX Frontend (Vite)" cmd /k "cd frontend && npm run dev"

echo.
echo Both servers are starting up!
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
pause

@echo off
echo ===================================================
echo Starting ChroniX Backend and Frontend...
echo ===================================================

start "ChroniX Backend (FastAPI)" cmd /k "cd backend && python main.py"
start "ChroniX Frontend (Vite)" cmd /k "cd frontend && npm run dev"

echo.
echo Both servers are starting up!
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
pause

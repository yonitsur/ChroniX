Write-Host "Starting ChroniX..." -ForegroundColor Cyan

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; python main.py"

Write-Host "Waiting for backend to become ready..." -ForegroundColor Yellow
& curl.exe -s -f -o NUL --connect-timeout 1 --retry 15 --retry-max-time 30 --retry-connrefused http://127.0.0.1:8000/api/health
if ($LASTEXITCODE -ne 0) {
	Write-Error "Backend did not become ready. The frontend was not started."
	exit 1
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"

Write-Host "ChroniX services launched!" -ForegroundColor Green
Write-Host "Backend:  http://localhost:8000" -ForegroundColor Yellow
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Yellow

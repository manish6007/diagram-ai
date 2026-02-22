@echo off
setlocal
title DiagramAI Startup

echo ==========================================
echo Starting DiagramAI System...
echo ==========================================

:: Start Python Bridge
echo Starting Python Bridge (Port 8765)...
start "DiagramAI - Python Bridge" cmd /k "cd mcp-bridge && python server.py"

:: Start Backend
echo Starting TypeScript Backend (Port 4000)...
start "DiagramAI - Backend" cmd /k "cd backend && npm run dev"

:: Start Frontend
echo Starting React Frontend (Port 3000)...
start "DiagramAI - Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ==========================================
echo All components have been launched!
echo Python Bridge: http://localhost:8765
echo Backend API  : http://localhost:4000
echo Frontend UI  : http://localhost:3000
echo ==========================================
echo.
echo You can close this window now.
pause

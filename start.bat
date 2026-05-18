@echo off
chcp 65001 > nul
echo.
echo ╔══════════════════════════════════════════╗
echo ║        图片上传平台 - 启动脚本            ║
echo ╚══════════════════════════════════════════╝
echo.

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

REM 检查依赖
if not exist "node_modules" (
    echo [信息] 正在安装依赖...
    npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

echo [信息] 正在启动服务器...
echo [信息] 服务启动后请访问: http://localhost:3000
echo [信息] 按 Ctrl+C 可停止服务
echo.
node server.js
pause

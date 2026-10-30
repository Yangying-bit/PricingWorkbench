@echo off
setlocal
cd /d "%~dp0"
if not exist "PricingWorkbench.Desktop.csproj" (
  echo [错误] 请把此 BAT 放在 PricingWorkbench.Desktop.csproj 所在的项目根目录。
  pause
  exit /b 1
)
echo 正在恢复依赖...
dotnet restore
if errorlevel 1 goto :fail
echo 正在启动智能定价工作台...
dotnet run
if errorlevel 1 goto :fail
exit /b 0
:fail
echo.
echo 运行失败。请复制上方完整错误信息进行排查。
pause
exit /b 1

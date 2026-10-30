@echo off
setlocal
cd /d "%~dp0"
if not exist "PricingWorkbench.Desktop.csproj" (
  echo [错误] 请把此 BAT 放在 PricingWorkbench.Desktop.csproj 所在的项目根目录。
  pause
  exit /b 1
)
echo 正在发布 Windows x64 自包含版本...
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false
if errorlevel 1 goto :fail
echo.
echo 发布完成。请检查 bin\Release\net10.0\win-x64\publish\ 文件夹。
echo 分发时请压缩整个 publish 文件夹，不要只复制 EXE。
pause
exit /b 0
:fail
echo.
echo 发布失败。请复制上方完整错误信息进行排查。
pause
exit /b 1

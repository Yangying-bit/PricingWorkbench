PricingWorkbench.Desktop - HTML 工作台接入包（V3 线路约束修复版）

本包用于已创建、且当前能显示“Welcome to Avalonia!”的 PricingWorkbench.Desktop 项目。
它不是完整新项目，请解压到现有项目根目录（含 PricingWorkbench.Desktop.csproj）。

建议操作：
1. 关闭当前桌面程序。
2. 备份项目内 Views/MainWindow.axaml、Views/MainWindow.axaml.cs，以及 Assets/pricing_workbench.html（如存在）。
3. 将本包里的 Assets 与 Views 文件夹复制到项目根目录，允许覆盖同名文件。
4. 在项目根目录打开 PowerShell/终端，执行：
   dotnet add package Avalonia.Controls.WebView
5. 打开 PricingWorkbench.Desktop.csproj，把 csproj_update.xml 中的 ItemGroup 合并到已有 <Project> 内部；不要覆盖整个 csproj，也不要重复添加同一文件项。
6. 在项目根目录执行：
   dotnet restore
   dotnet run
7. 窗口应显示智能定价工作台，而非 Avalonia 欢迎页面。

如要更简单，可将文件复制好、合并 csproj 后，双击 run.bat 运行。

发布 Windows 便携目录：
在项目根目录、确认 dotnet run 正常后，执行：
   dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false

或双击 publish_windows.bat。输出通常在：
bin\Release\net10.0\win-x64\publish\
如果 csproj 的 TargetFramework 不是 net10.0，请按项目内配置定位输出目录。
请分发整个 publish 文件夹并可再压缩成 ZIP，不要只复制 exe。

重要说明：
- 当前 HTML 为 V3 线路约束修复版。
- HTML 内的 SheetJS 仍从 CDN 加载，因此导入/导出 Excel 时需要网络加载该脚本。完全离线发布前，要将 xlsx.full.min.js 下载到 Assets/vendor 并把 HTML 的 script src 改成相对本地路径。
- NativeWebView 在 Windows 上使用 Microsoft Edge WebView2。Windows 11 通常已预装；某些 Windows 10 设备需安装 WebView2 Runtime。
- 如果出现错误，请复制 PowerShell 中的完整红色错误内容，不要重装 SDK。

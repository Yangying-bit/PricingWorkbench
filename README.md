# PricingWorkbench

基于 .NET 10、Avalonia 和 WebView2 的智能定价与客户健康分析工作台。

## 1. 项目介绍

`PricingWorkbench` 是一个面向寄递业务场景的桌面工作台，结合 Avalonia 原生壳与 WebView2 页面能力，提供报价、线路约束、项目档案、客户档案和月报分析的一体化操作体验。

项目目标：
- 把复杂的报价与客户运营分析集中到一个本地桌面应用中；
- 保持核心业务逻辑本地可控，降低数据外发风险；
- 在不改动既有报价流程的前提下，增强客户健康分析与导出能力。

## 2. 项目主要功能

### 智能报价工作台
- 报价主页面加载 `Assets/pricing_workbench.html`，支持规则化操作与数据联动。

### Excel 报价导入和价格折算
- 支持常见工作表导入流程，进行字段映射和业务数据处理。

### 线路约束
- 支持线路规则解析与约束判定，保障报价可执行性。

### 毛利测算
- 支持基于导入数据的毛利相关计算视图。

### 目标毛利反算
- 支持按目标毛利反推关键参数，辅助定价决策。

### 项目档案
- 支持历史项目归档、回看、恢复与管理。

### 客户档案
- 提供客户维度档案管理与月度数据归集能力。

### 月度订单数据导入
- 支持按客户导入月度订单明细，用于后续健康分析。

### 地址解析与脱敏
- 使用行政区划字典进行地址省市识别，导出前执行脱敏处理。

### 客户健康月报
- 基于订单结构、品牌表现、同城/跨城占比等生成健康分析。

### HTML 月报导出
- 支持导出可分享的 HTML 月报，便于业务复盘与沟通。

## 3. 技术栈

- .NET 10
- Avalonia UI
- Avalonia NativeWebView（WebView2）
- HTML / CSS / JavaScript（工作台前端页面）
- 本地浏览器存储（用于部分页面端数据）

## 4. 项目目录结构

```text
PricingWorkbench.Desktop/
├─ Assets/                     # 前端页面、脚本、主题、字典与 vendor 依赖
│  ├─ pricing_workbench.html
│  ├─ customer_archive.js
│  ├─ customer_address.js
│  ├─ vendor/
│  └─ geo/
├─ Views/                      # Avalonia 视图
├─ ViewModels/                 # MVVM 视图模型
├─ Models/                     # 领域模型
├─ Services/                   # 服务层与桥接逻辑
├─ Styles/                     # 主题与样式资源
├─ installer/                  # 安装程序脚本
├─ tools/                      # 辅助工具脚本
├─ App.axaml
├─ Program.cs
└─ PricingWorkbench.Desktop.csproj
```

## 5. 开发环境要求

- Windows 10/11
- .NET SDK 10
- Visual Studio 2022（或更新版本）/ Cursor
- WebView2 Runtime（部分系统需手动安装）

## 6. 如何在 Visual Studio / Cursor 中运行

1. 打开项目根目录（包含 `PricingWorkbench.Desktop.csproj`）。
2. 执行依赖恢复：
   - `dotnet restore`
3. 启动应用：
   - `dotnet run`
4. 如需在 IDE 内运行，选择 `PricingWorkbench.Desktop.csproj` 作为启动项目。

## 7. 如何生成 Windows 发布版本

可使用命令行：

```powershell
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false
```

也可使用项目中的 `publish_windows.bat`。

常见发布输出目录：
- `bin/Release/net10.0/win-x64/publish/`

## 8. 本地依赖说明

- WebView2 Runtime：用于宿主加载 HTML 工作台页面。
- `Assets/vendor`：前端运行依赖（如表格处理库），属于应用必需资源。
- 行政区划字典：用于地址解析、同城判断与脱敏流程。

## 9. 数据存储和隐私说明

- 应用会在本机保存部分工作数据与配置（例如 WebView2 用户数据、浏览器本地存储、档案数据）。
- 客户地址数据在导入分析流程中支持解析与脱敏，导出报告不应包含详细地址等敏感字段。
- 禁止将真实 API Key、Token、密码、客户原始订单、对账文件、客户详细地址/电话、客户月报原始导出文件提交到远程仓库。
- 若用于演示或测试，测试数据需先脱敏再入库或入仓。

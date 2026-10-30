; PricingWorkbench 0.3.0 installer
; Fixed AppId for all future upgrades:
; {1D6ABCF4-5EF9-446E-9A13-01458E13AE25}

#define MyAppName "智能定价工作台"
#define MyAppVersion "0.3.0"
#define MyAppPublisher "PricingWorkbench"
#define MyAppExeName "PricingWorkbench.Desktop.exe"
#define MyAppDirName "PricingWorkbench"
#define MyAppId "{{1D6ABCF4-5EF9-446E-9A13-01458E13AE25}"
#define MyOutputBaseFilename "PricingWorkbench-0.3.0-Setup"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppDirName}
DefaultGroupName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
OutputDir=..\artifacts\release
OutputBaseFilename={#MyOutputBaseFilename}
SetupIconFile=..\Assets\avalonia-logo.ico
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
UsePreviousGroup=yes
CloseApplications=yes
ChangesAssociations=no
VersionInfoVersion=0.3.0.0
VersionInfoProductVersion=0.3.0

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: unchecked

[Files]
Source: "..\artifacts\publish\win-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "redist\MicrosoftEdgeWebView2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即启动{#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebView2RuntimeMachineKey = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2RuntimeUserKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function IsValidRuntimeVersion(const Value: string): Boolean;
var
  Version: string;
begin
  Version := Trim(Value);
  Result := (Version <> '') and (Version <> '0.0.0.0');
end;

function TryGetInstalledWebView2Version(var Version: string): Boolean;
begin
  Version := '';
  Result :=
    (RegQueryStringValue(HKLM, WebView2RuntimeMachineKey, 'pv', Version) and IsValidRuntimeVersion(Version)) or
    (RegQueryStringValue(HKCU, WebView2RuntimeUserKey, 'pv', Version) and IsValidRuntimeVersion(Version));
end;

function HasInstalledWebView2Runtime(): Boolean;
var
  Version: string;
begin
  Result := TryGetInstalledWebView2Version(Version);
end;

function InstallWebView2Runtime(var ErrorMessage: string): Boolean;
var
  InstallerPath: string;
  ResultCode: Integer;
  Version: string;
begin
  Result := False;
  ErrorMessage := '';
  InstallerPath := ExpandConstant('{tmp}\MicrosoftEdgeWebView2Setup.exe');

  try
    ExtractTemporaryFile('MicrosoftEdgeWebView2Setup.exe');
  except
    ErrorMessage := '无法提取 Microsoft Edge WebView2 Runtime 引导安装器。';
    exit;
  end;

  if not Exec(InstallerPath, '/silent /install', '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
  begin
    ErrorMessage := '无法启动 Microsoft Edge WebView2 Runtime 安装程序。';
    exit;
  end;

  if TryGetInstalledWebView2Version(Version) then
  begin
    Result := True;
    exit;
  end;

  ErrorMessage :=
    'Microsoft Edge WebView2 Runtime 安装未成功完成。' + #13#10 +
    '安装程序退出代码: ' + IntToStr(ResultCode) + #13#10 +
    '请先安装官方 WebView2 Runtime 后再重新运行安装向导。';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Response: Integer;
  ErrorMessage: string;
begin
  Result := '';

  if HasInstalledWebView2Runtime() then
    exit;

  Response := MsgBox(
    '检测到当前系统缺少 Microsoft Edge WebView2 Runtime。' + #13#10 + #13#10 +
    '智能定价工作台需要该组件才能显示主界面。' + #13#10 +
    '单击“确定”继续安装 Microsoft 官方 Runtime，单击“取消”中止安装。',
    mbConfirmation, MB_OKCANCEL);

  if Response <> IDOK then
  begin
    Result := '用户取消安装 Microsoft Edge WebView2 Runtime。';
    exit;
  end;

  if not InstallWebView2Runtime(ErrorMessage) then
  begin
    Result := ErrorMessage;
    exit;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usDone) and not UninstallSilent then
  begin
    MsgBox(
      '智能定价工作台程序文件已卸载。' + #13#10 + #13#10 +
      '历史报价档案和本地数据仍保存在以下用户目录中：' + #13#10 +
      ExpandConstant('{localappdata}\PricingWorkbench.Desktop\WebView2'),
      mbInformation, MB_OK);
  end;
end;

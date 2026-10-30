# PricingWorkbench 0.1.0 Installer Build Notes

## Purpose

This folder contains the Inno Setup implementation for building the formal Windows installer:

- Output target: `artifacts/release/PricingWorkbench-0.1.0-Setup.exe`
- Program source input: `artifacts/publish/win-x64/`
- WebView2 bootstrapper: `installer/redist/MicrosoftEdgeWebView2Setup.exe`

## Fixed App Identity

- AppId: `{1D6ABCF4-5EF9-446E-9A13-01458E13AE25}`

This AppId must remain unchanged for all future upgrades.

## Compiler

This machine currently does not have Inno Setup Compiler (`ISCC.exe`) installed.

Official download page:

- https://jrsoftware.org/isdl.php

After installing Inno Setup 6, compile with:

```powershell
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\PricingWorkbench.iss
```

or, if installed elsewhere:

```powershell
ISCC.exe installer\PricingWorkbench.iss
```

## WebView2 Runtime Strategy

- Uses Microsoft official Evergreen Bootstrapper
- Installer checks both:
  - `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
  - `HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
- Looks for `pv` and requires a non-empty version above `0.0.0.0`
- If missing, installer prompts the user and runs the bootstrapper

## User Data Protection

The installer and uninstaller must not remove:

- `%LocalAppData%\PricingWorkbench.Desktop\WebView2`

This preserves IndexedDB archives and local workbench history across upgrades and uninstall/reinstall.

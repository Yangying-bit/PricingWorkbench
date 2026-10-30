using System;
using System.IO;

namespace PricingWorkbench.Desktop.Services;

/// <summary>
/// Provides the stable per-user locations used by the desktop application.
/// </summary>
public static class AppPaths
{
    private const string ApplicationDirectoryName = "PricingWorkbench.Desktop";

    /// <summary>
    /// Gets the persistent WebView2 profile directory. It owns the existing IndexedDB archives.
    /// </summary>
    public static string WebView2UserDataFolder => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        ApplicationDirectoryName,
        "WebView2");

    /// <summary>
    /// Gets the location reserved for future native application settings.
    /// </summary>
    public static string SettingsFilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        ApplicationDirectoryName,
        "settings.json");
}

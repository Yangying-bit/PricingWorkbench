using System;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Platform;
using Avalonia.Platform.Storage;
using PricingWorkbench.Desktop.Services;
using PricingWorkbench.Desktop.ViewModels;

namespace PricingWorkbench.Desktop.Views;

public partial class MainWindow : Window
{
    private readonly ArchiveBridge _archiveBridge;
    private bool _archiveHostBound;

    public MainWindow()
    {
        InitializeComponent();
        WorkbenchWebView.EnvironmentRequested += OnWebViewEnvironmentRequested;
        _archiveBridge = new ArchiveBridge(WorkbenchWebView);
        DataContextChanged += OnDataContextChanged;
        BindArchiveHost();
        LoadWorkbench();
    }

    private static void OnWebViewEnvironmentRequested(object? sender, WebViewEnvironmentRequestedEventArgs e)
    {
        // Keep IndexedDB archives across restarts. WebView2 stores them in UserDataFolder.
        var userData = AppPaths.WebView2UserDataFolder;
        Directory.CreateDirectory(userData);

        if (e is WindowsWebView2EnvironmentRequestedEventArgs webView2)
        {
            webView2.UserDataFolder = userData;
            webView2.AdditionalBrowserArguments = "--allow-file-access-from-files";
        }
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        BindArchiveHost();
    }

    private void BindArchiveHost()
    {
        if (_archiveHostBound || DataContext is not MainViewModel viewModel)
        {
            return;
        }

        viewModel.Archives.Bridge = _archiveBridge;
        viewModel.Archives.RequestOpenBackupPath += OpenBackupPathAsync;
        viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _archiveHostBound = true;
        UpdateWorkspaceHost(viewModel);
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (sender is MainViewModel viewModel
            && (e.PropertyName == nameof(MainViewModel.IsWorkspaceVisible)
                || e.PropertyName == nameof(MainViewModel.IsWebViewExpanded)
                || e.PropertyName == nameof(MainViewModel.IsCustomersVisible)
                || e.PropertyName == nameof(MainViewModel.CurrentPage)))
        {
            UpdateWorkspaceHost(viewModel);
        }
    }

    private void UpdateWorkspaceHost(MainViewModel viewModel)
    {
        if (viewModel.IsWebViewExpanded)
        {
            WorkspaceHost.Width = double.NaN;
            WorkspaceHost.Height = double.NaN;
            WorkspaceHost.HorizontalAlignment = HorizontalAlignment.Stretch;
            WorkspaceHost.VerticalAlignment = VerticalAlignment.Stretch;
            _ = SwitchCustomerOverlayAsync(viewModel.IsCustomersVisible);
            return;
        }

        // HWND WebView2 stays alive for InvokeScript, but must not cover native pages.
        WorkspaceHost.Width = 1;
        WorkspaceHost.Height = 1;
        WorkspaceHost.HorizontalAlignment = HorizontalAlignment.Left;
        WorkspaceHost.VerticalAlignment = VerticalAlignment.Top;
        _ = SwitchCustomerOverlayAsync(false);
    }

    private async Task SwitchCustomerOverlayAsync(bool showCustomers)
    {
        try
        {
            await _archiveBridge.WaitUntilReadyAsync(TimeSpan.FromSeconds(20));
            var script = showCustomers
                ? "window.__pwCustomer&&window.__pwCustomer.show()"
                : "window.__pwCustomer&&window.__pwCustomer.hide()";
            _ = await WorkbenchWebView.InvokeScript(script);
        }
        catch (Exception)
        {
            // Overlay switch is best-effort; quote WebView instance and Source stay unchanged.
        }
    }

    private async Task<string?> OpenBackupPathAsync(string title, string typeName)
    {
        var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = title,
            AllowMultiple = false,
            FileTypeFilter =
            [
                new FilePickerFileType(typeName)
                {
                    Patterns = ["*.json"],
                },
            ],
        });
        return files.FirstOrDefault()?.TryGetLocalPath();
    }

    private void LoadWorkbench()
    {
        var htmlPath = Path.Combine(AppContext.BaseDirectory, "Assets", "pricing_workbench.html");

        if (!File.Exists(htmlPath))
        {
            Title = "智能定价工作台（未找到界面文件）";
            Content = new TextBlock
            {
                Text = "未找到 Assets\\pricing_workbench.html。请确认 HTML 文件已复制到输出目录。",
                Margin = new Avalonia.Thickness(24),
                TextWrapping = Avalonia.Media.TextWrapping.Wrap
            };
            return;
        }

        WorkbenchWebView.Source = new Uri(Path.GetFullPath(htmlPath));
    }
}

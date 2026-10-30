using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PricingWorkbench.Desktop.Models;
using PricingWorkbench.Desktop.Services;

namespace PricingWorkbench.Desktop.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    private const string HomeTitle = "首页";
    private const string WorkspaceTitle = "报价工作台";
    private const string ArchivesTitle = "项目档案";
    private const string CustomersTitle = "客户档案";
    private const string SettingsTitle = "设置";
    private const string AboutTitle = "关于软件";

    public MainViewModel()
    {
        Archives = new ArchivesViewModel();
        Archives.RequestNavigateWorkspace += NavigateWorkspace;
    }

    public ArchivesViewModel Archives { get; }

    [ObservableProperty]
    private ShellPage currentPage = ShellPage.Home;

    public string CurrentPageTitle => CurrentPage switch
    {
        ShellPage.Home => HomeTitle,
        ShellPage.Workspace => WorkspaceTitle,
        ShellPage.Archives => ArchivesTitle,
        ShellPage.Customers => CustomersTitle,
        ShellPage.Settings => SettingsTitle,
        ShellPage.About => AboutTitle,
        _ => HomeTitle,
    };

    public bool IsHomeVisible => CurrentPage == ShellPage.Home;

    public bool IsWorkspaceVisible => CurrentPage == ShellPage.Workspace;

    public bool IsArchivesVisible => CurrentPage == ShellPage.Archives;

    public bool IsCustomersVisible => CurrentPage == ShellPage.Customers;

    public bool IsWebViewExpanded => CurrentPage == ShellPage.Workspace || CurrentPage == ShellPage.Customers;

    public bool IsSettingsVisible => CurrentPage == ShellPage.Settings;

    public bool IsAboutVisible => CurrentPage == ShellPage.About;

    public string UserDataFolder => AppPaths.WebView2UserDataFolder;

    public string SettingsFilePath => AppPaths.SettingsFilePath;

    [RelayCommand]
    private void NavigateHome()
    {
        CurrentPage = ShellPage.Home;
    }

    [RelayCommand]
    private void NavigateWorkspace()
    {
        CurrentPage = ShellPage.Workspace;
    }

    [RelayCommand]
    private void NavigateArchives()
    {
        CurrentPage = ShellPage.Archives;
    }

    [RelayCommand]
    private void NavigateCustomers()
    {
        CurrentPage = ShellPage.Customers;
    }

    [RelayCommand]
    private void NavigateSettings()
    {
        CurrentPage = ShellPage.Settings;
    }

    [RelayCommand]
    private void NavigateAbout()
    {
        CurrentPage = ShellPage.About;
    }

    partial void OnCurrentPageChanged(ShellPage value)
    {
        OnPropertyChanged(nameof(CurrentPageTitle));
        OnPropertyChanged(nameof(IsHomeVisible));
        OnPropertyChanged(nameof(IsWorkspaceVisible));
        OnPropertyChanged(nameof(IsArchivesVisible));
        OnPropertyChanged(nameof(IsCustomersVisible));
        OnPropertyChanged(nameof(IsWebViewExpanded));
        OnPropertyChanged(nameof(IsSettingsVisible));
        OnPropertyChanged(nameof(IsAboutVisible));
        if (value == ShellPage.Archives)
        {
            _ = Archives.RefreshCommand.ExecuteAsync(null);
        }
    }
}

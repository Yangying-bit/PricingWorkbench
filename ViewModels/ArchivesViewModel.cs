using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PricingWorkbench.Desktop.Models;
using PricingWorkbench.Desktop.Services;

namespace PricingWorkbench.Desktop.ViewModels;

public partial class ArchivesViewModel : ViewModelBase
{
    private readonly ObservableCollection<ArchiveSummary> _all = new();

    [ObservableProperty]
    private string searchText = "";

    [ObservableProperty]
    private int sortIndex;

    [ObservableProperty]
    private bool isLoading;

    [ObservableProperty]
    private string? errorMessage;

    [ObservableProperty]
    private string statusText = "尚未读取档案。";

    [ObservableProperty]
    private bool isConfirmVisible;

    [ObservableProperty]
    private string confirmTitle = "";

    [ObservableProperty]
    private string confirmMessage = "";

    [ObservableProperty]
    private ArchiveSummary? selectedArchive;

    private TaskCompletionSource<bool>? _confirmTcs;

    public ArchivesViewModel()
    {
        VisibleItems = new ObservableCollection<ArchiveSummary>();
    }

    public ArchiveBridge? Bridge { get; set; }

    public ObservableCollection<ArchiveSummary> VisibleItems { get; }

    public bool HasItems => VisibleItems.Count > 0;

    public bool ShowEmptyState => !IsLoading && string.IsNullOrWhiteSpace(ErrorMessage) && VisibleItems.Count == 0;

    public bool HasError => !string.IsNullOrWhiteSpace(ErrorMessage);

    public event Action? RequestNavigateWorkspace;

    public event Func<string, string, Task<string?>>? RequestOpenBackupPath;

    partial void OnSearchTextChanged(string value) => ApplyFilter();

    partial void OnSortIndexChanged(int value) => ApplyFilter();

    partial void OnIsLoadingChanged(bool value) => NotifyState();

    partial void OnErrorMessageChanged(string? value) => NotifyState();

    [RelayCommand]
    public async Task RefreshAsync()
    {
        if (Bridge is null)
        {
            ErrorMessage = "档案桥接尚未就绪。";
            return;
        }

        IsLoading = true;
        ErrorMessage = null;
        StatusText = "正在读取 IndexedDB 档案摘要…";
        try
        {
            var result = await Bridge.ListAsync();
            _all.Clear();
            if (result.Ok && result.Value is not null)
            {
                foreach (var item in result.Value)
                {
                    _all.Add(item);
                }
            }

            ApplyFilter();
            StatusText = _all.Count == 0
                ? "当前没有已保存的报价档案。"
                : "已读取 " + _all.Count + " 条真实档案摘要。";
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            StatusText = "读取档案失败。";
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task OpenArchiveAsync(ArchiveSummary? item)
    {
        item ??= SelectedArchive;
        if (item is null || Bridge is null)
        {
            return;
        }

        var confirmed = await ConfirmAsync(
            "打开历史档案",
            "打开「" + item.DisplayName + "」会替换当前工作台中尚未保存的内容。恢复的是已保存的工作表结果和线路规则，不会重新计算报价，也不会恢复成本表或毛利测算中间结果。是否打开？");
        if (!confirmed)
        {
            return;
        }

        await OpenConfirmedAsync(item);
    }

    [RelayCommand]
    private async Task DeleteArchiveAsync(ArchiveSummary? item)
    {
        item ??= SelectedArchive;
        if (item is null || Bridge is null)
        {
            return;
        }

        var confirmed = await ConfirmAsync(
            "删除档案",
            "确定删除档案「" + item.DisplayName + "」？此操作只删除这一条 IndexedDB 记录，不可恢复。");
        if (!confirmed)
        {
            return;
        }

        await DeleteConfirmedAsync(item);
    }

    [RelayCommand]
    private async Task ExportOneAsync(ArchiveSummary? item)
    {
        item ??= SelectedArchive;
        if (item is null || Bridge is null)
        {
            return;
        }

        try
        {
            await Bridge.ExportAsync(item.Id);
            StatusText = "已开始导出「" + item.DisplayName + "」。";
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
    }

    [RelayCommand]
    private async Task BackupAllAsync()
    {
        if (Bridge is null)
        {
            return;
        }

        try
        {
            await Bridge.ExportAsync();
            StatusText = "已开始导出全部档案 JSON 备份。";
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
    }

    [RelayCommand]
    private async Task RestoreBackupAsync()
    {
        if (Bridge is null || RequestOpenBackupPath is null)
        {
            return;
        }

        var path = await RequestOpenBackupPath(
            "选择档案备份 JSON",
            "JSON 档案备份");
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        try
        {
            var result = await Bridge.ImportAsync(path);
            if (result.NeedsConfirm && result.Import is not null)
            {
                var names = string.Join("、", result.Import.Conflicts.Take(8).Select(c =>
                    string.IsNullOrWhiteSpace(c.FileName) ? c.Id : c.FileName));
                var confirmed = await ConfirmAsync(
                    "档案 ID 冲突",
                    "有 "
                    + result.Import.Conflicts.Count
                    + " 条档案 ID 与现有记录冲突（"
                    + names
                    + "）。默认不会覆盖。是否覆盖这些冲突档案？");
                if (!confirmed)
                {
                    await Bridge.ImportAsync(path, confirm: false, hasConfirmFlag: true);
                    StatusText = "已取消导入，未覆盖现有档案。";
                    return;
                }

                result = await Bridge.ImportAsync(path, confirm: true, hasConfirmFlag: true);
            }

            if (result.Ok || result.Value is { Ok: true } || result.Import is { Ok: true })
            {
                var imported = result.Value?.Imported ?? result.Import?.Imported ?? 0;
                StatusText = "已导入 " + imported + " 条档案。";
                await RefreshAsync();
                return;
            }

            if (result.Cancelled)
            {
                StatusText = "已取消导入，未覆盖现有档案。";
                return;
            }

            ErrorMessage = result.Error ?? result.Import?.Error ?? "导入失败。";
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
    }

    [RelayCommand]
    private void ConfirmYes()
    {
        CompleteConfirm(true);
    }

    [RelayCommand]
    private void ConfirmNo()
    {
        CompleteConfirm(false);
    }

    private async Task OpenConfirmedAsync(ArchiveSummary item)
    {
        if (Bridge is null)
        {
            return;
        }

        try
        {
            var opened = await Bridge.OpenAsync(item.Id);
            if (!opened.Ok)
            {
                ErrorMessage = opened.Error ?? "打开档案失败。";
                return;
            }

            StatusText = "已打开档案「" + (opened.Value?.FileName ?? item.DisplayName) + "」。";
            RequestNavigateWorkspace?.Invoke();
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
    }

    private async Task DeleteConfirmedAsync(ArchiveSummary item)
    {
        if (Bridge is null)
        {
            return;
        }

        try
        {
            await Bridge.RemoveAsync(item.Id);
            StatusText = "已删除档案「" + item.DisplayName + "」。";
            await RefreshAsync();
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await RefreshAsync();
        }
    }

    private Task<bool> ConfirmAsync(string title, string message)
    {
        CompleteConfirm(false);
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _confirmTcs = tcs;
        ConfirmTitle = title;
        ConfirmMessage = message;
        IsConfirmVisible = true;
        return tcs.Task;
    }

    private void CompleteConfirm(bool confirmed)
    {
        var tcs = _confirmTcs;
        _confirmTcs = null;
        IsConfirmVisible = false;
        tcs?.TrySetResult(confirmed);
    }

    private void ApplyFilter()
    {
        var query = SearchText?.Trim() ?? "";
        var items = _all.AsEnumerable();
        if (!string.IsNullOrEmpty(query))
        {
            items = items.Where(x =>
                x.DisplayName.Contains(query, StringComparison.OrdinalIgnoreCase)
                || x.Id.Contains(query, StringComparison.OrdinalIgnoreCase));
        }

        items = SortIndex == 1
            ? items.OrderBy(x => x.Ts, StringComparer.Ordinal)
            : items.OrderByDescending(x => x.Ts, StringComparer.Ordinal);

        VisibleItems.Clear();
        foreach (var item in items)
        {
            VisibleItems.Add(item);
        }

        NotifyState();
    }

    private void NotifyState()
    {
        OnPropertyChanged(nameof(HasItems));
        OnPropertyChanged(nameof(ShowEmptyState));
        OnPropertyChanged(nameof(HasError));
    }
}

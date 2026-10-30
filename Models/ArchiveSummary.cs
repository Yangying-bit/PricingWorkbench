using System;

namespace PricingWorkbench.Desktop.Models;

/// <summary>
/// Lightweight archive metadata transferred from IndexedDB to the native shell.
/// This type must never include sheet CSV contents.
/// </summary>
public sealed class ArchiveSummary
{
    public string Id { get; set; } = "";

    public string FileName { get; set; } = "";

    public string Ts { get; set; } = "";

    public string StdVersion { get; set; } = "";

    public int SheetCount { get; set; }

    public int TotalRows { get; set; }

    public int ChangedCells { get; set; }

    public int RouteCount { get; set; }

    public string DisplayName => string.IsNullOrWhiteSpace(FileName) ? "未命名档案" : FileName;

    public string SavedAtText
    {
        get
        {
            if (DateTimeOffset.TryParse(Ts, out var value))
            {
                return value.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
            }

            return string.IsNullOrWhiteSpace(Ts) ? "保存时间未知" : Ts;
        }
    }

    public string MetaText =>
        SavedAtText
        + " · "
        + SheetCount
        + " 个工作表 · "
        + TotalRows.ToString("N0")
        + " 行 · 校正 "
        + ChangedCells.ToString("N0")
        + " 单元格 · 线路规则 "
        + RouteCount;
}

namespace PricingWorkbench.Desktop.Models;

/// <summary>
/// Existing IndexedDB record that would be overwritten by a backup import.
/// </summary>
public sealed class ArchiveConflict
{
    public string Id { get; set; } = "";

    public string FileName { get; set; } = "";

    public string Ts { get; set; } = "";
}

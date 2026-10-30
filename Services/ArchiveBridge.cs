using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Controls;
using PricingWorkbench.Desktop.Models;

namespace PricingWorkbench.Desktop.Services;

/// <summary>
/// Hosts the NativeWebView JSON command channel for IndexedDB archives.
/// Full sheet CSV never crosses this bridge.
/// </summary>
public sealed class ArchiveBridge
{
    public const int ProtocolVersion = 1;
    public const int MaxMessageBytes = 262144;

    private static readonly Regex ArchiveIdPattern = new("^rec_\\d+$", RegexOptions.Compiled);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly NativeWebView _webView;
    private readonly ConcurrentDictionary<string, PendingRequest> _pending = new();
    private readonly TaskCompletionSource<bool> _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public ArchiveBridge(NativeWebView webView)
    {
        _webView = webView;
        _webView.WebMessageReceived += OnWebMessageReceived;
        _webView.NavigationCompleted += OnNavigationCompleted;
    }

    public bool IsPageReady { get; private set; }

    public Uri? CurrentSource => _webView.Source;

    public NativeWebView WebView => _webView;

    public static bool IsValidArchiveId(string? id) =>
        !string.IsNullOrWhiteSpace(id) && ArchiveIdPattern.IsMatch(id);

    public async Task WaitUntilReadyAsync(TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        await _ready.Task.WaitAsync(cts.Token);
    }

    public Task<ArchiveCommandResult<List<ArchiveSummary>>> ListAsync(CancellationToken cancellationToken = default) =>
        SendAsync<List<ArchiveSummary>>(
            "archive.list",
            "archive.list",
            new { },
            TimeSpan.FromSeconds(30),
            ReadList,
            cancellationToken);

    public Task<ArchiveCommandResult<ArchiveOpenInfo>> OpenAsync(string id, CancellationToken cancellationToken = default)
    {
        EnsureArchiveId(id);
        return SendAsync<ArchiveOpenInfo>(
            "archive.open",
            "archive.open",
            new { id },
            TimeSpan.FromMinutes(3),
            ReadOpen,
            cancellationToken);
    }

    public Task<ArchiveCommandResult<string>> RemoveAsync(string id, CancellationToken cancellationToken = default)
    {
        EnsureArchiveId(id);
        return SendAsync<string>(
            "archive.remove",
            "archive.remove",
            new { id },
            TimeSpan.FromSeconds(30),
            (ok, payload, fallback) => ok
                ? (GetString(payload, "id") ?? id)
                : throw Failed(fallback, payload),
            cancellationToken);
    }

    public Task<ArchiveCommandResult<string>> ExportAsync(string? id = null, CancellationToken cancellationToken = default)
    {
        object payload = string.IsNullOrWhiteSpace(id) ? new { } : new { id };
        if (!string.IsNullOrWhiteSpace(id))
        {
            EnsureArchiveId(id);
        }

        return SendAsync<string>(
            "archive.export",
            "archive.export",
            payload,
            TimeSpan.FromMinutes(2),
            (_, p, fallback) => GetString(p, "fileName") ?? GetString(p, "scope") ?? fallback,
            cancellationToken);
    }

    public Task<ArchiveCommandResult<ArchiveImportResult>> ImportAsync(
        string path,
        bool overwrite = false,
        bool confirm = false,
        bool hasConfirmFlag = false,
        CancellationToken cancellationToken = default)
    {
        object payload = hasConfirmFlag
            ? new { confirm }
            : new { path, overwrite };
        return SendAsync<ArchiveImportResult>(
            "archive.import",
            "archive.imported",
            payload,
            TimeSpan.FromMinutes(3),
            ReadImport,
            cancellationToken);
    }

    private async Task<ArchiveCommandResult<T>> SendAsync<T>(
        string commandType,
        string replyType,
        object payload,
        TimeSpan timeout,
        Func<bool, JsonElement, string, T> read,
        CancellationToken cancellationToken)
    {
        await WaitUntilReadyAsync(TimeSpan.FromSeconds(20));
        var requestId = Guid.NewGuid().ToString("N");
        var tcs = new TaskCompletionSource<ArchiveEnvelope>(TaskCreationOptions.RunContinuationsAsynchronously);
        var pending = new PendingRequest(replyType, tcs);
        if (!_pending.TryAdd(requestId, pending))
        {
            throw new InvalidOperationException("无法登记档案桥接请求。");
        }

        try
        {
            var envelope = new
            {
                v = ProtocolVersion,
                requestId,
                type = commandType,
                payload,
            };
            var json = JsonSerializer.Serialize(envelope, JsonOptions);
            if (json.Length > MaxMessageBytes)
            {
                throw new InvalidOperationException("档案命令过大，已拒绝发送。");
            }

            var script = "window.__pwArchive && window.__pwArchive.handle(" + json + ")";
            _ = await _webView.InvokeScript(script);

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(timeout);
            ArchiveEnvelope reply;
            try
            {
                reply = await tcs.Task.WaitAsync(timeoutCts.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new TimeoutException("档案桥接等待响应超时。");
            }

            var data = reply.Payload;
            var ok = data.ValueKind == JsonValueKind.Object && data.TryGetProperty("ok", out var okEl) && okEl.GetBoolean();
            var error = data.ValueKind == JsonValueKind.Object ? GetString(data, "error") : "档案桥接返回无效载荷";
            if (!ok && error is null)
            {
                error = "档案操作失败";
            }

            if (!ok)
            {
                var cancelled = data.ValueKind == JsonValueKind.Object
                    && data.TryGetProperty("cancelled", out var cancelledEl)
                    && cancelledEl.GetBoolean();
                var needsConfirm = data.ValueKind == JsonValueKind.Object
                    && data.TryGetProperty("needsConfirm", out var confirmEl)
                    && confirmEl.GetBoolean();
                if (cancelled || needsConfirm)
                {
                    return new ArchiveCommandResult<T>
                    {
                        Ok = false,
                        Cancelled = cancelled,
                        NeedsConfirm = needsConfirm,
                        Error = error,
                        Import = ReadImport(false, data, error ?? ""),
                    };
                }

                throw new InvalidOperationException(error);
            }

            return new ArchiveCommandResult<T>
            {
                Ok = true,
                Value = read(true, data, requestId),
            };
        }
        finally
        {
            _pending.TryRemove(requestId, out _);
        }
    }

    private void OnNavigationCompleted(object? sender, WebViewNavigationCompletedEventArgs e)
    {
        if (e.IsSuccess)
        {
            IsPageReady = true;
            _ready.TrySetResult(true);
        }
    }

    private void OnWebMessageReceived(object? sender, WebMessageReceivedEventArgs e)
    {
        var body = e.Body;
        if (string.IsNullOrWhiteSpace(body) || body.Length > MaxMessageBytes)
        {
            return;
        }

        if (!TryParseEnvelope(body, out var envelope) || envelope is null)
        {
            return;
        }

        if (!_pending.TryGetValue(envelope.RequestId, out var pending))
        {
            return;
        }

        if (!string.Equals(pending.ExpectedType, envelope.Type, StringComparison.Ordinal))
        {
            pending.Completion.TrySetException(
                new InvalidOperationException("档案桥接响应类型不匹配：期望 "
                    + pending.ExpectedType
                    + "，实际 "
                    + envelope.Type));
            return;
        }

        pending.Completion.TrySetResult(envelope);
    }

    private static bool TryParseEnvelope(string body, out ArchiveEnvelope? envelope)
    {
        envelope = null;
        try
        {
            envelope = JsonSerializer.Deserialize<ArchiveEnvelope>(body, JsonOptions);
            if (IsValidEnvelope(envelope))
            {
                return true;
            }
        }
        catch (JsonException)
        {
            // Body may be a JSON-encoded string.
        }

        try
        {
            var inner = JsonSerializer.Deserialize<string>(body);
            if (string.IsNullOrWhiteSpace(inner) || inner.Length > MaxMessageBytes)
            {
                return false;
            }

            envelope = JsonSerializer.Deserialize<ArchiveEnvelope>(inner, JsonOptions);
            return IsValidEnvelope(envelope);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool IsValidEnvelope(ArchiveEnvelope? envelope) =>
        envelope is not null
        && envelope.V == ProtocolVersion
        && !string.IsNullOrWhiteSpace(envelope.RequestId)
        && !string.IsNullOrWhiteSpace(envelope.Type);

    private static void EnsureArchiveId(string id)
    {
        if (!IsValidArchiveId(id))
        {
            throw new InvalidOperationException("档案 id 无效。");
        }
    }

    private static List<ArchiveSummary> ReadList(bool ok, JsonElement payload, string fallback)
    {
        if (!ok)
        {
            throw Failed(fallback, payload);
        }

        var items = new List<ArchiveSummary>();
        if (!payload.TryGetProperty("items", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return items;
        }

        foreach (var el in arr.EnumerateArray())
        {
            var id = GetString(el, "id") ?? "";
            if (!IsValidArchiveId(id))
            {
                continue;
            }

            items.Add(new ArchiveSummary
            {
                Id = id,
                FileName = GetString(el, "fileName") ?? "",
                Ts = GetString(el, "ts") ?? "",
                StdVersion = GetString(el, "stdVersion") ?? "",
                SheetCount = GetInt(el, "sheetCount"),
                TotalRows = GetInt(el, "totalRows"),
                ChangedCells = GetInt(el, "changedCells"),
                RouteCount = GetInt(el, "routeCount"),
            });
        }

        return items;
    }

    private static ArchiveOpenInfo ReadOpen(bool ok, JsonElement payload, string fallback)
    {
        if (!ok)
        {
            throw Failed(fallback, payload);
        }

        var opened = payload.TryGetProperty("opened", out var el) ? el : payload;
        return new ArchiveOpenInfo
        {
            Id = GetString(opened, "id") ?? "",
            FileName = GetString(opened, "fileName") ?? "",
            SheetCount = GetInt(opened, "sheetCount"),
            TotalRows = GetInt(opened, "totalRows"),
            RouteCount = GetInt(opened, "routeCount"),
        };
    }

    private static ArchiveImportResult ReadImport(bool ok, JsonElement payload, string fallback)
    {
        var result = new ArchiveImportResult
        {
            Ok = ok,
            Cancelled = payload.ValueKind == JsonValueKind.Object
                && payload.TryGetProperty("cancelled", out var cancelled) && cancelled.GetBoolean(),
            NeedsConfirm = payload.ValueKind == JsonValueKind.Object
                && payload.TryGetProperty("needsConfirm", out var confirm) && confirm.GetBoolean(),
            Imported = GetInt(payload, "imported"),
            Error = GetString(payload, "error"),
        };
        if (payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty("conflicts", out var conflicts)
            && conflicts.ValueKind == JsonValueKind.Array)
        {
            foreach (var el in conflicts.EnumerateArray())
            {
                result.Conflicts.Add(new ArchiveConflict
                {
                    Id = GetString(el, "id") ?? "",
                    FileName = GetString(el, "fileName") ?? "",
                    Ts = GetString(el, "ts") ?? "",
                });
            }
        }

        return result;
    }

    private static InvalidOperationException Failed(string fallback, JsonElement payload) =>
        new(GetString(payload, "error") ?? fallback);

    private static string? GetString(JsonElement el, string name) =>
        el.ValueKind == JsonValueKind.Object && el.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int GetInt(JsonElement el, string name)
    {
        if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty(name, out var value))
        {
            return 0;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var n) => n,
            JsonValueKind.String when int.TryParse(value.GetString(), out var n) => n,
            _ => 0,
        };
    }

    private sealed record PendingRequest(string ExpectedType, TaskCompletionSource<ArchiveEnvelope> Completion);

    private sealed class ArchiveEnvelope
    {
        public int V { get; set; }

        public string RequestId { get; set; } = "";

        public string Type { get; set; } = "";

        public JsonElement Payload { get; set; }
    }
}

public sealed class ArchiveCommandResult<T>
{
    public bool Ok { get; set; }

    public bool Cancelled { get; set; }

    public bool NeedsConfirm { get; set; }

    public string? Error { get; set; }

    public T? Value { get; set; }

    public ArchiveImportResult? Import { get; set; }
}

public sealed class ArchiveOpenInfo
{
    public string Id { get; set; } = "";

    public string FileName { get; set; } = "";

    public int SheetCount { get; set; }

    public int TotalRows { get; set; }

    public int RouteCount { get; set; }
}

public sealed class ArchiveImportResult
{
    public bool Ok { get; set; }

    public bool Cancelled { get; set; }

    public bool NeedsConfirm { get; set; }

    public int Imported { get; set; }

    public string? Error { get; set; }

    public List<ArchiveConflict> Conflicts { get; } = new();
}

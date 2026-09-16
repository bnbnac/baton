using System.ComponentModel;
using System.Text.Json;
using Baton.Core;
using ModelContextProtocol.Protocol;

namespace Baton.Adapter;

public sealed class ShellTools(PipeClient client, JsonSerializerOptions json)
{
    public Task<CallToolResult> StatusAsync(CancellationToken cancellationToken = default) =>
        InvokeAsync(() => client.CallAsync<SessionInfo>("status", cancellationToken: cancellationToken));

    public Task<CallToolResult> ReadOutputAsync(
        [Description("Assigned session ID returned by status.")] string session_id,
        [Description("Absolute UTF-16 cursor. Start at 0 after handoff, then use next_cursor.")] long cursor,
        [Description("Maximum UTF-16 code units to return, from 2 through 32768.")] int limit,
        [Description("Long-poll wait in milliseconds, from 0 through 10000.")] int wait_ms,
        CancellationToken cancellationToken = default) =>
        InvokeAsync(() => client.CallAsync<OutputPage>("read_output", new { session_id, cursor, limit, wait_ms }, cancellationToken));

    public Task<CallToolResult> SendTextAsync(
        [Description("Assigned session ID returned by status.")] string session_id,
        [Description("Unique ID for this logical input. Reuse only to retrieve the same delivery outcome; conflicting reuse is rejected.")] string request_id,
        [Description("Exact terminal text to send, without automatic Enter or rewriting.")] string text,
        CancellationToken cancellationToken = default) =>
        InvokeAsync(() => client.CallAsync<InputReceipt>("send_text", new { session_id, request_id, text }, cancellationToken));

    public Task<CallToolResult> SendKeyAsync(
        [Description("Assigned session ID returned by status.")] string session_id,
        [Description("Unique ID for this logical key input. Reuse only to retrieve the same delivery outcome.")] string request_id,
        [Description("One of: Enter, Ctrl+C, Tab, Escape, Ctrl+D, Backspace.")] string key,
        CancellationToken cancellationToken = default)
    {
        return InvokeAsync(() => key is not ("Enter" or "Ctrl+C" or "Tab" or "Escape" or "Ctrl+D" or "Backspace")
            ? Task.FromException<InputReceipt>(new BatonException("invalid_key"))
            : client.CallAsync<InputReceipt>("send_key", new { session_id, request_id, key }, cancellationToken));
    }

    private async Task<CallToolResult> InvokeAsync<T>(Func<Task<T>> action)
    {
        try { return Result(JsonSerializer.Serialize(await action().ConfigureAwait(false), json), isError: false); }
        catch (OperationCanceledException) { throw; }
        catch (BatonException exception) { return Result(exception.Code, isError: true); }
        catch { return Result("adapter_error", isError: true); }
    }

    private static CallToolResult Result(string text, bool isError) => new()
    {
        Content = [new TextContentBlock { Text = text }],
        IsError = isError
    };
}

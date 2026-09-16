using System.Buffers.Binary;
using System.Text.Json;

namespace Baton.Core;

internal static class PipeProtocol
{
    // A 32 Ki UTF-16 page may JSON-escape to 192 KiB, plus the envelope.
    internal const int MaxFrameBytes = 256 * 1024;
    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower
    };
    private static readonly HashSet<string> RemoteErrorCodes = new(StringComparer.Ordinal)
    {
        "adapter_disconnected", "adapter_limit", "app_closed", "authentication_failed", "cancelled",
        "client_busy", "connection_timeout", "input_failed", "input_invalidated", "input_queue_full", "internal_error", "invalid_args",
        "invalid_input_size", "invalid_key", "invalid_label", "invalid_limit", "invalid_request_id",
        "invalid_wait", "method_not_found", "not_owner", "request_history_full_create_new_session",
        "read_limit", "request_id_conflict", "server_busy", "session_closed"
    };

    internal static string RemoteError(string? code, string fallback) =>
        code is not null && RemoteErrorCodes.Contains(code) ? code : fallback;

    internal static async Task<T> ReadAsync<T>(Stream stream, CancellationToken token)
    {
        var header = new byte[sizeof(int)];
        await ReadExactlyAsync(stream, header, token).ConfigureAwait(false);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length is <= 0 or > MaxFrameBytes) throw new BatonException("invalid_frame");
        var payload = new byte[length];
        await ReadExactlyAsync(stream, payload, token).ConfigureAwait(false);
        try
        {
            return JsonSerializer.Deserialize<T>(payload, JsonOptions)
                ?? throw new BatonException("invalid_frame");
        }
        catch (JsonException)
        {
            throw new BatonException("invalid_frame");
        }
        finally
        {
            Array.Clear(payload);
        }
    }

    internal static async Task WriteAsync<T>(Stream stream, T value, CancellationToken token)
    {
        byte[] payload;
        try { payload = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions); }
        catch { throw new BatonException("invalid_frame"); }
        try
        {
            if (payload.Length is 0 or > MaxFrameBytes) throw new BatonException("frame_too_large");
            var header = new byte[sizeof(int)];
            BinaryPrimitives.WriteInt32LittleEndian(header, payload.Length);
            await stream.WriteAsync(header, token).ConfigureAwait(false);
            await stream.WriteAsync(payload, token).ConfigureAwait(false);
            await stream.FlushAsync(token).ConfigureAwait(false);
        }
        finally
        {
            Array.Clear(payload);
        }
    }

    private static async Task ReadExactlyAsync(Stream stream, byte[] buffer, CancellationToken token)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var count = await stream.ReadAsync(buffer.AsMemory(offset), token).ConfigureAwait(false);
            if (count == 0) throw new BatonException("connection_closed");
            offset += count;
        }
    }
}

internal sealed record PipeHandshake(string Secret, string Label);
internal sealed record PipeHandshakeResult(string? ConnectionId = null, string? Error = null);
internal sealed record PipeRequest(string Id, string Method, JsonElement Args);
internal sealed record PipeResponse(string Id, object? Result = null, string? Error = null);
internal sealed record PipeResponseFrame(string Id, JsonElement Result, string? Error = null);

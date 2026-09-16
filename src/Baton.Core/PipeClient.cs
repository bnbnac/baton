using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Text.Json;

namespace Baton.Core;

public sealed class PipeClient : IAsyncDisposable
{
    private readonly NamedPipeClientStream stream;
    private readonly SemaphoreSlim writeGate = new(1, 1);
    private readonly SemaphoreSlim pendingSlots = new(16, 16);
    private readonly CancellationTokenSource lifetime = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<PipeResponseFrame>> pending = new(StringComparer.Ordinal);
    private readonly Task receiveLoop;
    private int disconnected;
    private int disposed;
    public string ConnectionId { get; }
    public bool IsConnected => Volatile.Read(ref disconnected) == 0;
    public event Action? Disconnected;

    private PipeClient(NamedPipeClientStream stream, string connectionId)
    {
        this.stream = stream;
        ConnectionId = connectionId;
        receiveLoop = ReceiveLoopAsync();
    }

    public static async Task<PipeClient> ConnectAsync(EndpointInfo endpoint, string label, CancellationToken cancellationToken = default)
    {
        NamedPipeClientStream? stream = null;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            if (endpoint is null) throw new BatonException("endpoint_unavailable");
            stream = new NamedPipeClientStream(".", endpoint.PipeName, PipeDirection.InOut,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            await stream.ConnectAsync(timeout.Token).ConfigureAwait(false);
            await PipeProtocol.WriteAsync(stream, new PipeHandshake(endpoint.Secret, label), timeout.Token).ConfigureAwait(false);
            var response = await PipeProtocol.ReadAsync<PipeHandshakeResult>(stream, timeout.Token).ConfigureAwait(false);
            if (response.Error is not null) throw new BatonException(PipeProtocol.RemoteError(response.Error, "authentication_failed"));
            if (string.IsNullOrWhiteSpace(response.ConnectionId)) throw new BatonException("authentication_failed");
            return new PipeClient(stream, response.ConnectionId);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            stream?.Dispose();
            throw new BatonException("connection_timeout");
        }
        catch (OperationCanceledException) { stream?.Dispose(); throw; }
        catch (BatonException) { stream?.Dispose(); throw; }
        catch { stream?.Dispose(); throw new BatonException("connection_failed"); }
    }

    public async Task<T> CallAsync<T>(string method, object? args = null, CancellationToken cancellationToken = default)
    {
        if (Volatile.Read(ref disconnected) != 0) throw new BatonException("connection_closed");
        cancellationToken.ThrowIfCancellationRequested();
        if (!pendingSlots.Wait(0)) throw new BatonException("client_busy");
        var id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<PipeResponseFrame>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!pending.TryAdd(id, completion))
        {
            pendingSlots.Release();
            throw new BatonException("connection_failed");
        }
        try
        {
            JsonElement element;
            try
            {
                element = args is null ? JsonSerializer.SerializeToElement(new { }, PipeProtocol.JsonOptions)
                    : JsonSerializer.SerializeToElement(args, PipeProtocol.JsonOptions);
            }
            catch { throw new BatonException("invalid_args"); }
            // Complete a frame once its write starts. Cancelling a partial frame would corrupt the connection.
            await WriteAsync(new PipeRequest(id, method, element), lifetime.Token).ConfigureAwait(false);
            using var registration = cancellationToken.Register(() =>
            {
                if (pending.TryRemove(id, out var call))
                {
                    pendingSlots.Release();
                    call.TrySetCanceled(cancellationToken);
                    _ = SendCancelAsync(id);
                }
            });
            var response = await completion.Task.ConfigureAwait(false);
            if (response.Error is not null) throw new BatonException(PipeProtocol.RemoteError(response.Error, "invalid_response"));
            try
            {
                return response.Result.Deserialize<T>(PipeProtocol.JsonOptions)
                    ?? throw new BatonException("invalid_response");
            }
            catch (JsonException) { throw new BatonException("invalid_response"); }
        }
        catch
        {
            if (pending.TryRemove(id, out _)) pendingSlots.Release();
            throw;
        }
    }

    private async Task SendCancelAsync(string requestId)
    {
        try
        {
            var args = JsonSerializer.SerializeToElement(new { request_id = requestId }, PipeProtocol.JsonOptions);
            await WriteAsync(new PipeRequest("", "$cancel", args), lifetime.Token).ConfigureAwait(false);
        }
        catch { }
    }

    private async Task WriteAsync<T>(T value, CancellationToken token)
    {
        await writeGate.WaitAsync(token).ConfigureAwait(false);
        try { await PipeProtocol.WriteAsync(stream, value, token).ConfigureAwait(false); }
        catch (OperationCanceledException) { throw; }
        catch (BatonException) { throw; }
        catch { throw new BatonException("connection_closed"); }
        finally { writeGate.Release(); }
    }

    private async Task ReceiveLoopAsync()
    {
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                var response = await PipeProtocol.ReadAsync<PipeResponseFrame>(stream, lifetime.Token).ConfigureAwait(false);
                if (pending.TryRemove(response.Id, out var completion))
                {
                    pendingSlots.Release();
                    completion.TrySetResult(response);
                }
            }
        }
        catch { }
        finally { SignalDisconnected(); }
    }

    private void SignalDisconnected()
    {
        if (Interlocked.Exchange(ref disconnected, 1) != 0) return;
        lifetime.Cancel();
        foreach (var pair in pending)
            if (pending.TryRemove(pair.Key, out var completion))
            {
                pendingSlots.Release();
                completion.TrySetException(new BatonException("connection_closed"));
            }
        try { Disconnected?.Invoke(); } catch { }
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        SignalDisconnected();
        stream.Dispose();
        try { await receiveLoop.ConfigureAwait(false); } catch { }
        writeGate.Dispose();
        pendingSlots.Dispose();
        lifetime.Dispose();
    }
}

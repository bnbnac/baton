using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Baton.Core;

public sealed class PipeBroker : IDisposable, IAsyncDisposable
{
    private const int MaxConnections = 32;
    private readonly SessionRegistry registry;
    private readonly EndpointInfo endpoint;
    private readonly CancellationTokenSource lifetime = new();
    private readonly SemaphoreSlim connectionSlots = new(MaxConnections, MaxConnections);
    private readonly ConcurrentDictionary<int, NamedPipeServerStream> streams = [];
    private readonly ConcurrentDictionary<int, Task> connections = [];
    private readonly TaskCompletionSource runStopped = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int nextConnection;
    private int runStarted;
    private int disposed;

    public PipeBroker(SessionRegistry registry, EndpointInfo endpoint)
    {
        this.registry = registry ?? throw new ArgumentNullException(nameof(registry));
        this.endpoint = endpoint ?? throw new ArgumentNullException(nameof(endpoint));
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        if (Interlocked.Exchange(ref runStarted, 1) != 0) throw new BatonException("broker_already_running");
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, lifetime.Token);
        try
        {
            while (true)
            {
                await connectionSlots.WaitAsync(linked.Token).ConfigureAwait(false);
                NamedPipeServerStream? stream = null;
                var id = Interlocked.Increment(ref nextConnection);
                try
                {
                    stream = new NamedPipeServerStream(endpoint.PipeName, PipeDirection.InOut, MaxConnections,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    streams[id] = stream;
                    await stream.WaitForConnectionAsync(linked.Token).ConfigureAwait(false);
                    var connected = stream;
                    stream = null;
                    var task = HandleConnectionAsync(id, connected, linked.Token);
                    connections[id] = task;
                    _ = task.ContinueWith(completed =>
                    {
                        _ = completed.Exception;
                        connections.TryRemove(id, out Task? _);
                    }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
                }
                catch (Exception) when (linked.IsCancellationRequested)
                {
                    streams.TryRemove(id, out _);
                    stream?.Dispose();
                    connectionSlots.Release();
                    break;
                }
                catch
                {
                    streams.TryRemove(id, out _);
                    stream?.Dispose();
                    connectionSlots.Release();
                    throw;
                }
            }
        }
        catch (OperationCanceledException) when (linked.IsCancellationRequested) { }
        finally
        {
            foreach (var stream in streams.Values) stream.Dispose();
            var active = connections.Values.ToArray();
            if (active.Length > 0) await Task.WhenAll(active).ConfigureAwait(false);
            runStopped.TrySetResult();
        }
    }

    private async Task HandleConnectionAsync(int id, NamedPipeServerStream stream, CancellationToken brokerToken)
    {
        string? owner = null;
        using var connectionCancellation = CancellationTokenSource.CreateLinkedTokenSource(brokerToken);
        try
        {
            using var handshakeTimeout = CancellationTokenSource.CreateLinkedTokenSource(connectionCancellation.Token);
            handshakeTimeout.CancelAfter(TimeSpan.FromSeconds(5));
            PipeHandshake handshake;
            try { handshake = await PipeProtocol.ReadAsync<PipeHandshake>(stream, handshakeTimeout.Token).ConfigureAwait(false); }
            catch { return; }
            if (!SecretMatches(handshake.Secret))
            {
                await SafeWriteAsync(stream, new PipeHandshakeResult(Error: "authentication_failed"), connectionCancellation.Token).ConfigureAwait(false);
                return;
            }
            try { owner = registry.RegisterAdapter(handshake.Label); }
            catch (BatonException ex)
            {
                await SafeWriteAsync(stream, new PipeHandshakeResult(Error: ex.Code), connectionCancellation.Token).ConfigureAwait(false);
                return;
            }
            await SafeWriteAsync(stream, new PipeHandshakeResult(owner), connectionCancellation.Token).ConfigureAwait(false);
            await ServeAsync(stream, owner, connectionCancellation).ConfigureAwait(false);
        }
        catch { }
        finally
        {
            connectionCancellation.Cancel();
            if (owner is not null) registry.DisconnectAdapter(owner);
            streams.TryRemove(id, out _);
            stream.Dispose();
            connectionSlots.Release();
        }
    }

    private async Task ServeAsync(Stream stream, string owner, CancellationTokenSource connectionCancellation)
    {
        using var requestSlots = new SemaphoreSlim(16, 16);
        using var readSlots = new SemaphoreSlim(8, 8);
        using var writeGate = new SemaphoreSlim(1, 1);
        var active = new ConcurrentDictionary<string, CancellationTokenSource>(StringComparer.Ordinal);
        var tasks = new ConcurrentDictionary<string, Task>(StringComparer.Ordinal);
        try
        {
            while (!connectionCancellation.IsCancellationRequested)
            {
                var request = await PipeProtocol.ReadAsync<PipeRequest>(stream, connectionCancellation.Token).ConfigureAwait(false);
                if (request.Method == "$cancel")
                {
                    if (TryString(request.Args, "request_id", out var requestId) && active.TryGetValue(requestId, out var pending)) CancelIfActive(pending);
                    continue;
                }
                if (string.IsNullOrWhiteSpace(request.Id) || request.Id.Length > 64 || active.ContainsKey(request.Id))
                {
                    await WriteResponseAsync(stream, writeGate, new PipeResponse(request.Id, Error: "invalid_request_id"), connectionCancellation.Token).ConfigureAwait(false);
                    continue;
                }
                var readReserved = false;
                if (request.Method == "read_output")
                {
                    readReserved = readSlots.Wait(0);
                    if (!readReserved)
                    {
                        await WriteResponseAsync(stream, writeGate, new PipeResponse(request.Id, Error: "read_limit"), connectionCancellation.Token).ConfigureAwait(false);
                        continue;
                    }
                }
                if (!requestSlots.Wait(0))
                {
                    if (readReserved) readSlots.Release();
                    await WriteResponseAsync(stream, writeGate, new PipeResponse(request.Id, Error: "server_busy"), connectionCancellation.Token).ConfigureAwait(false);
                    continue;
                }
                var requestCancellation = CancellationTokenSource.CreateLinkedTokenSource(connectionCancellation.Token);
                if (!active.TryAdd(request.Id, requestCancellation))
                {
                    requestCancellation.Dispose();
                    if (readReserved) readSlots.Release();
                    requestSlots.Release();
                    await WriteResponseAsync(stream, writeGate, new PipeResponse(request.Id, Error: "invalid_request_id"), connectionCancellation.Token).ConfigureAwait(false);
                    continue;
                }
                var tracked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                tasks[request.Id] = tracked.Task;
                _ = RunRequestAsync(stream, writeGate, readSlots, requestSlots, active, tasks, owner,
                    request, requestCancellation, readReserved, connectionCancellation.Token, tracked);
            }
        }
        finally
        {
            connectionCancellation.Cancel();
            foreach (var cancellation in active.Values) CancelIfActive(cancellation);
            // Closing the owned session releases an SSH write before draining its request task.
            registry.DisconnectAdapter(owner);
            var pending = tasks.Values.ToArray();
            if (pending.Length > 0) await Task.WhenAll(pending).ConfigureAwait(false);
            foreach (var cancellation in active.Values) cancellation.Dispose();
        }
    }

    private async Task RunRequestAsync(Stream stream, SemaphoreSlim writeGate, SemaphoreSlim readSlots,
        SemaphoreSlim requestSlots, ConcurrentDictionary<string, CancellationTokenSource> active,
        ConcurrentDictionary<string, Task> tasks, string owner, PipeRequest request,
        CancellationTokenSource requestCancellation, bool readReserved, CancellationToken connectionToken,
        TaskCompletionSource tracked)
    {
        try
        {
            await ProcessRequestAsync(stream, writeGate, owner, request, requestCancellation.Token, connectionToken).ConfigureAwait(false);
        }
        catch { }
        finally
        {
            active.TryRemove(request.Id, out _);
            tasks.TryRemove(request.Id, out _);
            requestCancellation.Dispose();
            if (readReserved) readSlots.Release();
            requestSlots.Release();
            tracked.TrySetResult();
        }
    }

    private static void CancelIfActive(CancellationTokenSource cancellation)
    {
        // Completion may remove/dispose the request after the dictionary lookup.
        try { cancellation.Cancel(); } catch (ObjectDisposedException) { }
    }

    private async Task ProcessRequestAsync(Stream stream, SemaphoreSlim writeGate, string owner,
        PipeRequest request, CancellationToken requestToken, CancellationToken connectionToken)
    {
        object? result = null;
        string? error = null;
        try { result = await DispatchAsync(owner, request, requestToken).ConfigureAwait(false); }
        catch (OperationCanceledException) { error = "cancelled"; }
        catch (BatonException ex) { error = ex.Code; }
        catch { error = "internal_error"; }
        await WriteResponseAsync(stream, writeGate, new PipeResponse(request.Id, result, error), connectionToken).ConfigureAwait(false);
    }

    private async Task<object?> DispatchAsync(string owner, PipeRequest request, CancellationToken token)
    {
        switch (request.Method)
        {
            case "status":
                return registry.Status(owner);
            case "read_output":
            {
                var sessionId = RequiredString(request.Args, "session_id");
                var cursor = RequiredInt64(request.Args, "cursor");
                var limit = RequiredInt32(request.Args, "limit");
                var waitMs = RequiredInt32(request.Args, "wait_ms");
                return await registry.Assigned(owner, sessionId).ReadAsync(owner, cursor, limit, waitMs, token).ConfigureAwait(false);
            }
            case "send_text":
            {
                var sessionId = RequiredString(request.Args, "session_id");
                var requestId = RequiredString(request.Args, "request_id");
                var text = RequiredString(request.Args, "text", allowEmpty: false);
                return await registry.Assigned(owner, sessionId).SendAgentAsync(owner, requestId, text, token).ConfigureAwait(false);
            }
            case "send_key":
            {
                var sessionId = RequiredString(request.Args, "session_id");
                var requestId = RequiredString(request.Args, "request_id");
                var key = MapKey(RequiredString(request.Args, "key"));
                return await registry.Assigned(owner, sessionId).SendAgentAsync(owner, requestId, key, token).ConfigureAwait(false);
            }
            default:
                throw new BatonException("method_not_found");
        }
    }

    private static string MapKey(string key) => key switch
    {
        "Enter" => "\r",
        "Ctrl+C" => "\u0003",
        "Tab" => "\t",
        "Escape" => "\u001b",
        "Ctrl+D" => "\u0004",
        "Backspace" => "\u007f",
        "ArrowUp" => "\u001b[A",
        "ArrowDown" => "\u001b[B",
        "ArrowRight" => "\u001b[C",
        "ArrowLeft" => "\u001b[D",
        _ => throw new BatonException("invalid_key")
    };

    private static string RequiredString(JsonElement args, string name, bool allowEmpty = false)
    {
        if (!TryString(args, name, out var value) || (!allowEmpty && string.IsNullOrEmpty(value))) throw new BatonException("invalid_args");
        return value;
    }

    private static bool TryString(JsonElement args, string name, out string value)
    {
        value = "";
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String) return false;
        value = property.GetString() ?? "";
        return true;
    }

    private static long RequiredInt64(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(name, out var property) || !property.TryGetInt64(out var value))
            throw new BatonException("invalid_args");
        return value;
    }

    private static int RequiredInt32(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(name, out var property) || !property.TryGetInt32(out var value))
            throw new BatonException("invalid_args");
        return value;
    }

    private bool SecretMatches(string candidate)
    {
        byte[] expected = [];
        byte[] supplied = [];
        try
        {
            expected = Convert.FromBase64String(endpoint.Secret);
            supplied = Convert.FromBase64String(candidate ?? "");
            return expected.Length == 32 && supplied.Length == 32 && CryptographicOperations.FixedTimeEquals(expected, supplied);
        }
        catch (FormatException) { return false; }
        finally
        {
            Array.Clear(expected);
            Array.Clear(supplied);
        }
    }

    private static async Task SafeWriteAsync<T>(Stream stream, T value, CancellationToken token)
    {
        try { await PipeProtocol.WriteAsync(stream, value, token).ConfigureAwait(false); } catch { }
    }

    private static async Task WriteResponseAsync(Stream stream, SemaphoreSlim writeGate, PipeResponse response,
        CancellationToken connectionCancellationToken)
    {
        await writeGate.WaitAsync(connectionCancellationToken).ConfigureAwait(false);
        try { await PipeProtocol.WriteAsync(stream, response, connectionCancellationToken).ConfigureAwait(false); }
        finally { writeGate.Release(); }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        lifetime.Cancel();
        foreach (var stream in streams.Values) stream.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        Dispose();
        if (Volatile.Read(ref runStarted) != 0) await runStopped.Task.ConfigureAwait(false);
    }
}

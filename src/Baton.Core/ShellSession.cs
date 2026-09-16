using System.Security.Cryptography;
using System.Text;
using System.Threading.Channels;

namespace Baton.Core;
public record InputReceipt(string Status);
public enum SessionState { UserOwned, Transferring, AgentOwned, Closed }
public sealed class ShellSession : IDisposable
{
    private sealed record Input(byte[] Bytes, string? Owner, bool Protocol, long Epoch, CancellationToken Token, TaskCompletionSource<InputReceipt> Completion);
    private readonly object gate = new();
    private readonly IShellTransport transport;
    private readonly OutputBuffer output;
    private readonly TerminalScreen screen = new();
    private Decoder decoder = Encoding.UTF8.GetDecoder();
    private readonly Channel<Input> input = Channel.CreateBounded<Input>(new BoundedChannelOptions(32) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
    private readonly SemaphoreSlim writeGate = new(1, 1);
    private readonly Dictionary<string, (string Hash, Task<InputReceipt> Task)> requests = [];
    private TaskCompletionSource changed = Signal();
    private SessionState state = SessionState.UserOwned;
    private string? owner;
    private long epoch;
    private int closed;
    public string Id { get; } = Guid.NewGuid().ToString("N");
    public string Target { get; }
    public SessionState State { get { lock(gate) return state; } }
    public string? Owner { get { lock(gate) return owner; } }
    public string ScreenText { get { lock(gate) return state == SessionState.Closed ? "" : screen.Snapshot(); } }
    public ShellSession(IShellTransport transport, string target, int outputCapacity = 1_048_576)
    {
        this.transport = transport; Target = target; output = new(outputCapacity);
        transport.Output += OnOutput;
        transport.Closed += Close;
        screen.Response += bytes =>
        {
            lock(gate)
            {
                if (state is SessionState.Closed or SessionState.Transferring) return;
                var response = Queue(bytes, null, true, CancellationToken.None);
                // Internal protocol replies never become a user/password bypass or a second parser.
                _ = response.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
            }
        };
        _ = Task.Run(ProcessInputAsync);
        try { transport.Start(); }
        catch { Close(); throw; }
    }
    private static TaskCompletionSource Signal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    private void Pulse() { var old = changed; changed = Signal(); old.TrySetResult(); }
    private void CheckOpen() { if (Volatile.Read(ref closed) != 0) throw new BatonException("session_closed"); }
    private void CheckOwner(string requestedOwner)
    {
        CheckOpen();
        if (state != SessionState.AgentOwned || owner != requestedOwner) throw new BatonException("not_owner");
    }
    private void OnOutput(byte[] bytes)
    {
        lock(gate)
        {
            if (state == SessionState.Closed) return;
            try { screen.Feed(bytes); }
            catch { Close(); return; }
            if (state == SessionState.AgentOwned)
            {
                var chars = new char[Encoding.UTF8.GetMaxCharCount(bytes.Length)];
                var count = decoder.GetChars(bytes, 0, bytes.Length, chars, 0, false);
                output.Append(new string(chars, 0, count));
                Pulse();
            }
        }
    }
    public async Task HandoffAsync(string newOwner)
    {
        if (string.IsNullOrWhiteSpace(newOwner)) throw new BatonException("invalid_owner");
        lock(gate) { CheckOpen(); if (state != SessionState.UserOwned) throw new BatonException("already_handed_off"); state = SessionState.Transferring; epoch++; }
        await writeGate.WaitAsync().ConfigureAwait(false);
        try
        {
            transport.Boundary(() =>
            {
                lock(gate)
                {
                    CheckOpen(); output.Clear(); decoder.Reset(); screen.Reset();
                    owner = newOwner; state = SessionState.AgentOwned; Pulse();
                }
            });
        }
        catch { Close(); throw; }
        finally { writeGate.Release(); }
    }
    public async Task<InputReceipt> SendUserAsync(string text)
    {
        Task<InputReceipt> task;
        lock(gate) { CheckOpen(); if (state != SessionState.UserOwned) throw new BatonException("not_owner"); task = Queue(Encode(text), null, false, CancellationToken.None); }
        return await task.ConfigureAwait(false);
    }
    private static byte[] Encode(string text)
    {
        if (string.IsNullOrEmpty(text) || text.Length > 16384 || Encoding.UTF8.GetByteCount(text) > 16384) throw new BatonException("invalid_input_size");
        return Encoding.UTF8.GetBytes(text);
    }
    public async Task<InputReceipt> SendAgentAsync(string requestedOwner, string requestId, string text, CancellationToken token = default)
    {
        var bytes = Encode(text);
        Task<InputReceipt> task;
        lock(gate)
        {
            CheckOwner(requestedOwner);
            if (string.IsNullOrWhiteSpace(requestId) || requestId.Length > 128) throw new BatonException("invalid_request_id");
            var hash = Convert.ToHexString(SHA256.HashData(bytes));
            if (requests.TryGetValue(requestId, out var existing))
            {
                if (hash != existing.Hash) throw new BatonException("request_id_conflict");
                task = existing.Task;
            }
            else
            {
                if (requests.Count >= 4096) throw new BatonException("request_history_full_create_new_session");
                token.ThrowIfCancellationRequested();
                task = Queue(bytes, requestedOwner, false, token);
                requests.Add(requestId, (hash, task));
            }
        }
        // Once queued, preserve the original outcome even if the caller stops waiting.
        return await task.ConfigureAwait(false);
    }
    private Task<InputReceipt> Queue(byte[] bytes, string? requestedOwner, bool protocol, CancellationToken token)
    {
        if (bytes.Length > 16384) return Task.FromException<InputReceipt>(new BatonException("invalid_input_size"));
        var completion = new TaskCompletionSource<InputReceipt>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!input.Writer.TryWrite(new(bytes, requestedOwner, protocol, epoch, token, completion)))
            completion.SetException(new BatonException("input_queue_full"));
        return completion.Task;
    }
    private async Task ProcessInputAsync()
    {
        await foreach (var item in input.Reader.ReadAllAsync().ConfigureAwait(false))
        {
            await writeGate.WaitAsync().ConfigureAwait(false);
            bool attempted = false;
            try
            {
                lock(gate)
                {
                    CheckOpen();
                    if (item.Epoch != epoch || state == SessionState.Transferring) throw new BatonException("input_invalidated");
                    if (!item.Protocol)
                    {
                        if (item.Owner is null && state != SessionState.UserOwned) throw new BatonException("not_owner");
                        if (item.Owner is not null) CheckOwner(item.Owner);
                    }
                    item.Token.ThrowIfCancellationRequested();
                }
                // Final transport validity check is inside Write. This object never changes its SSH transport.
                CheckOpen(); attempted = true;
                transport.Write(item.Bytes);
                item.Completion.TrySetResult(new("delivered"));
            }
            catch (Exception ex)
            {
                if (attempted) item.Completion.TrySetResult(new("uncertain"));
                else if (ex is OperationCanceledException) item.Completion.TrySetCanceled(item.Token);
                else item.Completion.TrySetException(ex is BatonException ? ex : new BatonException("input_failed"));
            }
            finally { Array.Clear(item.Bytes); writeGate.Release(); }
        }
    }
    public async Task<OutputPage> ReadAsync(string requestedOwner, long cursor, int limit, int waitMs, CancellationToken token = default)
    {
        if (waitMs is < 0 or > 10000) throw new BatonException("invalid_wait");
        Task signal;
        lock(gate)
        {
            CheckOwner(requestedOwner);
            var page = output.Read(cursor, limit);
            if (page.Error is not null || page.Text.Length > 0 || waitMs == 0) return page;
            signal = changed.Task;
        }
        try { await signal.WaitAsync(TimeSpan.FromMilliseconds(waitMs), token).ConfigureAwait(false); }
        catch (TimeoutException) { }
        lock(gate) { CheckOwner(requestedOwner); return output.Read(cursor, limit); }
    }
    public void Close()
    {
        if (Interlocked.Exchange(ref closed, 1) != 0) return;
        transport.Output -= OnOutput;
        transport.Closed -= Close;
        transport.Dispose();
        lock(gate)
        {
            state = SessionState.Closed; epoch++; input.Writer.TryComplete();
            output.Clear(); decoder.Reset(); screen.Dispose(); requests.Clear(); Pulse();
        }
    }
    public void Dispose() => Close();
}

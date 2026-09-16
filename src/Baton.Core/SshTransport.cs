using System.Security.Cryptography;
using Renci.SshNet;
using Renci.SshNet.Common;

namespace Baton.Core;

public record SshTarget(string Host, int Port, string Username, string? PrivateKeyPath = null);
public record AuthPrompt(string Text, bool Echo);
public interface IUserAuthentication
{
    bool ConfirmHostKey(string host, int port, string algorithm, string sha256);
    string? GetPassword(string purpose);
    string[]? AnswerChallenges(string name, string instruction, IReadOnlyList<AuthPrompt> prompts);
}
public interface IShellTransport : IDisposable
{
    event Action<byte[]>? Output;
    event Action? Closed;
    void Start();
    void Write(byte[] data);
    void Boundary(Action transition);
}
public sealed class SshTransport : IShellTransport
{
    private SshClient? client;
    private ShellStream? shell;
    private readonly object receiveGate = new();
    private readonly Queue<byte[]> initialOutput = new();
    private int initialBytes;
    private Timer? connectionWatch;
    private int disposed;
    private bool started;
    public event Action<byte[]>? Output;
    public event Action? Closed;
    private SshTransport(SshClient client, ShellStream shell)
    {
        this.client = client;
        this.shell = shell;
        shell.DataReceived += (_, _) => Drain(false);
        shell.Closed += (_, _) => NotifyClosed();
        client.ErrorOccurred += (_, _) => NotifyClosed();
        Drain(false);
        connectionWatch = new Timer(_ =>
        {
            try { if (this.client?.IsConnected != true || this.shell?.CanWrite != true) NotifyClosed(); }
            catch { NotifyClosed(); }
        }, null, 250, 250);
    }
    public static async Task<SshTransport> ConnectAsync(SshTarget target, IUserAuthentication auth, string method, CancellationToken token = default)
    {
        if (string.IsNullOrWhiteSpace(target.Host) || target.Host.Length > 253 || target.Port is < 1 or > 65535 ||
            string.IsNullOrWhiteSpace(target.Username) || target.Username.Length > 128) throw new BatonException("invalid_target");
        var methods = new List<AuthenticationMethod>();
        PrivateKeyFile? key = null;
        SshClient? client = null;
        try
        {
            if (method is "password" or "password+interactive")
                methods.Add(new PasswordAuthenticationMethod(target.Username, auth.GetPassword("SSH password") ?? throw new BatonException("authentication_cancelled")));
            if (method is "key" or "key+interactive")
            {
                if (target.PrivateKeyPath is null || !Path.IsPathFullyQualified(target.PrivateKeyPath)) throw new BatonException("invalid_key_path");
                try { key = new PrivateKeyFile(target.PrivateKeyPath); }
                catch (Exception ex) when (ex is SshPassPhraseNullOrEmptyException or Org.BouncyCastle.Crypto.InvalidCipherTextException)
                { key = new PrivateKeyFile(target.PrivateKeyPath, auth.GetPassword("Private key passphrase") ?? throw new BatonException("authentication_cancelled")); }
                methods.Add(new PrivateKeyAuthenticationMethod(target.Username, key));
            }
            if (method is "interactive" or "password+interactive" or "key+interactive")
            {
                var interactive = new KeyboardInteractiveAuthenticationMethod(target.Username);
                interactive.AuthenticationPrompt += (_, e) =>
                {
                    token.ThrowIfCancellationRequested();
                    var prompts = e.Prompts.ToArray();
                    var answers = auth.AnswerChallenges(target.Username, e.Instruction, prompts.Select(p => new AuthPrompt(p.Request, p.IsEchoed)).ToArray());
                    if (answers is null || answers.Length != prompts.Length) throw new BatonException("authentication_cancelled");
                    for (var i = 0; i < answers.Length; i++) prompts[i].Response = answers[i];
                };
                methods.Add(interactive);
            }
            if (methods.Count == 0) throw new BatonException("invalid_authentication_method");
            var info = new ConnectionInfo(target.Host, target.Port, target.Username, methods.ToArray()) { Timeout = TimeSpan.FromSeconds(45) };
            client = new SshClient(info) { KeepAliveInterval = TimeSpan.FromSeconds(15) };
            EventHandler<HostKeyEventArgs> hostCheck = (_, e) =>
            {
                e.CanTrust = !token.IsCancellationRequested && auth.ConfirmHostKey(target.Host, target.Port, e.HostKeyName,
                    "SHA256:" + Convert.ToBase64String(SHA256.HashData(e.HostKey)).TrimEnd('='));
            };
            client.HostKeyReceived += hostCheck;
            try { await client.ConnectAsync(token).ConfigureAwait(false); }
            finally { client.HostKeyReceived -= hostCheck; }
            token.ThrowIfCancellationRequested();
            var shell = client.CreateShellStream("xterm", 120, 32, 0, 0, 8192);
            // AuthenticationMethods is array-backed: overwrite entries rather than resizing it.
            for (var i = 0; i < info.AuthenticationMethods.Count; i++)
                info.AuthenticationMethods[i] = new NoneAuthenticationMethod(target.Username);
            return new SshTransport(client, shell);
        }
        catch (BatonException) { client?.Dispose(); throw; }
        catch (OperationCanceledException) { client?.Dispose(); throw; }
        catch (SshAuthenticationException) { client?.Dispose(); throw new BatonException("ssh_authentication_failed"); }
        catch { client?.Dispose(); throw new BatonException("ssh_connection_failed"); }
        finally { foreach (var item in methods) item.Dispose(); key?.Dispose(); }
    }
    public void Start()
    {
        lock (receiveGate)
        {
            if (Volatile.Read(ref disposed) != 0) throw new BatonException("session_closed");
            started = true;
            while (initialOutput.TryDequeue(out var bytes)) { Output?.Invoke(bytes); Array.Clear(bytes); }
            initialBytes = 0;
            Drain(false);
        }
    }
    private void Drain(bool discard)
    {
        lock (receiveGate)
        {
            if (Volatile.Read(ref disposed) != 0) return;
            var current = shell;
            if (current is null) return;
            var bytes = new byte[8192];
            try
            {
                // ShellStream also queues DataReceived bytes; drain its queue rather than duplicating the event payload.
                while (current.DataAvailable)
                {
                    int count = current.Read(bytes, 0, bytes.Length);
                    if (count == 0) break;
                    if (!discard)
                    {
                        var chunk = bytes.AsSpan(0, count).ToArray();
                        if (started) Output?.Invoke(chunk);
                        else
                        {
                            initialOutput.Enqueue(chunk); initialBytes += count;
                            while (initialBytes > 65536 && initialOutput.TryDequeue(out var old)) { initialBytes -= old.Length; Array.Clear(old); }
                        }
                    }
                }
            }
            catch { NotifyClosed(); }
        }
    }
    public void Write(byte[] data)
    {
        var current = shell;
        if (Volatile.Read(ref disposed) != 0 || client?.IsConnected != true || current?.CanWrite != true) throw new BatonException("session_closed");
        current.Write(data, 0, data.Length);
        current.Flush();
    }
    public void Boundary(Action transition)
    {
        lock (receiveGate) { Drain(true); transition(); }
    }
    private void NotifyClosed()
    {
        if (Interlocked.Exchange(ref disposed, 1) == 0)
        {
            connectionWatch?.Dispose();
            _ = Task.Run(Cleanup);
            Closed?.Invoke();
        }
    }
    private void Cleanup()
    {
        var oldShell = Interlocked.Exchange(ref shell, null);
        var oldClient = Interlocked.Exchange(ref client, null);
        try { oldClient?.Dispose(); } catch { }
        try { oldShell?.Dispose(); } catch { }
        lock(receiveGate) { foreach(var bytes in initialOutput) Array.Clear(bytes); initialOutput.Clear(); initialBytes = 0; }
    }
    public void Dispose() => NotifyClosed();
}

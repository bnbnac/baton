using System.Diagnostics;
using System.Text;
using Baton.Core;
using Xunit;

namespace Baton.Tests;

public sealed class Fixture : IAsyncDisposable
{
    private readonly Process process;
    public int Port { get; }
    public Fixture()
    {
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
        process = Process.Start(new ProcessStartInfo("node", Path.Combine(root, "tests/ssh-fixture.mjs")) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        })!;
        var port = process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
        if (!int.TryParse(port, out var value)) throw new InvalidOperationException("SSH fixture failed to start");
        Port = value;
    }
    public ValueTask DisposeAsync() { if (!process.HasExited) process.Kill(true); process.Dispose(); return ValueTask.CompletedTask; }
}
public sealed class FixtureAuth(bool trust = true) : IUserAuthentication
{
    public bool HostChecked { get; private set; }
    public bool ConfirmHostKey(string h, int p, string a, string f) { HostChecked = f.StartsWith("SHA256:"); return trust; }
    public string GetPassword(string purpose) => "fixture-only";
    public string[] AnswerChallenges(string name, string instruction, IReadOnlyList<AuthPrompt> prompts) => ["123456"];
}
public class SshTransportTests
{
    [Theory]
    [InlineData("password")]
    [InlineData("interactive")]
    [InlineData("password+interactive")]
    public async Task Authenticates_requests_pty_and_transmits_exact_bytes(string method)
    {
        await using var fixture = new Fixture();
        var auth = new FixtureAuth();
        using var transport = await SshTransport.ConnectAsync(new("127.0.0.1", fixture.Port, method == "password+interactive" ? "fixture-mfa" : "fixture"), auth, method);
        var output = new StringBuilder();
        var received = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        transport.Output += bytes => { lock(output) { output.Append(Encoding.UTF8.GetString(bytes)); if(output.ToString().Contains("EXACT_TEXT\r")) received.TrySetResult(); } };
        transport.Start();
        transport.Write(Encoding.UTF8.GetBytes("EXACT_TEXT\r"));
        await received.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.True(auth.HostChecked);
        lock(output) Assert.Contains("PRE_HANDOFF_SECRET", output.ToString());
    }
    [Fact]
    public async Task Rejects_host_key_before_opening_a_shell()
    {
        await using var fixture = new Fixture();
        var failure = await Assert.ThrowsAsync<BatonException>(() => SshTransport.ConnectAsync(new("127.0.0.1", fixture.Port, "fixture"), new FixtureAuth(false), "password"));
        Assert.Equal("ssh_connection_failed",failure.Code);
    }
    [Fact]
    public async Task Control_c_is_a_byte_and_remote_channel_close_invalidates_transport()
    {
        await using var fixture = new Fixture();
        using var transport = await SshTransport.ConnectAsync(new("127.0.0.1",fixture.Port,"fixture"),new FixtureAuth(),"password");
        var interrupt = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        transport.Output += bytes => { if(Encoding.UTF8.GetString(bytes).Contains("INTERRUPTED")) interrupt.TrySetResult(); };
        transport.Closed += () => closed.TrySetResult(); transport.Start();
        transport.Write([3]); await interrupt.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(closed.Task.IsCompleted);
        transport.Write(Encoding.UTF8.GetBytes("disconnect\r")); await closed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Throws<BatonException>(() => transport.Write(Encoding.UTF8.GetBytes("late")));
    }
    [Fact]
    public async Task Encrypted_private_key_authentication_uses_user_passphrase()
    {
        await using var fixture = new Fixture();
        using var key = System.Security.Cryptography.RSA.Create(2048);
        var directory = Path.Combine(Path.GetTempPath(),"baton-key-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory); var path = Path.Combine(directory,"fixture.pem");
        try
        {
            await File.WriteAllTextAsync(path,key.ExportEncryptedPkcs8PrivateKeyPem("fixture-only",new(System.Security.Cryptography.PbeEncryptionAlgorithm.Aes256Cbc,System.Security.Cryptography.HashAlgorithmName.SHA256,10000)));
            using var transport = await SshTransport.ConnectAsync(new("127.0.0.1",fixture.Port,"fixture",path),new FixtureAuth(),"key");
            transport.Start(); transport.Write(Encoding.UTF8.GetBytes("key-test"));
        }
        finally { File.Delete(path); Directory.Delete(directory); }
    }
}

// Test-only host: same registry/SSH disposal path as the app, with fixture credentials.
// Never connects to a user-provided server or emits terminal transcripts.
using System.Text.Json;
using System.Text.RegularExpressions;
using Baton.Core;

if (args.Length != 1 || !int.TryParse(args[0], out var port) || port is < 1 or > 65535)
    throw new ArgumentException("Expected loopback fixture port");
using var registry = new SessionRegistry();
var owner = registry.RegisterAdapter("server-lifecycle-probe");
var transport = await SshTransport.ConnectAsync(new("127.0.0.1", port, "batonfixture"), new FixtureAuth(port), "password");
var session = new ShellSession(transport, "isolated fixture");
registry.Add(session);
await registry.HandoffAsync(session.Id, owner);
long cursor = 0;
async Task<int> SendAndReadPid(string id, string command, string marker)
{
    await session.SendAgentAsync(owner, id, command + "\r");
    var collected = "";
    var deadline = DateTime.UtcNow.AddSeconds(10);
    while (DateTime.UtcNow < deadline)
    {
        var page = await session.ReadAsync(owner, cursor, 32768, 500);
        cursor = page.NextCursor;
        collected += page.Text;
        var match = Regex.Match(collected, Regex.Escape(marker) + @"=(\d+)\r?\n");
        if (match.Success) return int.Parse(match.Groups[1].Value);
    }
    throw new TimeoutException("fixture_pid_not_received");
}
var shellPid = await SendAndReadPid("shell", "printf '__SHELL__=%s\\n' \"$$\"", "__SHELL__");
var sshdPid = await SendAndReadPid("sshd", "printf '__SSHD__=%s\\n' \"$PPID\"", "__SSHD__");
var backgroundPid = await SendAndReadPid("background", "sleep 120 & printf '__BACKGROUND__=%s\\n' \"$!\"", "__BACKGROUND__");
var detachedPid = await SendAndReadPid("detached", "nohup sleep 120 </dev/null >/dev/null 2>&1 & printf '__DETACHED__=%s\\n' \"$!\"; disown %%", "__DETACHED__");
var foregroundPid = await SendAndReadPid("foreground", "sh -c 'printf \"__FOREGROUND__=%s\\n\" \"$$\"; exec sleep 120'", "__FOREGROUND__");
Console.WriteLine(JsonSerializer.Serialize(new { shellPid, sshdPid, backgroundPid, detachedPid, foregroundPid }));
if (await Console.In.ReadLineAsync() == "dispose")
{
    registry.Dispose();
    Console.WriteLine("registry_disposed");
    // Keep the process alive while the external observer checks cleanup.
    await Console.In.ReadLineAsync();
}

sealed class FixtureAuth(int port) : IUserAuthentication
{
    public bool ConfirmHostKey(string host, int actualPort, string algorithm, string sha256) =>
        host == "127.0.0.1" && actualPort == port && sha256.StartsWith("SHA256:", StringComparison.Ordinal);
    public string GetPassword(string purpose) => "baton-fixture-only";
    public string[]? AnswerChallenges(string name, string instruction, IReadOnlyList<AuthPrompt> prompts) => null;
}

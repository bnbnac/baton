using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Baton.Core;
using Xunit;

namespace Baton.Tests;

public sealed class LinuxSshFactAttribute : FactAttribute
{
    public LinuxSshFactAttribute()
    {
        if (!int.TryParse(Environment.GetEnvironmentVariable("BATON_LINUX_SSH_PORT"),
                NumberStyles.None, CultureInfo.InvariantCulture, out var port) || port is < 1 or > 65535)
            Skip = "Set BATON_LINUX_SSH_PORT to run the optional real Linux/OpenSSH integration test.";
    }
}

public sealed class LinuxSshTests
{
    [LinuxSshFact]
    public async Task Real_openssh_pty_enforces_handoff_and_handles_interrupt_exit_and_disconnect()
    {
        var port = int.Parse(Environment.GetEnvironmentVariable("BATON_LINUX_SSH_PORT")!, CultureInfo.InvariantCulture);
        var auth = new LinuxFixtureAuthentication(port);
        const string owner = "linux-integration-owner";

        using (var transport = await SshTransport.ConnectAsync(
                   new SshTarget("127.0.0.1", port, "batonfixture"), auth, "password"))
        using (var session = new ShellSession(transport, "local Docker OpenSSH fixture"))
        {
            await session.SendUserAsync("printf 'BATON_PRIVATE_%s\\n' BEFORE_HANDOFF\r");
            await WaitUntilAsync(() => session.ScreenText.Contains("BATON_PRIVATE_BEFORE_HANDOFF", StringComparison.Ordinal));
            await session.HandoffAsync(owner);

            var initial = await session.ReadAsync(owner, 0, 32768, 0);
            Assert.DoesNotContain("BATON_PRIVATE_BEFORE_HANDOFF", initial.Text, StringComparison.Ordinal);

            await session.SendAgentAsync(owner, "identity", "printf 'BATON_REAL_%s:%s:%s\\n' MARKER \"$(id -u)\" END\r");
            var (identityOutput, cursor) = await ReadUntilAsync(session, owner, 0, ":END");
            var uid = Regex.Match(identityOutput, @"BATON_REAL_MARKER:(\d+):END");
            Assert.True(uid.Success, identityOutput);
            Assert.NotEqual("0", uid.Groups[1].Value);
            Assert.True(auth.HostKeyChecked);

            await session.SendAgentAsync(owner, "sleep", "sleep 30\r");
            (_, cursor) = await ReadUntilAsync(session, owner, cursor, "sleep 30");
            await session.SendAgentAsync(owner, "interrupt", "\u0003");
            await session.SendAgentAsync(owner, "after-interrupt", "printf 'BATON_AFTER_%s\\n' CTRL_C\r");
            (_, cursor) = await ReadUntilAsync(session, owner, cursor, "BATON_AFTER_CTRL_C");

            await session.SendAgentAsync(owner, "exit", "exit\r");
            await WaitUntilAsync(() => session.State == SessionState.Closed);
        }

        var container = Environment.GetEnvironmentVariable("BATON_LINUX_SSH_CONTAINER");
        var fixtureId = Environment.GetEnvironmentVariable("BATON_LINUX_SSH_FIXTURE_ID");
        if (string.IsNullOrEmpty(container) || string.IsNullOrEmpty(fixtureId)) return;
        Assert.Matches("^[0-9a-f]{32}$", fixtureId);
        Assert.Equal($"baton-test-{fixtureId}", container);

        using var disconnectTransport = await SshTransport.ConnectAsync(
            new SshTarget("127.0.0.1", port, "batonfixture"), new LinuxFixtureAuthentication(port), "password");
        var disconnected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        disconnectTransport.Closed += () => disconnected.TrySetResult();
        disconnectTransport.Start();
        await StopOwnedContainerAsync(container, fixtureId);
        await disconnected.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Throws<BatonException>(() => disconnectTransport.Write(Encoding.UTF8.GetBytes("late")));
    }

    private static async Task<(string Text, long Cursor)> ReadUntilAsync(
        ShellSession session, string owner, long cursor, string marker)
    {
        var output = new StringBuilder();
        var timeout = DateTime.UtcNow.AddSeconds(10);
        while (DateTime.UtcNow < timeout)
        {
            var page = await session.ReadAsync(owner, cursor, 32768, 1000);
            Assert.Null(page.Error);
            output.Append(page.Text);
            cursor = page.NextCursor;
            if (output.ToString().Contains(marker, StringComparison.Ordinal)) return (output.ToString(), cursor);
        }
        throw new Xunit.Sdk.XunitException($"Timed out waiting for {marker}. Output: {output}");
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        var timeout = DateTime.UtcNow.AddSeconds(10);
        while (!condition() && DateTime.UtcNow < timeout) await Task.Delay(20);
        Assert.True(condition());
    }

    private static async Task StopOwnedContainerAsync(string container, string fixtureId)
    {
        var inspect = new ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        inspect.ArgumentList.Add("container");
        inspect.ArgumentList.Add("inspect");
        inspect.ArgumentList.Add("--format");
        inspect.ArgumentList.Add("{{index .Config.Labels \"baton.integration\"}}");
        inspect.ArgumentList.Add(container);
        using (var inspection = Process.Start(inspect) ?? throw new InvalidOperationException("docker_inspect_failed"))
        {
            var label = await inspection.StandardOutput.ReadToEndAsync();
            await inspection.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
            Assert.Equal(0, inspection.ExitCode);
            Assert.Equal(fixtureId, label.Trim());
        }

        var info = new ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        info.ArgumentList.Add("stop");
        info.ArgumentList.Add("--time");
        info.ArgumentList.Add("0");
        info.ArgumentList.Add(container);
        using var process = Process.Start(info) ?? throw new InvalidOperationException("docker_stop_failed");
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
        var error = await process.StandardError.ReadToEndAsync();
        Assert.True(process.ExitCode == 0, $"docker stop failed: {error}");
    }

    private sealed class LinuxFixtureAuthentication(int expectedPort) : IUserAuthentication
    {
        public bool HostKeyChecked { get; private set; }

        public bool ConfirmHostKey(string host, int port, string algorithm, string sha256)
        {
            HostKeyChecked = host == "127.0.0.1" && port == expectedPort &&
                !string.IsNullOrWhiteSpace(algorithm) && sha256.StartsWith("SHA256:", StringComparison.Ordinal);
            return HostKeyChecked;
        }

        public string GetPassword(string purpose) => "baton-fixture-only";
        public string[]? AnswerChallenges(string name, string instruction, IReadOnlyList<AuthPrompt> prompts) => null;
    }
}

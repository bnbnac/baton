using System.Diagnostics;
using System.Text.Json;
using Baton.Core;
using Xunit;

namespace Baton.Tests;

public sealed class AdapterTests
{
    [Fact]
    public async Task Stdio_adapter_initializes_lists_exactly_four_tools_and_calls_status()
    {
        await using var app = await TestApp.StartAsync();
        await using var adapter = AdapterProcess.Start(app.Directory, "Codex");

        using var initialize = await adapter.RequestAsync(1, "initialize", new
        {
            protocolVersion = "2025-06-18",
            capabilities = new { },
            clientInfo = new { name = "adapter-test", version = "1" }
        });
        var result = initialize.RootElement.GetProperty("result");
        Assert.Equal("Baton", result.GetProperty("serverInfo").GetProperty("name").GetString());
        Assert.Contains("sudo -n", result.GetProperty("instructions").GetString(), StringComparison.Ordinal);
        await adapter.NotifyAsync("notifications/initialized");

        using var list = await adapter.RequestAsync(2, "tools/list", new { });
        var tools = list.RootElement.GetProperty("result").GetProperty("tools");
        Assert.Equal(4, tools.GetArrayLength());
        Assert.Equal(
            ["read_output", "send_key", "send_text", "status"],
            tools.EnumerateArray().Select(tool => tool.GetProperty("name").GetString()!).Order().ToArray());
        Assert.All(tools.EnumerateArray(), tool => Assert.False(string.IsNullOrWhiteSpace(tool.GetProperty("description").GetString())));

        using var status = await adapter.RequestAsync(3, "tools/call", new
        {
            name = "status",
            arguments = new { }
        });
        var content = status.RootElement.GetProperty("result").GetProperty("content")[0];
        using var statusPayload = JsonDocument.Parse(content.GetProperty("text").GetString()!);
        Assert.Equal("unassigned", statusPayload.RootElement.GetProperty("state").GetString());
        Assert.Null(statusPayload.RootElement.GetProperty("session_id").GetString());

        await WaitUntilAsync(() => app.Registry.Adapters.Count == 1);
        var owner = Assert.Single(app.Registry.Adapters).Id;
        var transport = new ControlledTransport();
        using var session = new ShellSession(transport, "integration");
        app.Registry.Add(session);
        await app.Registry.HandoffAsync(session.Id, owner);

        using var sendText = await adapter.RequestAsync(4, "tools/call", new
        {
            name = "send_text",
            arguments = new { session_id = session.Id, request_id = "text-1", text = "printf hello" }
        });
        using var textReceipt = ContentJson(sendText);
        Assert.Equal("delivered", textReceipt.RootElement.GetProperty("status").GetString());
        using var sendKey = await adapter.RequestAsync(5, "tools/call", new
        {
            name = "send_key",
            arguments = new { session_id = session.Id, request_id = "key-1", key = "Enter" }
        });
        using var keyReceipt = ContentJson(sendKey);
        Assert.Equal("delivered", keyReceipt.RootElement.GetProperty("status").GetString());
        Assert.Equal(["printf hello", "\r"], transport.Writes);

        transport.Emit("hello");
        using var read = await adapter.RequestAsync(6, "tools/call", new
        {
            name = "read_output",
            arguments = new { session_id = session.Id, cursor = 0, limit = 100, wait_ms = 0 }
        });
        using var page = ContentJson(read);
        Assert.Equal("hello", page.RootElement.GetProperty("text").GetString());
        Assert.Equal(5, page.RootElement.GetProperty("next_cursor").GetInt64());

        using var invalidKey = await adapter.RequestAsync(7, "tools/call", new
        {
            name = "send_key",
            arguments = new { session_id = session.Id, request_id = "key-2", key = "ArrowUp" }
        });
        var invalidResult = invalidKey.RootElement.GetProperty("result");
        Assert.True(invalidResult.GetProperty("isError").GetBoolean());
        Assert.Contains("invalid_key", invalidResult.GetProperty("content")[0].GetProperty("text").GetString(), StringComparison.Ordinal);
        Assert.Equal(["printf hello", "\r"], transport.Writes);
        Assert.All(adapter.StdoutLines, line => Assert.NotNull(JsonDocument.Parse(line)));
    }

    [Fact]
    public async Task Eof_and_process_termination_close_only_each_adapters_owned_session()
    {
        await using var app = await TestApp.StartAsync();
        await using var claude = AdapterProcess.Start(app.Directory, "Claude Desktop");
        await using var codex = AdapterProcess.Start(app.Directory, "Codex");

        await WaitUntilAsync(() => app.Registry.Adapters.Count == 2);
        var claudeOwner = Assert.Single(app.Registry.Adapters, adapter => adapter.Label == "Claude Desktop").Id;
        var codexOwner = Assert.Single(app.Registry.Adapters, adapter => adapter.Label == "Codex").Id;
        var claudeTransport = new ControlledTransport();
        var codexTransport = new ControlledTransport();
        using var claudeSession = new ShellSession(claudeTransport, "claude");
        using var codexSession = new ShellSession(codexTransport, "codex");
        app.Registry.Add(claudeSession);
        app.Registry.Add(codexSession);
        await app.Registry.HandoffAsync(claudeSession.Id, claudeOwner);
        await app.Registry.HandoffAsync(codexSession.Id, codexOwner);

        claude.CloseInput();
        await claude.WaitForExitAsync();
        await WaitUntilAsync(() => claudeTransport.Disposed);
        Assert.False(codexTransport.Disposed);

        codex.Kill();
        await codex.WaitForExitAsync();
        await WaitUntilAsync(() => codexTransport.Disposed);
    }

    [Fact]
    public async Task App_pipe_disconnect_ends_adapter_without_reconnecting()
    {
        await using var app = await TestApp.StartAsync();
        await using var adapter = AdapterProcess.Start(app.Directory, "Codex");
        await WaitUntilAsync(() => app.Registry.Adapters.Count == 1);

        await app.StopBrokerAsync();

        await adapter.WaitForExitAsync();
        Assert.Empty(app.Registry.Adapters);
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        var timeout = DateTime.UtcNow.AddSeconds(10);
        while (!condition() && DateTime.UtcNow < timeout) await Task.Delay(20);
        Assert.True(condition());
    }

    private static JsonDocument ContentJson(JsonDocument response) =>
        JsonDocument.Parse(response.RootElement.GetProperty("result").GetProperty("content")[0].GetProperty("text").GetString()!);

    private sealed class TestApp : IAsyncDisposable
    {
        private readonly CancellationTokenSource cancellation = new();
        private readonly LocalEndpoint endpoint;
        private readonly PipeBroker broker;
        private readonly Task run;
        private int stopped;

        private TestApp(string directory, LocalEndpoint endpoint)
        {
            Directory = directory;
            this.endpoint = endpoint;
            broker = new PipeBroker(Registry, endpoint.Info);
            run = broker.RunAsync(cancellation.Token);
        }

        public string Directory { get; }
        public SessionRegistry Registry { get; } = new();

        public static Task<TestApp> StartAsync()
        {
            var directory = Path.Combine(Path.GetTempPath(), "BatonAdapterTests", Guid.NewGuid().ToString("N"));
            return Task.FromResult(new TestApp(directory, LocalEndpoint.Create(directory)));
        }

        public async Task StopBrokerAsync()
        {
            if (Interlocked.Exchange(ref stopped, 1) != 0) return;
            cancellation.Cancel();
            await broker.DisposeAsync();
            try { await run; } catch (OperationCanceledException) { }
        }

        public async ValueTask DisposeAsync()
        {
            await StopBrokerAsync();
            Registry.Dispose();
            endpoint.Dispose();
            cancellation.Dispose();
            if (System.IO.Directory.Exists(Directory)) System.IO.Directory.Delete(Directory, true);
        }
    }

    private sealed class AdapterProcess : IAsyncDisposable
    {
        private readonly Process process;
        private readonly List<string> stdoutLines = [];

        private AdapterProcess(Process process) => this.process = process;

        public IReadOnlyList<string> StdoutLines { get { lock (stdoutLines) return stdoutLines.ToArray(); } }

        public static AdapterProcess Start(string endpointDirectory, string label)
        {
            var info = new ProcessStartInfo("dotnet")
            {
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            var configuration = new DirectoryInfo(AppContext.BaseDirectory).Parent!.Name;
            var repository = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
            info.ArgumentList.Add(Path.Combine(repository, "src", "Baton.Adapter", "bin", configuration, "net10.0-windows", "Baton.Adapter.dll"));
            info.ArgumentList.Add("--endpoint-dir");
            info.ArgumentList.Add(endpointDirectory);
            info.ArgumentList.Add("--label");
            info.ArgumentList.Add(label);
            return new AdapterProcess(Process.Start(info) ?? throw new InvalidOperationException("adapter_start_failed"));
        }

        public async Task<JsonDocument> RequestAsync(int id, string method, object parameters)
        {
            await WriteAsync(new { jsonrpc = "2.0", id, method, @params = parameters });
            var read = process.StandardOutput.ReadLineAsync();
            var line = await read.WaitAsync(TimeSpan.FromSeconds(10));
            if (line is null)
            {
                var error = await process.StandardError.ReadToEndAsync();
                throw new InvalidOperationException($"adapter_stdout_closed: {error}");
            }
            lock (stdoutLines) stdoutLines.Add(line);
            return JsonDocument.Parse(line);
        }

        public Task NotifyAsync(string method) => WriteAsync(new { jsonrpc = "2.0", method });

        private async Task WriteAsync(object message)
        {
            await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(message));
            await process.StandardInput.FlushAsync();
        }

        public void CloseInput() => process.StandardInput.Close();
        public void Kill() { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        public Task WaitForExitAsync() => process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));

        public async ValueTask DisposeAsync()
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync();
            }
            process.Dispose();
        }
    }
}

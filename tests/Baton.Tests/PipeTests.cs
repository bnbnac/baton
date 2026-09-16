using Baton.Core;
using Xunit;

namespace Baton.Tests;

public sealed class PipeTests
{
    [Fact]
    public async Task Late_cancellations_do_not_disconnect_the_adapter()
    {
        await using var server = await PipeServer.StartAsync();
        await using var client = await PipeClient.ConnectAsync(server.Endpoint.Info,"cancel race");
        for(var i = 0; i < 50; i++)
        {
            using var cancellation = new CancellationTokenSource();
            var request = client.CallAsync<SessionInfo>("status",cancellationToken:cancellation.Token);
            cancellation.Cancel();
            try { await request; } catch(OperationCanceledException) { }
            Assert.Equal("unassigned",(await client.CallAsync<SessionInfo>("status")).State);
        }
        Assert.True(client.IsConnected);
    }
    [Fact]
    public async Task Maximum_unicode_output_page_fits_the_ipc_frame()
    {
        await using var server = await PipeServer.StartAsync();
        await using var client = await PipeClient.ConnectAsync(server.Endpoint.Info, "Codex");
        var transport = new ControlledTransport();
        using var session = new ShellSession(transport,"unicode");
        server.Registry.Add(session);
        await server.Registry.HandoffAsync(session.Id,client.ConnectionId);
        transport.Emit(new string('한',32768));
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var page = await client.CallAsync<OutputPage>("read_output",new { session_id = session.Id, cursor = 0, limit = 32768, wait_ms = 0 },timeout.Token);
        Assert.Equal(new string('한',32768),page.Text);
        Assert.Equal(32768,page.NextCursor);
    }
    [Fact]
    public void Endpoint_round_trips_and_prevents_a_second_app_instance()
    {
        using var directory = new TemporaryDirectory();
        using var endpoint = LocalEndpoint.Create(directory.Path);

        Assert.Equal(endpoint.Info, LocalEndpoint.Load(directory.Path));
        var error = Assert.Throws<BatonException>(() => LocalEndpoint.Create(directory.Path));
        Assert.Equal("app_already_running", error.Code);
    }

    [Fact]
    public async Task Wrong_secret_is_rejected_without_exposing_the_secret()
    {
        await using var server = await PipeServer.StartAsync();
        var wrong = new EndpointInfo(server.Endpoint.Info.PipeName, Convert.ToBase64String(new byte[32]));

        var error = await Assert.ThrowsAsync<BatonException>(() =>
            PipeClient.ConnectAsync(wrong, "attacker").WaitAsync(TimeSpan.FromSeconds(5)));

        Assert.Equal("authentication_failed", error.Code);
        Assert.DoesNotContain(wrong.Secret, error.ToString(), StringComparison.Ordinal);
        Assert.Empty(server.Registry.Adapters);
    }

    [Fact]
    public async Task Status_uses_the_owner_created_for_each_connection()
    {
        await using var server = await PipeServer.StartAsync();
        await using var first = await PipeClient.ConnectAsync(server.Endpoint.Info, "same display label");
        await using var second = await PipeClient.ConnectAsync(server.Endpoint.Info, "same display label");
        using var firstSession = new ShellSession(new ControlledTransport(), "first");
        using var secondSession = new ShellSession(new ControlledTransport(), "second");
        server.Registry.Add(firstSession);
        server.Registry.Add(secondSession);
        await server.Registry.HandoffAsync(firstSession.Id, first.ConnectionId);
        await server.Registry.HandoffAsync(secondSession.Id, second.ConnectionId);

        var firstStatus = await first.CallAsync<SessionInfo>("status");
        var secondStatus = await second.CallAsync<SessionInfo>("status");

        Assert.Equal(firstSession.Id, firstStatus.SessionId);
        Assert.Equal(first.ConnectionId, firstStatus.Owner);
        Assert.Equal(secondSession.Id, secondStatus.SessionId);
        Assert.Equal(second.ConnectionId, secondStatus.Owner);
    }

    [Fact]
    public async Task A_waiting_read_does_not_block_input_on_the_same_connection()
    {
        await using var server = await PipeServer.StartAsync();
        await using var client = await PipeClient.ConnectAsync(server.Endpoint.Info, "Codex");
        var transport = new ControlledTransport();
        using var session = new ShellSession(transport, "test");
        server.Registry.Add(session);
        await server.Registry.HandoffAsync(session.Id, client.ConnectionId);

        var read = client.CallAsync<OutputPage>("read_output", new
        {
            session_id = session.Id,
            cursor = 0,
            limit = 100,
            wait_ms = 10_000
        });
        var receipt = await client.CallAsync<InputReceipt>("send_text", new
        {
            session_id = session.Id,
            request_id = "write-1",
            text = "hello"
        }).WaitAsync(TimeSpan.FromSeconds(2));

        Assert.Equal("delivered", receipt.Status);
        Assert.Equal(["hello"], transport.Writes);
        transport.Emit("ready");
        Assert.Equal("ready", (await read.WaitAsync(TimeSpan.FromSeconds(2))).Text);
    }

    [Fact]
    public async Task Disconnect_closes_the_connection_owned_session()
    {
        await using var server = await PipeServer.StartAsync();
        var client = await PipeClient.ConnectAsync(server.Endpoint.Info, "Claude Desktop");
        var transport = new ControlledTransport();
        using var session = new ShellSession(transport, "test");
        server.Registry.Add(session);
        await server.Registry.HandoffAsync(session.Id, client.ConnectionId);

        await client.DisposeAsync();

        await WaitUntilAsync(() => transport.Disposed);
        Assert.Equal(SessionState.Closed, session.State);
    }

    [Fact]
    public async Task Cancelling_a_read_keeps_the_connection_usable()
    {
        await using var server = await PipeServer.StartAsync();
        await using var client = await PipeClient.ConnectAsync(server.Endpoint.Info, "Codex");
        using var session = new ShellSession(new ControlledTransport(), "test");
        server.Registry.Add(session);
        await server.Registry.HandoffAsync(session.Id, client.ConnectionId);
        using var cancellation = new CancellationTokenSource();

        var read = client.CallAsync<OutputPage>("read_output", new
        {
            session_id = session.Id,
            cursor = 0,
            limit = 100,
            wait_ms = 10_000
        }, cancellation.Token);
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => read);
        var status = await client.CallAsync<SessionInfo>("status").WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(session.Id, status.SessionId);
    }

    [Fact]
    public async Task Ninth_waiting_read_is_rejected_without_blocking_the_connection()
    {
        await using var server = await PipeServer.StartAsync();
        await using var client = await PipeClient.ConnectAsync(server.Endpoint.Info, "Codex");
        using var session = new ShellSession(new ControlledTransport(), "test");
        server.Registry.Add(session);
        await server.Registry.HandoffAsync(session.Id, client.ConnectionId);
        using var cancellation = new CancellationTokenSource();
        var reads = Enumerable.Range(0, 9).Select(_ => client.CallAsync<OutputPage>("read_output", new
        {
            session_id = session.Id,
            cursor = 0,
            limit = 100,
            wait_ms = 10_000
        }, cancellation.Token)).ToArray();

        var error = await Assert.ThrowsAsync<BatonException>(() => reads[8].WaitAsync(TimeSpan.FromSeconds(2)));
        Assert.Equal("read_limit", error.Code);
        Assert.Equal(session.Id, (await client.CallAsync<SessionInfo>("status")).SessionId);
        cancellation.Cancel();
    }

    [Fact]
    public async Task Client_rejects_more_than_sixteen_pending_calls()
    {
        await using var server = await PipeServer.StartAsync();
        await using var client = await PipeClient.ConnectAsync(server.Endpoint.Info, "Codex");
        var transport = new ControlledTransport { BlockWrite = new(false) };
        using var session = new ShellSession(transport, "test");
        server.Registry.Add(session);
        await server.Registry.HandoffAsync(session.Id, client.ConnectionId);
        using var cancellation = new CancellationTokenSource();
        var reads = Enumerable.Range(0, 8).Select(_ => client.CallAsync<OutputPage>("read_output", new
        {
            session_id = session.Id,
            cursor = 0,
            limit = 100,
            wait_ms = 10_000
        }, cancellation.Token)).ToArray();
        var writes = Enumerable.Range(0, 8).Select(i => client.CallAsync<InputReceipt>("send_text", new
        {
            session_id = session.Id,
            request_id = "blocked-" + i,
            text = "x"
        }, cancellation.Token)).ToArray();
        await transport.WriteEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));

        var error = await Assert.ThrowsAsync<BatonException>(() => client.CallAsync<SessionInfo>("status"));
        Assert.Equal("client_busy", error.Code);
        cancellation.Cancel();
        transport.BlockWrite.Set();
        await Task.WhenAll(reads.Select(IgnoreCancellation).Concat(writes.Select(IgnoreCancellation)));
    }

    [Fact]
    public async Task Disconnect_closes_session_even_when_an_input_write_is_blocked()
    {
        await using var server = await PipeServer.StartAsync();
        var client = await PipeClient.ConnectAsync(server.Endpoint.Info, "Codex");
        var transport = new ControlledTransport { BlockWrite = new(false) };
        using var session = new ShellSession(transport, "test");
        server.Registry.Add(session);
        await server.Registry.HandoffAsync(session.Id, client.ConnectionId);
        var write = client.CallAsync<InputReceipt>("send_text", new
        {
            session_id = session.Id,
            request_id = "blocked",
            text = "x"
        });
        await transport.WriteEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));

        await client.DisposeAsync();

        await WaitUntilAsync(() => transport.Disposed, TimeSpan.FromSeconds(1));
        await IgnoreCancellation(write);
    }

    [Fact]
    public async Task Connect_without_a_caller_token_times_out()
    {
        var unavailable = new EndpointInfo("baton-" + Guid.NewGuid().ToString("N"), Convert.ToBase64String(new byte[32]));

        var error = await Assert.ThrowsAsync<BatonException>(() =>
            PipeClient.ConnectAsync(unavailable, "Codex").WaitAsync(TimeSpan.FromSeconds(7)));

        Assert.Equal("connection_timeout", error.Code);
    }

    [Theory]
    [InlineData("Enter", "\r")]
    [InlineData("Ctrl+C", "\u0003")]
    [InlineData("Tab", "\t")]
    [InlineData("Escape", "\u001b")]
    [InlineData("Ctrl+D", "\u0004")]
    [InlineData("Backspace", "\u007f")]
    public async Task Send_key_maps_only_named_terminal_keys(string key, string expected)
    {
        await using var server = await PipeServer.StartAsync();
        await using var client = await PipeClient.ConnectAsync(server.Endpoint.Info, "Codex");
        var transport = new ControlledTransport();
        using var session = new ShellSession(transport, "test");
        server.Registry.Add(session);
        await server.Registry.HandoffAsync(session.Id, client.ConnectionId);

        var receipt = await client.CallAsync<InputReceipt>("send_key", new
        {
            session_id = session.Id,
            request_id = "key-1",
            key
        });

        Assert.Equal("delivered", receipt.Status);
        Assert.Equal([expected], transport.Writes);
    }

    private static async Task IgnoreCancellation(Task task)
    {
        try { await task; } catch (OperationCanceledException) { } catch (BatonException) { }
    }

    private static async Task WaitUntilAsync(Func<bool> condition, TimeSpan? duration = null)
    {
        var timeout = DateTime.UtcNow.Add(duration ?? TimeSpan.FromSeconds(5));
        while (!condition() && DateTime.UtcNow < timeout) await Task.Delay(10);
        Assert.True(condition());
    }

    private sealed class PipeServer : IAsyncDisposable
    {
        private readonly CancellationTokenSource cancellation = new();
        private readonly Task run;
        public LocalEndpoint Endpoint { get; }
        public SessionRegistry Registry { get; } = new();
        private PipeServer(LocalEndpoint endpoint)
        {
            Endpoint = endpoint;
            var broker = new PipeBroker(Registry, endpoint.Info);
            Broker = broker;
            run = broker.RunAsync(cancellation.Token);
        }
        public PipeBroker Broker { get; }
        public static Task<PipeServer> StartAsync()
        {
            var endpoint = LocalEndpoint.Create(System.IO.Path.Combine(System.IO.Path.GetTempPath(), "BatonPipeTests", Guid.NewGuid().ToString("N")));
            return Task.FromResult(new PipeServer(endpoint));
        }
        public async ValueTask DisposeAsync()
        {
            cancellation.Cancel();
            await Broker.DisposeAsync();
            try { await run; } catch (OperationCanceledException) { }
            Registry.Dispose();
            Endpoint.Dispose();
            cancellation.Dispose();
        }
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "BatonPipeTests", Guid.NewGuid().ToString("N"));
        public void Dispose()
        {
            if (Directory.Exists(Path)) Directory.Delete(Path, true);
        }
    }
}

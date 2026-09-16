using System.Text;
using Baton.Core;
using Xunit;
namespace Baton.Tests;

// Only the external SSH byte transport is substituted; all ownership/queue/buffer logic is real.
public sealed class ControlledTransport : IShellTransport
{
    public event Action<byte[]>? Output;
    public event Action? Closed;
    public List<string> Writes { get; } = [];
    public ManualResetEventSlim? BlockWrite;
    public TaskCompletionSource WriteEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public bool Disposed;
    public bool ThrowWrite;
    public void Start() { }
    public void Emit(string text) => Output?.Invoke(Encoding.UTF8.GetBytes(text));
    public void EmitBytes(byte[] bytes) => Output?.Invoke(bytes);
    public void Write(byte[] bytes) { WriteEntered.TrySetResult(); BlockWrite?.Wait(TimeSpan.FromSeconds(5)); if (ThrowWrite) throw new IOException("private terminal text"); lock(Writes) Writes.Add(Encoding.UTF8.GetString(bytes)); }
    public void Boundary(Action action) => action();
    public void Dispose() { Disposed = true; BlockWrite?.Set(); Closed?.Invoke(); }
}
public class ShellSessionTests
{
    [Fact] public async Task Handoff_hides_history_and_partial_utf8_and_rejects_every_user_input()
    {
        var t = new ControlledTransport(); using var s = new ShellSession(t, "test");
        t.Emit("SECRET"); t.EmitBytes([0xE2]);
        await s.HandoffAsync("owner"); t.Emit("PUBLIC");
        Assert.Equal("PUBLIC", (await s.ReadAsync("owner", 0, 100, 0)).Text);
        Assert.Equal("not_owner", (await Assert.ThrowsAsync<BatonException>(() => s.SendUserAsync("paste"))).Code);
        Assert.Equal("not_owner", (await Assert.ThrowsAsync<BatonException>(() => s.ReadAsync("wrong", 0, 100, 0))).Code);
        Assert.Empty(t.Writes);
    }
    [Fact] public async Task Duplicate_request_has_one_effect_and_conflicting_reuse_fails()
    {
        var t = new ControlledTransport(); using var s = new ShellSession(t,"test"); await s.HandoffAsync("a");
        await Task.WhenAll(s.SendAgentAsync("a", "id", "echo hi"), s.SendAgentAsync("a", "id", "echo hi"));
        Assert.Single(t.Writes); Assert.Equal("echo hi", t.Writes[0]);
        Assert.Equal("request_id_conflict", (await Assert.ThrowsAsync<BatonException>(() => s.SendAgentAsync("a", "id", "changed"))).Code);
        Assert.Equal("not_owner", (await Assert.ThrowsAsync<BatonException>(() => s.SendAgentAsync("b", "id2", "attack"))).Code);
    }
    [Fact] public async Task Wait_does_not_block_input_and_cancel_does_not_send_ctrl_c()
    {
        var t = new ControlledTransport(); using var s = new ShellSession(t,"test"); await s.HandoffAsync("a");
        using var cancel = new CancellationTokenSource();
        var read = s.ReadAsync("a",0,100,10000,cancel.Token);
        await s.SendAgentAsync("a","one","hello").WaitAsync(TimeSpan.FromSeconds(1));
        cancel.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => read);
        Assert.Equal(["hello"], t.Writes);
    }
    [Fact] public async Task Close_rejects_delayed_input_and_discards_output()
    {
        var t = new ControlledTransport(); using var s = new ShellSession(t,"test"); await s.HandoffAsync("a");
        var read = s.ReadAsync("a",0,100,10000); s.Close();
        Assert.Equal("session_closed", (await Assert.ThrowsAsync<BatonException>(() => read)).Code);
        Assert.Equal("session_closed", (await Assert.ThrowsAsync<BatonException>(() => s.SendAgentAsync("a","late","bad"))).Code);
        Assert.Equal("", s.ScreenText); Assert.True(t.Disposed);
    }
    [Fact] public async Task Uncertain_write_is_never_repeated()
    {
        var t = new ControlledTransport { ThrowWrite = true }; using var s = new ShellSession(t,"test"); await s.HandoffAsync("a");
        Assert.Equal("uncertain", (await s.SendAgentAsync("a","one","secret")).Status);
        Assert.Equal("uncertain", (await s.SendAgentAsync("a","one","secret")).Status);
        Assert.Empty(t.Writes);
    }
    [Fact] public async Task Queue_is_bounded_and_handoff_invalidates_pending_user_input()
    {
        var t = new ControlledTransport { BlockWrite = new(false) }; using var s = new ShellSession(t,"test");
        var first = s.SendUserAsync("first"); await t.WriteEntered.Task;
        var pending = Enumerable.Range(0, 32).Select(i => s.SendUserAsync("queued" + i)).ToArray();
        Assert.Equal("input_queue_full", (await Assert.ThrowsAsync<BatonException>(() => s.SendUserAsync("overflow"))).Code);
        var handoff = s.HandoffAsync("a"); t.BlockWrite.Set(); await first; await handoff;
        foreach (var task in pending) await Assert.ThrowsAsync<BatonException>(() => task);
        Assert.Equal(["first"], t.Writes);
    }
}

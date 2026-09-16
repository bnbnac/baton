using Baton.Core;
using Xunit;
namespace Baton.Tests;
public class SessionRegistryTests
{
    [Fact] public async Task Two_adapters_are_isolated_and_disconnect_closes_only_owned_session()
    {
        using var registry = new SessionRegistry();
        var a = registry.RegisterAdapter("Claude Desktop"); var b = registry.RegisterAdapter("Codex");
        var ta = new ControlledTransport(); var tb = new ControlledTransport();
        var sa = new ShellSession(ta,"a"); var sb = new ShellSession(tb,"b");
        registry.Add(sa); registry.Add(sb);
        await registry.HandoffAsync(sa.Id,a); await registry.HandoffAsync(sb.Id,b);
        ta.Emit("ONE"); tb.Emit("TWO");
        Assert.Equal("ONE", (await registry.Assigned(a,sa.Id).ReadAsync(a,0,100,0)).Text);
        Assert.Throws<BatonException>(() => registry.Assigned(a,sb.Id));
        registry.DisconnectAdapter(a);
        Assert.True(ta.Disposed); Assert.False(tb.Disposed);
        Assert.Equal("TWO", (await registry.Assigned(b,sb.Id).ReadAsync(b,0,100,0)).Text);
    }
    [Fact] public async Task One_adapter_cannot_acquire_two_live_shells()
    {
        using var r = new SessionRegistry(); var a = r.RegisterAdapter("same label");
        var s1 = new ShellSession(new ControlledTransport(),"a"); var s2 = new ShellSession(new ControlledTransport(),"b");
        r.Add(s1); r.Add(s2); await r.HandoffAsync(s1.Id,a);
        await Assert.ThrowsAsync<BatonException>(() => r.HandoffAsync(s2.Id,a));
        Assert.Equal(SessionState.UserOwned,s2.State);
    }
}

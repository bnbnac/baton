namespace Baton.Core;
public record AdapterInfo(string Id, string Label, string? SessionId);
public record SessionInfo(string? SessionId, string State, string? Owner, int Columns = 120, int Rows = 32);
public sealed class SessionRegistry : IDisposable
{
    private readonly object gate = new();
    private readonly Dictionary<string, AdapterInfo> adapters = [];
    private readonly Dictionary<string, ShellSession> sessions = [];
    private bool disposed;
    public string RegisterAdapter(string label)
    {
        lock(gate)
        {
            if (disposed) throw new BatonException("app_closed");
            if (adapters.Count >= 32) throw new BatonException("adapter_limit");
            if (string.IsNullOrWhiteSpace(label) || label.Length > 64 || label.Any(char.IsControl)) throw new BatonException("invalid_label");
            var id = Guid.NewGuid().ToString("N"); adapters.Add(id, new(id,label,null)); return id;
        }
    }
    public void DisconnectAdapter(string owner)
    {
        ShellSession? session = null;
        lock(gate)
        {
            if (adapters.Remove(owner, out var a) && a.SessionId is not null) sessions.TryGetValue(a.SessionId, out session);
        }
        session?.Close();
    }
    public IReadOnlyList<AdapterInfo> Adapters { get { lock(gate) return adapters.Values.ToArray(); } }
    public IReadOnlyList<ShellSession> Sessions { get { lock(gate) return sessions.Values.ToArray(); } }
    public void Add(ShellSession session)
    {
        lock(gate)
        {
            if (disposed) { session.Close(); throw new BatonException("app_closed"); }
            // Keep only live sessions plus the latest closed cards; all closed buffers already erased.
            foreach (var id in sessions.Where(p => p.Value.State == SessionState.Closed).Select(p => p.Key).ToArray()) sessions.Remove(id);
            if (sessions.Count >= 16) { session.Close(); throw new BatonException("session_limit"); }
            sessions.Add(session.Id, session);
        }
    }
    public async Task HandoffAsync(string sessionId, string owner)
    {
        ShellSession session;
        lock(gate)
        {
            if (!adapters.TryGetValue(owner, out var a)) throw new BatonException("adapter_disconnected");
            if (!sessions.TryGetValue(sessionId, out session!)) throw new BatonException("session_closed");
            if (a.SessionId is not null && sessions.TryGetValue(a.SessionId,out var prior) && prior.State != SessionState.Closed)
                throw new BatonException("adapter_already_assigned");
            if (session.State != SessionState.UserOwned || adapters.Values.Any(x => x.SessionId == sessionId)) throw new BatonException("already_handed_off");
            adapters[owner] = a with { SessionId = sessionId }; // Reserve before crossing async boundary.
        }
        try
        {
            await session.HandoffAsync(owner).ConfigureAwait(false);
            lock(gate) if (!adapters.ContainsKey(owner)) { session.Close(); throw new BatonException("adapter_disconnected"); }
        }
        catch { session.Close(); throw; }
    }
    public SessionInfo Status(string owner)
    {
        lock(gate)
        {
            if (!adapters.TryGetValue(owner, out var a)) throw new BatonException("adapter_disconnected");
            if (a.SessionId is null) return new(null,"unassigned",owner);
            if (!sessions.TryGetValue(a.SessionId, out var s)) return new(a.SessionId,"closed",owner);
            return new(s.Id,s.State.ToString().ToLowerInvariant(),owner);
        }
    }
    public ShellSession Assigned(string owner, string sessionId)
    {
        lock(gate)
        {
            if (!adapters.TryGetValue(owner,out var a) || a.SessionId != sessionId) throw new BatonException("not_owner");
            if (!sessions.TryGetValue(sessionId,out var s) || s.State == SessionState.Closed) throw new BatonException("session_closed");
            if (s.Owner != owner || s.State != SessionState.AgentOwned) throw new BatonException("not_owner");
            return s;
        }
    }
    public void CloseSession(string sessionId)
    {
        ShellSession? s;
        lock(gate) sessions.TryGetValue(sessionId,out s);
        s?.Close();
    }
    public void Dispose()
    {
        ShellSession[] active;
        lock(gate) { if (disposed) return; disposed = true; active = sessions.Values.ToArray(); adapters.Clear(); sessions.Clear(); }
        foreach (var session in active) session.Close();
    }
}

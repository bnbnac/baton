namespace Baton.Core;

// Only application-owned fixed codes may cross the UI/IPC boundary. Never propagate raw SSH exceptions.
public sealed class BatonException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

namespace Baton.Core;

public record OutputPage(string Text, long NextCursor, long OldestCursor, long EndCursor, bool HasMore, string? Error = null);
public sealed class OutputBuffer(int capacity = 1_048_576)
{
    private readonly char[] ring = new char[capacity >= 2 ? capacity : throw new ArgumentOutOfRangeException(nameof(capacity))];
    private long oldest;
    public long End { get; private set; }
    public void Append(string text)
    {
        long next = checked(End + text.Length);
        int start = Math.Max(0, text.Length - ring.Length);
        for (int i = start; i < text.Length; i++) ring[(End + i) % ring.Length] = text[i];
        End = next;
        oldest = Math.Max(oldest, End - ring.Length);
        if (oldest < End && char.IsLowSurrogate(ring[oldest % ring.Length])) oldest++;
    }
    public OutputPage Read(long cursor, int limit)
    {
        if (limit is < 2 or > 32768) throw new BatonException("invalid_limit");
        if (cursor < oldest) return new("", oldest, oldest, End, oldest < End, "cursor_expired");
        if (cursor > End || cursor < 0 || (cursor < End && char.IsLowSurrogate(ring[cursor % ring.Length])))
            return new("", cursor, oldest, End, false, "invalid_cursor");
        int length = (int)Math.Min(limit, End - cursor);
        if (length > 0 && char.IsHighSurrogate(ring[(cursor + length - 1) % ring.Length])) length--;
        var chars = new char[length];
        for (int i = 0; i < length; i++) chars[i] = ring[(cursor + i) % ring.Length];
        return new(new string(chars), cursor + length, oldest, End, cursor + length < End);
    }
    public void Clear() { Array.Clear(ring); oldest = End = 0; }
}

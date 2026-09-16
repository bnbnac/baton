using Baton.Core;
using Xunit;
namespace Baton.Tests;
public class OutputBufferTests
{
    [Fact] public void Reads_are_non_consuming_and_report_more()
    {
        var b = new OutputBuffer(16); b.Append("abcdefgh");
        Assert.Equal(new OutputPage("abc", 3, 0, 8, true), b.Read(0, 3));
        Assert.Equal("abc", b.Read(0, 3).Text);
        Assert.Equal("defgh", b.Read(3, 16).Text);
    }
    [Fact] public void Overrun_reports_resumable_cursor_and_bounds_even_a_large_chunk()
    {
        var b = new OutputBuffer(8); b.Append("0123456789ABCDEFGHIJ");
        var expired = b.Read(0, 8);
        Assert.Equal("cursor_expired", expired.Error);
        Assert.Equal(12, expired.OldestCursor);
        Assert.Equal("CDEFGHIJ", b.Read(expired.OldestCursor, 8).Text);
        Assert.Equal("invalid_cursor", b.Read(21, 8).Error);
    }
    [Fact] public void Clear_erases_stream_and_partial_reads_do_not_split_surrogates()
    {
        var b = new OutputBuffer(8); b.Append("a😀z");
        Assert.Equal("a", b.Read(0, 2).Text);
        b.Clear(); Assert.Equal(new OutputPage("", 0, 0, 0, false), b.Read(0, 8));
    }
}

using System.Text;
using Baton.Core;
using Xunit;

namespace Baton.Tests;

public sealed class TerminalScreenTests
{
    [Fact]
    public void Feed_renders_plain_text_as_a_trimmed_visible_snapshot()
    {
        using var screen = new TerminalScreen();

        screen.Feed(Encoding.UTF8.GetBytes("hello\r\nworld"));

        Assert.Equal("hello\nworld", screen.Snapshot());
    }

    [Fact]
    public void Feed_applies_ansi_attributes_and_cursor_movement_without_exposing_escape_bytes()
    {
        using var screen = new TerminalScreen();

        screen.Feed(Encoding.UTF8.GetBytes("abc\x1b[31mde\x1b[0m\x1b[2DXY"));

        Assert.Equal("abcXY", screen.Snapshot());
    }

    [Fact]
    public void Feed_preserves_a_utf8_scalar_split_across_calls()
    {
        using var screen = new TerminalScreen();
        var bytes = Encoding.UTF8.GetBytes("A한B");

        screen.Feed(bytes[..2]);
        screen.Feed(bytes[2..]);

        Assert.Equal("A한B", screen.Snapshot());
    }

    [Fact]
    public void Reset_discards_screen_utf8_and_ansi_parser_state()
    {
        using var screen = new TerminalScreen();
        screen.Feed([.. Encoding.UTF8.GetBytes("secret"), 0xF0, 0x9F]);
        screen.Feed(Encoding.ASCII.GetBytes("\x1b[31"));

        screen.Reset();
        screen.Feed(Encoding.UTF8.GetBytes("clean"));

        Assert.Equal("clean", screen.Snapshot());
    }

    [Fact]
    public void Device_status_query_emits_only_the_parser_protocol_reply()
    {
        using var screen = new TerminalScreen();
        var replies = new List<byte[]>();
        screen.Response += data => replies.Add(data);

        screen.Feed(Encoding.ASCII.GetBytes("visible\x1b[6n"));

        Assert.Equal("visible", screen.Snapshot());
        Assert.Single(replies);
        Assert.Equal("\x1b[1;8R", Encoding.ASCII.GetString(replies[0]));
    }

    [Fact]
    public void Remote_column_mode_cannot_expand_the_visible_snapshot_past_120_columns()
    {
        using var screen = new TerminalScreen();

        screen.Feed(Encoding.ASCII.GetBytes("\x1b[?3h" + new string('X', 125)));

        var lines = screen.Snapshot().Split('\n');
        Assert.All(lines, line => Assert.True(line.Length <= 120));
        Assert.Equal(2, lines.Length);
    }

    [Fact]
    public void Snapshot_includes_at_most_1000_scrollback_rows_plus_32_visible_rows()
    {
        using var screen = new TerminalScreen();
        var text = string.Join("\r\n", Enumerable.Range(0, 1100).Select(i => $"line-{i:D4}"));

        screen.Feed(Encoding.ASCII.GetBytes(text));

        var lines = screen.Snapshot().Split('\n');
        Assert.Equal(1032, lines.Length);
        Assert.Equal("line-0068", lines[0]);
        Assert.Equal("line-1099", lines[^1]);
    }

    [Fact]
    public void Excessive_unterminated_control_sequence_resets_the_parser_and_screen()
    {
        using var screen = new TerminalScreen();
        screen.Feed(Encoding.ASCII.GetBytes("secret\x1b]"));

        screen.Feed(Encoding.ASCII.GetBytes(new string('x', 5000)));
        screen.Feed(Encoding.ASCII.GetBytes("clean"));

        Assert.Equal("clean", screen.Snapshot());
    }

    [Fact]
    public void Cancelled_control_sequence_does_not_count_following_text_as_parser_state()
    {
        using var screen = new TerminalScreen();
        var text = "kept\x1b]unfinished\u0018" + new string('x', 5000);

        screen.Feed(Encoding.ASCII.GetBytes(text));

        Assert.StartsWith("keptxxxx", screen.Snapshot());
    }

    [Fact]
    public void Pathological_csi_numeric_parameter_resets_before_parser_processing()
    {
        using var screen = new TerminalScreen();
        screen.Feed(Encoding.ASCII.GetBytes("secret"));

        screen.Feed(Encoding.ASCII.GetBytes("\x1b[8;99999999999999999999;99999999999999999999t"));
        screen.Feed(Encoding.ASCII.GetBytes("clean"));

        Assert.Equal("clean", screen.Snapshot());
    }

    [Fact]
    public void Dispose_releases_the_snapshot_and_suppresses_future_feed_and_response()
    {
        var screen = new TerminalScreen();
        var replies = 0;
        screen.Response += _ => replies++;
        screen.Feed(Encoding.ASCII.GetBytes("secret"));

        screen.Dispose();
        screen.Feed(Encoding.ASCII.GetBytes("new\x1b[6n"));

        Assert.Equal(string.Empty, screen.Snapshot());
        Assert.Equal(0, replies);
    }
}

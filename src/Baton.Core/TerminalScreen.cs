using System.Text;
using VtNetCore.VirtualTerminal;
using VtNetCore.XTermParser;

namespace Baton.Core;

public sealed class TerminalScreen : IDisposable
{
    private const int Columns = 120;
    private const int Rows = 32;
    private const int MaximumHistoryLines = 1000;
    private const int MaximumControlSequenceBytes = 4096;
    private const int MaximumNumericParameter = 4096;
    private const int ParserChunkBytes = 4096;

    private VirtualTerminalController? controller;
    private DataConsumer? consumer;
    private ControlSequenceState controlState;
    private int controlSequenceBytes;
    private int csiParameterValue;
    private bool disposed;

    public event Action<byte[]>? Response;

    public TerminalScreen()
    {
        ResetCore();
    }

    private void ResetCore()
    {
        if (controller is not null)
            controller.SendData -= OnSendData;

        controller = new VirtualTerminalController
        {
            Debugging = false,
            MaximumHistoryLines = MaximumHistoryLines,
            StoreRawText = false
        };
        controller.ResizeView(Columns, Rows);
        controller.SetUTF8();
        controller.SendData += OnSendData;
        ResetParser();
    }

    private void ResetParser()
    {
        consumer = new DataConsumer(controller) { SequenceDebugging = false };
        controlState = ControlSequenceState.Ground;
        controlSequenceBytes = 0;
        csiParameterValue = 0;
    }

    private void OnSendData(object? sender, SendDataEventArgs args)
    {
        if (!disposed)
            Response?.Invoke(args.Data.ToArray());
    }

    public void Feed(byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);
        if (disposed || data.Length == 0)
            return;

        var segmentStart = 0;
        for (var i = 0; i < data.Length; i++)
        {
            var sequenceProgress = TrackControlSequence(data[i]);
            if (sequenceProgress == SequenceProgress.Rejected || controlSequenceBytes > MaximumControlSequenceBytes)
            {
                ResetCore();
                return;
            }

            var sequenceEnded = sequenceProgress is SequenceProgress.Completed or SequenceProgress.Cancelled;
            var segmentLength = i - segmentStart + 1;
            if (!sequenceEnded && segmentLength < ParserChunkBytes)
                continue;

            PushSegment(data, segmentStart, segmentLength);
            segmentStart = i + 1;
            if (sequenceProgress == SequenceProgress.Cancelled)
                ResetParser();
            if (sequenceEnded)
                controller!.ResizeView(Columns, Rows);
        }

        if (segmentStart < data.Length)
            PushSegment(data, segmentStart, data.Length - segmentStart);
    }

    private void PushSegment(byte[] data, int offset, int count)
    {
        if (offset == 0 && count == data.Length)
        {
            consumer!.Push(data);
            return;
        }

        consumer!.Push(data.AsSpan(offset, count).ToArray());
    }

    private SequenceProgress TrackControlSequence(byte value)
    {
        if (controlState != ControlSequenceState.Ground && value is 0x18 or 0x1A)
        {
            controlSequenceBytes++;
            return CancelControlSequence();
        }

        switch (controlState)
        {
            case ControlSequenceState.Ground:
                if (value == 0x1B)
                {
                    controlState = ControlSequenceState.Escape;
                    controlSequenceBytes = 1;
                }
                return SequenceProgress.None;

            case ControlSequenceState.Escape:
                controlSequenceBytes++;
                if (value == (byte)'[')
                {
                    controlState = ControlSequenceState.Csi;
                    csiParameterValue = 0;
                }
                else if (value is (byte)']' or (byte)'P' or (byte)'X' or (byte)'^' or (byte)'_')
                    controlState = ControlSequenceState.String;
                else if (value is >= 0x20 and <= 0x2F)
                    controlState = ControlSequenceState.EscapeIntermediate;
                else if (value == 0x1B)
                    controlSequenceBytes = 1;
                else
                    return CompleteControlSequence();
                return SequenceProgress.None;

            case ControlSequenceState.EscapeIntermediate:
                controlSequenceBytes++;
                if (value is >= 0x30 and <= 0x7E)
                    return CompleteControlSequence();
                if (value == 0x1B)
                {
                    controlState = ControlSequenceState.Escape;
                    controlSequenceBytes = 1;
                }
                return SequenceProgress.None;

            case ControlSequenceState.Csi:
                controlSequenceBytes++;
                if (value is >= (byte)'0' and <= (byte)'9')
                {
                    var digit = value - (byte)'0';
                    if (csiParameterValue > (MaximumNumericParameter - digit) / 10)
                        return SequenceProgress.Rejected;
                    csiParameterValue = (csiParameterValue * 10) + digit;
                    return SequenceProgress.None;
                }
                if (value is >= 0x40 and <= 0x7E)
                    return CompleteControlSequence();
                if (value == 0x1B)
                {
                    controlState = ControlSequenceState.Escape;
                    controlSequenceBytes = 1;
                }
                csiParameterValue = 0;
                return SequenceProgress.None;

            case ControlSequenceState.String:
                controlSequenceBytes++;
                if (value == 0x07)
                    return CompleteControlSequence();
                if (value == 0x1B)
                    controlState = ControlSequenceState.StringEscape;
                return SequenceProgress.None;

            case ControlSequenceState.StringEscape:
                controlSequenceBytes++;
                if (value == (byte)'\\')
                    return CompleteControlSequence();
                if (value != 0x1B)
                    controlState = ControlSequenceState.String;
                return SequenceProgress.None;

            default:
                throw new InvalidOperationException();
        }
    }

    private SequenceProgress CompleteControlSequence()
    {
        controlState = ControlSequenceState.Ground;
        controlSequenceBytes = 0;
        csiParameterValue = 0;
        return SequenceProgress.Completed;
    }

    private SequenceProgress CancelControlSequence()
    {
        controlState = ControlSequenceState.Ground;
        controlSequenceBytes = 0;
        csiParameterValue = 0;
        return SequenceProgress.Cancelled;
    }

    public void Reset()
    {
        if (!disposed)
            ResetCore();
    }

    public string Snapshot()
    {
        if (disposed)
            return string.Empty;

        var lineCount = Math.Min(MaximumHistoryLines + Rows, controller!.ViewPort.TopRow + Rows);
        var page = controller.GetPageSpans(0, lineCount, Columns);
        var lines = new string[page.Count];
        for (var i = 0; i < page.Count; i++)
        {
            var line = new StringBuilder(Columns);
            foreach (var span in page[i].Spans)
                line.Append(span.Text);
            lines[i] = line.ToString().TrimEnd(' ');
        }

        var last = lines.Length - 1;
        while (last >= 0 && lines[last].Length == 0)
            last--;

        return last < 0 ? string.Empty : string.Join('\n', lines, 0, last + 1);
    }

    public void Dispose()
    {
        if (disposed)
            return;

        disposed = true;
        controller!.SendData -= OnSendData;
        controller = null;
        consumer = null;
        Response = null;
    }

    private enum ControlSequenceState
    {
        Ground,
        Escape,
        EscapeIntermediate,
        Csi,
        String,
        StringEscape
    }

    private enum SequenceProgress
    {
        None,
        Completed,
        Cancelled,
        Rejected
    }
}

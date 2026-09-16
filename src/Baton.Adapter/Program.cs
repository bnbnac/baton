using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Baton.Adapter;
using Baton.Core;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

return await AdapterProgram.RunAsync(args);

internal static class AdapterProgram
{
    public static async Task<int> RunAsync(string[] args)
    {
        try
        {
            var arguments = ParseArguments(args);
            var endpoint = LocalEndpoint.Load(arguments.EndpointDirectory);
            await using var pipe = await PipeClient.ConnectAsync(endpoint, arguments.Label).ConfigureAwait(false);
            using var stopped = new CancellationTokenSource();
            pipe.Disconnected += stopped.Cancel;
            if (!pipe.IsConnected) stopped.Cancel();

            var json = new JsonSerializerOptions(JsonSerializerDefaults.Web)
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower,
                TypeInfoResolver = new DefaultJsonTypeInfoResolver()
            };
            var shell = new ShellTools(pipe, json);
            var options = new McpServerOptions
            {
                ServerInfo = new Implementation { Name = "Baton", Version = "0.1.0" },
                ServerInstructions = AgentPolicy.ServerInstructions,
                ToolCollection =
                [
                    McpServerTool.Create(shell.StatusAsync, Tool("status", AgentPolicy.StatusDescription, json, readOnly: true)),
                    McpServerTool.Create(shell.ReadOutputAsync, Tool("read_output", AgentPolicy.ReadOutputDescription, json, readOnly: true)),
                    McpServerTool.Create(shell.SendTextAsync, Tool("send_text", AgentPolicy.SendTextDescription, json, readOnly: false)),
                    McpServerTool.Create(shell.SendKeyAsync, Tool("send_key", AgentPolicy.SendKeyDescription, json, readOnly: false))
                ]
            };

            await using var transport = new StdioServerTransport(options, NullLoggerFactory.Instance);
            await using var server = McpServer.Create(transport, options, NullLoggerFactory.Instance);
            try { await server.RunAsync(stopped.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) when (stopped.IsCancellationRequested) { }
            return 0;
        }
        catch (BatonException exception)
        {
            await Console.Error.WriteLineAsync(exception.Code).ConfigureAwait(false);
            return 1;
        }
        catch (OperationCanceledException)
        {
            return 1;
        }
        catch
        {
            await Console.Error.WriteLineAsync("adapter_error").ConfigureAwait(false);
            return 1;
        }
    }

    private static McpServerToolCreateOptions Tool(string name, string description, JsonSerializerOptions json, bool readOnly) => new()
    {
        Name = name,
        Description = description,
        SerializerOptions = json,
        ReadOnly = readOnly,
        Destructive = !readOnly,
        Idempotent = readOnly,
        OpenWorld = true
    };

    private static Arguments ParseArguments(string[] args)
    {
        var label = "MCP adapter";
        string? endpointDirectory = null;
        for (var index = 0; index < args.Length; index++)
        {
            if (args[index] == "--label" && index + 1 < args.Length) label = args[++index];
            else if (args[index] == "--endpoint-dir" && index + 1 < args.Length) endpointDirectory = args[++index];
            else throw new BatonException("invalid_arguments");
        }
        if (string.IsNullOrWhiteSpace(label) || label.Length > 64 || label.Any(char.IsControl))
            throw new BatonException("invalid_label");
        if (endpointDirectory is not null && !Path.IsPathFullyQualified(endpointDirectory))
            throw new BatonException("invalid_endpoint_directory");
        return new(label, endpointDirectory is null ? null : Path.GetFullPath(endpointDirectory));
    }

    private sealed record Arguments(string Label, string? EndpointDirectory);
}

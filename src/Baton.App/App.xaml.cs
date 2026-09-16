using System.IO;
using System.Windows;
using Baton.Core;

namespace Baton.App;

public partial class App : Application
{
    private LocalEndpoint? endpoint;
    private PipeBroker? broker;
    private SessionRegistry? registry;
    private readonly CancellationTokenSource stopping = new();
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += (_, args) =>
        {
            args.Handled = true;
            MessageBox.Show("Baton 내부 오류로 세션을 종료합니다. 터미널 원문은 기록하지 않았습니다.","Baton");
            Shutdown(1);
        };
        try
        {
            string? directory = null;
            if (e.Args.Length != 0)
            {
                if (e.Args.Length != 2 || e.Args[0] != "--endpoint-dir" || !Path.IsPathFullyQualified(e.Args[1])) throw new BatonException("invalid_arguments");
                directory = e.Args[1];
            }
            endpoint = LocalEndpoint.Create(directory);
            registry = new SessionRegistry();
            broker = new PipeBroker(registry, endpoint.Info);
            _ = RunBrokerAsync();
            MainWindow = new MainWindow(registry);
            MainWindow.Show();
        }
        catch
        {
            MessageBox.Show("Baton을 시작할 수 없습니다. 같은 사용자로 이미 실행 중인지, 로컬 IPC 저장 경로에 접근할 수 있는지 확인하세요.","Baton");
            Shutdown(1);
        }
    }
    private async Task RunBrokerAsync()
    {
        try { await broker!.RunAsync(stopping.Token); }
        catch (OperationCanceledException) { }
        catch { if (!stopping.IsCancellationRequested) await Dispatcher.InvokeAsync(() => { MessageBox.Show("로컬 MCP 연결 서버가 종료되었습니다. 모든 SSH 세션을 종료합니다.","Baton"); Shutdown(1); }); }
    }
    protected override void OnExit(ExitEventArgs e)
    {
        stopping.Cancel();
        registry?.Dispose();
        broker?.Dispose();
        endpoint?.Dispose();
        stopping.Dispose();
        base.OnExit(e);
    }
}

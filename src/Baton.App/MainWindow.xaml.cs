using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using Baton.Core;

namespace Baton.App;

public partial class MainWindow : Window
{
    private sealed record SessionCard(string Id, string Target, string Caption) { public string ShortId => Id[..12]; }
    private sealed record AdapterCard(string Id, string Caption);
    private readonly SessionRegistry registry;
    private readonly DispatcherTimer timer;
    private readonly CancellationTokenSource closing = new();
    private string sessionsSignature = "", adaptersSignature = "";
    private bool refreshing, sending;
    private CancellationTokenSource? connecting;
    private ShellSession? Selected => SessionList.SelectedItem is SessionCard card ? registry.Sessions.FirstOrDefault(s => s.Id == card.Id) : null;
    public MainWindow(SessionRegistry registry)
    {
        this.registry = registry;
        InitializeComponent();
        timer = new DispatcherTimer(TimeSpan.FromMilliseconds(160), DispatcherPriority.Background, (_, _) => Refresh(), Dispatcher);
        Closing += (_, _) => { closing.Cancel(); connecting?.Cancel(); timer.Stop(); registry.Dispose(); UserInput.Clear(); SecretInput.Clear(); Terminal.Clear(); };
        Refresh();
    }
    private void Refresh()
    {
        if (closing.IsCancellationRequested) return;
        refreshing = true;
        try
        {
            var sessions = registry.Sessions;
            var signature = string.Join('|',sessions.Select(s => s.Id + s.State));
            if (signature != sessionsSignature)
            {
                var selected = (SessionList.SelectedItem as SessionCard)?.Id;
                SessionList.ItemsSource = sessions.Select(s => new SessionCard(s.Id,s.Target,Caption(s.State))).ToArray();
                SessionList.SelectedItem = SessionList.Items.Cast<SessionCard>().FirstOrDefault(s => s.Id == selected) ?? SessionList.Items.Cast<SessionCard>().LastOrDefault();
                sessionsSignature = signature;
            }
            var adapters = registry.Adapters.Where(a => a.SessionId is null || registry.Sessions.All(s => s.Id != a.SessionId || s.State == SessionState.Closed)).ToArray();
            signature = string.Join('|',adapters.Select(a => a.Id + a.SessionId));
            if (signature != adaptersSignature)
            {
                var selected = (AdapterList.SelectedItem as AdapterCard)?.Id;
                AdapterList.ItemsSource = adapters.Select(a => new AdapterCard(a.Id,$"{a.Label} · {a.Id[..12]}")).ToArray();
                AdapterList.SelectedItem = AdapterList.Items.Cast<AdapterCard>().FirstOrDefault(a => a.Id == selected) ?? AdapterList.Items.Cast<AdapterCard>().FirstOrDefault();
                adaptersSignature = signature;
            }
            RefreshSelection();
        }
        finally { refreshing = false; }
    }
    private static string Caption(SessionState state) => state switch { SessionState.UserOwned => "사용자 입력 가능", SessionState.Transferring => "전달 중 · 입력 차단", SessionState.AgentOwned => "에이전트 소유 · 관찰 전용", _ => "종료됨" };
    private void RefreshSelection()
    {
        if (!IsInitialized) return;
        var session = Selected;
        bool user = session?.State == SessionState.UserOwned && !sending;
        UserInput.IsEnabled = SecretInput.IsEnabled = SendLine.IsEnabled = ControlKeys.IsEnabled = user;
        HiddenInput.IsEnabled = user;
        Handoff.IsEnabled = user && AdapterList.SelectedItem is not null;
        CloseSsh.IsEnabled = session is not null && session.State != SessionState.Closed;
        EmptyState.Visibility = session is null ? Visibility.Visible : Visibility.Collapsed;
        TargetText.Text = session?.Target ?? "세션을 연결하세요";
        StateText.Text = session is null ? "인증정보는 에이전트에 전달되지 않습니다." : $"{Caption(session.State)} · {session.Id[..12]}" + (session.Owner is null ? "" : $" · 소유 연결 {session.Owner[..12]}");
        InputLabel.Text = session?.State == SessionState.AgentOwned ? "에이전트에 전달됨 · 사용자 입력 차단" : "사용자 입력 · 전달 전 사용";
        if (!user) { UserInput.Clear(); SecretInput.Clear(); }
        var text = session?.ScreenText ?? "";
        if (Terminal.Text != text)
        {
            bool atBottom = Terminal.VerticalOffset >= Terminal.ExtentHeight - Terminal.ViewportHeight - 30;
            Terminal.Text = text;
            if (atBottom) Terminal.ScrollToEnd();
        }
    }
    private async void NewSession_Click(object sender, RoutedEventArgs e)
    {
        if (connecting is not null) { connecting.Cancel(); Notice.Text = "SSH 연결을 취소하는 중입니다…"; return; }
        var dialog = new ConnectionDialog { Owner = this };
        if (dialog.ShowDialog() != true) return;
        var target = dialog.Target!; var method = dialog.AuthenticationMethod;
        connecting = CancellationTokenSource.CreateLinkedTokenSource(closing.Token);
        var token = connecting.Token;
        NewSession.Content = "연결 취소";
        Notice.Text = $"{target.Host} 연결·인증 중…";
        try
        {
            var auth = new WindowAuthentication(this, token);
            // All SSH callbacks may prompt the UI. Never block its dispatcher on Connect/CreateShell.
            var transport = await Task.Run(() => SshTransport.ConnectAsync(target, auth, method, token));
            if (token.IsCancellationRequested) { transport.Dispose(); return; }
            registry.Add(new ShellSession(transport,$"{target.Username}@{target.Host}:{target.Port}"));
            Refresh(); SessionList.SelectedIndex = SessionList.Items.Count - 1;
            Notice.Text = "연결되었습니다. 일반 사용자 셸을 준비한 뒤 대상 MCP 연결에 전달하세요.";
        }
        catch (OperationCanceledException) { Notice.Text = "연결을 취소했습니다."; }
        catch (BatonException ex) { Notice.Text = $"연결 실패: {ex.Code} · 서버·호스트키·인증 방법을 확인하세요."; }
        catch { Notice.Text = "연결 실패: ssh_connection_failed"; }
        finally { connecting.Dispose(); connecting = null; NewSession.Content = "＋ 새 SSH 세션"; }
    }
    private async void Handoff_Click(object sender, RoutedEventArgs e)
    {
        var session = Selected; var adapter = AdapterList.SelectedItem as AdapterCard;
        if (session is null || adapter is null) return;
        UserInput.Clear(); SecretInput.Clear(); Keyboard.ClearFocus();
        try
        {
            var task = registry.HandoffAsync(session.Id,adapter.Id);
            RefreshSelection();
            await task;
            Notice.Text = "전달 완료. 사용자 입력은 차단되었습니다. 에이전트는 공개 커서 0부터 조회할 수 있습니다.";
        }
        catch (BatonException ex) { Notice.Text = $"전달 실패: {ex.Code}"; }
        catch { Notice.Text = "전달 실패: handoff_failed"; }
        Refresh();
    }
    private void CloseSsh_Click(object sender, RoutedEventArgs e)
    {
        if (Selected is { } session) registry.CloseSession(session.Id);
        Notice.Text = "SSH를 종료하고 메모리 버퍼를 폐기했습니다. 이미 실행한 원격 작업의 취소·복원은 보장하지 않습니다.";
        Refresh();
    }
    private async Task SendAsync(string value)
    {
        var session = Selected;
        if (session?.State != SessionState.UserOwned || sending) return;
        sending = true; RefreshSelection();
        try { var receipt = await session.SendUserAsync(value); Notice.Text = receipt.Status == "delivered" ? "입력을 SSH 채널에 전달했습니다. 원격 명령 성공을 뜻하지 않습니다." : "전송 여부가 불확실합니다. 무조건 재전송하지 마세요."; }
        catch (BatonException ex) { Notice.Text = $"입력 거부: {ex.Code}"; }
        catch { Notice.Text = "입력 실패: input_failed"; }
        finally { sending = false; RefreshSelection(); }
    }
    private async void SendLine_Click(object sender, RoutedEventArgs e)
    {
        var value = HiddenInput.IsChecked == true ? SecretInput.Password : UserInput.Text;
        UserInput.Clear(); SecretInput.Clear();
        await SendAsync(value + "\r");
    }
    private void UserInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true; SendLine_Click(sender,e);
    }
    private async void ControlKey_Click(object sender, RoutedEventArgs e)
    {
        var key = (sender as Button)?.Tag as string;
        await SendAsync(key switch { "interrupt" => "\u0003", "tab" => "\t", "eof" => "\u0004", _ => "\r" });
    }
    private void HiddenInput_Changed(object sender, RoutedEventArgs e)
    {
        if (UserInput is null || SecretInput is null) return;
        UserInput.Clear(); SecretInput.Clear();
        UserInput.Visibility = HiddenInput.IsChecked == true ? Visibility.Collapsed : Visibility.Visible;
        SecretInput.Visibility = HiddenInput.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
    }
    private void SessionList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (refreshing || !IsInitialized) return;
        UserInput.Clear(); SecretInput.Clear(); Terminal.Clear(); RefreshSelection();
    }
    private void AdapterList_SelectionChanged(object sender, SelectionChangedEventArgs e) { if (!refreshing && IsInitialized) RefreshSelection(); }
}

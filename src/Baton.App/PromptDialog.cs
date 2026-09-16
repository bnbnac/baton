using System.Windows;
using System.Windows.Controls;
using Baton.Core;

namespace Baton.App;

public sealed class PromptDialog : Window
{
    private readonly List<Control> fields = [];
    public string[]? Answers { get; private set; }
    public PromptDialog(string title, string message, IReadOnlyList<AuthPrompt> prompts, string accept = "확인")
    {
        Style = (Style)Application.Current.FindResource(typeof(Window));
        Title = title; Width = 590; MaxHeight = 760; SizeToContent = SizeToContent.Height; WindowStartupLocation = WindowStartupLocation.CenterOwner; ResizeMode = ResizeMode.NoResize;
        var panel = new StackPanel { Margin = new(28) }; Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        panel.Children.Add(new TextBlock { Text = title, FontSize = 23, FontWeight = FontWeights.SemiBold, Margin = new(0,0,0,14) });
        panel.Children.Add(new TextBlock { Text = Display(message), Margin = new(0,0,0,12), FontFamily = new("Consolas, Segoe UI") });
        foreach (var prompt in prompts)
        {
            panel.Children.Add(new TextBlock { Text = Display(prompt.Text), Margin = new(0,8,0,6) });
            Control field = prompt.Echo ? new TextBox { MaxLength = 4096 } : new PasswordBox { MaxLength = 4096 };
            fields.Add(field); panel.Children.Add(field);
        }
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new(0,20,0,0) };
        var cancel = new Button { Content = "취소", IsCancel = true };
        // Host-key confirmation is intentionally not the default keyboard action.
        var submit = new Button { Content = accept, IsDefault = prompts.Count != 0 };
        submit.Click += (_,_) => { Answers = fields.Select(f => f is PasswordBox p ? p.Password : ((TextBox)f).Text).ToArray(); DialogResult = true; };
        buttons.Children.Add(cancel); buttons.Children.Add(submit); panel.Children.Add(buttons);
        Closed += (_,_) => { foreach(var f in fields) { if(f is PasswordBox p) p.Clear(); else ((TextBox)f).Clear(); } };
        Loaded += (_,_) => { if (fields.Count > 0) fields[0].Focus(); else cancel.Focus(); };
    }
    private static string Display(string value) => new(value.Take(8192).Where(c => !char.IsControl(c) || c is '\n' or '\r' or '\t').ToArray());
}

public sealed class WindowAuthentication(Window owner, CancellationToken token) : IUserAuthentication
{
    private T OnUi<T>(Func<T> action)
    {
        token.ThrowIfCancellationRequested();
        return owner.Dispatcher.Invoke(() => { token.ThrowIfCancellationRequested(); return action(); });
    }
    private string[]? Prompt(string title,string message,IReadOnlyList<AuthPrompt> prompts,string accept = "확인")
    {
        if (prompts.Count > 16) throw new BatonException("too_many_authentication_prompts");
        var dialog = new PromptDialog(title,message,prompts,accept) { Owner = owner };
        using var registration = token.Register(() => owner.Dispatcher.BeginInvoke(() => dialog.Close()));
        return dialog.ShowDialog() == true ? dialog.Answers : null;
    }
    public bool ConfirmHostKey(string host,int port,string algorithm,string sha256) => OnUi(() =>
        Prompt("SSH 호스트키 확인",$"대상: {host}:{port}\n알고리즘: {algorithm}\n지문: {sha256}\n\n신뢰할 수 있는 경로로 받은 서버 지문과 비교하세요.\n이 접속에만 적용되며 다음 접속 때 다시 확인합니다.",[],"지문 확인 · 연결 허용") is not null);
    public string? GetPassword(string purpose) => OnUi(() => Prompt("SSH 인증",purpose,[new("비밀번호 또는 개인키 암호",false)])?.FirstOrDefault());
    public string[]? AnswerChallenges(string name,string instruction,IReadOnlyList<AuthPrompt> prompts) => OnUi(() => Prompt("SSH 추가 인증",$"계정: {name}\n{instruction}",prompts));
}

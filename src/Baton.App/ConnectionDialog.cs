using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using Baton.Core;

namespace Baton.App;

public sealed class ConnectionDialog : Window
{
    private readonly TextBox host = new() { MaxLength = 253 };
    private readonly TextBox port = new() { Text = "22", MaxLength = 5 };
    private readonly TextBox username = new() { MaxLength = 128 };
    private readonly TextBox keyPath = new() { MaxLength = 2048 };
    private readonly ComboBox method = new() { ItemsSource = new[] { "password", "interactive", "key", "password+interactive", "key+interactive" }, SelectedIndex = 0 };
    private readonly TextBlock error = new() { Foreground = System.Windows.Media.Brushes.Salmon, Margin = new(0,12,0,0) };
    public SshTarget? Target { get; private set; }
    public string AuthenticationMethod => (string)method.SelectedItem;
    public ConnectionDialog()
    {
        Style = (Style)Application.Current.FindResource(typeof(Window));
        Title = "새 SSH 세션"; Width = 520; SizeToContent = SizeToContent.Height; ResizeMode = ResizeMode.NoResize; WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var panel = new StackPanel { Margin = new(28) }; Content = panel;
        panel.Children.Add(new TextBlock { Text = "Linux 서버 연결", FontSize = 24, FontWeight = FontWeights.SemiBold, Margin = new(0,0,0,8) });
        panel.Children.Add(new TextBlock { Text = "일반 사용자 계정으로 연결하세요. 호스트키와 인증은 다음 단계에서 직접 확인합니다.", Foreground = System.Windows.Media.Brushes.LightSlateGray, Margin = new(0,0,0,10) });
        AddField(panel,"호스트",host); AddField(panel,"포트",port); AddField(panel,"사용자 이름",username); AddField(panel,"인증 방법",method);
        AddField(panel,"개인키 파일 (key 선택 시)",keyPath);
        var browse = new Button { Content = "개인키 파일 선택", HorizontalAlignment = HorizontalAlignment.Left, Margin = new(0,8,0,0) };
        browse.Click += (_,_) => { var picker = new OpenFileDialog { Title = "SSH 개인키", CheckFileExists = true }; if (picker.ShowDialog(this) == true) keyPath.Text = picker.FileName; };
        panel.Children.Add(browse);
        panel.Children.Add(new TextBlock { Text = "OpenSSH config · ssh-agent · ProxyJump는 지원하지 않습니다. 입력한 접속 설정과 인증정보는 저장하지 않습니다.", Foreground = System.Windows.Media.Brushes.LightSlateGray, FontSize = 12, Margin = new(0,12,0,0) });
        panel.Children.Add(error);
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new(0,20,0,0) };
        var cancel = new Button { Content = "취소", IsCancel = true }; var connect = new Button { Content = "연결", IsDefault = true };
        buttons.Children.Add(cancel); buttons.Children.Add(connect); panel.Children.Add(buttons);
        connect.Click += (_,_) =>
        {
            if (string.IsNullOrWhiteSpace(host.Text) || string.IsNullOrWhiteSpace(username.Text) || !int.TryParse(port.Text,out var p) || p is < 1 or > 65535)
            { error.Text = "호스트, 사용자 이름과 올바른 포트가 필요합니다."; return; }
            if (AuthenticationMethod.StartsWith("key") && !System.IO.Path.IsPathFullyQualified(keyPath.Text)) { error.Text = "개인키 파일을 선택하세요."; return; }
            Target = new(host.Text.Trim(),p,username.Text.Trim(),AuthenticationMethod.StartsWith("key") ? keyPath.Text : null);
            DialogResult = true;
        };
        Loaded += (_,_) => host.Focus();
    }
    private static void AddField(Panel panel,string label,Control field)
    {
        panel.Children.Add(new TextBlock { Text = label, Margin = new(0,10,0,5) }); panel.Children.Add(field);
    }
}

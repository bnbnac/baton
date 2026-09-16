using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;

namespace Baton.Core;

public sealed record EndpointInfo(string PipeName, string Secret);

public sealed class LocalEndpoint : IDisposable
{
    private const string EndpointFileName = "endpoint.bin";
    private const string LockFileName = "app.lock";
    private readonly string endpointPath;
    private FileStream? processLock;
    public EndpointInfo Info { get; }

    private LocalEndpoint(string endpointPath, FileStream processLock, EndpointInfo info)
    {
        this.endpointPath = endpointPath;
        this.processLock = processLock;
        Info = info;
    }

    public static LocalEndpoint Create(string? directory = null)
    {
        var path = ResolveDirectory(directory);
        FileStream? appLock = null;
        try
        {
            SecureDirectory(path);
            try
            {
                appLock = new FileStream(Path.Combine(path, LockFileName), FileMode.OpenOrCreate,
                    FileAccess.ReadWrite, FileShare.None, 1, FileOptions.WriteThrough);
            }
            catch (IOException)
            {
                throw new BatonException("app_already_running");
            }

            var secretBytes = RandomNumberGenerator.GetBytes(32);
            try
            {
                var info = new EndpointInfo("baton-" + Guid.NewGuid().ToString("N"), Convert.ToBase64String(secretBytes));
                WriteProtected(Path.Combine(path, EndpointFileName), info);
                return new LocalEndpoint(Path.Combine(path, EndpointFileName), appLock, info);
            }
            finally
            {
                Array.Clear(secretBytes);
            }
        }
        catch (BatonException)
        {
            appLock?.Dispose();
            throw;
        }
        catch
        {
            appLock?.Dispose();
            throw new BatonException("endpoint_unavailable");
        }
    }

    public static EndpointInfo Load(string? directory = null)
    {
        try
        {
            var protectedBytes = File.ReadAllBytes(Path.Combine(ResolveDirectory(directory), EndpointFileName));
            byte[] clearBytes;
            try { clearBytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser); }
            finally { Array.Clear(protectedBytes); }
            try
            {
                var info = JsonSerializer.Deserialize<EndpointInfo>(clearBytes, PipeProtocol.JsonOptions);
                Validate(info);
                return info!;
            }
            finally
            {
                Array.Clear(clearBytes);
            }
        }
        catch (BatonException) { throw; }
        catch { throw new BatonException("endpoint_unavailable"); }
    }

    private static string ResolveDirectory(string? directory) => Path.GetFullPath(directory ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Baton"));

    private static void SecureDirectory(string path)
    {
        Directory.CreateDirectory(path);
        var identity = WindowsIdentity.GetCurrent().User ?? throw new BatonException("endpoint_unavailable");
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(identity, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(path).SetAccessControl(security);
    }

    private static void WriteProtected(string path, EndpointInfo info)
    {
        var clearBytes = JsonSerializer.SerializeToUtf8Bytes(info, PipeProtocol.JsonOptions);
        byte[] protectedBytes;
        try { protectedBytes = ProtectedData.Protect(clearBytes, null, DataProtectionScope.CurrentUser); }
        finally { Array.Clear(clearBytes); }
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllBytes(temporary, protectedBytes);
            File.Move(temporary, path, true);
        }
        finally
        {
            Array.Clear(protectedBytes);
            try { File.Delete(temporary); } catch { }
        }
    }

    private static void Validate(EndpointInfo? info)
    {
        if (info is null || string.IsNullOrWhiteSpace(info.PipeName) || info.PipeName.Length > 128 ||
            info.PipeName.IndexOfAny(['\\', '/']) >= 0) throw new BatonException("endpoint_unavailable");
        byte[] secret;
        try { secret = Convert.FromBase64String(info.Secret); }
        catch (FormatException) { throw new BatonException("endpoint_unavailable"); }
        try
        {
            if (secret.Length != 32) throw new BatonException("endpoint_unavailable");
        }
        finally { Array.Clear(secret); }
    }

    public void Dispose()
    {
        var appLock = Interlocked.Exchange(ref processLock, null);
        if (appLock is null) return;
        try { File.Delete(endpointPath); } catch { }
        appLock.Dispose();
    }
}

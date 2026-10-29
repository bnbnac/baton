param([Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$Evidence,[Parameter(Mandatory)][int]$OwnerPid,[int]$TimeoutSeconds=180)
$ErrorActionPreference='Stop'
# A private job owns this suspended-before-assignment process and every child.
# Kill-on-close also works when the supervisor itself is forcibly terminated.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public sealed class BatonOwnedJob : IDisposable {
 [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct Io {public ulong a,b,c,d,e,f;}
 [StructLayout(LayoutKind.Sequential)] struct Extended {public Basic basic;public Io io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {public int cb;public string reserved,desktop,title;public int x,y,w,h,cx,cy,fill,flags;public short show,cbReserved;public IntPtr reserved2,input,output,error;}
 [StructLayout(LayoutKind.Sequential)] struct Info {public IntPtr process,thread;public uint pid,tid;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Entry {public uint size,usage,pid;public UIntPtr heap;public uint module,threads,parent;public int priority;public uint flags;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string exe;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateJobObject(IntPtr a,string n);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr j,int c,ref Extended i,uint n);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool QueryInformationJobObject(IntPtr j,int c,IntPtr i,uint n,IntPtr r);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateJobObject(IntPtr j,uint c);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcess(string a,string cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup s,out Info i);
 [DllImport("kernel32.dll")]static extern uint ResumeThread(IntPtr t);
 [DllImport("kernel32.dll")]static extern bool TerminateProcess(IntPtr p,uint c);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr p);
 [DllImport("kernel32.dll")]static extern uint WaitForSingleObject(IntPtr p,uint ms);
 [DllImport("kernel32.dll")]static extern bool GetExitCodeProcess(IntPtr p,out uint code);
 [DllImport("kernel32.dll")]static extern IntPtr GetStdHandle(int n);
 [DllImport("kernel32.dll")]static extern IntPtr CreateToolhelp32Snapshot(uint f,uint p);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool Process32First(IntPtr s,ref Entry e);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool Process32Next(IntPtr s,ref Entry e);
 [DllImport("kernel32.dll")]static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool QueryFullProcessImageName(IntPtr p,uint flags,StringBuilder path,ref uint size);
 [DllImport("kernel32.dll")]static extern bool GetProcessTimes(IntPtr p,out long created,out long exited,out long kernel,out long user);
 [DllImport("ntdll.dll")]static extern int NtQueryInformationProcess(IntPtr p,int c,IntPtr b,int n,out int size);
 IntPtr job,rootHandle,threadHandle;public int RootPid {get;private set;}
 public bool RootExited {get{return rootHandle!=IntPtr.Zero&&WaitForSingleObject(rootHandle,0)==0;}}
 public uint ExitCode {get{uint code;if(!GetExitCodeProcess(rootHandle,out code))throw Fail("exit_code");return code;}}
 static Exception Fail(string s){return new Exception(s+":"+Marshal.GetLastWin32Error());}
 public BatonOwnedJob(string exe){
   job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw Fail("create_job");
   var limits=new Extended();limits.basic.flags=0x2000;
   if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf<Extended>())){Dispose();throw Fail("job_limits");}
   var start=new Startup{cb=Marshal.SizeOf<Startup>(),flags=0x101,show=0,input=GetStdHandle(-10),output=GetStdHandle(-11),error=GetStdHandle(-12)};Info process;
   if(!CreateProcess(exe,"\""+exe+"\"",IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,System.IO.Path.GetDirectoryName(exe),ref start,out process)){Dispose();throw Fail("create_process");}
   rootHandle=process.process;threadHandle=process.thread;
   if(!AssignProcessToJobObject(job,process.process)){TerminateProcess(process.process,1);Dispose();throw Fail("assign_job");}RootPid=(int)process.pid;
 }
 public void Start(){if(ResumeThread(threadHandle)==uint.MaxValue)throw Fail("resume");CloseHandle(threadHandle);threadHandle=IntPtr.Zero;}
 public int[] Pids(){IntPtr b=Marshal.AllocHGlobal(8192);try{if(!QueryInformationJobObject(job,3,b,8192,IntPtr.Zero))throw Fail("query_job");int n=Marshal.ReadInt32(b,4);var ids=new int[n];for(int i=0;i<n;i++)ids[i]=(int)Marshal.ReadIntPtr(b,8+i*IntPtr.Size);return ids;}finally{Marshal.FreeHGlobal(b);}}
 public static Dictionary<int,int> Parents(){var result=new Dictionary<int,int>();IntPtr s=CreateToolhelp32Snapshot(2,0);if(s==new IntPtr(-1))throw Fail("snapshot");try{var e=new Entry{size=(uint)Marshal.SizeOf<Entry>()};if(Process32First(s,ref e))do{result[(int)e.pid]=(int)e.parent;}while(Process32Next(s,ref e));return result;}finally{CloseHandle(s);}}
 public static bool UsesDataDirectory(int pid,string dir){IntPtr p=OpenProcess(0x1000,false,pid);if(p==IntPtr.Zero)return false;IntPtr b=IntPtr.Zero;try{int n;NtQueryInformationProcess(p,60,IntPtr.Zero,0,out n);if(n<16||n>1048576)return false;b=Marshal.AllocHGlobal(n);if(NtQueryInformationProcess(p,60,b,n,out n)!=0)return false;int length=(ushort)Marshal.ReadInt16(b);IntPtr text=Marshal.ReadIntPtr(b,IntPtr.Size);return (Marshal.PtrToStringUni(text,length/2)??"").IndexOf(dir,StringComparison.OrdinalIgnoreCase)>=0;}finally{if(b!=IntPtr.Zero)Marshal.FreeHGlobal(b);CloseHandle(p);}}
 // Query the image without enumerating modules of a sandboxed WebView process.
 // Validate creation time on the same native handle before accepting its path.
 public static string ImagePath(int pid,long ticks){IntPtr p=OpenProcess(0x1000,false,pid);if(p==IntPtr.Zero)return null;try{long created,exited,kernel,user;if(!GetProcessTimes(p,out created,out exited,out kernel,out user)||DateTime.FromFileTimeUtc(created).Ticks!=ticks)return null;uint size=32768;var path=new StringBuilder((int)size);return QueryFullProcessImageName(p,0,path,ref size)?path.ToString():null;}finally{CloseHandle(p);}}
 public void Kill(){if(!TerminateJobObject(job,1))throw Fail("terminate_job");}
 public void Dispose(){if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}if(rootHandle!=IntPtr.Zero){CloseHandle(rootHandle);rootHandle=IntPtr.Zero;}if(threadHandle!=IntPtr.Zero){CloseHandle(threadHandle);threadHandle=IntPtr.Zero;}}
}
'@
$Executable=[IO.Path]::GetFullPath($Executable)
$owner=Get-Process -Id $OwnerPid
$ownerTicks=$owner.StartTime.ToUniversalTime().Ticks
$job=$null
$records=@{}
$receipt=[ordered]@{pid=0;normalExit=$false;forcedCleanup=$false;descendantAudit='unverified';descendants=@();failure=$null;dataDirectory=$env:BATON_WEBVIEW_DATA}
function Save-Evidence {
    $receipt.descendants=@($records.Values | Where-Object {$_.pid -ne $receipt.pid})
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ($Evidence+'.partial')
    Move-Item -LiteralPath ($Evidence+'.partial') -Destination $Evidence -Force
}
try {
    $job=[BatonOwnedJob]::new($Executable)
    $root=Get-Process -Id $job.RootPid
    $receipt.pid=$root.Id;$receipt.startedTicks=$root.StartTime.ToUniversalTime().Ticks.ToString();$receipt.path=$Executable
    $records[$root.Id]=@{pid=$root.Id;startedTicks=$receipt.startedTicks;path=$Executable;parent=$OwnerPid;exited=$false}
    Save-Evidence
    $job.Start()
    $deadline=[datetime]::UtcNow.AddSeconds($TimeoutSeconds);$rootExit=$null
    while ($true) {
        $ids=$job.Pids();$parents=[BatonOwnedJob]::Parents()
        foreach ($childId in $ids) {
            if (!$records.ContainsKey($childId)) {
                $p=Get-Process -Id $childId -ErrorAction SilentlyContinue
                if ($p) {$ticks=$p.StartTime.ToUniversalTime().Ticks;$records[$childId]=@{pid=$childId;startedTicks=$ticks.ToString();path=[BatonOwnedJob]::ImagePath($childId,$ticks);parent=$parents[$childId];dataDirectoryMatch=[BatonOwnedJob]::UsesDataDirectory($childId,$env:BATON_WEBVIEW_DATA);exited=$false}}
            } elseif (!$records[$childId].path) {
                $records[$childId].path=[BatonOwnedJob]::ImagePath($childId,[long]$records[$childId].startedTicks)
            }
        }
        foreach ($item in $records.Values) {if($item.pid -notin $ids){$item.exited=$true}}
        Save-Evidence
        if ($job.RootExited -and !$rootExit) {$rootExit=[datetime]::UtcNow;$receipt.exitCode=$job.ExitCode;$receipt.normalExit=$job.ExitCode -eq 0}
        if ($rootExit -and $ids.Count -eq 0) {break}
        $currentOwner=Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue
        if (!$currentOwner -or $currentOwner.StartTime.ToUniversalTime().Ticks -ne $ownerTicks -or [datetime]::UtcNow -gt $deadline -or ($rootExit -and [datetime]::UtcNow -gt $rootExit.AddSeconds(5))) {
            $receipt.forcedCleanup=$true;$job.Kill();$limit=[datetime]::UtcNow.AddSeconds(5)
            while ($job.Pids().Count -gt 0 -and [datetime]::UtcNow -lt $limit) {Start-Sleep -Milliseconds 50}
            if ($job.Pids().Count -ne 0) {throw 'owned_job_not_empty'}
            foreach ($item in $records.Values) {$item.exited=$true};break
        }
        Start-Sleep -Milliseconds 50
    }
    if (!@($records.Values|Where-Object {$_.dataDirectoryMatch}).Count) {throw 'webview_data_directory_not_observed'}
    if (@($records.Values|Where-Object {!$_.path -or !$_.startedTicks -or !$_.parent}).Count) {throw 'descendant_identity_incomplete'}
    $receipt.descendantAudit='verified'
}catch{$receipt.failure=$_.Exception.Message}
finally{if($job){$job.Dispose()};Save-Evidence}
if($receipt.failure -or $receipt.forcedCleanup -or !$receipt.normalExit){exit 1}
exit 0

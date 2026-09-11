param([Parameter(Mandatory=$true)][int]$BrowserPid,[Parameter(Mandatory=$true)][string]$ExtensionPath,[int]$TimeoutSeconds=30)
$ErrorActionPreference = 'Stop'
$extension = [IO.Path]::GetFullPath($ExtensionPath).TrimEnd('\')
if (-not (Test-Path -LiteralPath (Join-Path $extension 'manifest.json'))) { throw 'The bundled extension manifest is missing.' }
$expectedBrowser = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $extension) 'browser-engine\gwpc-lab.exe'))
$initialProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$BrowserPid"
if (-not $initialProcess -or -not [string]::Equals($initialProcess.ExecutablePath,$expectedBrowser,[StringComparison]::OrdinalIgnoreCase)) {
  throw 'Folder picker process does not belong to this isolated browser installation.'
}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class GwpcFolderPicker {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder value, int size);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd,uint command);
  public static int ProcessId(IntPtr hwnd) { uint pid; GetWindowThreadProcessId(hwnd,out pid); return (int)pid; }
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wparam, string lparam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wparam, StringBuilder lparam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
  static string ClassName(IntPtr hwnd) { var text=new StringBuilder(128); GetClassName(hwnd,text,text.Capacity); return text.ToString(); }
  public static IntPtr[] FindDialogs(int pid) {
    var matches=new List<IntPtr>();
    EnumWindows((hwnd,param)=>{uint owner;GetWindowThreadProcessId(hwnd,out owner);if(IsWindowVisible(hwnd) && ClassName(hwnd)=="#32770" && (owner==pid || ProcessId(GetWindow(hwnd,4))==pid)) matches.Add(hwnd);return true;},IntPtr.Zero);
    return matches.ToArray();
  }
  public static IntPtr FindControl(IntPtr dialog,int id,string className) {
    var matches=new List<IntPtr>();
    EnumChildWindows(dialog,(hwnd,param)=>{if(GetDlgCtrlID(hwnd)==id && ClassName(hwnd).Equals(className,StringComparison.OrdinalIgnoreCase))matches.Add(hwnd);return true;},IntPtr.Zero);
    if(matches.Count!=1)throw new InvalidOperationException("Expected exactly one folder picker control.");
    return matches[0];
  }
  public static bool OwnedBy(IntPtr hwnd,int pid) {uint owner;GetWindowThreadProcessId(hwnd,out owner);return owner==pid;}
  public static void Select(IntPtr dialog,int pid,string folder) {
    if(!OwnedBy(dialog,pid))throw new InvalidOperationException("Folder picker ownership changed.");
    var edit=FindControl(dialog,1152,"Edit"); var button=FindControl(dialog,1,"Button");
    if(!OwnedBy(edit,pid)||!OwnedBy(button,pid))throw new InvalidOperationException("Folder picker control ownership changed.");
    IntPtr result;
    if(SendMessageTimeout(edit,0x000C,IntPtr.Zero,folder,2,5000,out result)==IntPtr.Zero)throw new InvalidOperationException("Could not fill the folder picker path.");
    var readBack=new StringBuilder(32768);
    if(SendMessageTimeout(edit,0x000D,(IntPtr)readBack.Capacity,readBack,2,5000,out result)==IntPtr.Zero)throw new InvalidOperationException("Could not read the folder picker path.");
    if(!readBack.ToString().Equals(folder,StringComparison.Ordinal))throw new InvalidOperationException("Folder picker path verification failed.");
    if(SendMessageTimeout(button,0x00F5,IntPtr.Zero,IntPtr.Zero,2,5000,out result)==IntPtr.Zero)throw new InvalidOperationException("Could not confirm the extension folder.");
  }
}
'@
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$dialog = [IntPtr]::Zero
do {
  $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$BrowserPid"
  if (-not $currentProcess -or $currentProcess.CreationDate -ne $initialProcess.CreationDate -or -not [string]::Equals($currentProcess.ExecutablePath,$expectedBrowser,[StringComparison]::OrdinalIgnoreCase)) { throw 'The isolated browser exited or changed while waiting for its folder picker.' }
  $dialogs = @([GwpcFolderPicker]::FindDialogs($BrowserPid))
  if ($dialogs.Count -gt 1) { throw 'This browser has multiple native dialogs. Close them and retry installation.' }
  if ($dialogs.Count -eq 1) { $dialog=$dialogs[0]; break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
if ($dialog -eq [IntPtr]::Zero) { throw 'Chrome did not open its extension folder picker.' }
$dialogPid = [GwpcFolderPicker]::ProcessId($dialog)
$dialogProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$dialogPid"
if (-not $dialogProcess -or -not [string]::Equals($dialogProcess.ExecutablePath,$expectedBrowser,[StringComparison]::OrdinalIgnoreCase) -or ($dialogPid -ne $BrowserPid -and $dialogProcess.ParentProcessId -ne $BrowserPid)) { throw 'The native folder picker is not owned by this browser process or its direct child.' }
[GwpcFolderPicker]::Select($dialog,$dialogPid,$extension)
$deadline = (Get-Date).AddSeconds(10)
while ([GwpcFolderPicker]::IsWindow($dialog) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
if ([GwpcFolderPicker]::IsWindow($dialog)) { throw 'Chrome did not accept the bundled extension directory.' }
Write-Host 'Selected the bundled extension in this browser only.'

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { win32 } from 'node:path';
const execute = promisify(execFile);
export const nativeRegistryKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.promptdirector.connector';
export function windowsCommand(name, env = process.env) {
  if (!env.SystemRoot) throw new Error('Windows 系统目录不可用，无法安全调用系统安装工具。');
  return win32.join(env.SystemRoot, 'System32', name);
}
export async function privateWindowsDirectory(root) {
  // Paths are data in the child environment, never interpolated PowerShell code.
  const script = `$ErrorActionPreference='Stop'
$p=$env:PROMPTDIRECTOR_PRIVATE_DIRECTORY
$item=Get-Item -LiteralPath $p -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Connector directory cannot be a reparse point' }
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=Get-Acl -LiteralPath $p
$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier])
if ($owner.Value -ne $sid.Value) { throw 'Connector directory must belong to current user' }
$private=New-Object Security.AccessControl.DirectorySecurity
$private.SetOwner($sid)
$private.SetAccessRuleProtection($true,$false)
$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$private.AddAccessRule($rule)
Set-Acl -LiteralPath $p -AclObject $private
$actual=Get-Acl -LiteralPath $p
if (!$actual.AreAccessRulesProtected) { throw 'Private directory permissions were not applied' }
foreach($r in $actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
 if ($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -ne $sid.Value) { throw 'Unexpected directory access' }
}`;
  try {
    await execute(windowsCommand('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, env: { ...process.env, PROMPTDIRECTOR_PRIVATE_DIRECTORY: root }
    });
  } catch { throw new Error('无法保护 Windows 连接目录，请确认目录属于当前用户且允许设置私有访问权限。'); }
}
export function windowsLauncher(plan) {
  const quote = value => {
    if (/["\r\n]/u.test(value)) throw new Error('Windows 安装路径含无效字符。');
    return value.replaceAll('%', '%%');
  };
  return `@echo off\r\nsetlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\nset "PROMPTDIRECTOR_CONNECTOR_HOME=${quote(plan.root)}"\r\n"${quote(plan.node)}" "${quote(win32.join(plan.runtime, 'native-host.mjs'))}" %*\r\n`;
}
export async function registerWindowsHost(registration, { key = nativeRegistryKey, run = execute } = {}) {
  const script = `$ErrorActionPreference='Stop'
$p='Registry::'+$env:PROMPTDIRECTOR_REGISTRY_KEY.Replace('HKCU\\','HKEY_CURRENT_USER\\')
New-Item -Path $p -Force | Out-Null
Set-Item -LiteralPath $p -Value $env:PROMPTDIRECTOR_NATIVE_MANIFEST
if ((Get-Item -LiteralPath $p).GetValue('') -cne $env:PROMPTDIRECTOR_NATIVE_MANIFEST) { throw 'Chrome registration readback mismatch' }`;
  await run(windowsCommand('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, env: { ...process.env, PROMPTDIRECTOR_REGISTRY_KEY: key, PROMPTDIRECTOR_NATIVE_MANIFEST: registration }
  });
}

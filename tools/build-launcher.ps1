# 构建抖音聚合登录器（WebView2 轻量壳，x86，.NET Framework 自带 csc）。
# 仓库里不放任何现成二进制：
#   - WebView2 的三个 DLL 从微软官方 NuGet 包下载，固定版本并校验 SHA-256；
#   - native\bin 下的两个辅助程序用 PyInstaller 从 native\*.py 源码打包。
# 依赖：Python 3.8+（pip install pyinstaller cryptography）。
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$source = Join-Path $project 'apps\launcher-webview2'
$output = Join-Path $project 'build\launcher'
$cache = Join-Path $project 'build\cache'
$payload = Join-Path $output 'payload\launcher-webview2'
$csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
$icon = Join-Path $source 'assets\douyinjuhe.ico'

$webview2Version = '1.0.2903.40'
$webview2Sha256 = 'EF128016DD1E51C59178C827ED5B8AA3322C57AFA8675D930F8109505542AD74'
$webview2Files = @('lib/net462/Microsoft.Web.WebView2.Core.dll', 'lib/net462/Microsoft.Web.WebView2.WinForms.dll', 'runtimes/win-x86/native/WebView2Loader.dll', 'LICENSE.txt', 'NOTICE.txt')

if (Test-Path $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Path $payload, $cache -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem

# 1. WebView2 运行库。
$nupkg = Join-Path $cache "microsoft.web.webview2.$webview2Version.nupkg"
if (-not (Test-Path $nupkg)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$webview2Version/microsoft.web.webview2.$webview2Version.nupkg" -OutFile $nupkg
}
if ((Get-FileHash -LiteralPath $nupkg -Algorithm SHA256).Hash -ne $webview2Sha256) { throw 'WebView2 NuGet 包校验失败，请删除 build\cache 后重试' }
$archive = [System.IO.Compression.ZipFile]::OpenRead($nupkg)
try {
  foreach ($name in $webview2Files) {
    $entry = $archive.GetEntry($name)
    if ($null -eq $entry) { throw "WebView2 NuGet 包缺少 $name" }
    $target = Join-Path $payload (Split-Path -Leaf $name)
    if ($name -like '*.txt') { $target = Join-Path $payload ('WebView2-' + (Split-Path -Leaf $name)) }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
  }
} finally { $archive.Dispose() }

# 2. 页面、说明和辅助程序源码。
Copy-Item -Path (Join-Path $source 'web') -Destination $payload -Recurse -Force
Copy-Item -Path (Join-Path $source 'README.md') -Destination $payload -Force
Copy-Item -Path (Join-Path $source 'native') -Destination $payload -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $payload 'native') -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force

# 3. 辅助程序：从源码打包成单文件 exe。
$bin = Join-Path $payload 'native\bin'
$work = Join-Path $output 'pyinstaller'
foreach ($name in @('capture_duoshan', 'seal_material')) {
  & python -m PyInstaller --noconfirm --clean --onefile --console --log-level WARN --name $name --distpath $bin --workpath $work --specpath $work (Join-Path $source "native\$name.py")
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $bin "$name.exe"))) { throw "辅助程序 $name 打包失败" }
}
Remove-Item -LiteralPath $work -Recurse -Force

# 4. 登录器主程序、更新器、单文件启动器。
$references = @('/r:System.dll','/r:System.Core.dll','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Net.Http.dll','/r:System.Web.Extensions.dll','/r:System.Security.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll',
  ('/r:' + (Join-Path $payload 'Microsoft.Web.WebView2.Core.dll')), ('/r:' + (Join-Path $payload 'Microsoft.Web.WebView2.WinForms.dll')))
$sources = @('Program.cs','NodeNetworkTransport.cs','CreatorStorageSelection.cs') | ForEach-Object { Join-Path $source $_ }
& $csc /nologo /utf8output /optimize+ /platform:x86 /target:winexe /main:DouyinJuheLauncherWebView2.Program ('/win32icon:' + $icon) ('/out:' + (Join-Path $payload 'DouyinJuheLauncher-WebView2.exe')) @references @sources
if ($LASTEXITCODE -ne 0) { throw '登录器主程序编译失败' }

& $csc /nologo /utf8output /optimize+ /target:winexe ('/out:' + (Join-Path $payload 'DouyinJuheWebView2Updater.exe')) /r:System.dll /r:System.Core.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll (Join-Path $source 'WebView2Updater.cs')
if ($LASTEXITCODE -ne 0) { throw '更新器编译失败' }

$zip = Join-Path $output 'payload.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $output 'payload'), $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$bundle = Join-Path $output 'DouyinJuheLauncher.exe'
& $csc /nologo /utf8output /target:winexe ('/win32icon:' + $icon) ('/out:' + $bundle) /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll ('/resource:' + $zip + ',DouyinJuheSingleExeBootstrapper.payload.zip') (Join-Path $source 'SingleExeBootstrapper.cs')
if ($LASTEXITCODE -ne 0) { throw '单文件启动器编译失败' }
Get-FileHash -LiteralPath $bundle -Algorithm SHA256 | Select-Object Path, Hash | Format-List

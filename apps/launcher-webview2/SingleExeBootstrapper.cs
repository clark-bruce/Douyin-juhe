using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;

namespace DouyinJuheSingleExeBootstrapper
{
    static class Program
    {
        // Bump the extraction directory whenever the embedded renderer or
        // native bridge changes; otherwise an existing single-exe install
        // would keep launching the previous payload forever.
        const string BundleVersion = "0.2.117-webview2-x86-r4";
        const string InnerExecutable = "DouyinJuheLauncher-WebView2.exe";

        [STAThread]
        static int Main()
        {
            try
            {
                var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DouyinJuheLauncherWebView2", BundleVersion);
                var executable = Path.Combine(root, InnerExecutable);
                if (!File.Exists(executable))
                {
                    var stage = root + ".stage-" + Guid.NewGuid().ToString("N");
                    Directory.CreateDirectory(stage);
                    using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("DouyinJuheSingleExeBootstrapper.payload.zip"))
                    {
                        if (stream == null) throw new InvalidDataException("登录器内置组件缺失。");
                        using (var archive = new ZipArchive(stream, ZipArchiveMode.Read, false)) ExtractSafe(archive, stage);
                    }
                    var source = Path.Combine(stage, "launcher-webview2");
                    var stagedExe = Path.Combine(source, InnerExecutable);
                    if (!File.Exists(stagedExe)) throw new InvalidDataException("登录器内置程序不完整。");
                    if (Directory.Exists(root)) Directory.Delete(root, true);
                    Directory.Move(source, root);
                    try { Directory.Delete(stage, true); } catch { }
                }
                var info = new ProcessStartInfo { FileName = executable, WorkingDirectory = root, UseShellExecute = true };
                Process.Start(info);
                return 0;
            }
            catch (Exception error)
            {
                try { System.Windows.Forms.MessageBox.Show("抖音聚合登录器启动失败：\n\n" + error.Message, "抖音聚合登录器", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error); } catch { }
                return 1;
            }
        }

        static void ExtractSafe(ZipArchive archive, string destination)
        {
            var root = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
            foreach (var entry in archive.Entries)
            {
                var full = Path.GetFullPath(Path.Combine(destination, entry.FullName));
                if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("登录器内置路径无效。");
                if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(full); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(full));
                using (var input = entry.Open()) using (var output = File.Create(full)) input.CopyTo(output);
            }
        }
    }
}

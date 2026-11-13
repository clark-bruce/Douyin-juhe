using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Threading;

namespace DouyinJuheLauncherWebView2Updater
{
    static class Program
    {
        static int Main(string[] args)
        {
            if (args.Length < 4) return 2;
            var package = args[0];
            var installDir = Path.GetFullPath(args[1]);
            var executable = args[2];
            int parentPid;
            if (!File.Exists(package) || !Int32.TryParse(args[3], out parentPid)) return 3;
            try
            {
                for (var i = 0; i < 120; i++)
                {
                    try { using (var parent = Process.GetProcessById(parentPid)) { if (!parent.HasExited) { Thread.Sleep(500); continue; } } } catch { }
                    break;
                }
                // The parent process may still be releasing file handles (WebView2
                // child processes, antivirus scans) after it exits.
                Thread.Sleep(1500);
                var stage = Path.Combine(Path.GetTempPath(), "douyinjuhe-webview2-stage-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(stage);
                ExtractSafe(package, stage);
                var source = Path.Combine(stage, "launcher-webview2");
                if (!File.Exists(Path.Combine(source, executable))) { Log("package missing " + executable); return 4; }
                Directory.CreateDirectory(installDir);
                // Overwrite in place with retries instead of deleting the whole
                // install directory first: a single locked file used to leave a
                // half-deleted install and no launcher to restart.
                var failed = 0;
                foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
                {
                    var relative = file.Substring(source.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                    var target = Path.Combine(installDir, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    if (!CopyWithRetry(file, target)) failed++;
                }
                // Remove files that no longer exist in the new package (best effort).
                try
                {
                    foreach (var old in Directory.GetFiles(installDir, "*", SearchOption.AllDirectories))
                    {
                        var relative = old.Substring(installDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                        if (!File.Exists(Path.Combine(source, relative))) { try { File.Delete(old); } catch { } }
                    }
                }
                catch { }
                var exePath = Path.Combine(installDir, executable);
                Log("copy finished, failedFiles=" + failed + ", exeExists=" + File.Exists(exePath));
                if (File.Exists(exePath))
                    Process.Start(new ProcessStartInfo { FileName = exePath, WorkingDirectory = installDir, UseShellExecute = true });
                if (failed > 0) return 6;
                try { Directory.Delete(stage, true); } catch { }
                try { File.Delete(package); } catch { }
                return 0;
            }
            catch (Exception error)
            {
                Log("update failed: " + error);
                // Never leave the user without a launcher: start whatever is installed.
                try
                {
                    var exePath = Path.Combine(installDir, executable);
                    if (File.Exists(exePath)) Process.Start(new ProcessStartInfo { FileName = exePath, WorkingDirectory = installDir, UseShellExecute = true });
                }
                catch { }
                return 5;
            }
        }

        static bool CopyWithRetry(string source, string target)
        {
            Exception last = null;
            for (var attempt = 0; attempt < 20; attempt++)
            {
                try { File.Copy(source, target, true); return true; }
                catch (Exception error) { last = error; Thread.Sleep(500); }
            }
            Log("copy failed " + target + ": " + (last == null ? "" : last.Message));
            return false;
        }

        static void Log(string message)
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "douyinjuhe-webview2-updater.log"), DateTime.Now.ToString("o") + " " + message + Environment.NewLine); } catch { }
        }

        static void ExtractSafe(string zipPath, string destination)
        {
            var root = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
            using (var archive = ZipFile.OpenRead(zipPath))
            {
                foreach (var entry in archive.Entries)
                {
                    var full = Path.GetFullPath(Path.Combine(destination, entry.FullName));
                    if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("运行包路径无效");
                    if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(full); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(full));
                    entry.ExtractToFile(full, true);
                }
            }
        }
    }
}

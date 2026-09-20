// T2 Sales Native - setup: what installing / uninstalling actually does (no UI here).
//
// Same behaviour as the earlier NSIS installer, per-user, no administrator rights:
//   folder   %LOCALAPPDATA%\Programs\T2 Sales Native
//   shortcuts desktop + Start menu, Add/Remove entry in HKCU, Uninstall.exe next to the app
// Safety rules learned the hard way (a jpackage MSI once wiped a shared folder): only OWN files are removed, by name;
// a folder that holds somebody else's files is refused; nothing outside the install folder / own shortcuts is touched.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace T2Setup
{
    static class Product
    {
        public const string Name = "T2 Sales Native";
        public const string ExeName = "T2 Sales Native.exe";
        public const string Publisher = "T2 Sales";
        public const string UninstallerName = "Uninstall.exe";
        public const string UninstKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\T2SalesNative";
        public const string AppKey = @"Software\T2SalesNative";
        public const string ProcessName = "T2 Sales Native"; // image name without .exe

        public static string DefaultDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Name); }
        }

        public static string InstalledDir()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(AppKey))
                {
                    string d = k == null ? null : k.GetValue("InstallLocation") as string;
                    return string.IsNullOrEmpty(d) ? null : d;
                }
            }
            catch (Exception) { return null; }
        }

        public static string InstalledVersion()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(UninstKey))
                {
                    return k == null ? null : k.GetValue("DisplayVersion") as string;
                }
            }
            catch (Exception) { return null; }
        }
    }

    /// <summary>progress 0..1 and a short technical note for the log; the friendly phrases live in the UI.</summary>
    delegate void ProgressReport(double fraction, string note);

    sealed class Engine
    {
        readonly Payload payload;
        public readonly string InstallDir;

        public Engine(Payload payload, string installDir) { this.payload = payload; this.InstallDir = installDir; }

        public static string LogPath { get { return Path.Combine(Path.GetTempPath(), "T2SalesNative-Setup.log"); } }

        public static void Log(string line)
        {
            try { File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine, Encoding.UTF8); }
            catch (Exception) { }
        }

        // ---------------------------------------------------------------------------------------------------------------- install

        public void Install(ProgressReport report)
        {
            Log("install " + payload.Version + " -> " + InstallDir);
            report(0.01, "check");
            RefuseForeignFolder(InstallDir);

            report(0.02, "close running app");
            KillRunning();

            report(0.05, "clean previous files");
            Directory.CreateDirectory(InstallDir);
            DeleteDir(Path.Combine(InstallDir, "app"));
            DeleteDir(Path.Combine(InstallDir, "runtime"));

            long installed = 0;
            using (Stream zs = payload.OpenZip())
            using (ZipArchive zip = new ZipArchive(zs, ZipArchiveMode.Read))
            {
                long total = 0;
                foreach (ZipArchiveEntry e in zip.Entries) total += e.Length;
                if (total <= 0) total = 1;

                string root = Path.GetFullPath(InstallDir).TrimEnd('\\') + "\\";
                byte[] buf = new byte[256 * 1024];
                long done = 0;
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    string target = Path.GetFullPath(Path.Combine(InstallDir, e.FullName.Replace('/', '\\')));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Недопустимый путь в архиве");
                    if (e.FullName.EndsWith("/") || e.FullName.EndsWith("\\"))
                    {
                        Directory.CreateDirectory(target);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (Stream input = e.Open())
                    using (FileStream output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        int n;
                        while ((n = input.Read(buf, 0, buf.Length)) > 0)
                        {
                            output.Write(buf, 0, n);
                            done += n;
                            report(0.06 + 0.84 * ((double)done / total), null);
                        }
                    }
                    try { File.SetLastWriteTime(target, e.LastWriteTime.DateTime); } catch (Exception) { }
                }
                installed = total;
            }

            report(0.91, "uninstaller");
            WriteUninstaller();

            report(0.94, "shortcuts");
            string exe = Path.Combine(InstallDir, Product.ExeName);
            string uninst = Path.Combine(InstallDir, Product.UninstallerName);
            CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Product.Name + ".lnk"), exe, "", InstallDir, exe, Product.Name);
            string menuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product.Name);
            Directory.CreateDirectory(menuDir);
            CreateShortcut(Path.Combine(menuDir, Product.Name + ".lnk"), exe, "", InstallDir, exe, Product.Name);
            CreateShortcut(Path.Combine(menuDir, "Удалить " + Product.Name + ".lnk"), uninst, "", InstallDir, uninst, "Удалить " + Product.Name);
            TryDelete(Path.Combine(menuDir, "Uninstall " + Product.Name + ".lnk")); // left by the previous (NSIS) installer

            report(0.98, "registry");
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Product.AppKey)) { k.SetValue("InstallLocation", InstallDir); }
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Product.UninstKey))
            {
                k.SetValue("DisplayName", Product.Name);
                k.SetValue("DisplayVersion", payload.Version);
                k.SetValue("Publisher", Product.Publisher);
                k.SetValue("DisplayIcon", exe);
                k.SetValue("InstallLocation", InstallDir);
                k.SetValue("UninstallString", "\"" + uninst + "\"");
                k.SetValue("QuietUninstallString", "\"" + uninst + "\" /S");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, installed / 1024), RegistryValueKind.DWord);
            }
            report(1.0, "done");
            Log("install ok");
        }

        void WriteUninstaller()
        {
            // the uninstaller is this stub alone: the first payload.Start bytes of the installer (a valid .exe without the payload)
            string target = Path.Combine(InstallDir, Product.UninstallerName);
            using (FileStream src = new FileStream(payload.ExePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (FileStream dst = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                byte[] buf = new byte[64 * 1024];
                long left = payload.Start;
                while (left > 0)
                {
                    int n = src.Read(buf, 0, (int)Math.Min((long)buf.Length, left));
                    if (n <= 0) throw new EndOfStreamException();
                    dst.Write(buf, 0, n);
                    left -= n;
                }
            }
        }

        /// <summary>An existing folder that is neither empty nor ours is somebody else's - never install into it.</summary>
        static void RefuseForeignFolder(string dir)
        {
            if (!Directory.Exists(dir)) return;
            bool empty = Directory.GetFileSystemEntries(dir).Length == 0;
            bool ours = File.Exists(Path.Combine(dir, Product.ExeName)) || File.Exists(Path.Combine(dir, Product.UninstallerName));
            if (!empty && !ours) throw new InvalidOperationException("Папка установки занята другим содержимым:\n" + dir);
        }

        // -------------------------------------------------------------------------------------------------------------- uninstall

        /// <summary>Runs from &lt;dir&gt;\Uninstall.exe. Removes only what the installer created, by name; never the folder recursively.</summary>
        public static void Uninstall(string dir, ProgressReport report)
        {
            Log("uninstall " + dir);
            if (!File.Exists(Path.Combine(dir, Product.ExeName))) throw new InvalidOperationException("Не найдено приложение для удаления в:\n" + dir);

            report(0.05, "close app");
            KillRunning();

            report(0.20, "shortcuts");
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Product.Name + ".lnk"));
            string menuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product.Name);
            TryDelete(Path.Combine(menuDir, Product.Name + ".lnk"));
            TryDelete(Path.Combine(menuDir, "Удалить " + Product.Name + ".lnk"));
            TryDelete(Path.Combine(menuDir, "Uninstall " + Product.Name + ".lnk")); // left by the previous (NSIS) installer
            try { Directory.Delete(menuDir, false); } catch (Exception) { }

            report(0.45, "files");
            DeleteDir(Path.Combine(dir, "app"));
            report(0.70, "runtime");
            DeleteDir(Path.Combine(dir, "runtime"));
            TryDelete(Path.Combine(dir, Product.ExeName));
            TryDelete(Path.Combine(dir, Product.Name + ".ico"));
            TryDelete(Path.Combine(dir, ".jpackage.xml"));

            report(0.90, "registry");
            try { Registry.CurrentUser.DeleteSubKeyTree(Product.UninstKey, false); } catch (Exception) { }
            try { Registry.CurrentUser.DeleteSubKeyTree(Product.AppKey, false); } catch (Exception) { }

            // this very exe is still running: let a detached cmd remove it and the (then empty) folder a moment after we exit
            try
            {
                string self = Path.Combine(dir, Product.UninstallerName);
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe",
                    "/c ping 127.0.0.1 -n 3 >nul & del /f /q \"" + self + "\" & rmdir \"" + dir + "\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
            }
            catch (Exception ex) { Log("self-delete not scheduled: " + ex.Message); }
            report(1.0, "done");
            Log("uninstall ok");
        }

        // ------------------------------------------------------------------------------------------------------------------ helpers

        public static void KillRunning()
        {
            foreach (Process p in Process.GetProcessesByName(Product.ProcessName))
            {
                try { p.Kill(); p.WaitForExit(4000); }
                catch (Exception ex) { Log("kill: " + ex.Message); }
                finally { p.Dispose(); }
            }
        }

        static void TryDelete(string file)
        {
            try { if (File.Exists(file)) { File.SetAttributes(file, FileAttributes.Normal); File.Delete(file); } }
            catch (Exception ex) { Log("delete " + file + ": " + ex.Message); }
        }

        /// <summary>Recursive delete of one of OUR sub-folders (app / runtime), with a few retries for files that antivirus still holds.</summary>
        static void DeleteDir(string dir)
        {
            for (int attempt = 0; attempt < 6; attempt++)
            {
                try
                {
                    if (!Directory.Exists(dir)) return;
                    foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                    {
                        try { File.SetAttributes(f, FileAttributes.Normal); } catch (Exception) { }
                    }
                    Directory.Delete(dir, true);
                    return;
                }
                catch (Exception ex)
                {
                    Log("delete dir " + dir + " attempt " + attempt + ": " + ex.Message);
                    Thread.Sleep(400);
                }
            }
            if (Directory.Exists(dir)) throw new IOException("Не удалось удалить старые файлы:\n" + dir);
        }

        static void CreateShortcut(string lnk, string target, string args, string workDir, string icon, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object sc = null;
            try
            {
                sc = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
                Type t = sc.GetType();
                t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
                t.InvokeMember("Arguments", BindingFlags.SetProperty, null, sc, new object[] { args });
                t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
                t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { icon + ",0" });
                t.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { description });
                t.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
            }
            finally
            {
                if (sc != null) Marshal.ReleaseComObject(sc);
                Marshal.ReleaseComObject(shell);
            }
        }
    }
}

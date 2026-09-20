// T2 Sales Native - setup: entry point.
//   T2SalesNative-Setup-x64-<v>.exe            interactive install / update (this exe carries the payload)
//   T2SalesNative-Setup-x64-<v>.exe /S         silent install (no window, exit code 0 / 1)
//   <install dir>\Uninstall.exe [/S]           interactive / silent uninstall (a copy of the stub without payload)
//   ... /UPDATE                              update started by the app itself: no welcome page, installs at once, relaunches the app, closes
//   ... /demo                                  UI preview with a fake engine (touches nothing) - for design work
using System;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows;

namespace T2Setup
{
    static class Program
    {
        static bool Has(string[] args, string flag)
        {
            foreach (string a in args) if (a.Equals(flag, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        [STAThread]
        static int Main(string[] args)
        {
            bool silent = Has(args, "/S");
            bool demo = Has(args, "/demo") || Has(args, "/demo-uninstall");
            string exe = Assembly.GetEntryAssembly().Location;

            bool created;
            Mutex mutex = new Mutex(true, "Local\\T2SalesNativeSetup", out created);
            if (!created) return 2; // already running

            try
            {
                Payload payload = Payload.TryOpen(exe);
                Session s = new Session();
                s.Demo = demo;
                s.Auto = Has(args, "/UPDATE");
                if (demo)
                {
                    s.Mode = Has(args, "/demo-uninstall") ? SetupMode.Uninstall : SetupMode.Install;
                    s.NewVersion = "1.0.1";
                    s.OldVersion = Has(args, "/demo-update") ? "1.0.0" : null;
                    s.Dir = Product.DefaultDir;
                }
                else if (payload != null)
                {
                    s.Mode = SetupMode.Install;
                    s.Payload = payload;
                    s.NewVersion = payload.Version;
                    s.OldVersion = Product.InstalledVersion();
                    string existing = Product.InstalledDir();
                    s.Dir = (existing != null && Directory.Exists(existing)) ? existing : Product.DefaultDir;
                }
                else
                {
                    // no payload: this is the uninstaller - and only if it really lives in an installed app folder
                    string dir = Path.GetDirectoryName(exe);
                    bool isUninstaller = Path.GetFileName(exe).Equals(Product.UninstallerName, StringComparison.OrdinalIgnoreCase)
                                         && File.Exists(Path.Combine(dir, Product.ExeName));
                    if (!isUninstaller)
                    {
                        Engine.Log("refusing to run: no payload and not an installed Uninstall.exe (" + exe + ")");
                        if (!silent) MessageBox.Show("Это не установщик: в файле нет приложения для установки.", "T2 Sales Native", MessageBoxButton.OK, MessageBoxImage.Warning);
                        return 3;
                    }
                    s.Mode = SetupMode.Uninstall;
                    s.Dir = dir;
                }

                if (silent && !demo) return RunSilent(s) ? 0 : 1;

                Application app = new Application();
                app.ShutdownMode = ShutdownMode.OnMainWindowClose;
                return app.Run(new SetupWindow(s));
            }
            finally
            {
                GC.KeepAlive(mutex);
            }
        }

        static bool RunSilent(Session s)
        {
            try
            {
                ProgressReport nop = delegate(double f, string note) { if (note != null) Engine.Log("  " + note); };
                if (s.Mode == SetupMode.Install) new Engine(s.Payload, s.Dir).Install(nop);
                else Engine.Uninstall(s.Dir, nop);
                return true;
            }
            catch (Exception ex)
            {
                Engine.Log("ERROR " + ex);
                return false;
            }
        }
    }
}

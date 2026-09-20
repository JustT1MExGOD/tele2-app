// T2 Sales Native - setup: the window. Look = the app's sign-in screen (dark, #0E2230 glow fading to black, glass card, 🍉 + "T2 Sales",
// white primary button); pages: welcome -> installing (animated analytics + friendly phrases) -> done. Same pages for uninstall.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using Shapes = System.Windows.Shapes;

namespace T2Setup
{
    enum SetupMode { Install, Uninstall }

    sealed class SwitchHolder { public Fx.Switch Sw; }

    sealed class Session
    {
        public SetupMode Mode;
        public Payload Payload;
        public string Dir;
        public bool Demo;
        public bool Auto;           // update started from the app: install at once, relaunch, close
        public string OldVersion;   // installed version, when this is an update
        public string NewVersion;
    }

    sealed class SetupWindow : Window
    {
        enum Ui { Idle, Progress, Done }

        readonly Session session;
        Border shell;
        Grid host;
        FrameworkElement current;
        Border closeBtn;
        Action primary;
        Ui ui = Ui.Idle;
        bool working;

        // work thread -> UI
        readonly object sync = new object();
        double target;
        bool workDone;
        string error;

        // progress page
        double shown;
        double pageTime;
        DateTime lastFrame;
        Dashboard dashboard;
        TextBlock percent, phrase;
        Grid fillHost;
        Grid track;
        Shapes.Rectangle shimmer;
        int phraseIdx = -1;
        string[] phrases;
        double[] phraseAt;

        // done page
        Canvas confetti;
        readonly List<Particle> particles = new List<Particle>();
        double doneTime;
        SwitchHolder launchSwitch = new SwitchHolder();

        sealed class Particle { public Shapes.Rectangle R; public double X, Y, Vx, Vy, Rot, Vr; }

        public SetupWindow(Session session)
        {
            this.session = session;
            Title = session.Mode == SetupMode.Install ? "Установка T2 Sales Native" : "Удаление T2 Sales Native";
            Width = 548;
            Height = 752;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            FontFamily = Theme.Font;
            TextOptions.SetTextRenderingMode(this, TextRenderingMode.Grayscale);
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Ideal);
            try { Icon = Theme.Image("icon.png"); } catch (Exception) { }

            phrases = session.Mode == SetupMode.Install
                ? new string[] { "Готовим установку…", "Считываем графики смен…", "Подсчитываем продажи…", "Сверяем планы по точкам…", "Делаем прогнозы выполнения планов…", "Считаем BFQ и рейтинг команды…", "Раскладываем кассу по дням…", "Настраиваем Command Center…", "Создаём ярлыки…", "Наводим последний лоск…" }
                : new string[] { "Закрываем приложение…", "Убираем ярлыки…", "Стираем графики и планы с этого компьютера…", "Считаем освободившееся место…", "Наводим порядок в папках…", "Прощаемся…" };
            phraseAt = session.Mode == SetupMode.Install
                ? new double[] { 0.0, 0.06, 0.18, 0.30, 0.42, 0.54, 0.66, 0.78, 0.88, 0.95 }
                : new double[] { 0.0, 0.15, 0.30, 0.55, 0.78, 0.93 };

            BuildShell();
            Loaded += delegate { Intro(); if (session.Auto && session.Mode == SetupMode.Install) StartWork(); else ShowWelcome(); };
            PreviewKeyDown += OnKey;
            Closing += delegate(object s, System.ComponentModel.CancelEventArgs e) { if (working) e.Cancel = true; };
            CompositionTarget.Rendering += OnFrame;
            Closed += delegate { CompositionTarget.Rendering -= OnFrame; };
        }

        // ------------------------------------------------------------------------------------------------------------ shell

        void BuildShell()
        {
            LinearGradientBrush bg = new LinearGradientBrush();
            bg.StartPoint = new Point(0, 0);
            bg.EndPoint = new Point(0, 1);
            bg.GradientStops.Add(new GradientStop(Theme.C(Theme.TopGlow), 0.0));
            bg.GradientStops.Add(new GradientStop(Theme.C(0xFF000000), 0.74));
            bg.Freeze();

            shell = new Border();
            shell.Margin = new Thickness(24);
            shell.CornerRadius = new CornerRadius(28);
            shell.Background = bg;
            shell.BorderBrush = Theme.B(0x22FFFFFF);
            shell.BorderThickness = new Thickness(1);
            shell.Effect = new DropShadowEffect { BlurRadius = 30, ShadowDepth = 0, Opacity = 0.6, Color = Colors.Black };
            shell.RenderTransformOrigin = new Point(0.5, 0.5);
            shell.RenderTransform = new ScaleTransform(0.97, 0.97);
            shell.Opacity = 0;
            shell.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e) { if (e.ButtonState == MouseButtonState.Pressed) { try { DragMove(); } catch (Exception) { } } };

            Grid root = new Grid();
            host = new Grid();
            root.Children.Add(host);

            closeBtn = new Border { Width = 34, Height = 34, CornerRadius = new CornerRadius(17), Background = Theme.B(0x14FFFFFF), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 16, 16, 0), Cursor = Cursors.Hand };
            Shapes.Path x = Fx.Icon("M0,0 L10,10 M10,0 L0,10", Theme.TextSecondary, 1.8);
            x.Width = 10; x.Height = 10; x.HorizontalAlignment = HorizontalAlignment.Center; x.VerticalAlignment = VerticalAlignment.Center;
            closeBtn.Child = x;
            closeBtn.MouseEnter += delegate { closeBtn.Background = Theme.B(0x2AFFFFFF); };
            closeBtn.MouseLeave += delegate { closeBtn.Background = Theme.B(0x14FFFFFF); };
            closeBtn.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e) { e.Handled = true; };
            closeBtn.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e) { e.Handled = true; if (!working) Close(); };
            root.Children.Add(closeBtn);

            shell.Child = root;
            Content = shell;
        }

        void Intro()
        {
            shell.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, Fx.Ms(380)) { EasingFunction = Fx.EaseOut() });
            ScaleTransform st = (ScaleTransform)shell.RenderTransform;
            DoubleAnimation sa = new DoubleAnimation(0.97, 1, Fx.Ms(520)) { EasingFunction = Fx.EaseOut() };
            st.BeginAnimation(ScaleTransform.ScaleXProperty, sa);
            st.BeginAnimation(ScaleTransform.ScaleYProperty, sa);
        }

        void OnKey(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter && primary != null) { e.Handled = true; primary(); }
            else if (e.Key == Key.Escape && !working) { e.Handled = true; Close(); }
        }

        void ShowPage(FrameworkElement next)
        {
            FrameworkElement old = current;
            current = next;
            next.HorizontalAlignment = HorizontalAlignment.Center;
            next.VerticalAlignment = VerticalAlignment.Center;
            host.Children.Add(next);
            if (old != null)
            {
                DoubleAnimation f = new DoubleAnimation(1, 0, Fx.Ms(160));
                f.Completed += delegate { host.Children.Remove(old); };
                old.BeginAnimation(OpacityProperty, f);
                old.IsHitTestVisible = false;
            }
        }

        // ------------------------------------------------------------------------------------------------------------ blocks

        FrameworkElement Melon(double size)
        {
            Grid g = new Grid { Width = size * 1.6, Height = size * 1.6, HorizontalAlignment = HorizontalAlignment.Center };

            RadialGradientBrush glowBrush = new RadialGradientBrush();
            glowBrush.GradientStops.Add(new GradientStop(Theme.C(0x503BB8F5), 0.0));
            glowBrush.GradientStops.Add(new GradientStop(Theme.C(0x003BB8F5), 1.0));
            Shapes.Ellipse glow = new Shapes.Ellipse { Fill = glowBrush, RenderTransformOrigin = new Point(0.5, 0.5) };
            ScaleTransform gs = new ScaleTransform(1, 1);
            glow.RenderTransform = gs;
            DoubleAnimation pulse = new DoubleAnimation(0.92, 1.12, Fx.Ms(2600)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase() };
            gs.BeginAnimation(ScaleTransform.ScaleXProperty, pulse);
            gs.BeginAnimation(ScaleTransform.ScaleYProperty, pulse);
            g.Children.Add(glow);

            Image img = new Image { Source = Theme.Image("melon.png"), Width = size, Height = size * 0.98, Stretch = Stretch.Uniform, RenderTransformOrigin = new Point(0.5, 0.5) };
            RenderOptions.SetBitmapScalingMode(img, BitmapScalingMode.HighQuality);
            TransformGroup tg = new TransformGroup();
            ScaleTransform sc = new ScaleTransform(0.4, 0.4);
            TranslateTransform tr = new TranslateTransform(0, 0);
            tg.Children.Add(sc);
            tg.Children.Add(tr);
            img.RenderTransform = tg;
            DoubleAnimation pop = new DoubleAnimation(0.4, 1, Fx.Ms(750)) { EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.7 } };
            sc.BeginAnimation(ScaleTransform.ScaleXProperty, pop);
            sc.BeginAnimation(ScaleTransform.ScaleYProperty, pop);
            DoubleAnimation bob = new DoubleAnimation(0, -6, Fx.Ms(2300)) { BeginTime = TimeSpan.FromMilliseconds(800), AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
            tr.BeginAnimation(TranslateTransform.YProperty, bob);
            g.Children.Add(img);
            return g;
        }

        FrameworkElement Brand(double melonSize, double titleSize, string subtitle, double delay)
        {
            StackPanel sp = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
            sp.Children.Add(Fx.Reveal(Melon(melonSize), delay, 0));
            sp.Children.Add(Fx.Reveal(Fx.Text("T2 Sales", titleSize, FontWeights.Bold, Theme.Text, 4), delay + 90));
            if (subtitle != null) sp.Children.Add(Fx.Reveal(Fx.Text(subtitle, 14, FontWeights.Normal, Theme.Hint, 6), delay + 160));
            return sp;
        }

        // ------------------------------------------------------------------------------------------------------------ pages

        void ShowWelcome()
        {
            bool install = session.Mode == SetupMode.Install;
            bool update = install && session.OldVersion != null;
            bool same = update && session.OldVersion == session.NewVersion;   // reinstall of the very same version
            primary = StartWork;

            StackPanel page = new StackPanel { Width = 420 };
            page.Children.Add(Brand(78, 28, install ? "Приложение для компьютера" : "Приложение для компьютера", 120));

            Border card = Fx.Card();
            card.Margin = new Thickness(0, 22, 0, 0);
            StackPanel cs = new StackPanel();
            cs.Children.Add(Fx.IconCircle(install ? "M12,3 L12,15 M7,10.5 L12,15.5 L17,10.5 M5,20 L19,20" : "M4,7 L20,7 M9,7 L9,4 L15,4 L15,7 M6.5,7 L7.5,20 L16.5,20 L17.5,7 M10.5,11 L10.5,16 M13.5,11 L13.5,16", Theme.Primary, Theme.PrimarySoft));
            cs.Children.Add(Fx.Text(install ? (same ? "Переустановка T2 Sales Native" : update ? "Обновление T2 Sales Native" : "Установка T2 Sales Native") : "Удаление T2 Sales Native", 20, FontWeights.Bold, Theme.Text, 12));
            cs.Children.Add(Fx.Text(install
                ? "Продажи, график, планы, чат и аналитика сети — всё в одном приложении для компьютера."
                : "Приложение будет удалено с этого компьютера. Ваши данные на сервере останутся на месте.", 14, FontWeights.Normal, Theme.Hint, 8));
            if (install)
            {
                StackPanel chips = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 14, 0, 0) };
                chips.Children.Add(Fx.Chip(update && !same ? session.OldVersion + "  →  " + session.NewVersion : "Версия " + session.NewVersion));
                chips.Children.Add(Fx.Chip("Без прав администратора"));
                cs.Children.Add(chips);
                cs.Children.Add(Fx.Text("Папка: " + Shorten(session.Dir, 46), 12, FontWeights.Normal, Theme.Hint, 12));
            }
            Border btn = Fx.Button(install ? (same ? "Переустановить" : update ? "Обновить" : "Установить") : "Удалить", StartWork);
            btn.Margin = new Thickness(0, 18, 0, 0);
            cs.Children.Add(btn);
            card.Child = cs;
            page.Children.Add(Fx.Reveal(card, 330, 22));
            page.Children.Add(Fx.Reveal(Fx.Link("Отмена", delegate { Close(); }), 470, 8));
            ShowPage(page);
        }

        void StartWork()
        {
            if (working) return;
            working = true;
            primary = null;
            closeBtn.Visibility = Visibility.Hidden;
            BeginWorker();
            ShowProgress();
        }

        void ShowProgress()
        {
            shown = 0; pageTime = 0; phraseIdx = -1; lastFrame = DateTime.UtcNow;

            StackPanel page = new StackPanel { Width = 420 };
            page.Children.Add(Brand(52, 22, null, 60));

            Border card = Fx.Card();
            card.Margin = new Thickness(0, 18, 0, 0);
            card.Padding = new Thickness(16, 16, 16, 20);
            StackPanel cs = new StackPanel();

            dashboard = new Dashboard();
            cs.Children.Add(Fx.Reveal(dashboard, 200, 14));

            percent = Fx.Text("0%", 46, FontWeights.Bold, Theme.Text, 14);
            cs.Children.Add(Fx.Reveal(percent, 300, 10));

            phrase = Fx.Text(phrases[0], 16, FontWeights.SemiBold, Theme.Text, 4);
            cs.Children.Add(Fx.Reveal(phrase, 380, 10));
            cs.Children.Add(Fx.Reveal(Fx.Text(session.Mode == SetupMode.Install ? "Это займёт меньше минуты" : "Ваши данные на сервере остаются на месте", 13, FontWeights.Normal, Theme.Hint, 4), 440, 10));

            track = new Grid { Height = 10, Margin = new Thickness(0, 18, 0, 0) };
            track.Children.Add(new Border { CornerRadius = new CornerRadius(5), Background = Theme.B(Theme.Surface3) });
            fillHost = new Grid { Height = 10, HorizontalAlignment = HorizontalAlignment.Left, Width = 0 };
            LinearGradientBrush fillBrush = new LinearGradientBrush(Theme.C(Theme.Primary), Theme.C(0xFF8ADBFF), 0);
            fillHost.Children.Add(new Border { Background = fillBrush });
            LinearGradientBrush sh = new LinearGradientBrush();
            sh.StartPoint = new Point(0, 0.5); sh.EndPoint = new Point(1, 0.5);
            sh.GradientStops.Add(new GradientStop(Theme.C(0x00FFFFFF), 0));
            sh.GradientStops.Add(new GradientStop(Theme.C(0x88FFFFFF), 0.5));
            sh.GradientStops.Add(new GradientStop(Theme.C(0x00FFFFFF), 1));
            shimmer = new Shapes.Rectangle { Width = 64, Fill = sh, HorizontalAlignment = HorizontalAlignment.Left, IsHitTestVisible = false };
            shimmer.RenderTransform = new TranslateTransform(0, 0);
            fillHost.Children.Add(shimmer);
            fillHost.Clip = new RectangleGeometry(new Rect(0, 0, 0, 10), 5, 5);
            track.Children.Add(fillHost);
            cs.Children.Add(Fx.Reveal(track, 480, 8));

            card.Child = cs;
            page.Children.Add(Fx.Reveal(card, 160, 22));
            ui = Ui.Progress;
            ShowPage(page);
            UpdateProgressUi();
        }

        void ShowDone()
        {
            ui = Ui.Done;
            working = false;
            closeBtn.Visibility = Visibility.Visible;
            bool install = session.Mode == SetupMode.Install;
            bool update = install && session.OldVersion != null;
            launchSwitch = new SwitchHolder();

            StackPanel page = new StackPanel { Width = 420 };

            // success mark: soft disc + circle and check that draw themselves
            Grid markBox = new Grid { Width = 110, Height = 110, HorizontalAlignment = HorizontalAlignment.Center };
            Canvas mark = new Canvas { Width = 96, Height = 96, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, RenderTransformOrigin = new Point(0.5, 0.5) };
            Shapes.Ellipse disc = new Shapes.Ellipse { Width = 96, Height = 96, Fill = Theme.B(Theme.SuccessSoft) };
            mark.Children.Add(disc);
            double circleLen = Math.PI * 90 / 3.0;
            Shapes.Ellipse ring = new Shapes.Ellipse { Width = 90, Height = 90, Stroke = Theme.B(Theme.Success), StrokeThickness = 3, StrokeDashArray = new DoubleCollection(new double[] { circleLen + 0.5, circleLen + 0.5 }), StrokeDashCap = PenLineCap.Round, RenderTransformOrigin = new Point(0.5, 0.5), RenderTransform = new RotateTransform(-90) };
            Canvas.SetLeft(ring, 3); Canvas.SetTop(ring, 3);
            mark.Children.Add(ring);
            double checkLen = 60.5 / 5.0;
            Shapes.Path check = new Shapes.Path { Data = Geometry.Parse("M28,50 L43,64 L69,34"), Stroke = Theme.B(Theme.Success), StrokeThickness = 5, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round, StrokeDashArray = new DoubleCollection(new double[] { checkLen + 0.3, checkLen + 0.3 }) };
            mark.Children.Add(check);
            ScaleTransform ms = new ScaleTransform(0.55, 0.55);
            mark.RenderTransform = ms;
            markBox.Children.Add(mark);
            confetti = new Canvas { Width = 0, Height = 0, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, IsHitTestVisible = false };
            markBox.Children.Add(confetti);
            page.Children.Add(markBox);

            ms.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(0.55, 1, Fx.Ms(650)) { EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.6 } });
            ms.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(0.55, 1, Fx.Ms(650)) { EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.6 } });
            ring.BeginAnimation(Shapes.Shape.StrokeDashOffsetProperty, new DoubleAnimation(circleLen + 0.5, 0, Fx.Ms(650)) { EasingFunction = Fx.EaseOut() });
            check.BeginAnimation(Shapes.Shape.StrokeDashOffsetProperty, new DoubleAnimation(checkLen + 0.3, 0, Fx.Ms(420)) { BeginTime = TimeSpan.FromMilliseconds(520), EasingFunction = Fx.EaseOut() });

            page.Children.Add(Fx.Reveal(Fx.Text(install ? (update && session.OldVersion != session.NewVersion ? "Обновлено до " + session.NewVersion : "Всё готово") : "Приложение удалено", 26, FontWeights.Bold, Theme.Text, 8), 260));
            page.Children.Add(Fx.Reveal(Fx.Text(install
                ? "T2 Sales Native установлено. Ярлык добавлен на рабочий стол и в меню «Пуск»."
                : "T2 Sales Native удалено с этого компьютера. Данные на сервере не затронуты.", 14, FontWeights.Normal, Theme.Hint, 8), 340));

            Border card = Fx.Card();
            card.Margin = new Thickness(0, 22, 0, 0);
            StackPanel cs = new StackPanel();
            if (install)
            {
                Grid row = new Grid { Margin = new Thickness(4, 0, 4, 0) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                TextBlock lbl = Fx.Text("Запустить T2 Sales Native", 15, FontWeights.SemiBold, Theme.Text);
                lbl.HorizontalAlignment = HorizontalAlignment.Left;
                lbl.VerticalAlignment = VerticalAlignment.Center;
                lbl.TextAlignment = TextAlignment.Left;
                SwitchHolder holder = launchSwitch;
                holder.Sw = new Fx.Switch(true);
                Grid.SetColumn(holder.Sw, 1);
                row.Children.Add(lbl);
                row.Children.Add(holder.Sw);
                cs.Children.Add(row);
            }
            Border btn = Fx.Button("Готово", FinishAndClose);
            btn.Margin = new Thickness(0, install ? 18 : 0, 0, 0);
            cs.Children.Add(btn);
            card.Child = cs;
            page.Children.Add(Fx.Reveal(card, 420, 20));

            primary = FinishAndClose;
            ShowPage(page);
            doneTime = 0;
            SpawnConfetti();
        }

        void FinishAndClose()
        {
            if (session.Mode == SetupMode.Install && launchSwitch.Sw != null && launchSwitch.Sw.IsOn) LaunchApp();
            Close();
        }

        void LaunchApp()
        {
            if (session.Demo) return;
            try
            {
                string exe = System.IO.Path.Combine(session.Dir, Product.ExeName);
                ProcessStartInfo psi = new ProcessStartInfo(exe);
                psi.WorkingDirectory = session.Dir;
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            catch (Exception ex) { Engine.Log("launch: " + ex.Message); }
        }

        void ShowError(string message)
        {
            ui = Ui.Idle;
            working = false;
            closeBtn.Visibility = Visibility.Visible;
            StackPanel page = new StackPanel { Width = 420 };
            page.Children.Add(Brand(60, 24, null, 60));
            Border card = Fx.Card();
            card.Margin = new Thickness(0, 22, 0, 0);
            StackPanel cs = new StackPanel();
            cs.Children.Add(Fx.IconCircle("M12,6.5 L12,13.5 M12,17.2 L12,17.4", Theme.Danger, Theme.DangerSoft));
            cs.Children.Add(Fx.Text(session.Mode == SetupMode.Install ? "Не удалось установить" : "Не удалось удалить", 20, FontWeights.Bold, Theme.Text, 12));
            cs.Children.Add(Fx.Text(message, 14, FontWeights.Normal, Theme.Danger, 8));
            cs.Children.Add(Fx.Text("Подробности: " + Engine.LogPath, 11, FontWeights.Normal, Theme.Hint, 10));
            Border btn = Fx.Button("Закрыть", delegate { Close(); });
            btn.Margin = new Thickness(0, 18, 0, 0);
            cs.Children.Add(btn);
            card.Child = cs;
            page.Children.Add(Fx.Reveal(card, 200, 18));
            primary = delegate { Close(); };
            ShowPage(page);
        }

        // ------------------------------------------------------------------------------------------------------------ work + frames

        void BeginWorker()
        {
            Thread t = new Thread(delegate()
            {
                try
                {
                    ProgressReport rep = delegate(double f, string note)
                    {
                        lock (sync) { if (f > target) target = f; }
                        if (note != null) Engine.Log("  " + note);
                    };
                    if (session.Demo) { for (int i = 1; i <= 100; i++) { Thread.Sleep(40); rep(i / 100.0, null); } }
                    else if (session.Mode == SetupMode.Install) new Engine(session.Payload, session.Dir).Install(rep);
                    else Engine.Uninstall(session.Dir, rep);
                    lock (sync) { target = 1; workDone = true; }
                }
                catch (Exception ex)
                {
                    Engine.Log("ERROR " + ex);
                    lock (sync) { error = ex.Message; }
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        void OnFrame(object sender, EventArgs e)
        {
            DateTime now = DateTime.UtcNow;
            double dt = Math.Min(0.05, (now - lastFrame).TotalSeconds);
            lastFrame = now;
            if (ui == Ui.Progress) FrameProgress(dt);
            else if (ui == Ui.Done) FrameDone(dt);
        }

        void FrameProgress(double dt)
        {
            double tgt; bool done; string err;
            lock (sync) { tgt = target; done = workDone; err = error; }
            if (err != null) { ShowError(err); return; }
            pageTime += dt;

            // catch up smoothly, but never faster than the minimum "show" time - the animation deserves to be seen
            double minSeconds = session.Auto ? 3.5 : (session.Mode == SetupMode.Install ? 7.0 : 4.0);
            double want = Math.Max(0, tgt - shown);
            double ease = want * (1 - Math.Exp(-5 * dt));
            double step = Math.Min(ease, dt / minSeconds);
            if (want > 0 && step < 0.0002) step = Math.Min(want, 0.0002);
            shown = Math.Min(1.0, shown + step);
            UpdateProgressUi();

            if (done && shown >= 0.9985)
            {
                shown = 1;
                UpdateProgressUi();
                if (session.Auto && session.Mode == SetupMode.Install) { working = false; LaunchApp(); Close(); return; }
                ShowDone();
            }
        }

        void UpdateProgressUi()
        {
            if (percent == null) return;
            percent.Text = ((int)Math.Round(shown * 100)).ToString() + "%";

            double w = Math.Max(0, (track.ActualWidth > 0 ? track.ActualWidth : 372) * shown);
            fillHost.Width = w;
            ((RectangleGeometry)fillHost.Clip).Rect = new Rect(0, 0, w, 10);
            if (w > 80)
            {
                double x = (pageTime * 170) % (w - 60 + 60) - 60;
                ((TranslateTransform)shimmer.RenderTransform).X = x;
                shimmer.Visibility = Visibility.Visible;
            }
            else shimmer.Visibility = Visibility.Hidden;

            dashboard.Update(shown, pageTime);

            int idx = 0;
            for (int i = 0; i < phraseAt.Length; i++) if (shown >= phraseAt[i]) idx = i;
            if (idx != phraseIdx)
            {
                phraseIdx = idx;
                string next = phrases[idx];
                DoubleAnimation fadeOut = new DoubleAnimation(phrase.Opacity, 0, Fx.Ms(140));
                fadeOut.Completed += delegate
                {
                    phrase.Text = next;
                    phrase.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, Fx.Ms(260)));
                };
                phrase.BeginAnimation(OpacityProperty, fadeOut);
            }
        }

        void SpawnConfetti()
        {
            uint[] colors = new uint[] { Theme.Primary, Theme.Success, Theme.Warning, Theme.Danger, Theme.Text, 0xFF8ADBFF };
            Random rnd = new Random();
            for (int i = 0; i < 46; i++)
            {
                double ang = (-155 + rnd.NextDouble() * 130) * Math.PI / 180.0;
                double sp = 230 + rnd.NextDouble() * 330;
                Shapes.Rectangle r = new Shapes.Rectangle { Width = 5 + rnd.Next(4), Height = 8 + rnd.Next(6), RadiusX = 1.5, RadiusY = 1.5, Fill = Theme.B(colors[rnd.Next(colors.Length)]), RenderTransformOrigin = new Point(0.5, 0.5) };
                r.RenderTransform = new RotateTransform(0);
                confetti.Children.Add(r);
                particles.Add(new Particle { R = r, X = 0, Y = 0, Vx = Math.Cos(ang) * sp, Vy = Math.Sin(ang) * sp, Rot = rnd.NextDouble() * 360, Vr = (rnd.NextDouble() - 0.5) * 900 });
            }
        }

        void FrameDone(double dt)
        {
            doneTime += dt;
            if (particles.Count == 0) return;
            foreach (Particle p in particles)
            {
                p.Vy += 900 * dt;
                p.Vx *= (1 - 0.6 * dt);
                p.X += p.Vx * dt;
                p.Y += p.Vy * dt;
                p.Rot += p.Vr * dt;
                Canvas.SetLeft(p.R, p.X);
                Canvas.SetTop(p.R, p.Y);
                ((RotateTransform)p.R.RenderTransform).Angle = p.Rot;
                p.R.Opacity = Fx.Clamp01(1.9 - doneTime * 0.9);
            }
            if (doneTime > 2.2)
            {
                confetti.Children.Clear();
                particles.Clear();
            }
        }

        static string Shorten(string s, int max)
        {
            if (s.Length <= max) return s;
            return s.Substring(0, 12) + "…" + s.Substring(s.Length - (max - 13));
        }
    }
}

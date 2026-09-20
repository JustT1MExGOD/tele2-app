// T2 Sales Native - setup: the app's own dark palette (shared/theme/T2Tokens.kt, dark values) and small UI/animation helpers.
using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Reflection;
using Shapes = System.Windows.Shapes;

namespace T2Setup
{
    static class Theme
    {
        // T2Colors (dark)
        public const uint Text = 0xFFF5F5F7;
        public const uint TextSecondary = 0xFFA1A1AA;
        public const uint Hint = 0xFF7E7E87;
        public const uint Primary = 0xFF3BB8F5;
        public const uint PrimarySoft = 0x2E3BB8F5;
        public const uint Success = 0xFF30D158;
        public const uint SuccessSoft = 0x2930D158;
        public const uint Danger = 0xFFFF453A;
        public const uint DangerSoft = 0x29FF453A;
        public const uint Warning = 0xFFFF9F0A;
        public const uint Border = 0x14FFFFFF;
        public const uint Surface2 = 0xFF1C1C1F;
        public const uint Surface3 = 0xFF26262B;
        public const uint Accent = 0xFFFFFFFF;     // dark theme: the accent (primary button) is white ...
        public const uint OnAccent = 0xFF111111;   // ... with near-black text
        public const uint TopGlow = 0xFF0E2230;    // login screen background: #0E2230 fading to black

        public static readonly FontFamily Font = new FontFamily("Segoe UI");

        public static Color C(uint argb)
        {
            return Color.FromArgb((byte)(argb >> 24), (byte)(argb >> 16), (byte)(argb >> 8), (byte)argb);
        }

        public static SolidColorBrush B(uint argb)
        {
            SolidColorBrush b = new SolidColorBrush(C(argb));
            b.Freeze();
            return b;
        }

        public static BitmapImage Image(string resourceName)
        {
            Stream_ s = new Stream_(resourceName);
            return s.Load();
        }

        /// <summary>Embedded PNG resource -> frozen bitmap.</summary>
        sealed class Stream_
        {
            readonly string name;
            public Stream_(string name) { this.name = name; }
            public BitmapImage Load()
            {
                BitmapImage bi = new BitmapImage();
                bi.BeginInit();
                bi.StreamSource = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
                bi.CacheOption = BitmapCacheOption.OnLoad;
                bi.EndInit();
                bi.Freeze();
                return bi;
            }
        }
    }

    static class Fx
    {
        public static Duration Ms(double ms) { return new Duration(TimeSpan.FromMilliseconds(ms)); }

        public static CubicEase EaseOut() { return new CubicEase { EasingMode = EasingMode.EaseOut }; }

        public static double Clamp01(double v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

        public static double EaseOutCubic(double x) { x = Clamp01(x); return 1 - Math.Pow(1 - x, 3); }

        /// <summary>Fade + slide up, staggered by delay: how every block of a page enters.</summary>
        public static T Reveal<T>(T el, double delayMs, double dy = 16) where T : FrameworkElement
        {
            el.Opacity = 0;
            TranslateTransform tt = new TranslateTransform(0, dy);
            el.RenderTransform = tt;
            TimeSpan begin = TimeSpan.FromMilliseconds(delayMs);
            DoubleAnimation fade = new DoubleAnimation(0, 1, Ms(420)) { BeginTime = begin, EasingFunction = EaseOut() };
            DoubleAnimation slide = new DoubleAnimation(dy, 0, Ms(560)) { BeginTime = begin, EasingFunction = EaseOut() };
            el.BeginAnimation(UIElement.OpacityProperty, fade);
            tt.BeginAnimation(TranslateTransform.YProperty, slide);
            return el;
        }

        public static TextBlock Text(string s, double size, FontWeight weight, uint color, double top = 0)
        {
            TextBlock t = new TextBlock();
            t.Text = s;
            t.FontSize = size;
            t.FontWeight = weight;
            t.Foreground = Theme.B(color);
            t.FontFamily = Theme.Font;
            t.TextAlignment = TextAlignment.Center;
            t.TextWrapping = TextWrapping.Wrap;
            t.HorizontalAlignment = HorizontalAlignment.Center;
            t.Margin = new Thickness(0, top, 0, 0);
            return t;
        }

        public static Shapes.Path Icon(string data, uint color, double thickness = 2.2)
        {
            Shapes.Path p = new Shapes.Path();
            p.Data = Geometry.Parse(data);
            p.Stroke = Theme.B(color);
            p.StrokeThickness = thickness;
            p.StrokeStartLineCap = PenLineCap.Round;
            p.StrokeEndLineCap = PenLineCap.Round;
            p.StrokeLineJoin = PenLineJoin.Round;
            p.Stretch = Stretch.Uniform;
            return p;
        }

        /// <summary>The login screen's glass card: 24dp radius, 0x0FFFFFFF -> 0x0A000000 diagonal gradient, hairline border.</summary>
        public static Border Card()
        {
            LinearGradientBrush g = new LinearGradientBrush(Theme.C(0x0FFFFFFF), Theme.C(0x0A000000), new Point(0, 0), new Point(1, 1));
            g.Freeze();
            Border b = new Border();
            b.CornerRadius = new CornerRadius(24);
            b.Background = g;
            b.BorderBrush = Theme.B(Theme.Border);
            b.BorderThickness = new Thickness(1);
            b.Padding = new Thickness(18, 22, 18, 20);
            return b;
        }

        /// <summary>The 64px round icon holder of the login card (primarySoft circle + a vector glyph).</summary>
        public static FrameworkElement IconCircle(string glyph, uint glyphColor, uint circleColor)
        {
            Grid g = new Grid { Width = 64, Height = 64, HorizontalAlignment = HorizontalAlignment.Center };
            g.Children.Add(new Shapes.Ellipse { Fill = Theme.B(circleColor) });
            Shapes.Path icon = Icon(glyph, glyphColor, 2.0);
            icon.Width = 26;
            icon.Height = 26;
            icon.HorizontalAlignment = HorizontalAlignment.Center;
            icon.VerticalAlignment = VerticalAlignment.Center;
            g.Children.Add(icon);
            return g;
        }

        /// <summary>Login-screen MainButton: full width, 14dp radius, white (accent) with dark text; hover + press animations.</summary>
        public static Border Button(string text, Action click, bool primary = true)
        {
            SolidColorBrush bg = new SolidColorBrush(Theme.C(primary ? Theme.Accent : Theme.Surface2));
            Border b = new Border();
            b.Height = 48;
            b.CornerRadius = new CornerRadius(14);
            b.Background = bg;
            b.Cursor = Cursors.Hand;
            b.RenderTransformOrigin = new Point(0.5, 0.5);
            ScaleTransform sc = new ScaleTransform(1, 1);
            b.RenderTransform = sc;
            TextBlock t = Text(text, 16, FontWeights.Bold, primary ? Theme.OnAccent : Theme.Text);
            t.VerticalAlignment = VerticalAlignment.Center;
            b.Child = t;

            Color normal = Theme.C(primary ? Theme.Accent : Theme.Surface2);
            Color hover = Theme.C(primary ? 0xFFE4E4E8 : Theme.Surface3);
            b.MouseEnter += delegate { bg.BeginAnimation(SolidColorBrush.ColorProperty, new ColorAnimation(hover, Ms(140))); };
            b.MouseLeave += delegate { bg.BeginAnimation(SolidColorBrush.ColorProperty, new ColorAnimation(normal, Ms(180))); sc.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(1, Ms(120))); sc.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(1, Ms(120))); };
            b.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e)
            {
                e.Handled = true;
                sc.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(0.97, Ms(90)));
                sc.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(0.97, Ms(90)));
            };
            b.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e)
            {
                e.Handled = true;
                sc.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(1, Ms(120)));
                sc.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(1, Ms(120)));
                if (b.IsMouseOver && click != null) click();
            };
            return b;
        }

        /// <summary>Quiet text button under the main one ("Отмена").</summary>
        public static TextBlock Link(string text, Action click)
        {
            TextBlock t = Text(text, 14, FontWeights.SemiBold, Theme.Hint);
            t.Cursor = Cursors.Hand;
            t.Padding = new Thickness(12, 6, 12, 6);
            t.MouseEnter += delegate { t.Foreground = Theme.B(Theme.Text); };
            t.MouseLeave += delegate { t.Foreground = Theme.B(Theme.Hint); };
            t.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e) { e.Handled = true; };
            t.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e) { e.Handled = true; if (click != null) click(); };
            return t;
        }

        /// <summary>Small rounded label ("Версия 1.0.0").</summary>
        public static Border Chip(string text)
        {
            Border b = new Border();
            b.CornerRadius = new CornerRadius(10);
            b.Background = Theme.B(Theme.Surface2);
            b.Padding = new Thickness(10, 5, 10, 5);
            b.Margin = new Thickness(4, 0, 4, 0);
            TextBlock t = Text(text, 12, FontWeights.SemiBold, Theme.TextSecondary);
            b.Child = t;
            return b;
        }

        /// <summary>iOS-style switch.</summary>
        public sealed class Switch : Border
        {
            readonly Shapes.Ellipse knob;
            readonly SolidColorBrush track;
            bool on;
            public bool IsOn { get { return on; } }

            public Switch(bool initial)
            {
                Width = 46;
                Height = 28;
                CornerRadius = new CornerRadius(14);
                Cursor = Cursors.Hand;
                track = new SolidColorBrush(Theme.C(initial ? Theme.Primary : Theme.Surface3));
                Background = track;
                Canvas c = new Canvas();
                knob = new Shapes.Ellipse { Width = 22, Height = 22, Fill = Brushes.White };
                Canvas.SetTop(knob, 3);
                Canvas.SetLeft(knob, initial ? 21 : 3);
                c.Children.Add(knob);
                Child = c;
                on = initial;
                MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e) { e.Handled = true; Toggle(); };
                MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e) { e.Handled = true; };
            }

            public void Toggle()
            {
                on = !on;
                knob.BeginAnimation(Canvas.LeftProperty, new DoubleAnimation(on ? 21 : 3, Fx.Ms(200)) { EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.35 } });
                track.BeginAnimation(SolidColorBrush.ColorProperty, new ColorAnimation(Theme.C(on ? Theme.Primary : Theme.Surface3), Fx.Ms(200)));
            }
        }
    }
}

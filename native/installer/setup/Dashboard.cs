// T2 Sales Native - setup: the animated "analytics" panel shown while installing.
// Bars (sales per day) rise one after another, the FACT line draws itself, the PLAN is a dashed target line and the FORECAST
// (green, dotted) continues from the current point - all driven by the install progress, so the picture always matches the bar.
using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Shapes = System.Windows.Shapes;

namespace T2Setup
{
    sealed class Dashboard : Border
    {
        public const double W = 348, H = 158;
        const double X0 = 16, X1 = W - 16, BASE = H - 16, TOP = 46;
        const int Bars = 16;

        readonly Canvas canvas = new Canvas();
        readonly Shapes.Rectangle[] bars = new Shapes.Rectangle[Bars];
        readonly double[] barTarget = new double[Bars];
        readonly Shapes.Polyline fact = new Shapes.Polyline();
        readonly Shapes.Polygon area = new Shapes.Polygon();
        readonly Shapes.Polyline forecast = new Shapes.Polyline();
        readonly Shapes.Line plan = new Shapes.Line();
        readonly Shapes.Ellipse dot = new Shapes.Ellipse();
        readonly Shapes.Ellipse ring = new Shapes.Ellipse();

        public Dashboard()
        {
            Width = W;
            Height = H;
            CornerRadius = new CornerRadius(16);
            Background = Theme.B(0x0AFFFFFF);
            BorderBrush = Theme.B(Theme.Border);
            BorderThickness = new Thickness(1);
            HorizontalAlignment = HorizontalAlignment.Center;
            canvas.Width = W - 2;
            canvas.Height = H - 2;
            canvas.ClipToBounds = true;
            Child = canvas;
            Build();
        }

        static double V(double t) { return 0.10 + 0.72 * Math.Pow(t, 1.3) + 0.02 * Math.Sin(t * 17); }

        static double Y(double v) { return BASE - v * (BASE - TOP); }

        static double X(double t) { return X0 + t * (X1 - X0); }

        void Build()
        {
            // faint grid
            for (int i = 0; i < 4; i++)
            {
                double y = TOP + i * (BASE - TOP) / 3.0;
                Shapes.Line g = new Shapes.Line { X1 = X0, X2 = X1, Y1 = y, Y2 = y, Stroke = Theme.B(0x0FFFFFFF), StrokeThickness = 1 };
                canvas.Children.Add(g);
            }

            // bars: sales per day
            double step = (X1 - X0) / (Bars - 1);
            LinearGradientBrush barBrush = new LinearGradientBrush(Theme.C(0x703BB8F5), Theme.C(0x143BB8F5), 90);
            barBrush.Freeze();
            for (int i = 0; i < Bars; i++)
            {
                double h = 0.42 + 0.30 * Math.Sin(i * 0.85 + 0.4) + 0.14 * Math.Sin(i * 2.3);
                barTarget[i] = Math.Max(0.14, h) * (BASE - TOP) * 0.72;
                Shapes.Rectangle r = new Shapes.Rectangle { Width = 9, Height = 0, RadiusX = 3, RadiusY = 3, Fill = barBrush };
                Canvas.SetLeft(r, X0 + i * step - 4.5);
                Canvas.SetTop(r, BASE);
                bars[i] = r;
                canvas.Children.Add(r);
            }

            // plan: dashed target line
            plan.X1 = X(0); plan.Y1 = Y(0.10); plan.X2 = X(1); plan.Y2 = Y(0.80);
            plan.Stroke = Theme.B(0xFF7E7E87);
            plan.StrokeThickness = 1.6;
            plan.StrokeDashArray = new DoubleCollection(new double[] { 3.5, 3.5 });
            plan.Opacity = 0;
            canvas.Children.Add(plan);

            // fact: area + line
            LinearGradientBrush areaBrush = new LinearGradientBrush(Theme.C(0x483BB8F5), Theme.C(0x003BB8F5), 90);
            areaBrush.Freeze();
            area.Fill = areaBrush;
            canvas.Children.Add(area);
            fact.Stroke = Theme.B(Theme.Primary);
            fact.StrokeThickness = 3;
            fact.StrokeLineJoin = PenLineJoin.Round;
            fact.StrokeStartLineCap = PenLineCap.Round;
            fact.StrokeEndLineCap = PenLineCap.Round;
            canvas.Children.Add(fact);

            // forecast: dotted green continuation
            forecast.Stroke = Theme.B(Theme.Success);
            forecast.StrokeThickness = 3;
            forecast.StrokeDashArray = new DoubleCollection(new double[] { 0.1, 2.2 });
            forecast.StrokeDashCap = PenLineCap.Round;
            forecast.StrokeLineJoin = PenLineJoin.Round;
            forecast.Opacity = 0;
            canvas.Children.Add(forecast);

            // the moving point with a pulse ring
            ring.Width = 12; ring.Height = 12;
            ring.Stroke = Theme.B(Theme.Primary);
            ring.StrokeThickness = 1.5;
            ring.RenderTransformOrigin = new Point(0.5, 0.5);
            ring.RenderTransform = new ScaleTransform(1, 1);
            canvas.Children.Add(ring);
            dot.Width = 10; dot.Height = 10;
            dot.Fill = Brushes.White;
            dot.Stroke = Theme.B(Theme.Primary);
            dot.StrokeThickness = 2.5;
            canvas.Children.Add(dot);

            // legend
            AddLegend(16, "Факт", Theme.Primary, false);
            AddLegend(84, "План", 0xFF7E7E87, true);
            AddLegend(148, "Прогноз", Theme.Success, false);
        }

        void AddLegend(double x, string text, uint color, bool dashed)
        {
            if (dashed)
            {
                Shapes.Line l = new Shapes.Line { X1 = 0, X2 = 12, Y1 = 0, Y2 = 0, Stroke = Theme.B(color), StrokeThickness = 2, StrokeDashArray = new DoubleCollection(new double[] { 1.5, 1.5 }) };
                Canvas.SetLeft(l, x); Canvas.SetTop(l, 17);
                canvas.Children.Add(l);
            }
            else
            {
                Shapes.Ellipse e = new Shapes.Ellipse { Width = 8, Height = 8, Fill = Theme.B(color) };
                Canvas.SetLeft(e, x + 2); Canvas.SetTop(e, 13);
                canvas.Children.Add(e);
            }
            TextBlock t = Fx.Text(text, 11.5, FontWeights.SemiBold, Theme.TextSecondary);
            Canvas.SetLeft(t, x + 17);
            Canvas.SetTop(t, 8);
            canvas.Children.Add(t);
        }

        /// <summary>p = install progress 0..1, time = seconds since the page appeared (for the pulse).</summary>
        public void Update(double p, double time)
        {
            p = Fx.Clamp01(p);

            for (int i = 0; i < Bars; i++)
            {
                double k = Fx.EaseOutCubic((p * 1.15 - (i / (double)Bars) * 0.85) / 0.25);
                double h = barTarget[i] * k;
                bars[i].Height = Math.Max(0, h);
                Canvas.SetTop(bars[i], BASE - h);
            }

            plan.Opacity = Fx.Clamp01(p / 0.12) * 0.9;

            // fact line grows with progress
            int n = 2 + (int)(p * 90);
            System.Windows.Media.PointCollection pts = new System.Windows.Media.PointCollection();
            for (int k = 0; k <= n; k++)
            {
                double t = p * k / n;
                pts.Add(new Point(X(t), Y(V(t))));
            }
            fact.Points = pts;
            System.Windows.Media.PointCollection ap = new System.Windows.Media.PointCollection();
            foreach (Point q in pts) ap.Add(q);
            ap.Add(new Point(X(p), BASE));
            ap.Add(new Point(X(0), BASE));
            area.Points = ap;

            double px = X(p), py = Y(V(p));
            Canvas.SetLeft(dot, px - 5); Canvas.SetTop(dot, py - 5);
            Canvas.SetLeft(ring, px - 6); Canvas.SetTop(ring, py - 6);
            double phase = (time * 1.3) % 1.0;
            ScaleTransform st = (ScaleTransform)ring.RenderTransform;
            st.ScaleX = st.ScaleY = 1 + phase * 1.9;
            ring.Opacity = 0.55 * (1 - phase);
            dot.Opacity = p > 0.995 ? 0 : 1;
            ring.Visibility = p > 0.995 ? Visibility.Hidden : Visibility.Visible;

            // forecast: from the current point to a target slightly above the plan
            if (p > 0.40 && p < 0.995)
            {
                System.Windows.Media.PointCollection fp = new System.Windows.Media.PointCollection();
                double v0 = V(p);
                for (int k = 0; k <= 26; k++)
                {
                    double t = p + (1 - p) * k / 26.0;
                    double v = v0 + (0.92 - v0) * Math.Pow((t - p) / (1 - p), 0.9);
                    fp.Add(new Point(X(t), Y(v)));
                }
                forecast.Points = fp;
                forecast.Opacity = Fx.Clamp01((p - 0.40) / 0.15);
            }
            else
            {
                forecast.Opacity = 0;
            }
        }
    }
}

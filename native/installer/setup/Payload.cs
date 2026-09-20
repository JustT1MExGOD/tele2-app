// T2 Sales Native - setup: file format.
//
// The installer is ONE .exe:   [ stub (this program) ][ payload.zip ][ meta text ][ 32-byte trailer ]
// trailer = "T2SETUP1" + int64 payloadStart + int64 payloadLength + int64 metaLength.
// The uninstaller is a copy of the stub alone (first payloadStart bytes) - no trailer, so it starts in "uninstall" mode.
//
// C# 5 only (the compiler that ships with Windows): no string interpolation, no ?., no expression-bodied members.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace T2Setup
{
    sealed class Payload
    {
        public const string Magic = "T2SETUP1";
        public const int TrailerSize = 32;

        public string ExePath;
        public long Start;      // where payload.zip begins == length of the stub
        public long Length;     // payload.zip length
        public string Version = "0.0.0";
        public string Name = "T2 Sales Native";
        public string ExeName = "T2 Sales Native.exe";

        static void ReadFully(Stream s, byte[] buf)
        {
            int off = 0;
            while (off < buf.Length)
            {
                int n = s.Read(buf, off, buf.Length - off);
                if (n <= 0) throw new EndOfStreamException();
                off += n;
            }
        }

        /// <summary>null when this exe carries no payload (=> it is the uninstaller / a bare stub).</summary>
        public static Payload TryOpen(string exePath)
        {
            try
            {
                using (FileStream fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    if (fs.Length < TrailerSize) return null;
                    fs.Seek(-TrailerSize, SeekOrigin.End);
                    byte[] t = new byte[TrailerSize];
                    ReadFully(fs, t);
                    if (Encoding.ASCII.GetString(t, 0, 8) != Magic) return null;
                    long start = BitConverter.ToInt64(t, 8);
                    long len = BitConverter.ToInt64(t, 16);
                    long metaLen = BitConverter.ToInt64(t, 24);
                    if (start <= 0 || len <= 0 || metaLen < 0 || start + len + metaLen + TrailerSize != fs.Length) return null;

                    fs.Seek(start + len, SeekOrigin.Begin);
                    byte[] m = new byte[metaLen];
                    ReadFully(fs, m);

                    Payload p = new Payload();
                    p.ExePath = exePath;
                    p.Start = start;
                    p.Length = len;
                    foreach (string raw in Encoding.UTF8.GetString(m).Split('\n'))
                    {
                        string line = raw.Trim();
                        int i = line.IndexOf('=');
                        if (i <= 0) continue;
                        string k = line.Substring(0, i), v = line.Substring(i + 1);
                        if (k == "version") p.Version = v;
                        else if (k == "name") p.Name = v;
                        else if (k == "exe") p.ExeName = v;
                    }
                    return p;
                }
            }
            catch (Exception)
            {
                return null;
            }
        }

        public Stream OpenZip()
        {
            FileStream fs = new FileStream(ExePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            return new SubStream(fs, Start, Length);
        }
    }

    /// <summary>A read-only seekable window over a part of another stream (ZipArchive needs a seekable stream).</summary>
    sealed class SubStream : Stream
    {
        readonly Stream inner;
        readonly long start, length;
        long pos;

        public SubStream(Stream inner, long start, long length) { this.inner = inner; this.start = start; this.length = length; }

        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return length; } }
        public override long Position { get { return pos; } set { pos = value; } }
        public override void Flush() { }

        public override int Read(byte[] buffer, int offset, int count)
        {
            long remaining = length - pos;
            if (remaining <= 0) return 0;
            inner.Position = start + pos;
            int n = inner.Read(buffer, offset, (int)Math.Min((long)count, remaining));
            pos += n;
            return n;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            long np = origin == SeekOrigin.Begin ? offset : origin == SeekOrigin.Current ? pos + offset : length + offset;
            if (np < 0) throw new IOException("seek before start");
            pos = np;
            return pos;
        }

        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }

        protected override void Dispose(bool disposing)
        {
            if (disposing) inner.Dispose();
            base.Dispose(disposing);
        }
    }
}

#!/usr/bin/env bash
# Compiles the setup stub with the C# compiler that ships with Windows (no SDK needed). Usage: build-stub.sh <out.exe>
set -euo pipefail
OUT="${1:?output path}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FW='C:\Windows\Microsoft.NET\Framework64\v4.0.30319'
cd "$HERE"
MSYS_NO_PATHCONV=1 "/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:winexe /optimize+ /warn:4 \
  "/out:$OUT" /win32icon:icon.ico /win32manifest:app.manifest \
  "/r:$FW\WPF\PresentationCore.dll" "/r:$FW\WPF\PresentationFramework.dll" "/r:$FW\WPF\WindowsBase.dll" "/r:$FW\System.Xaml.dll" \
  "/r:$FW\System.IO.Compression.dll" "/r:$FW\System.IO.Compression.FileSystem.dll" \
  /resource:melon.png,melon.png /resource:icon.png,icon.png \
  Program.cs Payload.cs Engine.cs Theme.cs Dashboard.cs SetupWindow.cs

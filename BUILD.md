# ⚡ VELLE.AI — Building the .exe

## Option 1: Quick Launch (No Build Needed)

### Batch file (double-click)
```
start.bat
```
This auto-checks Node.js, starts Ollama, installs deps, and opens the browser.

### PowerShell (more features)
```powershell
powershell -ExecutionPolicy Bypass -File start.ps1
```

---

## Option 2: Electron .exe (Full Desktop App)

This creates a proper Windows application with:
- ⚡ Custom icon in taskbar
- 🔲 Native window (no browser needed)
- 📌 System tray (minimize to tray, right-click menu)
- 🔒 Single instance lock
- 🚀 Auto-starts the server

### Prerequisites
- Node.js 18+
- Ollama installed and running

### Steps

```powershell
# 1. Copy the electron package.json
copy package-electron.json package.json

# 2. Install all dependencies (including Electron)
npm install

# 3. Test it works
npm run electron

# 4. Build portable .exe (no install needed, single file)
npm run build:portable

# 5. OR build installer .exe
npm run build:installer
```

### Output
After building, find your .exe in:
```
dist/
├── VELLE-AI-1.0.0-portable.exe    ← Portable (single file, ~150MB)
└── VELLE-AI-1.0.0-setup.exe       ← Installer
```

### Notes

- The portable .exe bundles Node.js + your code + Electron. ~150MB.
- **Ollama must be installed separately** — the .exe doesn't bundle it.
- The .exe runs the Express server internally and opens a Chromium window.
- Closing the window minimizes to system tray. Right-click tray icon to quit.
- Database (`companion.db`) lives in `memory/` alongside the .exe.

### Troubleshooting

**"better-sqlite3 rebuild" errors:**
```powershell
npx electron-rebuild -f -w better-sqlite3
```

**"Cannot find module" errors:**
Make sure you used `package-electron.json` as your `package.json`.

**Antivirus flags the .exe:**
Electron apps get flagged sometimes. Add an exception for the build output.

---

## Option 3: Shortcut with Icon

If you just want a desktop shortcut with the VELLE.AI icon:

1. Right-click desktop → New → Shortcut
2. Target: `powershell -ExecutionPolicy Bypass -File "C:\path\to\velle-ai\start.ps1"`
3. Start in: `C:\path\to\velle-ai\`
4. Click "Change Icon" → browse to `public\assets\icon.ico`
5. Name it "VELLE.AI"

This gives you a clickable icon without the Electron overhead.

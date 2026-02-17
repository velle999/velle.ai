// ⚡ VELLE.AI — Electron Wrapper
// Build: npx electron-builder --win

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let serverInstance = null;  // Store Express server for cleanup
let dbInstance = null;      // Store Database for cleanup

const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || 'qwen3:8b';
const SERVER_URL = `http://localhost:${PORT}`;

// Set env vars before server starts
process.env.PORT = String(PORT);
process.env.MODEL = MODEL;
process.env.ELECTRON = '1';

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

async function startServer() {
  const serverPath = path.join(app.getAppPath(), 'server', 'index.js');
  console.log('[VELLE.AI] Loading server from:', serverPath);

  try {
    const fileUrl = 'file:///' + serverPath.replace(/\\/g, '/');
    const serverModule = await import(fileUrl);
    
    // Capture exported server and db instances for cleanup
    serverInstance = serverModule.serverInstance || null;
    dbInstance = serverModule.dbInstance || null;
    
    console.log('[VELLE.AI] Server loaded');
  } catch (err) {
    console.error('[VELLE.AI] Server failed to start:', err.message);
    console.error(err.stack);
  }
}

function getIconPath() {
  const fs = require('fs');
  const base = app.getAppPath();
  const candidates = [
    path.join(base, 'assets', 'icon.png'),
    path.join(base, 'public', 'assets', 'icon.png'),
  ];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'assets', 'icon.png'));
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function createWindow() {
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    title: 'VELLE.AI',
    backgroundColor: '#0a0a1a',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const loadWithRetry = (retries = 10) => {
    mainWindow.loadURL(SERVER_URL).catch(() => {
      if (retries > 0) {
        setTimeout(() => loadWithRetry(retries - 1), 1000);
      }
    });
  };
  loadWithRetry();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = getIconPath();
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('VELLE.AI');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open VELLE.AI',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createWindow();
      },
    },
    {
      label: 'Open in Browser',
      click: () => shell.openExternal(SERVER_URL),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
    } else createWindow();
  });
}

// ── GRACEFUL SHUTDOWN ──
async function cleanupAndQuit() {
  console.log('[VELLE.AI] Shutting down...');

  // 1. Close Express server
  if (serverInstance) {
    await new Promise((resolve) => {
      serverInstance.close(() => {
        console.log('[VELLE.AI] HTTP server closed');
        resolve();
      });
    });
  }

  // 2. Close SQLite database
  if (dbInstance && typeof dbInstance.close === 'function') {
    try {
      dbInstance.close();
      console.log('[VELLE.AI] Database closed');
    } catch (err) {
      console.error('[VELLE.AI] Database close error:', err.message);
    }
  }

  // 3. Destroy tray
  if (tray) {
    tray.destroy();
    tray = null;
  }

  // 4. Nullify window
  mainWindow = null;

  // 5. Force quit
  app.quit();
}

// Register shutdown handlers
app.on('before-quit', (e) => {
  e.preventDefault();
  cleanupAndQuit();
});

process.on('SIGINT', () => cleanupAndQuit());
process.on('SIGTERM', () => cleanupAndQuit());

// ── APP LIFECYCLE ──
app.whenReady().then(async () => {
  console.log('[VELLE.AI] App path:', app.getAppPath());
  console.log('[VELLE.AI] Packaged:', app.isPackaged);

  await startServer();
  await new Promise(r => setTimeout(r, 1500));

  createWindow();
  createTray();
});

app.on('window-all-closed', () => { /* stay in tray */ });
app.on('activate', () => { if (!mainWindow) createWindow(); });
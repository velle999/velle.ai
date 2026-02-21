// ⚡ VELLE.AI — Electron Wrapper
// Build: npx electron-builder --win

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification: ElectronNotification } = require('electron');
const path = require('path');

const { ipcMain } = require('electron');

let mainWindow = null;
let tray = null;

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

let serverModule = null;

async function startServer() {
  const serverPath = path.join(app.getAppPath(), 'server', 'index.js');
  console.log('[VELLE.AI] Loading server from:', serverPath);

  try {
    const fileUrl = 'file:///' + serverPath.replace(/\\/g, '/');
    serverModule = await import(fileUrl);

    if (serverModule?.default?.start) {
      await serverModule.default.start();
    }

    console.log('[VELLE.AI] Server module loaded OK');
  } catch (err) {
    console.error('[VELLE.AI] Server failed to start:', err.message);
    console.error(err.stack);
  }
}
async function waitForServer(url, timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}

    await new Promise(r => setTimeout(r, 500));
  }

  return false;
}

function getIconPath() {
  const fs = require('fs');
  const base = app.getAppPath();
  const candidates = [
    path.join(base, 'assets', 'icon.png'),
    path.join(base, 'public', 'assets', 'icon.png'),
  ];
  // Also check unpacked resources
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
      preload: path.join(app.getAppPath(), 'preload.cjs'),
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

  mainWindow.on('close', () => {
    app.exit(0);
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
      click: () => {
        app.exit(0);
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
    } else createWindow();
  });
}

app.whenReady().then(async () => {
  console.log('[VELLE.AI] App path:', app.getAppPath());
  console.log('[VELLE.AI] Packaged:', app.isPackaged);

  // Handle native notification requests from renderer
  ipcMain.on('show-notification', (event, { title, body }) => {
    const iconPath = getIconPath();
    const notif = new ElectronNotification({
      title: title || 'VELLE.AI',
      body: body || '',
      icon: iconPath,
      urgency: 'critical',
    });
    notif.on('click', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
    notif.show();
  });

  await startServer();

  // Give server a moment to bind
  await new Promise(r => setTimeout(r, 1500));

  createWindow();
  createTray();
});

app.on('window-all-closed', () => { app.exit(0); });

app.on('before-quit', () => { app.exit(0); });

app.on('activate', () => { if (!mainWindow) createWindow(); });

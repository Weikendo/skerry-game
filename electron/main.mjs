// Skerry as a desktop app: an Electron window that loads the built game (dist/) from inside the
// app under its own address app://skerry/, so neither a web server nor localhost is needed.
// The fixed address keeps the saves (localStorage) in one place from version to version.
import { app, BrowserWindow, Menu, net, protocol } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.join(here, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveGame() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(GAME, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    // nothing outside the game's folder
    if (!file.startsWith(GAME + path.sep)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  // the system's language, as macOS gives it to the standard menus (the game picks its own in its main menu)
  const de = app.getLocale().startsWith('de');
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    // copy and paste in the save names
    { role: 'editMenu' },
    {
      label: de ? 'Ansicht' : 'View',
      submenu: [
        { role: 'togglefullscreen', label: de ? 'Vollbild' : 'Full Screen', accelerator: mac ? 'Ctrl+Cmd+F' : 'F11' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: de ? 'Entwicklerwerkzeuge' : 'Developer Tools' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

function openWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b2433',
    title: 'Skerry',
    icon: path.join(here, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      // the title music may start without a click first
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // it always starts in full screen (Ansicht → Vollbild or Ctrl+Cmd+F leaves it; Esc stays the game's menu key)
  win.once('ready-to-show', () => { win.show(); win.setFullScreen(true); });
  void win.loadURL('app://skerry/index.html');
}

app.whenReady().then(() => {
  serveGame();
  buildMenu();
  openWindow();
});

// a game: closing its window ends it, on the Mac too
app.on('window-all-closed', () => app.quit());

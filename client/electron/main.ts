import { app, BrowserWindow, desktopCapturer, session, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

// Disable buggy Windows Graphics Capture (WGC) to prevent hr: -2147024891 E_ACCESSDENIED errors.
// This forces Electron/WebRTC to fallback to the stable DXGI screen capture engine.
app.commandLine.appendSwitch('disable-features', 'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer');

// Support multiple isolated sessions by providing a custom user data directory via env var
const userDataPath = process.env.HARMONY_USER_DATA_DIR;
if (userDataPath) {
    const absolutePath = path.isAbsolute(userDataPath) 
        ? userDataPath 
        : path.join(process.cwd(), userDataPath);
    app.setPath('userData', absolutePath);
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'Harmony',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });

    // Hide context menu in production
    if (!isDev) {
        win.removeMenu();
    }

    if (isDev) {
        win.loadURL('http://localhost:5173');
    } else {
        // Vite builds to 'dist', Electron runs from 'dist-electron'
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Intercept target="_blank" links and open them in the user's default external browser
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
}

app.whenReady().then(() => {
    // Handle screen share requests natively in Electron
    ipcMain.handle('get-desktop-sources', async () => {
        try {
            const sources = await desktopCapturer.getSources({ types: ['screen'] });
            return sources.map(s => ({ id: s.id, name: s.name }));
        } catch (e) {
            console.error("Failed to get sources", e);
            return [];
        }
    });

    createWindow();
});



app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

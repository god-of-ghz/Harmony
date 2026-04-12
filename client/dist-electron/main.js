import { app, session, ipcMain, desktopCapturer, BrowserWindow, shell } from "electron";
import path from "path";
import { fileURLToPath } from "url";
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
const isDev = process.env.NODE_ENV === "development";
app.commandLine.appendSwitch("disable-features", "WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer");
const userDataPath = process.env.HARMONY_USER_DATA_DIR;
if (userDataPath) {
  const absolutePath = path.isAbsolute(userDataPath) ? userDataPath : path.join(process.cwd(), userDataPath);
  app.setPath("userData", absolutePath);
}
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Harmony",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });
  if (!isDev) {
    win.removeMenu();
  }
  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname$1, "../dist/index.html"));
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
}
app.whenReady().then(() => {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const hostname = request.hostname;
    const isLocalNetwork = hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.") || hostname.startsWith("10.") || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
    if (isLocalNetwork) {
      callback(0);
    } else {
      callback(-3);
    }
  });
  ipcMain.handle("get-desktop-sources", async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      return sources.map((s) => ({ id: s.id, name: s.name }));
    } catch (e) {
      console.error("Failed to get sources", e);
      return [];
    }
  });
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

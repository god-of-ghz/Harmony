import { app as o, ipcMain as c, desktopCapturer as l, BrowserWindow as a, shell as d } from "electron";
import r from "path";
import { fileURLToPath as p } from "url";
const h = p(import.meta.url), w = r.dirname(h), s = process.env.NODE_ENV === "development";
o.commandLine.appendSwitch("disable-features", "WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer");
const n = process.env.HARMONY_USER_DATA_DIR;
if (n) {
  const e = r.isAbsolute(n) ? n : r.join(process.cwd(), n);
  o.setPath("userData", e);
}
function i() {
  const e = new a({
    width: 1200,
    height: 800,
    title: "Harmony",
    webPreferences: {
      nodeIntegration: !0,
      contextIsolation: !1,
      webSecurity: !1
    }
  });
  s || e.removeMenu(), s ? e.loadURL("http://localhost:5173") : e.loadFile(r.join(w, "../dist/index.html")), e.webContents.setWindowOpenHandler(({ url: t }) => t.startsWith("http://") || t.startsWith("https://") ? (d.openExternal(t), { action: "deny" }) : { action: "allow" });
}
o.whenReady().then(() => {
  c.handle("get-desktop-sources", async () => {
    try {
      return (await l.getSources({ types: ["screen"] })).map((t) => ({ id: t.id, name: t.name }));
    } catch (e) {
      return console.error("Failed to get sources", e), [];
    }
  }), i();
});
o.on("window-all-closed", () => {
  process.platform !== "darwin" && o.quit();
});
o.on("activate", () => {
  a.getAllWindows().length === 0 && i();
});

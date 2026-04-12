import { app as o, session as d, ipcMain as p, desktopCapturer as h, BrowserWindow as i, shell as m } from "electron";
import r from "path";
import { fileURLToPath as w } from "url";
const u = w(import.meta.url), f = r.dirname(u), a = process.env.NODE_ENV === "development";
o.commandLine.appendSwitch("disable-features", "WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer");
const n = process.env.HARMONY_USER_DATA_DIR;
if (n) {
  const e = r.isAbsolute(n) ? n : r.join(process.cwd(), n);
  o.setPath("userData", e);
}
function c() {
  const e = new i({
    width: 1200,
    height: 800,
    title: "Harmony",
    webPreferences: {
      nodeIntegration: !0,
      contextIsolation: !1,
      webSecurity: !1
    }
  });
  a || e.removeMenu(), a ? e.loadURL("http://localhost:5173") : e.loadFile(r.join(f, "../dist/index.html")), e.webContents.setWindowOpenHandler(({ url: t }) => t.startsWith("http://") || t.startsWith("https://") ? (m.openExternal(t), { action: "deny" }) : { action: "allow" });
}
o.whenReady().then(() => {
  d.defaultSession.setCertificateVerifyProc((e, t) => {
    const s = e.hostname, l = s === "localhost" || s === "127.0.0.1" || s.startsWith("192.168.") || s.startsWith("10.") || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(s);
    t(l ? 0 : -3);
  }), p.handle("get-desktop-sources", async () => {
    try {
      return (await h.getSources({ types: ["screen"] })).map((t) => ({ id: t.id, name: t.name }));
    } catch (e) {
      return console.error("Failed to get sources", e), [];
    }
  }), c();
});
o.on("window-all-closed", () => {
  process.platform !== "darwin" && o.quit();
});
o.on("activate", () => {
  i.getAllWindows().length === 0 && c();
});

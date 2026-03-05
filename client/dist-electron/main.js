import { app as e, BrowserWindow as n } from "electron";
import i from "path";
import { fileURLToPath as a } from "url";
const l = a(import.meta.url), s = i.dirname(l), t = process.env.NODE_ENV === "development";
function r() {
  const o = new n({
    width: 1200,
    height: 800,
    title: "Harmony",
    webPreferences: {
      nodeIntegration: !0,
      contextIsolation: !1,
      webSecurity: !1
    }
  });
  t || o.removeMenu(), t ? o.loadURL("http://localhost:5173") : o.loadFile(i.join(s, "../dist/index.html"));
}
e.whenReady().then(r);
e.on("window-all-closed", () => {
  process.platform !== "darwin" && e.quit();
});
e.on("activate", () => {
  n.getAllWindows().length === 0 && r();
});

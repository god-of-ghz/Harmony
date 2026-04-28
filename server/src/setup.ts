import fs from 'fs';
import path from 'path';
import os from 'os';

// NOTE: Do NOT set NODE_TLS_REJECT_UNAUTHORIZED here.
// Server-to-server (federation) fetch calls use a scoped HTTPS agent via
// src/utils/federationFetch.ts which handles self-signed certs in dev
// without poisoning TLS verification for the entire Node.js process.

if ((process as any).pkg) {
  try {
    const workerBin = path.join(__dirname, '../node_modules/mediasoup/worker/out/Release/mediasoup-worker.exe');
    const tempBin = path.join(os.tmpdir(), 'harmony-mediasoup-worker.exe');
    if (!fs.existsSync(tempBin)) {
      fs.copyFileSync(workerBin, tempBin);
    }
    process.env.MEDIASOUP_WORKER_BIN = tempBin;
  } catch (e) {
    console.warn("Failed to extract mediasoup worker from pkg context:", e);
  }
}

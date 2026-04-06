import fs from 'fs';
import path from 'path';
import os from 'os';

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

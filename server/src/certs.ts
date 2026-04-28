/**
 * Certificate Management — Mode C Only (Self-Signed / Local Dev)
 *
 * TODO [VISION:Beta] Only Mode C is implemented (self-signed cert generation).
 * The vision (HARMONY_VISION.md) defines three first-class cert modes:
 *   Mode A — Automated (Let's Encrypt / ACME via `acme-client` npm package)
 *   Mode B — User-Provided Certificate (upload cert.pem + key.pem)
 *   Mode C — Local Only / Self-Signed (this file) ← CURRENT
 * Modes A and B are Beta features. They also tie into the first-run setup wizard
 * (not yet built). Do NOT attempt during alpha stabilization.
 */
import fs from 'fs';
import path from 'path';
import selfsigned from 'selfsigned';

export async function getOrGenerateCerts(): Promise<{ key: string | Buffer, cert: string | Buffer } | null> {
    const keyPath = path.join(process.cwd(), 'key.pem');
    const certPath = path.join(process.cwd(), 'cert.pem');

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
    }

    try {
        console.log("Generating self-signed certificates for HTTPS...");
        const attrs = [{ name: 'commonName', value: 'localhost' }];
        const pems = await selfsigned.generate(attrs, {
            keySize: 2048,
            algorithm: 'sha256',
            extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }]
        });

        fs.writeFileSync(keyPath, pems.private);
        fs.writeFileSync(certPath, pems.cert);
        
        console.log("Certificates generated successfully.");

        return {
            key: pems.private,
            cert: pems.cert
        };
    } catch (err) {
        console.error("Failed to generate self-signed certificates:", err);
        return null;
    }
}

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

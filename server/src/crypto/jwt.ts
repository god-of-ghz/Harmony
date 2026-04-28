import crypto from 'crypto';

function base64url(buf: Buffer | string) {
    if (typeof buf === 'string') buf = Buffer.from(buf, 'utf8');
    return buf.toString('base64url').replace(/=/g, '');
}

export function sign(payload: any, privateKeyPem: string | crypto.KeyObject, options: { algorithm: string, expiresIn: string | number, issuer?: string }) {
    const header = { alg: options.algorithm, typ: 'JWT' };
    
    let expiresInSec = 3600;
    if (typeof options.expiresIn === 'string') {
        if (options.expiresIn.endsWith('d')) {
            expiresInSec = parseInt(options.expiresIn) * 24 * 60 * 60;
        } else if (options.expiresIn.endsWith('h')) {
            expiresInSec = parseInt(options.expiresIn) * 60 * 60;
        } else {
            expiresInSec = parseInt(options.expiresIn);
        }
    } else {
        expiresInSec = options.expiresIn;
    }
    
    const payloadWithClaims = {
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + expiresInSec
    };
    if (options.issuer) {
        payloadWithClaims.iss = options.issuer;
    }
    const headerStr = base64url(JSON.stringify(header));
    const payloadStr = base64url(JSON.stringify(payloadWithClaims));
    
    const signInput = `${headerStr}.${payloadStr}`;
    const signature = crypto.sign(null, Buffer.from(signInput, 'utf8'), privateKeyPem);
    
    return `${signInput}.${base64url(signature)}`;
}

export function verify(token: string, publicKeyPem: string | crypto.KeyObject, options?: { algorithms?: string[] }) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');
    const [headerStr, payloadStr, signatureStr] = parts;
    const signInput = `${headerStr}.${payloadStr}`;
    
    // Convert base64url to base64 buffer properly
    let sigBase64 = signatureStr.replace(/-/g, '+').replace(/_/g, '/');
    while (sigBase64.length % 4) {
        sigBase64 += '=';
    }
    const signature = Buffer.from(sigBase64, 'base64');
    
    const isValid = crypto.verify(null, Buffer.from(signInput, 'utf8'), publicKeyPem, signature);
    if (!isValid) {
        console.error("DEBUG [jwt.ts] Verify failed!");
        console.error("  signInput: ", signInput);
        console.error("  signature hex: ", signature.toString('hex'));
        throw new Error('Invalid token signature');
    }
    
    let payloadJson;
    try {
        let payloadBase64 = payloadStr.replace(/-/g, '+').replace(/_/g, '/');
        while (payloadBase64.length % 4) {
            payloadBase64 += '=';
        }
        payloadJson = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    } catch (e) {
        throw new Error('Invalid payload JSON');
    }
    
    if (payloadJson.exp && payloadJson.exp < Date.now() / 1000) throw new Error('Token expired');
    return payloadJson;
}

export function decode(token: string, options?: any) {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        let hBase64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
        while (hBase64.length % 4) hBase64 += '=';
        let pBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (pBase64.length % 4) pBase64 += '=';
        
        return {
            header: JSON.parse(Buffer.from(hBase64, 'base64').toString('utf8')),
            payload: JSON.parse(Buffer.from(pBase64, 'base64').toString('utf8')),
            signature: parts[2]
        };
    } catch {
        return null;
    }
}

export default { sign, verify, decode };

import crypto from 'crypto';

export const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
export const TOKEN_EXPIRY = '30d';

import { Router } from 'express';
import express from 'express';
import path from 'path';
import { DATA_DIR } from '../database';

const router = Router();

// Base directories for static assets
// P18 FIX: was 'servers' — data dir is now 'guilds'
const serversBase = path.join(DATA_DIR, 'guilds');
const globalAvatarsBase = path.join(DATA_DIR, 'avatars');

// Static serving for attachments
router.use('/uploads/:guildId', (req, res, next) => {
    const guildId = req.params.guildId || (req.params as any).serverId;

    const requestedDir = path.join(serversBase, guildId, 'uploads');
    const resolvedDir = path.resolve(requestedDir);

    // Path Traversal Mitigation: Ensure the resolved path stays within the base directory
    if (!resolvedDir.startsWith(path.resolve(serversBase))) {
        return res.status(403).json({ error: 'Access denied: Invalid path traversal attempt in guildId' });
    }

    // Apply strict security headers to satisfy Phase 4 requirements
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Force PDF downloads rather than inline rendering to prevent XSS-in-PDF
    if (req.path.toLowerCase().endsWith('.pdf')) {
        res.setHeader('Content-Disposition', 'attachment');
    }

    express.static(resolvedDir)(req, res, next);
});

// Static serving for global avatars
router.use('/avatars', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    express.static(globalAvatarsBase)(req, res, next);
});

// Static serving for server-specific avatars
router.use('/servers/:guildId/avatars', (req, res, next) => {
    const guildId = req.params.guildId || (req.params as any).serverId;
    
    const requestedDir = path.join(serversBase, guildId, 'avatars');
    const resolvedDir = path.resolve(requestedDir);

    if (!resolvedDir.startsWith(path.resolve(serversBase))) {
        return res.status(403).json({ error: 'Access denied: Invalid path traversal attempt in guildId' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    express.static(resolvedDir)(req, res, next);
});

export default router;

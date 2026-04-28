import { WebSocket, WebSocketServer } from 'ws';
import jwt from './crypto/jwt';
import { getServerIdentity, fetchRemotePublicKey } from './crypto/pki';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PresenceData {
    accountId: string;
    status: 'online' | 'idle' | 'dnd' | 'offline';
    lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Global in-memory maps
// ---------------------------------------------------------------------------

/** accountId → presence info */
const presenceMap = new Map<string, PresenceData>();

/** ws → accountId */
const socketAccountMap = new Map<WebSocket, string>();

/** ws → set of guild IDs the connection is subscribed to */
const socketGuildMap = new Map<WebSocket, Set<string>>();

/** guild ID → set of WebSocket connections subscribed to it */
const guildSocketMap = new Map<string, Set<WebSocket>>();

// ---------------------------------------------------------------------------
// Public accessors (read-only snapshots for tests / diagnostics)
// ---------------------------------------------------------------------------

export const getGlobalPresence = () => Array.from(presenceMap.values());

export const getSocketGuildMap = () => socketGuildMap;
export const getGuildSocketMap = () => guildSocketMap;
export const getSocketAccountMap = () => socketAccountMap;

// ---------------------------------------------------------------------------
// Scoped broadcast factory
// ---------------------------------------------------------------------------

/**
 * Creates a broadcast function that routes messages based on the `guildId`
 * field. Guild-scoped messages go only to members; global messages go to all.
 */
export const createScopedBroadcast = (wss: WebSocketServer) => {
    return (message: any) => {
        const guildId = message.guildId;

        if (guildId) {
            // Guild-scoped: only send to members of this guild
            const guildSockets = guildSocketMap.get(guildId);
            if (guildSockets) {
                const payload = JSON.stringify(message);
                for (const client of guildSockets) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(payload);
                    }
                }
            }

            // Handle guild suspension/stop — clear subscriptions after delivery
            if (message.type === 'GUILD_STATUS_CHANGE' &&
                message.data?.status !== 'active') {
                clearGuildSubscriptions(guildId);
            }
        } else {
            // Global: send to all connected clients (presence, DMs, friend events)
            const payload = JSON.stringify(message);
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(payload);
                }
            });
        }
    };
};

// ---------------------------------------------------------------------------
// Guild subscription helpers
// ---------------------------------------------------------------------------

function subscribeToGuild(ws: WebSocket, guildId: string): void {
    if (!socketGuildMap.has(ws)) socketGuildMap.set(ws, new Set());
    socketGuildMap.get(ws)!.add(guildId);

    if (!guildSocketMap.has(guildId)) guildSocketMap.set(guildId, new Set());
    guildSocketMap.get(guildId)!.add(ws);
}

function unsubscribeFromGuild(ws: WebSocket, guildId: string): void {
    socketGuildMap.get(ws)?.delete(guildId);
    guildSocketMap.get(guildId)?.delete(ws);
    if (guildSocketMap.get(guildId)?.size === 0) {
        guildSocketMap.delete(guildId);
    }
}

/**
 * Removes ALL WebSocket subscriptions for a guild (used when guild is
 * suspended or stopped). The status change event has already been delivered
 * before this runs.
 */
function clearGuildSubscriptions(guildId: string): void {
    const sockets = guildSocketMap.get(guildId);
    if (sockets) {
        for (const ws of sockets) {
            socketGuildMap.get(ws)?.delete(guildId);
        }
        guildSocketMap.delete(guildId);
    }
}

function cleanupDisconnect(ws: WebSocket): void {
    // Clean up guild maps
    const guilds = socketGuildMap.get(ws);
    if (guilds) {
        for (const guildId of guilds) {
            guildSocketMap.get(guildId)?.delete(ws);
            if (guildSocketMap.get(guildId)?.size === 0) {
                guildSocketMap.delete(guildId);
            }
        }
    }
    socketGuildMap.delete(ws);
}

// ---------------------------------------------------------------------------
// Connection tracking
// ---------------------------------------------------------------------------

export const setupConnectionTracking = (
    ws: WebSocket,
    broadcastMessage: (message: any) => void,
    db?: any
) => {
    ws.on('message', async (message) => {
        try {
            const parsed = JSON.parse(message.toString());

            if (parsed.type === 'PRESENCE_IDENTIFY') {
                const { token } = parsed.data;
                if (!token) return;

                try {
                    const decodedRaw = jwt.decode(token, { complete: true });
                    if (!decodedRaw || !decodedRaw.payload) return;
                    const issuerUrl = (decodedRaw.payload as any).iss;

                    let pubKey;
                    if (!issuerUrl || issuerUrl.match(/127\.0\.0\.1:\d+/)) {
                        pubKey = getServerIdentity().publicKey;
                    } else {
                        pubKey = await fetchRemotePublicKey(issuerUrl).catch(() => getServerIdentity().publicKey);
                    }

                    const decoded = jwt.verify(token, pubKey.export({type: 'spki', format: 'pem'}), { algorithms: ['EdDSA'] }) as { accountId: string };
                    const { accountId } = decoded;

                    socketAccountMap.set(ws, accountId);

                    presenceMap.set(accountId, {
                        accountId,
                        status: 'online',
                        lastUpdated: Date.now()
                    });

                    broadcastMessage({ type: 'PRESENCE_UPDATE', data: presenceMap.get(accountId) });

                    // Subscribe to all guilds where this account has active membership
                    let memberGuilds: Array<{ id: string; name: string }> = [];
                    if (db && typeof db.getAccountGuildMemberships === 'function') {
                        try {
                            memberGuilds = await db.getAccountGuildMemberships(accountId);
                            for (const guild of memberGuilds) {
                                subscribeToGuild(ws, guild.id);
                            }
                        } catch (err) {
                            console.error('[WS] Failed to load guild memberships:', err);
                        }
                    }

                    // Send sync of ALL presences + guild list to the newly connected client
                    ws.send(JSON.stringify({
                        type: 'PRESENCE_SYNC',
                        data: Array.from(presenceMap.values()),
                        guilds: memberGuilds.map(g => g.id)
                    }));
                } catch (err) {
                    console.error("WS Identity Verification Failed:", err);
                }
            }
            else if (parsed.type === 'PRESENCE_UPDATE') {
                const accountId = socketAccountMap.get(ws);
                if (accountId) {
                    presenceMap.set(accountId, {
                        accountId,
                        status: parsed.data.status,
                        lastUpdated: Date.now()
                    });
                    broadcastMessage({ type: 'PRESENCE_UPDATE', data: presenceMap.get(accountId) });
                }
            }
            else if (parsed.type === 'TYPING_START') {
                const accountId = socketAccountMap.get(ws);
                if (accountId) {
                    // Resolve guild from channel for scoped delivery
                    const guildId = db?.channelToGuildId?.get(parsed.data.channelId) || undefined;
                    broadcastMessage({
                        type: 'TYPING_START',
                        data: {
                            ...parsed.data,
                            accountId
                        },
                        guildId
                    });
                }
            }
            else if (parsed.type === 'TYPING_STOP') {
                const accountId = socketAccountMap.get(ws);
                if (accountId) {
                    // Resolve guild from channel for scoped delivery
                    const guildId = db?.channelToGuildId?.get(parsed.data.channelId) || undefined;
                    broadcastMessage({
                        type: 'TYPING_STOP',
                        data: {
                            ...parsed.data,
                            accountId
                        },
                        guildId
                    });
                }
            }
            else if (parsed.type === 'GUILD_SUBSCRIBE') {
                const { guildId } = parsed.data || {};
                const accountId = socketAccountMap.get(ws);
                if (accountId && guildId && db) {
                    // Verify membership before subscribing
                    try {
                        const profile = await db.getGuildQuery(guildId,
                            'SELECT id FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
                            [accountId, guildId, 'active']
                        );
                        if (profile) {
                            subscribeToGuild(ws, guildId);
                        }
                    } catch {
                        // Guild DB may not be loaded — ignore
                    }
                }
            }
            else if (parsed.type === 'GUILD_UNSUBSCRIBE') {
                const { guildId } = parsed.data || {};
                if (guildId) {
                    unsubscribeFromGuild(ws, guildId);
                }
            }
        } catch (e) {
            // Unparseable or invalid json, ignore
        }
    });

    ws.on('close', () => {
        const accountId = socketAccountMap.get(ws);
        if (accountId) {
            // Check if user has other active connections (simplified for now to just mark offline)
            presenceMap.delete(accountId);
            broadcastMessage({ type: 'PRESENCE_UPDATE', data: { accountId, status: 'offline', lastUpdated: Date.now() } });
            socketAccountMap.delete(ws);
        }

        // Clean up guild subscription maps
        cleanupDisconnect(ws);
    });
};

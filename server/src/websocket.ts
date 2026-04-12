import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config';

export interface PresenceData {
    accountId: string;
    status: 'online' | 'idle' | 'dnd' | 'offline';
    lastUpdated: number;
}

// Global in-memory presence map
const presenceMap = new Map<string, PresenceData>();

// Map WebSocket to AccountId to handle disconnects
const socketAccountMap = new Map<WebSocket, string>();

export const getGlobalPresence = () => Array.from(presenceMap.values());

export const setupConnectionTracking = (ws: WebSocket, broadcastMessage: (message: any) => void) => {
    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message.toString());
            
            if (parsed.type === 'PRESENCE_IDENTIFY') {
                const { token } = parsed.data;
                if (!token) return;

                try {
                    const decoded = jwt.verify(token, JWT_SECRET) as { accountId: string };
                    const { accountId } = decoded;
                    
                    socketAccountMap.set(ws, accountId);
                    
                    presenceMap.set(accountId, {
                        accountId,
                        status: 'online',
                        lastUpdated: Date.now()
                    });
                    
                    broadcastMessage({ type: 'PRESENCE_UPDATE', data: presenceMap.get(accountId) });
                    
                    // Send sync of ALL presences to the newly connected client
                    ws.send(JSON.stringify({
                        type: 'PRESENCE_SYNC',
                        data: Array.from(presenceMap.values())
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
                    broadcastMessage({
                        type: 'TYPING_START',
                        data: {
                            ...parsed.data, 
                            accountId 
                        }
                    });
                }
            }
            else if (parsed.type === 'TYPING_STOP') {
                const accountId = socketAccountMap.get(ws);
                if (accountId) {
                    broadcastMessage({
                        type: 'TYPING_STOP',
                        data: {
                            ...parsed.data, 
                            accountId 
                        }
                    });
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
    });
};

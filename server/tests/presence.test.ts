import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { setupConnectionTracking, getGlobalPresence } from '../src/websocket';
import { WebSocket } from 'ws';

describe('Rich Presence WebSocket Tracking', () => {
    it('sets user online when identifying, and idle when updated', () => {
        const events: any[] = [];
        const broadcast = (msg: any) => events.push(msg);
        
        // Mock a WS
        const mockWs = new (class {
            listeners: Record<string, Function[]> = {};
            readyState = 1; // OPEN
            on(event: string, cb: Function) {
                if (!this.listeners[event]) this.listeners[event] = [];
                this.listeners[event].push(cb);
            }
            send(data: string) {
                events.push(JSON.parse(data));
            }
            close() {
                if (this.listeners['close']) this.listeners['close'].forEach(cb => cb());
            }
            emulateMessage(payload: any) {
                if (this.listeners['message']) {
                    this.listeners['message'].forEach(cb => cb(JSON.stringify(payload)));
                }
            }
        });

        // Track it
        setupConnectionTracking(mockWs as any, broadcast);

        // Send IDENTIFY
        mockWs.emulateMessage({ type: 'PRESENCE_IDENTIFY', data: { accountId: 'acc123' } });

        // Checks
        const onlineEvents = events.filter(e => e.type === 'PRESENCE_UPDATE' && e.data.status === 'online');
        expect(onlineEvents.length).toBeGreaterThan(0);
        expect(getGlobalPresence().find(p => p.accountId === 'acc123')?.status).toBe('online');

        // Send IDLE UPDATE
        mockWs.emulateMessage({ type: 'PRESENCE_UPDATE', data: { status: 'idle' } });

        const idleEvents = events.filter(e => e.type === 'PRESENCE_UPDATE' && e.data.status === 'idle');
        expect(idleEvents.length).toBe(1);
        expect(getGlobalPresence().find(p => p.accountId === 'acc123')?.status).toBe('idle');

        // Close connection
        mockWs.close();
        
        const offlineEvents = events.filter(e => e.type === 'PRESENCE_UPDATE' && e.data.status === 'offline');
        expect(offlineEvents.length).toBe(1);
        expect(getGlobalPresence().find(p => p.accountId === 'acc123')).toBeUndefined();
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupConnectionTracking, getGlobalPresence } from '../src/websocket';
import { generateToken } from '../src/app';

// Mock WebSocket class
class MockWebSocket {
    listeners: Record<string, Function[]> = {};
    readyState = 1; // OPEN
    
    on(event: string, cb: Function) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(cb);
    }
    
    send = vi.fn();
    
    close() {
        if (this.listeners['close']) {
            this.listeners['close'].forEach(cb => cb());
        }
    }
    
    emit(event: string, data: any) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
    }
    
    emulateMessage(payload: any) {
        this.emit('message', JSON.stringify(payload));
    }
}

describe('WebSocket Unit Tests', () => {
    let broadcastMessage: any;
    let ws: MockWebSocket;

    beforeEach(() => {
        broadcastMessage = vi.fn();
        ws = new MockWebSocket();
    });

    it('Identify: updates internal presenceMap and triggers broadcastMessage', () => {
        setupConnectionTracking(ws as any, broadcastMessage);
        const accountId = 'user-ws-1';
        
        ws.emulateMessage({ type: 'PRESENCE_IDENTIFY', data: { accountId, token: generateToken(accountId) } });
        
        expect(broadcastMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'PRESENCE_UPDATE',
            data: expect.objectContaining({ accountId, status: 'online' })
        }));
        
        const presence = getGlobalPresence();
        expect(presence).toContainEqual(expect.objectContaining({ accountId, status: 'online' }));
    });

    it('Typing: correctly appends sender\'s accountId to payload before broadcasting', () => {
        setupConnectionTracking(ws as any, broadcastMessage);
        const accountId = 'user-ws-2';
        
        // Identify first to set the socketAccountMap
        ws.emulateMessage({ type: 'PRESENCE_IDENTIFY', data: { accountId, token: generateToken(accountId) } });
        
        ws.emulateMessage({ type: 'TYPING_START', data: { channelId: 'chan-1' } });
        
        expect(broadcastMessage).toHaveBeenCalledWith({
            type: 'TYPING_START',
            data: { channelId: 'chan-1', accountId }
        });
    });

    it('Sync: new connection receives a PRESENCE_SYNC message containing all current online users', () => {
        // Setup initial state: user-ws-1 is already online
        const ws1 = new MockWebSocket();
        setupConnectionTracking(ws1 as any, broadcastMessage);
        ws1.emulateMessage({ type: 'PRESENCE_IDENTIFY', data: { accountId: 'user-ws-1', token: generateToken('user-ws-1') } });

        // New connection
        const ws2 = new MockWebSocket();
        setupConnectionTracking(ws2 as any, broadcastMessage);
        ws2.emulateMessage({ type: 'PRESENCE_IDENTIFY', data: { accountId: 'user-ws-3', token: generateToken('user-ws-3') } });

        expect(ws2.send).toHaveBeenCalledWith(expect.stringContaining('"type":"PRESENCE_SYNC"'));
        const syncCall = ws2.send.mock.calls.find(call => call[0].includes('PRESENCE_SYNC'));
        expect(syncCall).toBeDefined();
        if (!syncCall) return;
        const syncMessage = JSON.parse(syncCall[0]);
        expect(syncMessage.data).toEqual(expect.arrayContaining([
            expect.objectContaining({ accountId: 'user-ws-1' }),
            expect.objectContaining({ accountId: 'user-ws-3' })
        ]));
    });

    it('Lifecycle: closing a socket removes user from presence map and broadcasts offline', () => {
        setupConnectionTracking(ws as any, broadcastMessage);
        const accountId = 'user-ws-4';
        ws.emulateMessage({ type: 'PRESENCE_IDENTIFY', data: { accountId, token: generateToken(accountId) } });
        
        ws.close();
        
        expect(broadcastMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'PRESENCE_UPDATE',
            data: expect.objectContaining({ accountId, status: 'offline' })
        }));
        
        const presence = getGlobalPresence();
        expect(presence.find(p => p.accountId === accountId)).toBeUndefined();
    });
});

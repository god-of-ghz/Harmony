import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupWebRTC } from '../src/media/signaling';
import * as sfu from '../src/media/sfu';

// Mock SFU
vi.mock('../src/media/sfu', () => ({
    getRouter: vi.fn(),
    createWebRtcTransport: vi.fn(),
    connectTransport: vi.fn(),
    getTransport: vi.fn(),
    producers: new Map(),
    consumers: new Map()
}));

// Mock WebSocket class
class MockWebSocket {
    listeners: Record<string, Function[]> = {};
    readyState = 1;
    on(event: string, cb: Function) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(cb);
    }
    send = vi.fn();
    close() { if (this.listeners['close']) this.listeners['close'].forEach(cb => cb()); }
    emit(event: string, data: any) { if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data)); }
    emulateMessage(payload: any) { this.emit('message', JSON.stringify(payload)); }
}

describe('Signaling Unit Tests', () => {
    let ws: MockWebSocket;

    beforeEach(() => {
        ws = new MockWebSocket();
        vi.clearAllMocks();
        sfu.producers.clear();
        sfu.consumers.clear();
    });

    it('webrtc-produce returns reqId and stores producer', async () => {
        const mockProducer = { id: 'p1', kind: 'video', on: vi.fn() };
        const mockTransport = { produce: vi.fn().mockResolvedValue(mockProducer) };
        (sfu.getTransport as any).mockReturnValue(mockTransport);
        (sfu.getRouter as any).mockResolvedValue({ rtpCapabilities: {} });

        setupWebRTC(ws as any);
        
        // Mock join first
        ws.emulateMessage({ type: 'webrtc-join-room', channelId: 'c1', peerId: 'peer1' });
        
        ws.emulateMessage({ 
            type: 'webrtc-produce', 
            reqId: 'req-123', 
            transportId: 't1', 
            kind: 'video', 
            rtpParameters: {} 
        });

        // Wait for async
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"reqId":"req-123"'));
        expect(sfu.producers.has('p1')).toBe(true);
    });

    it('webrtc-resume-consumer calls consumer.resume()', async () => {
        const mockConsumer = { id: 'c1', resume: vi.fn() };
        sfu.consumers.set('c1', mockConsumer as any);

        setupWebRTC(ws as any);
        ws.emulateMessage({ type: 'webrtc-resume-consumer', consumerId: 'c1', reqId: 'req-456' });

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockConsumer.resume).toHaveBeenCalled();
        expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"webrtc-consumer-resumed"'));
        expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"reqId":"req-456"'));
    });

    it('cleanup on socket close closes producers and consumers', async () => {
        const mockProducer = { id: 'p1', close: vi.fn() };
        const mockConsumer = { id: 'c1', close: vi.fn() };
        
        sfu.producers.set('p1', mockProducer as any);
        sfu.consumers.set('c1', mockConsumer as any);

        setupWebRTC(ws as any);
        ws.emulateMessage({ type: 'webrtc-join-room', channelId: 'c1', peerId: 'peer1' });

        // Manually add to peer info since it's local to setupWebRTC's closure
        // Actually, I need to trigger the messages that add them to the peer info
        // but peer info state is inside setupWebRTC. 
        // Let's emulate a production and consumption
        const mockProducerObj = { id: 'p1', close: vi.fn(), on: vi.fn() };
        const mockConsumerObj = { id: 'c1', close: vi.fn(), on: vi.fn() };
        const mockTransport = { 
            produce: vi.fn().mockResolvedValue(mockProducerObj), 
            consume: vi.fn().mockResolvedValue(mockConsumerObj) 
        };
        (sfu.getTransport as any).mockReturnValue(mockTransport);
        (sfu.getRouter as any).mockResolvedValue({ rtpCapabilities: {}, canConsume: () => true });

        ws.emulateMessage({ type: 'webrtc-produce', reqId: 'r1', transportId: 't1', kind: 'video', rtpParameters: {} });
        ws.emulateMessage({ type: 'webrtc-consume', reqId: 'r2', transportId: 't1', producerId: 'other-p' });

        await new Promise(resolve => setTimeout(resolve, 50));

        ws.close();

        expect(mockProducerObj.close).toHaveBeenCalled();
        expect(mockConsumerObj.close).toHaveBeenCalled();
        expect(sfu.producers.has('p1')).toBe(false);
        expect(sfu.consumers.has('c1')).toBe(false);
    });

    it('webrtc-join-room notifies about existing producers', async () => {
        // Setup existing producer
        const existingPeerId = 'existing-peer';
        const existingProducerId = 'existing-p';
        sfu.producers.set(existingProducerId, { id: existingProducerId, appData: { type: 'camera' } } as any);

        setupWebRTC(ws as any);
        
        // Mock rooms state - this is tricky because rooms is private in signaling.ts
        // But setupWebRTC's closure uses a global rooms map.
        // We actually need to emulate an EXISTING peer join FIRST.
        const wsExisting = new MockWebSocket();
        setupWebRTC(wsExisting as any);
        wsExisting.emulateMessage({ type: 'webrtc-join-room', channelId: 'c1', peerId: existingPeerId });
        // Produce on existing peer
        const mockTransport = { produce: vi.fn().mockResolvedValue({ id: existingProducerId, on: vi.fn(), appData: { type: 'camera' } }) };
        (sfu.getTransport as any).mockReturnValue(mockTransport);
        (sfu.getRouter as any).mockResolvedValue({ rtpCapabilities: {} });
        wsExisting.emulateMessage({ type: 'webrtc-produce', reqId: 'r1', transportId: 't1', kind: 'video', rtpParameters: {} });
        
        await new Promise(resolve => setTimeout(resolve, 200));

        // Now new peer joins
        ws.emulateMessage({ type: 'webrtc-join-room', channelId: 'c1', peerId: 'new-peer' });

        await new Promise(resolve => setTimeout(resolve, 200));

        expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"webrtc-new-producer"'));
        expect(ws.send).toHaveBeenCalledWith(expect.stringContaining(existingProducerId));
    });
});

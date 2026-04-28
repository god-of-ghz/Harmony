import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as sfu from '../src/media/sfu';

const { mockTransport, mockRouter, mockWorker } = vi.hoisted(() => {
  const t = {
    id: 'transport_1',
    iceParameters: { usernameFragment: 'u', password: 'p' },
    iceCandidates: [],
    dtlsParameters: { role: 'auto', fingerprints: [] },
    close: vi.fn(),
    on: vi.fn(),
    connect: vi.fn()
  };
  const r = {
    createWebRtcTransport: vi.fn().mockResolvedValue(t)
  };
  const w = {
    on: vi.fn(),
    createRouter: vi.fn().mockResolvedValue(r)
  };
  return { mockTransport: t, mockRouter: r, mockWorker: w };
});

vi.mock('mediasoup', () => {
    return {
        createWorker: vi.fn().mockResolvedValue(mockWorker)
    };
});

describe('SFU Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the maps by accessing them directly 
        // Though it's hard to clear const exports unless we mock the maps, let's just make sure we use unique IDs or clear them if possible.
        sfu.transports.clear();
        mockRouter.createWebRtcTransport.mockClear();
        mockWorker.createRouter.mockClear();
    });

    it('should export necessary collections', () => {
        expect(sfu.transports).toBeInstanceOf(Map);
        expect(sfu.producers).toBeInstanceOf(Map);
        expect(sfu.consumers).toBeInstanceOf(Map);
    });

    it('startMediasoup creates a worker with correct settings', async () => {
        const mediasoup = await import('mediasoup');
        
        await sfu.startMediasoup();

        expect(mediasoup.createWorker).toHaveBeenCalledWith({
            logLevel: 'warn',
            logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
            rtcMinPort: 10000,
            rtcMaxPort: 10100,
        });

        // Test the 'died' event subscription
        expect(mockWorker.on).toHaveBeenCalledWith('died', expect.any(Function));
    });

    it('getRouter creates router on worker if it does not exist', async () => {
        await sfu.startMediasoup(); // ensure worker is set
        const router = await sfu.getRouter('ch1');
        
        expect(mockWorker.createRouter).toHaveBeenCalledWith({ mediaCodecs: expect.any(Array) });
        expect(router).toBe(mockRouter);
        
        // Calling it again should return from map without creating a new one
        mockWorker.createRouter.mockClear();
        const cachedRouter = await sfu.getRouter('ch1');
        expect(cachedRouter).toBe(mockRouter);
        expect(mockWorker.createRouter).not.toHaveBeenCalled();
    });

    it('createWebRtcTransport binds listeners and adds to map', async () => {
        await sfu.startMediasoup();
        const { transport, params } = await sfu.createWebRtcTransport(mockRouter as any);

        expect(mockRouter.createWebRtcTransport).toHaveBeenCalledWith({
            listenIps: expect.arrayContaining([{ ip: '0.0.0.0', announcedIp: expect.any(String) }]),
            enableUdp: true,
            enableTcp: true,
            preferUdp: true
        });

        expect(transport.on).toHaveBeenCalledWith('dtlsstatechange', expect.any(Function));
        expect(transport.on).toHaveBeenCalledWith('routerclose', expect.any(Function));
        
        expect(params.id).toBe('transport_1');
        expect(sfu.transports.get('transport_1')).toBe(mockTransport);

        // Test the events to hit the branches
        const dtlsCallback = mockTransport.on.mock.calls.find(c => c[0] === 'dtlsstatechange')[1];
        dtlsCallback('closed');
        expect(mockTransport.close).toHaveBeenCalled();

        const closeCallback = mockTransport.on.mock.calls.find(c => c[0] === 'routerclose')[1];
        closeCallback();
        expect(mockTransport.close).toHaveBeenCalledTimes(2);
    });

    it('connectTransport calls connect on the transport', async () => {
        await sfu.startMediasoup();
        await sfu.createWebRtcTransport(mockRouter as any);
        
        const dtlsParams = { role: 'server', fingerprints: [] };
        await sfu.connectTransport('transport_1', dtlsParams);

        expect(mockTransport.connect).toHaveBeenCalledWith({ dtlsParameters: dtlsParams });
    });

    it('connectTransport throws if transport does not exist', async () => {
        await expect(sfu.connectTransport('missing_transport', {})).rejects.toThrow('Transport missing_transport not found');
    });

    it('getTransport returns the transport by id', async () => {
        await sfu.startMediasoup();
        await sfu.createWebRtcTransport(mockRouter as any);

        const t = sfu.getTransport('transport_1');
        expect(t).toBe(mockTransport);
    });
});

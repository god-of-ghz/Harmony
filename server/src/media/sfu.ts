import * as mediasoup from 'mediasoup';
import { Worker, Router, WebRtcTransport, Producer, Consumer, RtpCodecCapability } from 'mediasoup/node/lib/types';
import os from 'os';

let worker: Worker;
const routers: Map<string, Router> = new Map(); // channelId -> Router
export const transports: Map<string, WebRtcTransport> = new Map(); // transportId -> WebRtcTransport
export const producers: Map<string, Producer> = new Map(); // producerId -> Producer
export const consumers: Map<string, Consumer> = new Map(); // consumerId -> Consumer

const mediaCodecs: RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    preferredPayloadType: 111,
    clockRate: 48000,
    channels: 2,
    rtcpFeedback: [
      { type: 'goog-remb', parameter: '' },
      { type: 'transport-cc', parameter: '' }
    ]
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    preferredPayloadType: 96,
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000
    },
    rtcpFeedback: [
      { type: 'goog-remb', parameter: '' },
      { type: 'transport-cc', parameter: '' },
      { type: 'ccm', parameter: 'fir' },
      { type: 'nack', parameter: '' },
      { type: 'nack', parameter: 'pli' }
    ]
  },
  {
    kind: 'video',
    mimeType: 'video/h264',
    preferredPayloadType: 102,
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000
    },
    rtcpFeedback: [
      { type: 'goog-remb', parameter: '' },
      { type: 'transport-cc', parameter: '' },
      { type: 'ccm', parameter: 'fir' },
      { type: 'nack', parameter: '' },
      { type: 'nack', parameter: 'pli' }
    ]
  }
];

export const startMediasoup = async () => {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });

  worker.on('died', () => {
    console.error('Mediasoup worker died, exiting in 2 seconds...');
    setTimeout(() => process.exit(1), 2000);
  });

  console.log('Mediasoup worker created');
};

export const getRouter = async (channelId: string): Promise<Router> => {
  if (routers.has(channelId)) {
    return routers.get(channelId)!;
  }
  const router = await worker.createRouter({ mediaCodecs });
  routers.set(channelId, router);
  return router;
};

export const createWebRtcTransport = async (router: Router) => {
  const transport = await router.createWebRtcTransport({
    listenIps: [
      {
        ip: '0.0.0.0', // Listen on all interfaces
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || getLocalIp() // Fallback to local IP for discovery
      }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  });

  transport.on('dtlsstatechange', dtlsState => {
    if (dtlsState === 'closed') transport.close();
  });

  transport.on('routerclose', () => transport.close());

  transports.set(transport.id, transport);
  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    }
  };
};

export const connectTransport = async (transportId: string, dtlsParameters: any) => {
  const transport = transports.get(transportId);
  if (!transport) throw new Error(`Transport ${transportId} not found`);
  await transport.connect({ dtlsParameters });
};

export const getTransport = (transportId: string) => transports.get(transportId);

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

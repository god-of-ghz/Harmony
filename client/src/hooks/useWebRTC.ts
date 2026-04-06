import { useRef, useState, useEffect } from 'react';
import * as mediasoupClient from 'mediasoup-client';

export type QualityPreset = '720p30' | '1080p60' | '1440p60' | '4k60';
export type StreamMode = 'low-latency' | 'balanced' | 'best-quality';

interface WebRTCConfig {
    wsUrl: string;
    channelId: string;
    peerId: string;
}

export const useWebRTC = ({ wsUrl, channelId, peerId }: WebRTCConfig) => {
    const wsRef = useRef<WebSocket | null>(null);
    const deviceRef = useRef<mediasoupClient.Device | null>(null);
    const sendTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
    const recvTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
    
    const [connected, setConnected] = useState(false);
    const [producers, setProducers] = useState<Map<string, mediasoupClient.types.Producer>>(new Map());
    const [remoteStreams, setRemoteStreams] = useState<Map<string, { stream: MediaStream; peerId: string; type?: string }>>(new Map());
    const consumerByProducerId = useRef<Map<string, mediasoupClient.types.Consumer>>(new Map());
    const pendingRequests = useRef<Map<string, (data: any) => void>>(new Map());
    const pendingEvents = useRef<any[]>([]);
    const consumptionQueue = useRef<Promise<void>>(Promise.resolve());

    useEffect(() => {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            setConnected(true);
            ws.send(JSON.stringify({ type: 'webrtc-join-room', channelId, peerId }));
        };

        ws.onmessage = async (e) => {
            const data = JSON.parse(e.data);

            // Handle Promises waiting for server response
            if (data.type === 'webrtc-router-capabilities') {
                const device = new mediasoupClient.Device();
                await device.load({ routerRtpCapabilities: data.rtpCapabilities });
                deviceRef.current = device;
                
                // Create Transports
                ws.send(JSON.stringify({ type: 'webrtc-create-transport', direction: 'send', peerId }));
                ws.send(JSON.stringify({ type: 'webrtc-create-transport', direction: 'recv', peerId }));
            }
            
            if (data.type === 'webrtc-transport-created') {
                const { params, direction } = data;
                if (!deviceRef.current) return;

                if (direction === 'send') {
                    const transport = deviceRef.current.createSendTransport(params);
                    transport.on('connect', ({ dtlsParameters }, callback) => {
                        const reqId = `connect-${transport.id}`;
                        pendingRequests.current.set(reqId, () => callback());
                        ws.send(JSON.stringify({ type: 'webrtc-connect-transport', transportId: transport.id, dtlsParameters, peerId, reqId }));
                    });

                    transport.on('produce', async ({ kind, rtpParameters, appData }, callback) => {
                        // Keep track of this produce request
                        const reqId = Math.random().toString();
                        pendingRequests.current.set(reqId, (msgData) => callback({ id: msgData.id }));
                        ws.send(JSON.stringify({ type: 'webrtc-produce', reqId, transportId: transport.id, kind, rtpParameters, appData, peerId }));
                    });
                    
                    sendTransportRef.current = transport;
                } else {
                    const transport = deviceRef.current.createRecvTransport(params);
                    transport.on('connect', ({ dtlsParameters }, callback) => {
                        const reqId = `connect-${transport.id}`;
                        pendingRequests.current.set(reqId, () => callback());
                        ws.send(JSON.stringify({ type: 'webrtc-connect-transport', transportId: transport.id, dtlsParameters, peerId, reqId }));
                    });
                    recvTransportRef.current = transport;

                    // Immediately process unified event queue
                    if (pendingEvents.current.length > 0) {
                        console.log(`[WebRTC] Processing ${pendingEvents.current.length} queued events`);
                        const queued = [...pendingEvents.current];
                        pendingEvents.current = [];
                        queued.forEach(eventData => {
                            // Recursively call onmessage handler or directly trigger logic
                            // For simplicity, we'll re-dispatch the message data
                            ws.onmessage!({ data: JSON.stringify(eventData) } as any);
                        });
                    }
                }
            }

            if (data.type === 'webrtc-new-producer') {
                const { producerId, peerId: remotePeerId, appData } = data;
                
                if (!deviceRef.current || !recvTransportRef.current) {
                    console.log(`[WebRTC] Queueing new producer ${producerId} from ${remotePeerId}`);
                    pendingEvents.current.push(data);
                    return;
                }

                // Inform the server we want to consume
                const reqId = `consume-${producerId}-${Math.random()}`;
                pendingRequests.current.set(reqId, async (msgData: any) => {
                    // Serialize calls to transport.consume() to avoid "Transceiver not found" / m-line index errors
                    consumptionQueue.current = consumptionQueue.current.then(async () => {
                        try {
                            const { id, kind, rtpParameters } = msgData.params;
                            console.log(`[WebRTC] Consuming ${kind} from ${remotePeerId} (producerId: ${producerId})`);
                            
                            if (!recvTransportRef.current) return;
                            
                            const consumer = await recvTransportRef.current.consume({
                                id,
                                producerId,
                                kind,
                                rtpParameters,
                            });
                            
                            const streamKey = appData?.source?.startsWith('screen') 
                                ? `${remotePeerId}-screen` 
                                : remotePeerId;

                            consumerByProducerId.current.set(producerId, consumer);

                            // Add to stream map by streamKey
                            setRemoteStreams(prev => {
                                const newMap = new Map(prev);
                                const existing = newMap.get(streamKey);
                                
                                let newStream: MediaStream;
                                if (existing) {
                                    newStream = new MediaStream([...existing.stream.getTracks(), consumer.track]);
                                } else {
                                    newStream = new MediaStream([consumer.track]);
                                }
                                
                                newMap.set(streamKey, { 
                                    stream: newStream, 
                                    peerId: remotePeerId,
                                    type: appData?.source?.startsWith('screen') ? 'screen' : 'camera'
                                });
                                return newMap;
                            });

                            // Resume
                            ws.send(JSON.stringify({ type: 'webrtc-resume-consumer', consumerId: consumer.id, peerId, reqId: `resume-${consumer.id}` }));
                        } catch (err) {
                            console.error(`[WebRTC] Failed to consume producer ${producerId}:`, err);
                        }
                    });
                    await consumptionQueue.current;
                });

                ws.send(JSON.stringify({
                    type: 'webrtc-consume',
                    producerId,
                    transportId: recvTransportRef.current.id,
                    rtpCapabilities: deviceRef.current.rtpCapabilities,
                    peerId,
                    reqId
                }));
            }

            if (data.type === 'webrtc-produced' || data.type === 'webrtc-consumed' || data.type === 'webrtc-transport-connected' || data.type === 'webrtc-consumer-resumed') {
                if (data.reqId && pendingRequests.current.has(data.reqId)) {
                    pendingRequests.current.get(data.reqId)!(data);
                    pendingRequests.current.delete(data.reqId);
                }
            }

            if (data.type === 'webrtc-producer-closed') {
                const { producerId } = data;
                
                // If the producer is still in the pending queue, remove it from the queue altogether
                const existingIdx = pendingEvents.current.findIndex(e => e.type === 'webrtc-new-producer' && e.producerId === producerId);
                if (existingIdx !== -1) {
                    console.log(`[WebRTC] Removing stale producer ${producerId} from pending queue`);
                    pendingEvents.current.splice(existingIdx, 1);
                    return;
                }
                
                // If transport isn't ready but we received a close event, queue it up (though the short-circuit above usually handles this)
                if (!deviceRef.current || !recvTransportRef.current) {
                    pendingEvents.current.push(data);
                    return;
                }

                const consumer = consumerByProducerId.current.get(producerId);
                if (consumer) {
                    consumer.close();
                    consumerByProducerId.current.delete(producerId);
                }

                setRemoteStreams(prev => {
                    const newMap = new Map(prev);
                    
                    // Look through all streams to find which one had this track
                    for (const [key, value] of Array.from(newMap.entries())) {
                        if (consumer && value.stream.getTracks().some(t => t.id === consumer.track.id)) {
                            // Rebuild track without this one
                            const remainingTracks = value.stream.getTracks().filter(t => t.id !== consumer.track.id);
                            if (remainingTracks.length === 0) {
                                newMap.delete(key);
                            } else {
                                newMap.set(key, { ...value, stream: new MediaStream(remainingTracks) });
                            }
                        }
                    }
                    return newMap;
                });
            }
        };

        return () => {
            ws.close();
            sendTransportRef.current?.close();
            recvTransportRef.current?.close();
            
            // Stop all local tracks
            producers.forEach(p => {
                p.track?.stop();
                p.close();
            });
        };
    }, [wsUrl, channelId, peerId]);

    const produce = async (track: MediaStreamTrack, quality: QualityPreset = '720p30', mode: StreamMode = 'balanced', appDataParams: any = {}) => {
        if (!sendTransportRef.current) return null;
        
        const isScreen = appDataParams?.source === 'screen-video';
        
        // Bitrate limits
        let maxBitrate = 2500000; // 2.5 Mbps
        if (quality === '1080p60') maxBitrate = 6000000;
        else if (quality === '1440p60') maxBitrate = 12000000;
        else if (quality === '4k60') maxBitrate = 20000000;

        // Boost bitrate for screenshare to ensure text clarity
        if (isScreen) {
            maxBitrate = Math.floor(maxBitrate * 1.5);
            // Apply contentHint for sharpness
            if ('contentHint' in track) {
                (track as any).contentHint = 'detail';
            }
        }

        const encodings: RTCRtpEncodingParameters[] = [
            { maxBitrate }
        ];

        // Codec specific tweaks for 'low-latency'
        let codecOptions = {};
        if (mode === 'low-latency') {
            codecOptions = { videoGoogleStartBitrate: maxBitrate / 2 };
        }

        const producer = await sendTransportRef.current.produce({
            track,
            encodings,
            codecOptions,
            appData: { peerId, ...appDataParams }
        });

        setProducers(prev => new Map(prev).set(producer.id, producer));
        return producer;
    };

    const stopProducing = (producerId: string) => {
        const producer = producers.get(producerId);
        if (producer) {
            producer.track?.stop();
            producer.close();
            setProducers(prev => {
                const newMap = new Map(prev);
                newMap.delete(producerId);
                return newMap;
            });
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'webrtc-close-producer', producerId, peerId }));
            }
        }
    };

    return {
        connected,
        produce,
        stopProducing,
        remoteStreams,
        producers
    };
};

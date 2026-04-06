import { WebSocket } from 'ws';
import { getRouter, createWebRtcTransport, connectTransport, getTransport, producers, consumers } from './sfu';
import { Producer, Consumer, RtpCapabilities } from 'mediasoup/node/lib/types';

// track rooms: channelId -> array of peer info
const rooms = new Map<string, Map<string, Peer>>();

interface Peer {
    ws: WebSocket;
    id: string; // account or profile ID
    transports: string[];
    producers: string[];
    consumers: string[];
}

export const setupWebRTC = (ws: WebSocket) => {
    let peerId: string | null = null;
    let currentChannelId: string | null = null;

    ws.on('message', async (message: string) => {
        try {
            const data = JSON.parse(message);
            if (!data.type || !data.type.startsWith('webrtc-')) return;
            
            console.log(`[WebRTC] ${data.type} from peer ${data.peerId || peerId}`);

            // Basic authentication / setup
            if (!peerId && data.peerId) {
                peerId = data.peerId;
            }

            switch (data.type) {
                case 'webrtc-join-room': {
                    const { channelId, peerId: pId } = data;
                    peerId = pId;
                    currentChannelId = channelId;
                    
                    if (!rooms.has(channelId)) rooms.set(channelId, new Map());
                    rooms.get(channelId)!.set(peerId!, { ws, id: peerId!, transports: [], producers: [], consumers: [] });

                    const router = await getRouter(channelId);
                    ws.send(JSON.stringify({
                        type: 'webrtc-router-capabilities',
                        rtpCapabilities: router.rtpCapabilities
                    }));

                    // Notify about existing producers in the room
                    const currentRoom = rooms.get(channelId);
                    if (currentRoom) {
                        for (const [existingPeerId, existingPeer] of currentRoom.entries()) {
                            if (existingPeerId !== peerId) {
                                // Inform this peer about every producer the existing peer has
                                existingPeer.producers.forEach(pid => {
                                    const producer = producers.get(pid);
                                    // CRITICAL: Double check the producer actually exists in our global map
                                    // This prevents notifying about "ghost" producers from stale Peer metadata
                                    if (producer) {
                                        ws.send(JSON.stringify({
                                            type: 'webrtc-new-producer',
                                            producerId: pid,
                                            peerId: existingPeerId,
                                            appData: producer.appData
                                        }));
                                    }
                                });
                            }
                        }
                    }
                    break;
                }

                case 'webrtc-create-transport': {
                    if (!currentChannelId) return;
                    const router = await getRouter(currentChannelId);
                    const { transport, params } = await createWebRtcTransport(router);
                    
                    const peer = rooms.get(currentChannelId)?.get(peerId!);
                    if (peer) peer.transports.push(transport.id);

                    ws.send(JSON.stringify({
                        type: 'webrtc-transport-created',
                        transportId: transport.id,
                        direction: data.direction,
                        params,
                        reqId: data.reqId
                    }));
                    break;
                }

                case 'webrtc-connect-transport': {
                    const { transportId, dtlsParameters, reqId } = data;
                    await connectTransport(transportId, dtlsParameters);
                    ws.send(JSON.stringify({ type: 'webrtc-transport-connected', transportId, reqId }));
                    break;
                }

                case 'webrtc-produce': {
                    const { transportId, kind, rtpParameters, appData } = data;
                    const transport = getTransport(transportId);
                    if (!transport) throw new Error("Transport not found");

                    const producer = await transport.produce({ kind, rtpParameters, appData });
                    const peer = rooms.get(currentChannelId!)?.get(peerId!);
                    if (peer) peer.producers.push(producer.id);

                    producer.on('transportclose', () => {
                        producer.close();
                        producers.delete(producer.id);
                    });

                    producers.set(producer.id, producer);

                    ws.send(JSON.stringify({
                        type: 'webrtc-produced',
                        id: producer.id,
                        kind: producer.kind,
                        reqId: data.reqId
                    }));

                    // Inform other peers in the room
                    const room = rooms.get(currentChannelId!);
                    if (room) {
                        for (const [otherPeerId, otherPeer] of room.entries()) {
                            if (otherPeerId !== peerId) {
                                otherPeer.ws.send(JSON.stringify({
                                    type: 'webrtc-new-producer',
                                    producerId: producer.id,
                                    peerId,
                                    appData: producer.appData
                                }));
                            }
                        }
                    }
                    break;
                }

                case 'webrtc-consume': {
                    const { producerId, transportId, rtpCapabilities } = data;
                    const router = await getRouter(currentChannelId!);
                    const transport = getTransport(transportId);
                    if (!transport || !router) {
                        console.error(`[WebRTC] Router or transport not found for consume: transportId=${transportId}, router=${!!router}`);
                        throw new Error("Router or transport not found");
                    }

                    if (!router.canConsume({ producerId, rtpCapabilities })) {
                        console.warn(`[WebRTC] Cannot consume producer ${producerId}`);
                        throw new Error("Cannot consume");
                    }

                    const consumer = await transport.consume({
                        producerId,
                        rtpCapabilities,
                        paused: true
                    });

                    const peer = rooms.get(currentChannelId!)?.get(peerId!);
                    if (peer) peer.consumers.push(consumer.id);

                    consumer.on('transportclose', () => {
                        consumer.close();
                        consumers.delete(consumer.id);
                        // Cleanup from peer metadata
                        const peer = rooms.get(currentChannelId!)?.get(peerId!);
                        if (peer) peer.consumers = peer.consumers.filter(id => id !== consumer.id);
                    });
                    consumer.on('producerclose', () => {
                        ws.send(JSON.stringify({
                            type: 'webrtc-consumer-closed',
                            consumerId: consumer.id
                        }));
                        consumer.close();
                        consumers.delete(consumer.id);
                        // Cleanup from peer metadata
                        const peer = rooms.get(currentChannelId!)?.get(peerId!);
                        if (peer) peer.consumers = peer.consumers.filter(id => id !== consumer.id);
                    });

                    consumers.set(consumer.id, consumer);

                    ws.send(JSON.stringify({
                        type: 'webrtc-consumed',
                        params: {
                            id: consumer.id,
                            producerId: consumer.producerId,
                            kind: consumer.kind,
                            rtpParameters: consumer.rtpParameters,
                            type: consumer.type,
                            producerPaused: consumer.producerPaused
                        },
                        reqId: data.reqId
                    }));
                    break;
                }

                case 'webrtc-resume-consumer': {
                    const { consumerId, reqId } = data;
                    const consumer = consumers.get(consumerId);
                    if (consumer) {
                        await consumer.resume();
                        ws.send(JSON.stringify({ type: 'webrtc-consumer-resumed', consumerId, reqId }));
                    }
                    break;
                }

                case 'webrtc-close-producer': {
                    const { producerId } = data;
                    const producer = producers.get(producerId);
                    if (producer) {
                        producer.close();
                        producers.delete(producerId);
                        
                        // Cleanup from peer metadata
                        const peer = rooms.get(currentChannelId!)?.get(peerId!);
                        if (peer) {
                            peer.producers = peer.producers.filter(id => id !== producerId);
                        }
                        
                        // Notify others in room
                        const room = rooms.get(currentChannelId!);
                        if (room) {
                            for (const [id, op] of room.entries()) {
                                if (id !== peerId) {
                                    op.ws.send(JSON.stringify({
                                        type: 'webrtc-producer-closed',
                                        producerId
                                    }));
                                }
                            }
                        }
                    }
                    break;
                }
            }
        } catch (e) {
            console.error("WebRTC Signaling Error:", e);
        }
    });

    ws.on('close', () => {
        if (currentChannelId && peerId) {
            const room = rooms.get(currentChannelId);
            if (room) {
                const peer = room.get(peerId);
                if (peer) {
                    peer.producers.forEach(pid => {
                        const producer = producers.get(pid);
                        if (producer) {
                            producer.close();
                            producers.delete(pid);
                        }
                        // notify others that producer closed
                        for (const [id, op] of room.entries()) {
                            if (id !== peerId) {
                                op.ws.send(JSON.stringify({
                                    type: 'webrtc-producer-closed',
                                    producerId: pid
                                }));
                            }
                        }
                    });
                    peer.consumers.forEach(cid => {
                        const consumer = consumers.get(cid);
                        if (consumer) {
                            consumer.close();
                            consumers.delete(cid);
                        }
                    });
                }
                room.delete(peerId);
                if (room.size === 0) rooms.delete(currentChannelId);
            }
        }
    });
};

import { useEffect, useRef, useState } from 'react';
import { useWebRTC } from '../../hooks/useWebRTC';
import type { QualityPreset, StreamMode } from '../../hooks/useWebRTC';
import { Mic, MicOff, Video, VideoOff, MonitorUp, Settings, X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

interface Props {
    channelId: string;
    serverUrl: string;
    onClose: () => void;
}

export const VoiceChannel = ({ channelId, serverUrl, onClose }: Props) => {
    const { currentAccount } = useAppStore();
    const wsUrl = serverUrl.replace(/^http/, 'ws');
    
    // Stable peer ID to avoid WebRTC re-initialization on every render
    const [stableId] = useState(`anon-${Math.random().toString(36).substring(7)}`);
    const peerId = currentAccount?.id || stableId;

    const { connected, produce, stopProducing, remoteStreams } = useWebRTC({
        wsUrl,
        channelId,
        peerId
    });

    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOn, setIsCameraOn] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    
    // Loading states for UI feedback during negotiation
    const [isCamLoading, setIsCamLoading] = useState(false);
    const [isScreenLoading, setIsScreenLoading] = useState(false);
    
    const [quality, setQuality] = useState<QualityPreset>('720p30');
    const [mode, setMode] = useState<StreamMode>('balanced');
    const [showSettings, setShowSettings] = useState(false);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const cameraStreamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    
    // Track producer IDs to stop them correctly
    const [cameraProducerIds, setCameraProducerIds] = useState<string[]>([]);
    const [screenProducerIds, setScreenProducerIds] = useState<string[]>([]);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);

    // Auto-focus new screen shares (remote or local)
    useEffect(() => {
        if (isScreenSharing && !focusedId) {
            setFocusedId('local-screen');
            return;
        }
        const screenShare = Array.from(remoteStreams.entries()).find(([_, v]) => v.type === 'screen');
        if (screenShare && !focusedId) {
            setFocusedId(screenShare[0]);
        } else if (!screenShare && !isScreenSharing && focusedId?.endsWith('-screen')) {
            setFocusedId(null);
        } else if (!isScreenSharing && focusedId === 'local-screen') {
            setFocusedId(null);
        }
    }, [remoteStreams, focusedId, isScreenSharing]);



    const startCamera = async () => {
        setIsCamLoading(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720, frameRate: 30 },
                audio: { noiseSuppression: true, echoCancellation: true }
            });
            if (localVideoRef.current) localVideoRef.current.srcObject = stream;
            cameraStreamRef.current = stream;

            const pIds: string[] = [];
            // Produce Audio
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                const p = await produce(audioTrack, undefined, undefined, { source: 'mic' });
                if (p) pIds.push(p.id);
            }

            // Produce Video
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
                const p = await produce(videoTrack, quality, mode, { source: 'webcam' });
                if (p) pIds.push(p.id);
            }

            setCameraProducerIds(pIds);
            setIsCameraOn(true);
        } catch (e) {
            console.error("Camera failed:", e);
        } finally {
            setIsCamLoading(false);
        }
    };

    const stopCamera = () => {
        setIsCamLoading(true);
        cameraProducerIds.forEach(id => stopProducing(id));
        cameraStreamRef.current?.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        setCameraProducerIds([]);
        setIsCameraOn(false);
        // Brief loading indicator to show something is happening
        setTimeout(() => setIsCamLoading(false), 300);
    };

    const startScreenShare = async () => {
        if (isScreenSharing) return stopScreenShare();
        
        setIsScreenLoading(true);
        try {
            let stream: MediaStream;
            
            // Check if we are in Electron to use the robust getUserMedia fallback
            const isElectron = navigator.userAgent.toLowerCase().includes('electron');
            if (isElectron) {
                // Use dynamic import so Vite resolves it properly for Electron without breaking web builds
                const electron = await import('electron');
                const sources = await electron.ipcRenderer.invoke('get-desktop-sources');
                if (sources && sources.length > 0) {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: false, // system audio hard in electron without loopback configuration
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: sources[0].id
                            }
                        } as any
                    });
                } else {
                    throw new Error("No display sources found via ipcRenderer");
                }
            } else {
                try {
                    // Use simplified constraints for first attempt to ensure maximum compatibility in regular browsers
                    stream = await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                        audio: true
                    });
                } catch (err: any) {
                    // If user cancelled, don't retry or show error
                    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                        console.log("[VoiceChannel] Screen share cancelled by user");
                        return;
                    }
                    
                    console.warn("[VoiceChannel] Screen share with audio failed, trying video only", err);
                    stream = await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                        audio: false
                    });
                }
            }
            
            screenStreamRef.current = stream;
            setLocalScreenStream(stream);
            
            const pIds: string[] = [];
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.onended = () => stopScreenShare();
                const p = await produce(videoTrack, quality, mode, { source: 'screen-video' });
                if (p) pIds.push(p.id);
            }
            
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                const p = await produce(audioTrack, undefined, undefined, { source: 'screen-audio' });
                if (p) pIds.push(p.id);
            }

            setScreenProducerIds(pIds);
            setIsScreenSharing(true);
        } catch (e) {
            console.error("[VoiceChannel] Screen share failed:", e);
            alert("Failed to start screen share. Please ensure you are on a secure connection and have granted permissions.");
        } finally {
            setIsScreenLoading(false);
        }
    };


    const stopScreenShare = () => {
        setIsScreenLoading(true);
        screenProducerIds.forEach(id => stopProducing(id));
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
        setLocalScreenStream(null);
        setScreenProducerIds([]);
        setIsScreenSharing(false);
        setTimeout(() => setIsScreenLoading(false), 300);
    };


    const allStreams = Array.from(remoteStreams.entries());
    const focusedStream = focusedId === 'local-screen' ? { stream: localScreenStream, peerId: 'You', type: 'screen' } : (focusedId ? remoteStreams.get(focusedId) : null);
    const otherRemoteStreams = allStreams.filter(([id]) => id !== focusedId);


    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0b0b0f', position: 'relative', color: '#e0e0e0', fontFamily: 'Inter, system-ui, sans-serif' }}>
            {/* Header */}
            <div style={{ height: '56px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', padding: '0 20px', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(10px)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: connected ? '#23a559' : '#f0b232', boxShadow: connected ? '0 0 8px #23a559' : 'none' }} />
                    <span style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.2px' }}>{connected ? 'Voice Channel' : 'Connecting...'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button 
                        style={{ background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer', color: '#b5bac1', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} 
                        className="hover-bright"
                        onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Video Main Area */}
            <div style={{ flex: 1, padding: '20px', position: 'relative', display: 'flex', flexDirection: focusedId ? 'row' : 'column', gap: '20px', overflow: 'hidden' }}>
                
                {focusedId && focusedStream ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ flex: 1, backgroundColor: '#000', borderRadius: '16px', overflow: 'hidden', position: 'relative', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
                            <RemoteVideo stream={focusedStream.stream} isFocused />
                            <div style={{ position: 'absolute', bottom: '16px', left: '16px', backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', padding: '6px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <MonitorUp size={14} style={{ color: '#5865f2' }} />
                                {focusedStream.peerId.substring(0,8)}'s Screen
                            </div>
                            <button 
                                onClick={() => setFocusedId(null)}
                                style={{ position: 'absolute', top: '16px', right: '16px', backgroundColor: 'rgba(0,0,0,0.4)', border: 'none', color: 'white', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                                Unfocus
                            </button>
                        </div>
                    </div>
                ) : null}

                <div style={{ 
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    gap: '16px', 
                    justifyContent: 'center',
                    alignContent: 'center',
                    flex: focusedId ? '0 0 280px' : 1,
                    flexDirection: focusedId ? 'column' : 'row',
                    overflowY: 'auto',
                    paddingRight: focusedId ? '8px' : '0'
                }}>
                    {/* Local Preview Box */}
                    <div style={{ width: focusedId ? '100%' : '320px', aspectRatio: '16/9', backgroundColor: '#16171d', borderRadius: '12px', overflow: 'hidden', position: 'relative', border: '1px solid rgba(255,255,255,0.05)' }}>
                        {isCameraOn ? (
                            <video ref={localVideoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(45deg, #16171d, #1e1f26)' }}>
                                <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: '#5865f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 'bold', color: 'white' }}>
                                    {peerId.charAt(0).toUpperCase()}
                                </div>
                            </div>
                        )}
                        <div style={{ position: 'absolute', bottom: '12px', left: '12px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 500 }}>You</div>
                    </div>

                    {/* Local Screen Share Box */}
                    {isScreenSharing && localScreenStream && focusedId !== 'local-screen' && (
                        <div 
                            onClick={() => setFocusedId('local-screen')}
                            style={{ width: focusedId ? '100%' : '320px', aspectRatio: '16/9', backgroundColor: '#16171d', borderRadius: '12px', overflow: 'hidden', position: 'relative', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
                            <LocalScreenPreview stream={localScreenStream} />
                            <div style={{ position: 'absolute', bottom: '12px', left: '12px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <MonitorUp size={12} style={{ color: '#23a559' }} />
                                Your Screen
                            </div>
                        </div>
                    )}


                    {/* Other Remote Streams */}
                    {otherRemoteStreams.map(([pid, { stream, peerId: streamPeerId, type }]) => (
                        <div 
                            key={pid} 
                            onClick={() => setFocusedId(pid)}
                            style={{ 
                                width: focusedId ? '100%' : '320px', 
                                aspectRatio: '16/9', 
                                backgroundColor: '#16171d', 
                                borderRadius: '12px', 
                                overflow: 'hidden', 
                                position: 'relative', 
                                border: '1px solid rgba(255,255,255,0.05)',
                                cursor: 'pointer',
                                transition: 'transform 0.2s'
                            }}
                            className="stream-card">
                            <RemoteVideo stream={stream} />
                            <div style={{ position: 'absolute', bottom: '12px', left: '12px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {type === 'screen' && <MonitorUp size={12} style={{ color: '#5865f2' }} />}
                                {streamPeerId.substring(0,8)} {type === 'screen' ? 'Screen' : ''}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Controls */}
            <div style={{ height: '80px', backgroundColor: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
                <button 
                    onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
                    style={{ ...controlBtn, backgroundColor: isMuted ? '#f23f42' : 'rgba(255,255,255,0.1)', color: 'white' }}>
                    {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
                </button>
                
                <button 
                    disabled={isCamLoading}
                    onClick={(e) => { e.stopPropagation(); if (!isCameraOn) startCamera(); else stopCamera(); }}
                    style={{ ...controlBtn, backgroundColor: isCameraOn ? '#5865f2' : 'rgba(255,255,255,0.1)', color: 'white' }}>
                    {isCamLoading ? <div className="spinning" style={{ width: '20px', height: '20px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%' }} /> : (isCameraOn ? <Video size={22} /> : <VideoOff size={22} />)}
                </button>

                <button 
                    disabled={isScreenLoading}
                    onClick={(e) => { e.stopPropagation(); startScreenShare(); }}
                    style={{ 
                        ...controlBtn, 
                        backgroundColor: isScreenSharing ? '#23a559' : 'rgba(255,255,255,0.1)', 
                        color: 'white',
                        opacity: isScreenLoading ? 0.5 : 1,
                        cursor: isScreenLoading ? 'not-allowed' : 'pointer'
                    }}>
                    {isScreenLoading ? <div className="spinning" style={{ width: '20px', height: '20px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%' }} /> : <MonitorUp size={22} />}
                </button>


                <div style={{ width: '1px', height: '32px', backgroundColor: 'rgba(255,255,255,0.1)', margin: '0 8px' }} />

                <button 
                    onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}
                    style={{ ...controlBtn, backgroundColor: showSettings ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)', color: 'white' }}>
                    <Settings size={22} />
                </button>
            </div>

            {/* Stream Settings Overlay */}
            {showSettings && (
                <div style={{ position: 'absolute', bottom: '90px', right: '50%', transform: 'translateX(50%)', backgroundColor: '#1e1f26', padding: '20px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 12px 48px rgba(0,0,0,0.5)', width: '320px', zIndex: 100 }}>
                    <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '15px', color: 'white' }}>Stream Quality Settings</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#b5bac1', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Resolution & Framerate</label>
                            <select 
                                value={quality} 
                                onChange={e => setQuality(e.target.value as QualityPreset)}
                                style={{ width: '100%', padding: '10px', backgroundColor: '#111214', border: 'none', borderRadius: '8px', color: '#dbdee1', fontSize: '13px', outline: 'none' }}>
                                <option value="720p30">720p @ 30fps (Balanced)</option>
                                <option value="1080p60">1080p @ 60fps (High Performance)</option>
                                <option value="1440p60">1440p @ 60fps (Ultra)</option>
                                <option value="4k60">4K @ 60fps (Extreme)</option>
                            </select>
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#b5bac1', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Encoding Profile</label>
                            <select 
                                value={mode} 
                                onChange={e => setMode(e.target.value as StreamMode)}
                                style={{ width: '100%', padding: '10px', backgroundColor: '#111214', border: 'none', borderRadius: '8px', color: '#dbdee1', fontSize: '13px', outline: 'none' }}>
                                <option value="low-latency">Low Latency (Prioritize Speed)</option>
                                <option value="balanced">Balanced</option>
                                <option value="best-quality">Best Quality (Prioritize Detail)</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ marginTop: '20px', padding: '12px', backgroundColor: 'rgba(88,101,242,0.1)', borderRadius: '8px', fontSize: '11px', color: '#949cf7', border: '1px solid rgba(88,101,242,0.2)' }}>
                        Settings apply to new streams. Restart sharing to apply changes.
                    </div>
                </div>
            )}
        </div>
    );
};

const controlBtn = {
    width: '48px',
    height: '48px',
    borderRadius: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: 'white'
};

const RemoteVideo = ({ stream, isFocused }: { stream: MediaStream | null, isFocused?: boolean }) => {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        if (!ref.current || !stream) return;
        ref.current.srcObject = stream;
        ref.current.play().catch(e => console.warn("video play failed:", e));
    }, [stream]);
    
    return (
        <video 
            ref={ref} 
            autoPlay 
            playsInline 
            style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: isFocused ? 'contain' : 'cover',
                backgroundColor: '#000'
            }} 
        />
    );
};

const LocalScreenPreview = ({ stream }: { stream: MediaStream }) => {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        if (!ref.current) return;
        ref.current.srcObject = stream;
    }, [stream]);
    return <video ref={ref} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
};

import { useState, useEffect, useRef } from 'react';

export const useMicrophoneLevel = (stream: MediaStream | null) => {
    const [levelDb, setLevelDb] = useState<number>(-100);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const requestRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (!stream || stream.getAudioTracks().length === 0) {
            setLevelDb(-100);
            return;
        }

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.4;
        analyserRef.current = analyser;

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateLevel = () => {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const normalized = dataArray[i] / 255;
                sum += normalized * normalized;
            }
            const rms = Math.sqrt(sum / dataArray.length);

            // Convert RMS to dB. 0.0 RMS will result in -Infinity, cap at -100
            let db = -100;
            if (rms > 0) {
                db = 20 * Math.log10(rms);
            }
            if (db < -100) db = -100;
            
            setLevelDb(db);
            requestRef.current = requestAnimationFrame(updateLevel);
        };

        requestRef.current = requestAnimationFrame(updateLevel);

        return () => {
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
            }
            source.disconnect();
            audioContext.close().catch(console.error);
        };
    }, [stream]);

    return levelDb;
};

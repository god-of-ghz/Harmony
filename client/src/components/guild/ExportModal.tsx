import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore';
import { formatBytes } from './ExportImportSection';

interface Props {
    guildId: string;
    serverUrl: string;
    estimatedSize: number | null;
    onClose: () => void;
}

interface ExportProgress {
    status: 'pending' | 'in_progress' | 'complete' | 'error';
    progress: number; // 0-100
    message?: string;
    download_url?: string;
    current_step?: string;
    files_processed?: number;
    files_total?: number;
}

export const ExportModal = ({ guildId, serverUrl, estimatedSize, onClose }: Props) => {
    const { currentAccount } = useAppStore();
    const [phase, setPhase] = useState<'confirm' | 'progress' | 'done' | 'error'>('confirm');
    const [progress, setProgress] = useState<ExportProgress>({
        status: 'pending', progress: 0
    });
    const [errorMsg, setErrorMsg] = useState('');
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, []);

    const startExport = async () => {
        if (!currentAccount?.token) return;
        setPhase('progress');
        try {
            const res = await fetch(`${serverUrl}/api/guilds/${guildId}/export`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (!res.ok) throw new Error(`Export failed (${res.status})`);

            // Start polling
            pollRef.current = setInterval(async () => {
                try {
                    const pollRes = await fetch(`${serverUrl}/api/guilds/${guildId}/export/progress`, {
                        headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                    });
                    if (!pollRes.ok) return;
                    const data: ExportProgress = await pollRes.json();
                    setProgress(data);

                    if (data.status === 'complete') {
                        if (pollRef.current) clearInterval(pollRef.current);
                        setPhase('done');
                        // Auto-trigger download
                        if (data.download_url) {
                            triggerDownload(data.download_url);
                        }
                    } else if (data.status === 'error') {
                        if (pollRef.current) clearInterval(pollRef.current);
                        setErrorMsg(data.message || 'Export failed');
                        setPhase('error');
                    }
                } catch { /* polling error, continue */ }
            }, 5000);
        } catch (err: any) {
            setErrorMsg(err.message || 'Failed to start export');
            setPhase('error');
        }
    };

    const triggerDownload = (url: string) => {
        // Try Electron dialog first
        const electron = (window as any).electron || (window as any).require?.('electron');
        if (electron?.remote?.dialog || electron?.dialog) {
            // Desktop mode — handled by Electron IPC
            return;
        }
        // Browser fallback: <a download> link
        const a = document.createElement('a');
        a.href = url.startsWith('http') ? url : `${serverUrl}${url}`;
        a.download = `guild-export-${guildId}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleCancel = () => {
        if (pollRef.current) clearInterval(pollRef.current);
        onClose();
    };

    return (
        <div data-testid="export-modal" style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10001
        }}>
            <div className="glass-panel" style={{ padding: '28px', borderRadius: '10px', maxWidth: '480px', width: '90%' }}>
                {/* Confirmation Phase */}
                {phase === 'confirm' && (
                    <div data-testid="export-confirm">
                        <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            📦 Export Guild
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', marginBottom: '16px' }}>
                            This will create a complete backup of your guild including all messages, files, channels, roles, and settings.
                        </p>
                        {estimatedSize != null && (
                            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                                Estimated size: <strong style={{ color: 'var(--text-normal)' }}>~{formatBytes(estimatedSize)}</strong>
                            </p>
                        )}
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button className="wizard-btn-nav" onClick={onClose}>Cancel</button>
                            <button data-testid="export-start-btn" className="btn" onClick={startExport}>
                                Start Export
                            </button>
                        </div>
                    </div>
                )}

                {/* Progress Phase */}
                {phase === 'progress' && (
                    <div data-testid="export-progress">
                        <h3 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            📦 Exporting Guild…
                        </h3>

                        {/* Progress bar */}
                        <div className="export-progress-bar" style={{
                            width: '100%', height: '20px', backgroundColor: 'var(--bg-tertiary)',
                            borderRadius: '10px', overflow: 'hidden', marginBottom: '12px'
                        }}>
                            <div className="export-progress-fill" data-testid="export-progress-bar" style={{
                                width: `${progress.progress}%`, height: '100%',
                                background: 'linear-gradient(90deg, var(--brand-experiment), #4752C4)',
                                backgroundSize: '30px 30px',
                                animation: 'progressStripe 1s linear infinite',
                                borderRadius: '10px',
                                transition: 'width 0.5s ease'
                            }} />
                        </div>

                        <p style={{ textAlign: 'center', fontSize: '18px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-normal)' }}>
                            {progress.progress}%
                        </p>

                        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                            {progress.current_step || 'Preparing export…'}
                            {progress.files_processed != null && progress.files_total != null && (
                                <span> ({progress.files_processed} / {progress.files_total} files)</span>
                            )}
                        </p>

                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <button className="wizard-btn-nav" onClick={handleCancel} data-testid="export-cancel-btn">
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {/* Done Phase */}
                {phase === 'done' && (
                    <div data-testid="export-done" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
                        <h3 style={{ marginBottom: '12px', color: '#23a559' }}>Export Complete!</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px' }}>
                            Your backup has been saved. You can use this file to import the guild on any Harmony node.
                        </p>
                        {progress.download_url && (
                            <button
                                data-testid="export-download-btn"
                                className="btn"
                                onClick={() => triggerDownload(progress.download_url!)}
                                style={{ marginBottom: '12px' }}
                            >
                                Download Again
                            </button>
                        )}
                        <div>
                            <button className="wizard-btn-nav" onClick={onClose}>Close</button>
                        </div>
                    </div>
                )}

                {/* Error Phase */}
                {phase === 'error' && (
                    <div data-testid="export-error">
                        <h3 style={{ marginBottom: '12px', color: '#ed4245' }}>Export Failed</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px' }}>{errorMsg}</p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button className="wizard-btn-nav" onClick={onClose}>Close</button>
                            <button className="btn" onClick={startExport}>Retry</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

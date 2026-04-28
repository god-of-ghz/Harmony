import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { ExportModal } from './ExportModal';
import { ImportModal } from './ImportModal';

interface Props {
    guildId: string;
    serverUrl: string;
}

/** Format bytes to human-readable string */
export const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const ExportImportSection = ({ guildId, serverUrl }: Props) => {
    const { currentAccount } = useAppStore();
    const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
    const [loadingSize, setLoadingSize] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);

    useEffect(() => {
        if (!guildId || !serverUrl || !currentAccount?.token) return;
        setLoadingSize(true);
        fetch(`${serverUrl}/api/guilds/${guildId}/export/stats`, {
            headers: { 'Authorization': `Bearer ${currentAccount.token}` }
        })
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data?.total_bytes != null) setEstimatedSize(data.total_bytes); })
            .catch(console.error)
            .finally(() => setLoadingSize(false));
    }, [guildId, serverUrl, currentAccount?.token]);

    return (
        <div data-testid="export-import-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '24px', borderRadius: '8px' }}>
                <h3 style={{ marginBottom: '20px', fontSize: '18px' }}>Data & Portability</h3>

                {/* Export */}
                <div style={{ marginBottom: '24px' }}>
                    <h4 style={{ fontSize: '15px', marginBottom: '8px' }}>Export Guild</h4>
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '1.5', marginBottom: '12px' }}>
                        Download your entire guild as a portable backup.
                        Includes all messages, files, channels, roles, and settings.
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '16px' }}>
                        Estimated size: {loadingSize ? (
                            <span style={{ fontStyle: 'italic' }}>calculating…</span>
                        ) : estimatedSize != null ? (
                            <strong data-testid="export-size" style={{ color: 'var(--text-normal)' }}>~{formatBytes(estimatedSize)}</strong>
                        ) : (
                            <span style={{ fontStyle: 'italic' }}>unavailable</span>
                        )}
                    </p>
                    <button
                        data-testid="export-btn"
                        className="btn"
                        onClick={() => setShowExportModal(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}
                    >
                        📦 Export Guild
                    </button>
                </div>

                <div style={{ height: '1px', backgroundColor: 'var(--divider)', margin: '0 0 24px 0' }} />

                {/* Import */}
                <div>
                    <h4 style={{ fontSize: '15px', marginBottom: '8px' }}>Import Guild</h4>
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '1.5', marginBottom: '16px' }}>
                        Import a previously exported guild onto this server.
                        (Requires node operator permission or a provision code)
                    </p>
                    <button
                        data-testid="import-btn"
                        className="btn"
                        onClick={() => setShowImportModal(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: 'var(--bg-modifier-active)', color: 'var(--text-normal)' }}
                    >
                        📥 Import Guild Bundle
                    </button>
                </div>
            </div>

            {showExportModal && (
                <ExportModal
                    guildId={guildId}
                    serverUrl={serverUrl}
                    estimatedSize={estimatedSize}
                    onClose={() => setShowExportModal(false)}
                />
            )}

            {showImportModal && (
                <ImportModal
                    serverUrl={serverUrl}
                    onClose={() => setShowImportModal(false)}
                />
            )}
        </div>
    );
};

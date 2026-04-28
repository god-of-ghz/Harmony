import { useState } from 'react';
import { useAppStore } from '../../store/appStore';

interface Props {
    guildId: string;
    guildName: string;
    serverUrl: string;
    onClose: () => void;
}

export const DangerZoneSection = ({ guildId, guildName, serverUrl, onClose }: Props) => {
    const { currentAccount, setActiveGuildId } = useAppStore();
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [confirmName, setConfirmName] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');

    const isNameMatch = confirmName === guildName;

    const handleDelete = async () => {
        if (!isNameMatch || !currentAccount?.token) return;
        setDeleting(true);
        setError('');
        try {
            const res = await fetch(`${serverUrl}/api/guilds/${guildId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Delete failed (${res.status})`);
            }
            // Success: redirect to home
            setActiveGuildId('');
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to delete guild');
            setDeleting(false);
        }
    };

    return (
        <div data-testid="danger-zone-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="danger-zone" style={{
                backgroundColor: 'rgba(237, 66, 69, 0.06)',
                border: '1px solid rgba(237, 66, 69, 0.3)',
                padding: '24px',
                borderRadius: '8px'
            }}>
                <h3 style={{ marginBottom: '16px', fontSize: '18px', color: '#ed4245' }}>Danger Zone</h3>

                <div>
                    <h4 style={{ fontSize: '15px', marginBottom: '8px', color: '#ed4245', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        ⚠ Delete Guild
                    </h4>
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '1.5', marginBottom: '16px' }}>
                        Permanently delete this guild and all its data. This action cannot be undone.
                    </p>
                    <button
                        data-testid="delete-guild-btn"
                        className="btn"
                        onClick={() => setShowDeleteConfirm(true)}
                        style={{
                            backgroundColor: '#ed4245',
                            padding: '10px 20px',
                            fontWeight: 600
                        }}
                    >
                        Delete Guild
                    </button>
                </div>
            </div>

            {/* Confirmation Dialog */}
            {showDeleteConfirm && (
                <div data-testid="delete-confirm-dialog" style={{
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10001
                }}>
                    <div className="glass-panel" style={{ padding: '24px', borderRadius: '8px', maxWidth: '440px', width: '90%' }}>
                        <h3 style={{ marginBottom: '12px', color: '#ed4245' }}>⚠ Permanently Delete Guild</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '16px', lineHeight: '1.5' }}>
                            This will permanently delete <strong style={{ color: 'var(--text-normal)' }}>{guildName}</strong> and all its data including messages, channels, roles, and uploaded files.
                        </p>
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '12px' }}>
                            Type <strong style={{ color: 'var(--text-normal)' }}>{guildName}</strong> to confirm:
                        </p>
                        <input
                            data-testid="delete-confirm-input"
                            type="text"
                            value={confirmName}
                            onChange={e => setConfirmName(e.target.value)}
                            placeholder={guildName}
                            style={{
                                width: '100%', padding: '10px 12px', borderRadius: '4px', border: 'none',
                                backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)',
                                fontFamily: 'inherit', fontSize: '14px', marginBottom: '16px'
                            }}
                        />
                        {error && (
                            <p style={{ color: '#ed4245', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
                        )}
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button
                                data-testid="delete-cancel-btn"
                                className="wizard-btn-nav"
                                onClick={() => { setShowDeleteConfirm(false); setConfirmName(''); setError(''); }}
                            >
                                Cancel
                            </button>
                            <button
                                data-testid="delete-confirm-btn"
                                className="btn"
                                disabled={!isNameMatch || deleting}
                                onClick={handleDelete}
                                style={{
                                    backgroundColor: isNameMatch ? '#ed4245' : 'var(--bg-modifier-hover)',
                                    cursor: isNameMatch && !deleting ? 'pointer' : 'not-allowed',
                                    opacity: isNameMatch ? 1 : 0.5,
                                    fontWeight: 600
                                }}
                            >
                                {deleting ? 'Deleting…' : 'Delete Guild'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

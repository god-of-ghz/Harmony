import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { Profile } from '../../store/appStore';

interface Props {
    guildId: string;
    serverUrl: string;
    profiles: Profile[];
    currentProfile: Profile;
}

export const OwnershipSection = ({ guildId, serverUrl, profiles, currentProfile }: Props) => {
    const { currentAccount } = useAppStore();
    const [selectedMemberId, setSelectedMemberId] = useState('');
    const [showConfirm, setShowConfirm] = useState(false);
    const [transferring, setTransferring] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    // Filter eligible members: ADMIN or OWNER, excluding current user
    const eligibleMembers = profiles.filter(
        p => (p.role === 'ADMIN' || p.role === 'OWNER') && p.id !== currentProfile.id
    );

    const handleTransfer = async () => {
        if (!selectedMemberId || !currentAccount?.token) return;
        setTransferring(true);
        setError('');
        try {
            const res = await fetch(`${serverUrl}/api/guilds/${guildId}/transfer-ownership`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                },
                body: JSON.stringify({ newOwnerProfileId: selectedMemberId })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Transfer failed (${res.status})`);
            }
            setSuccess(true);
            setShowConfirm(false);
        } catch (err: any) {
            setError(err.message || 'Transfer failed');
        } finally {
            setTransferring(false);
        }
    };

    if (success) {
        return (
            <div data-testid="ownership-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ backgroundColor: 'rgba(35, 165, 89, 0.1)', border: '1px solid rgba(35, 165, 89, 0.3)', padding: '24px', borderRadius: '8px', textAlign: 'center' }}>
                    <span style={{ fontSize: '32px' }}>✓</span>
                    <h3 style={{ marginTop: '8px', color: '#23a559' }}>Ownership Transferred</h3>
                    <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>Guild ownership has been transferred successfully.</p>
                </div>
            </div>
        );
    }

    return (
        <div data-testid="ownership-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '24px', borderRadius: '8px' }}>
                <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Guild Ownership</h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 24px', fontSize: '14px', marginBottom: '24px' }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Current Owner</span>
                    <span data-testid="current-owner">{currentProfile.nickname}</span>
                </div>

                <div style={{ borderTop: '1px solid var(--divider)', paddingTop: '20px' }}>
                    <h4 style={{ fontSize: '15px', marginBottom: '8px' }}>Transfer Ownership</h4>
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px', lineHeight: '1.5' }}>
                        Transfer this guild to another member. They will become the guild owner and you will be demoted to Admin.
                    </p>

                    {eligibleMembers.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
                            No eligible members found. Only Admins can receive ownership.
                        </p>
                    ) : (
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <label htmlFor="transfer-target" style={{ color: 'var(--text-muted)', fontSize: '13px', whiteSpace: 'nowrap' }}>Transfer to:</label>
                            <select
                                id="transfer-target"
                                data-testid="transfer-select"
                                value={selectedMemberId}
                                onChange={e => setSelectedMemberId(e.target.value)}
                                style={{
                                    flex: 1, padding: '8px 12px', borderRadius: '4px', border: 'none',
                                    backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)',
                                    fontFamily: 'inherit', fontSize: '14px'
                                }}
                            >
                                <option value="">Select a member…</option>
                                {eligibleMembers.map(m => (
                                    <option key={m.id} value={m.id}>{m.nickname} ({m.role})</option>
                                ))}
                            </select>
                            <button
                                data-testid="transfer-btn"
                                className="btn"
                                disabled={!selectedMemberId || transferring}
                                onClick={() => setShowConfirm(true)}
                                style={{ padding: '8px 16px', whiteSpace: 'nowrap' }}
                            >
                                Transfer Ownership
                            </button>
                        </div>
                    )}

                    {error && (
                        <div style={{ marginTop: '12px', color: '#ed4245', fontSize: '13px', padding: '8px 12px', backgroundColor: 'rgba(237, 66, 69, 0.1)', borderRadius: '4px' }}>
                            {error}
                        </div>
                    )}

                    <div style={{ marginTop: '16px', padding: '10px 14px', backgroundColor: 'rgba(250, 166, 26, 0.08)', border: '1px solid rgba(250, 166, 26, 0.25)', borderRadius: '6px', fontSize: '12px', color: '#faa61a' }}>
                        ⚠ This action cannot be undone without the new owner's cooperation.
                    </div>
                </div>
            </div>

            {/* Confirmation Dialog */}
            {showConfirm && (
                <div data-testid="transfer-confirm-dialog" style={{
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10001
                }}>
                    <div className="glass-panel" style={{ padding: '24px', borderRadius: '8px', maxWidth: '420px', width: '90%' }}>
                        <h3 style={{ marginBottom: '12px', color: '#faa61a' }}>⚠ Confirm Transfer</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px', lineHeight: '1.5' }}>
                            Are you sure you want to transfer ownership to <strong style={{ color: 'var(--text-normal)' }}>
                                {eligibleMembers.find(m => m.id === selectedMemberId)?.nickname}
                            </strong>? You will be demoted to Admin.
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button
                                data-testid="transfer-cancel-btn"
                                className="wizard-btn-nav"
                                onClick={() => setShowConfirm(false)}
                            >
                                Cancel
                            </button>
                            <button
                                data-testid="transfer-confirm-btn"
                                className="btn"
                                disabled={transferring}
                                onClick={handleTransfer}
                                style={{ backgroundColor: '#faa61a', color: '#000', fontWeight: 600 }}
                            >
                                {transferring ? 'Transferring…' : 'Confirm Transfer'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';

interface UnclaimedProfile {
    id: string;
    global_name: string;
    avatar: string;
    bio?: string;
}

export const GlobalClaimProfile = () => {
    const { currentAccount, unclaimedProfiles, setUnclaimedProfiles, setDismissedGlobalClaim, isGuestSession, knownServers } = useAppStore();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUnclaimed = async () => {
            if (!currentAccount?.token || isGuestSession) {
                setLoading(false);
                return;
            }
            try {
                const res = await fetch('/api/accounts/unclaimed-imports', {
                    headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setUnclaimedProfiles(data);
                }
            } catch (err) {
                console.error('Failed to fetch unclaimed profiles:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchUnclaimed();
    }, [currentAccount?.token, isGuestSession, setUnclaimedProfiles]);

    const handleDismiss = async () => {
        if (!currentAccount?.token) return;
        try {
            const res = await fetch('/api/accounts/dismiss-claim', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (res.ok) {
                setDismissedGlobalClaim(true);
            }
        } catch (err) {
            console.error('Failed to dismiss claim:', err);
        }
    };

    const handleClaim = async (discord_id: string) => {
        if (!currentAccount?.token) return;
        try {
            const res = await fetch('/api/accounts/link-discord', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}` 
                },
                body: JSON.stringify({ discord_id })
            });
            if (res.ok) {
                setDismissedGlobalClaim(true);
                // Refresh to get new profiles across all servers
                window.location.reload();
            }
        } catch (err) {
            console.error('Failed to link discord:', err);
        }
    };

    if (loading || isGuestSession || (unclaimedProfiles || []).length === 0) return null;

    return (
        <div id="global-claim-modal" style={{
            position: 'fixed', inset: 0, zIndex: 3000, 
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)'
        }}>
            <div className="glass-panel" style={{
                width: '600px', padding: '40px', borderRadius: '16px',
                display: 'flex', flexDirection: 'column', gap: '24px',
                animation: 'modalSlideUp 0.3s ease-out'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <h1 style={{ fontSize: '28px', marginBottom: '8px', color: 'var(--header-primary)' }}>Claim Your Profiles</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '15px' }}>
                        We found Discord profiles that might belong to you. Claiming them will restore your past server identities and shared history.
                    </p>
                </div>

                <div 
                    id="unclaimed-grid"
                    style={{ 
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', 
                    gap: '16px', maxHeight: '400px', overflowY: 'auto', padding: '4px'
                }}>
                    {(unclaimedProfiles as unknown as UnclaimedProfile[]).map(u => (
                        <div 
                            key={u.id}
                            onClick={() => handleClaim(u.id)}
                            className="claim-card"
                            style={{
                                backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', padding: '16px',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
                                cursor: 'pointer', transition: 'all 0.2s', border: '1px solid rgba(255,255,255,0.05)',
                                position: 'relative', overflow: 'hidden'
                            }}
                        >
                            <img 
                                src={u.avatar && typeof u.avatar === 'string' ? (u.avatar.startsWith('http') ? u.avatar : `${knownServers?.[0] || ''}${u.avatar}`) : 'https://cdn.discordapp.com/embed/avatars/0.png'} 
                                alt={u.global_name}
                                style={{ width: '64px', height: '64px', borderRadius: '50%', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
                            />
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--header-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100px' }}>
                                    {u.global_name}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px' }}>
                    <button 
                        id="start-fresh-btn"
                        onClick={handleDismiss} 
                        style={{ 
                            background: 'transparent', border: 'none', color: 'var(--text-muted)', 
                            cursor: 'pointer', textDecoration: 'underline', fontSize: '13px',
                            transition: 'color 0.2s'
                        }}
                    >
                        I don't recognize these (Start Fresh)
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes modalSlideUp {
                    from { transform: translateY(30px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                .claim-card:hover {
                    background-color: var(--bg-modifier-hover) !important;
                    border-color: var(--brand-experiment) !important;
                    transform: translateY(-4px);
                    box-shadow: 0 10px 20px rgba(0,0,0,0.4);
                }
                .claim-card:active {
                    transform: translateY(-1px);
                }
                #unclaimed-grid::-webkit-scrollbar { width: 6px; }
                #unclaimed-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
            `}</style>
        </div>
    );
};

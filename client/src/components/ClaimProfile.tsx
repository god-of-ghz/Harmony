import { useEffect, useState } from 'react';
import type { Profile } from '../store/appStore';
import { useAppStore } from '../store/appStore';

export const ClaimProfile = ({ serverId }: { serverId: string }) => {
    const { currentAccount, addClaimedProfile, serverUrl } = useAppStore();
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [freshName, setFreshName] = useState('');
    const [isFreshStart, setIsFreshStart] = useState(false);

    useEffect(() => {
        fetch(`${serverUrl}/api/servers/${serverId}/profiles`)
            .then(res => res.json())
            .then(data => {
                setProfiles(data);
                setLoading(false);
            })
            .catch(console.error);
    }, [serverId, serverUrl]);

    const handleClaim = (profileId: string) => {
        if (!currentAccount) return; // Ensure currentAccount exists
        fetch(`${serverUrl}/api/profiles/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId, serverId, accountId: currentAccount.id })
        })
            .then(res => res.json())
            .then(result => {
                if (result.success) {
                    const profile = profiles.find(p => p.id === profileId);
                    if (profile) {
                        addClaimedProfile({ ...profile, account_id: currentAccount.id });
                    }
                }
            })
            .catch(console.error);
    };

    const handleFreshStart = (e: React.FormEvent) => {
        e.preventDefault();
        if (!freshName.trim() || !currentAccount) return;

        fetch(`${serverUrl}/api/servers/${serverId}/profiles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: currentAccount.id, nickname: freshName })
        })
            .then(res => res.json())
            .then(newProfile => {
                addClaimedProfile(newProfile);
            })
            .catch(console.error);
    };

    if (loading) {
        return <div style={{ color: 'white', padding: '24px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading available profiles...</div>;
    }

    const unclaimedProfiles = profiles.filter(p => !p.account_id);
    const filteredProfiles = unclaimedProfiles.filter(p => p.original_username.toLowerCase().includes(search.toLowerCase()));

    return (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
            <div className="glass-panel" style={{ padding: '32px', borderRadius: '12px', width: '450px', maxWidth: '90%' }}>
                <h2 style={{ textAlign: 'center', marginBottom: '8px', color: 'var(--text-normal)' }}>Join Server</h2>
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginBottom: '24px' }}>Claim your old Discord identity or start fresh.</p>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    <button
                        style={{
                            flex: 1, padding: '8px', border: 'none', borderRadius: '4px', cursor: 'pointer',
                            backgroundColor: !isFreshStart ? 'var(--brand-experiment)' : 'var(--bg-tertiary)', color: 'white'
                        }}
                        onClick={() => setIsFreshStart(false)}
                    >Claim Existing</button>
                    <button
                        style={{
                            flex: 1, padding: '8px', border: 'none', borderRadius: '4px', cursor: 'pointer',
                            backgroundColor: isFreshStart ? 'var(--brand-experiment)' : 'var(--bg-tertiary)', color: 'white'
                        }}
                        onClick={() => setIsFreshStart(true)}
                    >Fresh Start</button>
                </div>

                {!isFreshStart ? (
                    <>
                        <input
                            type="text"
                            placeholder="Search by username..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            style={{ width: '100%', padding: '10px', marginBottom: '16px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)' }}
                        />
                        {unclaimedProfiles.length === 0 ? (
                            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No unclaimed profiles limit found on this server.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto', paddingRight: '8px' }}>
                                {filteredProfiles.map(p => (
                                    <div
                                        key={p.id}
                                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px' }}
                                    >
                                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--brand-experiment)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                            {p.original_username.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div style={{ flex: 1, fontWeight: '500', color: 'var(--text-normal)' }}>{p.original_username}</div>
                                        <button className="btn" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={() => handleClaim(p.id)}>Claim</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <form onSubmit={handleFreshStart} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Choose a Nickname</label>
                            <input
                                type="text"
                                value={freshName}
                                onChange={e => setFreshName(e.target.value)}
                                required
                                style={{ padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)' }}
                            />
                        </div>
                        <button type="submit" className="btn" style={{ padding: '10px', fontWeight: 'bold' }}>Join Server</button>
                    </form>
                )}
            </div>
        </div>
    );
};

import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import type { Relationship, GlobalProfile } from '../store/appStore';
import { Check, X, UserPlus, UserMinus, MessageSquare } from 'lucide-react';
import { useUserInteraction } from '../hooks/useUserInteraction';

export const FriendsList = () => {
    const { currentAccount, connectedServers, relationships, setRelationships, globalProfiles } = useAppStore();
    const [tab, setTab] = useState<'online' | 'all' | 'pending' | 'add'>('online');
    const [addInput, setAddInput] = useState('');
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    const safe = Array.isArray(connectedServers) ? connectedServers : [];
    const homeServer = currentAccount?.primary_server_url || safe[0]?.url || '';

    useEffect(() => {
        if (!currentAccount || !homeServer) return;
        fetch(`${homeServer}/api/accounts/relationships`, {
            headers: { 'Authorization': `Bearer ${currentAccount.token}` }
        })
        .then(res => res.ok ? res.json() : [])
        .then(data => {
            if (Array.isArray(data)) setRelationships(data);
        })
        .catch(console.error);
    }, [currentAccount, homeServer, setRelationships]);

    // Fetch profiles for all relationship targets
    useEffect(() => {
        if (!homeServer) return;
        const missingProfiles = relationships.map(r => r.account_id === currentAccount?.id ? r.target_id : r.account_id)
            .filter(id => !globalProfiles[id]);

        missingProfiles.forEach(id => {
            fetch(`${homeServer}/api/accounts/${id}/profile`, {
                headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
            })
                .then(res => res.ok ? res.json() : null)
                .then(profile => {
                    if (profile) useAppStore.getState().updateGlobalProfile(profile);
                })
                .catch(console.error);
        });
    }, [relationships, homeServer, currentAccount, globalProfiles]);


    const handleSendRequest = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMsg('');
        if (!addInput.trim() || !homeServer || !currentAccount) return;

        try {
            const res = await fetch(`${homeServer}/api/accounts/relationships/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentAccount.token}` },
                body: JSON.stringify({ targetId: addInput.trim() })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to send request');
            setSuccessMsg('Friend request sent!');
            setAddInput('');
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleAccept = async (targetId: string) => {
        if (!homeServer || !currentAccount) return;
        try {
            const res = await fetch(`${homeServer}/api/accounts/relationships/accept`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentAccount.token}` },
                body: JSON.stringify({ targetId })
            });
            if (!res.ok) throw new Error('Failed to accept');
        } catch (err: any) {
            console.error(err);
        }
    };

    const handleRemove = async (targetId: string) => {
        if (!homeServer || !currentAccount) return;
        try {
            const res = await fetch(`${homeServer}/api/accounts/relationships/${targetId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (!res.ok) throw new Error('Failed to remove');
        } catch (err: any) {
            console.error(err);
        }
    };

    const pendingRequests = relationships.filter(r => r.status === 'pending');
    const incomingRequests = pendingRequests.filter(r => r.target_id === currentAccount?.id);
    const outgoingRequests = pendingRequests.filter(r => r.account_id === currentAccount?.id);
    
    const friends = relationships.filter(r => r.status === 'friend');

    const getTargetId = (r: any) => r.account_id === currentAccount?.id ? r.target_id : r.account_id;
    const getProfile = (r: any) => globalProfiles[getTargetId(r)];

    return (
        <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', color: 'var(--text-normal)' }}>
            {/* Header */}
            <div style={{ height: '48px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '16px' }}>
                <span style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserPlus size={20} color="var(--text-muted)" /> Friends
                </span>
                <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--divider)' }}></div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn" style={{ backgroundColor: tab === 'online' ? 'var(--bg-modifier-selected)' : 'transparent', color: tab === 'online' ? 'white' : 'var(--interactive-normal)' }} onClick={() => setTab('online')}>Online</button>
                    <button className="btn" style={{ backgroundColor: tab === 'all' ? 'var(--bg-modifier-selected)' : 'transparent', color: tab === 'all' ? 'white' : 'var(--interactive-normal)' }} onClick={() => setTab('all')}>All</button>
                    <button className="btn" style={{ backgroundColor: tab === 'pending' ? 'var(--bg-modifier-selected)' : 'transparent', color: tab === 'pending' ? 'white' : 'var(--interactive-normal)' }} onClick={() => setTab('pending')}>
                        Pending {incomingRequests.length > 0 && <span style={{ backgroundColor: 'var(--status-danger)', color: 'white', borderRadius: '50%', padding: '2px 6px', fontSize: '12px', marginLeft: '4px' }}>{incomingRequests.length}</span>}
                    </button>
                    <button className="btn" style={{ backgroundColor: 'var(--status-positive)', color: 'white' }} onClick={() => setTab('add')}>Add Friend</button>
                </div>
            </div>

            {/* List Body */}
            <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
                {tab === 'add' && (
                    <div>
                        <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>ADD FRIEND</h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '16px' }}>You can add a friend with their Account ID.</p>
                        <form onSubmit={handleSendRequest} style={{ display: 'flex', gap: '12px', backgroundColor: 'var(--bg-tertiary)', padding: '12px', borderRadius: '8px' }}>
                            <input
                                value={addInput}
                                onChange={e => setAddInput(e.target.value)}
                                placeholder="Enter Account ID"
                                style={{ flex: 1, backgroundColor: 'transparent', border: 'none', color: 'white', outline: 'none' }}
                            />
                            <button type="submit" className="btn" style={{ backgroundColor: 'var(--brand-experiment)', color: 'white' }}>Send Friend Request</button>
                        </form>
                        {successMsg && <div style={{ color: 'var(--status-positive)', marginTop: '8px' }}>{successMsg}</div>}
                        {error && <div style={{ color: 'var(--status-danger)', marginTop: '8px' }}>{error}</div>}
                    </div>
                )}

                {tab === 'pending' && (
                    <div>
                        <h2 style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: '16px' }}>PENDING - {pendingRequests.length}</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {incomingRequests.map((r, i) => {
                                const profile = getProfile(r);
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', borderTop: '1px solid var(--divider)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--brand-experiment)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {profile?.account_id.substring(0, 2).toUpperCase() || '?'}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 'bold' }}>{profile?.account_id || r.account_id}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Incoming Friend Request</div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={() => handleAccept(r.account_id)} style={{ padding: '8px', borderRadius: '50%', backgroundColor: 'var(--bg-modifier-selected)', color: 'var(--status-positive)', border: 'none', cursor: 'pointer' }}><Check size={16} /></button>
                                            <button onClick={() => handleRemove(r.account_id)} style={{ padding: '8px', borderRadius: '50%', backgroundColor: 'var(--bg-modifier-selected)', color: 'var(--status-danger)', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
                                        </div>
                                    </div>
                                );
                            })}
                            {outgoingRequests.map((r, i) => {
                                const profile = getProfile(r);
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', borderTop: '1px solid var(--divider)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--brand-experiment)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {profile?.account_id.substring(0, 2).toUpperCase() || '?'}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 'bold' }}>{profile?.account_id || r.target_id}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Outgoing Friend Request</div>
                                            </div>
                                        </div>
                                        <button onClick={() => handleRemove(r.target_id)} style={{ padding: '8px', borderRadius: '50%', backgroundColor: 'var(--bg-modifier-selected)', color: 'var(--status-danger)', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {(tab === 'all' || tab === 'online') && (
                    <div>
                        <h2 style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: '16px' }}>ALL FRIENDS - {friends.length}</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {friends.map((r, i) => {
                                const targetId = getTargetId(r);
                                const profile = getProfile(r);
                                return (
                                    <FriendRow
                                        key={i}
                                        targetId={targetId}
                                        profile={profile}
                                        onRemove={handleRemove}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Extracted sub-component to allow useUserInteraction hook ──

const FriendRow = ({ targetId, profile, onRemove }: { targetId: string; profile: GlobalProfile | undefined; onRemove: (id: string) => void }) => {
    // Use a stable profileId — account_id serves as the identifier in global context
    const userInteraction = useUserInteraction({
        profileId: targetId,
        accountId: targetId,
        guildId: '', // global context — no guild-specific moderation
    });

    return (
        <div className="friend-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', borderTop: '1px solid var(--divider)', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }} onContextMenu={userInteraction.onContextMenu} onClick={userInteraction.onClick}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--brand-experiment)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {profile?.account_id.substring(0, 2).toUpperCase() || '?'}
                </div>
                <div>
                    <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {targetId}
                    </div>
                    {profile?.status_message && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{profile.status_message}</div>}
                </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
                <button style={{ padding: '8px', borderRadius: '50%', backgroundColor: 'var(--bg-tertiary)', color: 'var(--interactive-normal)', border: 'none', cursor: 'pointer' }}><MessageSquare size={16} /></button>
                <button onClick={() => onRemove(targetId)} style={{ padding: '8px', borderRadius: '50%', backgroundColor: 'var(--bg-tertiary)', color: 'var(--interactive-normal)', border: 'none', cursor: 'pointer' }}><UserMinus size={16} /></button>
            </div>
        </div>
    );
};


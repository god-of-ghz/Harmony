import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { MessageSquare, Plus } from 'lucide-react';

export const DMSidebar = () => {
    const { currentAccount, knownServers, trustedServers, activeChannelId, setActiveChannelId, presenceMap, unreadChannels } = useAppStore();
    const [dms, setDms] = useState<any[]>([]);
    const [showNewDMModal, setShowNewDMModal] = useState(false);
    const [newDMEmail, setNewDMEmail] = useState('');

    const fetchDMs = async () => {
        if (!currentAccount) return;
        const homeServer = knownServers[0] || trustedServers[0];
        if (!homeServer) return;

        try {
            const res = await fetch(`${homeServer}/api/dms`, {
                headers: { 'X-Account-Id': currentAccount.id }
            });
            if (res.ok) {
                const data = await res.json();
                setDms(data);
            }
        } catch (err) {
            console.error("Failed to fetch DMs", err);
        }
    };

    useEffect(() => {
        fetchDMs();
        const interval = setInterval(fetchDMs, 10000);
        return () => clearInterval(interval);
    }, [currentAccount, knownServers, trustedServers]);

    const handleCreateDM = async (e: React.FormEvent) => {
        e.preventDefault();
        setNewDMEmail('');
        setShowNewDMModal(false);

        // Not implemented email address lookup right now.
        // For simplicity, we just prompt an email or profile ID
        alert("Creating DMs by account ID isn't wired up to full user search yet! Use the mock endpoints or implement User Search.");
    };

    return (
        <div style={{
            width: 'var(--channel-sidebar-width)',
            backgroundColor: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--divider)'
        }}>
            {/* Header */}
            <div style={{
                height: '48px',
                borderBottom: '1px solid var(--divider)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 16px',
                fontWeight: 'bold',
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                justifyContent: 'space-between'
            }}>
                <span style={{ cursor: 'pointer' }}>Direct Messages</span>
                <Plus size={18} style={{ cursor: 'pointer', color: 'var(--interactive-normal)' }} onClick={() => setShowNewDMModal(true)} />
            </div>

            {/* DM List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {dms.map(dm => {
                    const isActive = activeChannelId === dm.id;
                    const peerId = dm.participants?.find((p: string) => p !== currentAccount?.id);
                    const presence = peerId ? presenceMap[peerId] : null;
                    return (
                        <div
                            key={dm.id}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                backgroundColor: isActive ? 'var(--bg-modifier-selected)' : 'transparent',
                                color: isActive ? 'var(--interactive-active)' : 'var(--interactive-normal)'
                            }}
                            onClick={() => setActiveChannelId(dm.id, dm.name || 'DM')}
                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)' }}
                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent' }}
                        >
                            <div style={{ position: 'relative', width: '32px', height: '32px', borderRadius: '16px', backgroundColor: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <MessageSquare size={16} />
                                {presence && presence.status !== 'offline' && (
                                    <div style={{
                                        position: 'absolute',
                                        bottom: 0, right: 0,
                                        width: '10px', height: '10px',
                                        borderRadius: '50%',
                                        backgroundColor: presence.status === 'online' ? '#23a559' : presence.status === 'idle' ? '#faa61a' : '#ed4245',
                                        border: '2px solid var(--bg-secondary)'
                                    }} />
                                )}
                            </div>
                            <span style={{ fontWeight: 500, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: unreadChannels.has(dm.id) && !isActive ? 'var(--text-normal)' : undefined }}>
                                {dm.name || peerId || 'Unknown User'}
                            </span>
                            {unreadChannels.has(dm.id) && !isActive && (
                                <div style={{ width: '16px', height: '16px', borderRadius: '8px', backgroundColor: 'var(--status-danger)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>
                                    !
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {showNewDMModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
                    <div className="glass-panel" style={{ padding: '32px', borderRadius: '8px', width: '400px', color: 'var(--text-normal)' }}>
                        <h2 style={{ marginBottom: '16px' }}>Start a Conversation</h2>
                        <form onSubmit={handleCreateDM} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <input
                                type="text"
                                placeholder="Account ID"
                                required
                                value={newDMEmail}
                                onChange={e => setNewDMEmail(e.target.value)}
                                style={{ padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'white' }}
                            />
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                <button type="button" onClick={() => setShowNewDMModal(false)} style={{ flex: 1, padding: '10px', border: '1px solid var(--background-modifier-accent)', backgroundColor: 'transparent', color: 'white', cursor: 'pointer', borderRadius: '4px' }}>Cancel</button>
                                <button type="submit" className="btn" style={{ flex: 1, padding: '10px', fontWeight: 'bold' }}>Start Chat</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import type { ServerData } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { Home, Plus, FolderSync, LogOut } from 'lucide-react';

export const ServerSidebar = () => {
    const [servers, setServers] = useState<ServerData[]>([]);
    const { activeServerId, setActiveServerId, currentAccount, knownServers, trustedServers, setServerMap, setClaimedProfiles, setTrustedServers } = useAppStore();
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, serverId: string } | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newServerUrl, setNewServerUrl] = useState('');

    const fetchServers = async () => {
        if (!currentAccount) return;
        const allUrls = Array.from(new Set([...trustedServers, ...knownServers]));
        const allServers: ServerData[] = [];
        const newMap: Record<string, string> = {};
        const allProfiles: any[] = [];
        await Promise.all(allUrls.map(async (url) => {
            try {
                const res = await fetch(`${url}/api/servers`, { headers: { 'X-Account-Id': currentAccount.id } });
                if (res.ok) {
                    const data = await res.json();
                    for (const s of data) {
                        if (!newMap[s.id]) {
                            allServers.push(s);
                            newMap[s.id] = url;
                        }
                    }
                }
                const profRes = await fetch(`${url}/api/accounts/${currentAccount.id}/profiles`);
                if (profRes.ok) {
                    const profiles = await profRes.json();
                    allProfiles.push(...profiles);
                }
            } catch (err) {
                console.error(`Failed to fetch from ${url}`, err);
            }
        }));

        setServers(allServers);
        setServerMap(newMap);
        setClaimedProfiles(allProfiles);

        if (allServers.length > 0 && !useAppStore.getState().activeServerId) {
            setActiveServerId(allServers[0].id);
        }
    };

    useEffect(() => {
        fetchServers();
    }, [currentAccount, knownServers.join(','), trustedServers.join(',')]);

    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    const handleContextMenu = (e: MouseEvent, serverId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.pageX, y: e.pageY, serverId });
    };

    const handleDelete = (serverId: string) => {
        if (!currentAccount) return;
        const sUrl = useAppStore.getState().serverMap[serverId];
        if (!sUrl) return;

        fetch(`${sUrl}/api/servers/${serverId}`, {
            method: 'DELETE',
            headers: { 'X-Account-Id': currentAccount.id }
        })
            .then(res => res.json())
            .then(result => {
                if (result.success) {
                    if (activeServerId === serverId) setActiveServerId('');
                    fetchServers();
                }
            })
            .catch(console.error);
    };

    const handleAddServer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentAccount || !newServerUrl.trim()) return;

        const targetUrl = newServerUrl.trim().replace(/\/$/, ""); // trim trailing slash

        try {
            // Register this new server as trusted on our Home server so we roam
            // The Home server will automatically push our Identity payload to the new server securely!
            const homeServer = knownServers[0] || trustedServers[0];
            const res = await fetch(`${homeServer}/api/accounts/${currentAccount.id}/trusted_servers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
                body: JSON.stringify({ serverUrl: targetUrl })
            });

            if (res.ok) {
                // Update client state
                setTrustedServers([...trustedServers, targetUrl]);
                setNewServerUrl('');
                setShowAddModal(false);
            } else {
                alert("Failed to add trusted server.");
            }
        } catch (err) {
            console.error("Error adding server:", err);
            alert("Network error while adding server.");
        }
    };

    return (
        <div style={{
            width: 'var(--server-sidebar-width)',
            backgroundColor: 'var(--bg-tertiary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: '12px',
            paddingBottom: '12px',
            gap: '8px',
            overflowY: 'auto'
        }}>
            <div
                className={`server-icon ${activeServerId === null ? 'active' : ''}`}
                style={{
                    width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'all 0.2s'
                }}
                onClick={() => setActiveServerId('')}
            >
                <Home size={28} />
            </div>

            <div style={{ width: '32px', height: '2px', backgroundColor: 'var(--divider)', margin: '4px 0' }} />

            {servers.map(server => (
                <div
                    key={server.id}
                    style={{
                        width: '48px', height: '48px', borderRadius: activeServerId === server.id ? '16px' : '24px',
                        backgroundColor: activeServerId === server.id ? 'var(--brand-experiment)' : 'var(--bg-primary)',
                        display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                        transition: 'all 0.2s', position: 'relative'
                    }}
                    onClick={() => setActiveServerId(server.id)}
                    onContextMenu={(e) => handleContextMenu(e, server.id)}
                >
                    {server.name.substring(0, 2).toUpperCase()}
                </div>
            ))}

            {contextMenu && (
                <div style={{
                    position: 'fixed', top: contextMenu.y, left: contextMenu.x,
                    backgroundColor: 'var(--bg-secondary)', padding: '8px',
                    borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    zIndex: 100
                }}>
                    <div
                        style={{ padding: '8px 12px', color: '#ed4245', cursor: 'pointer', borderRadius: '2px', fontWeight: '500' }}
                        onClick={() => handleDelete(contextMenu.serverId)}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-modifier-hover)'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        Delete Server
                    </div>
                </div>
            )}

            <div
                title="Add Peer Server"
                style={{
                    width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                    color: '#23a559'
                }}
                onClick={() => setShowAddModal(true)}
            >
                <Plus size={24} />
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {currentAccount?.is_creator && (
                    <div
                        title="Import Server (Creator Only)"
                        style={{
                            width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                            display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                            color: 'var(--brand-experiment)'
                        }}
                        onClick={() => {
                            const path = window.prompt("Enter the absolute path to the Discord JSON backup directory:");
                            const firstKnown = knownServers[0]; // fallback
                            if (path && firstKnown) {
                                fetch(`${firstKnown}/api/import`, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'X-Account-Id': currentAccount.id
                                    },
                                    body: JSON.stringify({ path })
                                }).then(() => alert("Import triggered! Check server logs."));
                            }
                        }}
                    >
                        <FolderSync size={24} />
                    </div>
                )}

                <div
                    title="Logout"
                    style={{
                        width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                        display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                        color: '#ed4245'
                    }}
                    onClick={() => {
                        localStorage.removeItem('harmony_account');
                        useAppStore.getState().setCurrentAccount(null);
                        useAppStore.getState().setClaimedProfiles([]);
                        useAppStore.getState().setActiveServerId('');
                    }}
                >
                    <LogOut size={24} />
                </div>
            </div>

            {showAddModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
                    <div className="glass-panel" style={{ padding: '32px', borderRadius: '8px', width: '400px', color: 'var(--text-normal)' }}>
                        <h2 style={{ marginBottom: '16px' }}>Join a Peer Server</h2>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '14px' }}>
                            Enter the URL of the Harmony server you want to join. This server will be added to your profile's trusted network.
                        </p>

                        <form onSubmit={handleAddServer} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <input
                                type="url"
                                placeholder="http://localhost:3002"
                                required
                                value={newServerUrl}
                                onChange={e => setNewServerUrl(e.target.value)}
                                style={{ padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'white' }}
                            />

                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                <button type="button" onClick={() => setShowAddModal(false)} style={{ flex: 1, padding: '10px', border: '1px solid var(--background-modifier-accent)', backgroundColor: 'transparent', color: 'white', cursor: 'pointer', borderRadius: '4px' }}>Cancel</button>
                                <button type="submit" className="btn" style={{ flex: 1, padding: '10px', fontWeight: 'bold' }}>Join Server</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

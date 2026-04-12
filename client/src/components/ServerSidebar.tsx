import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import type { ServerData } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { Home, Plus, FolderPlus, FolderSync, LogOut } from 'lucide-react';
import { clearSessionKey } from '../utils/keyStore';

export const ServerSidebar = () => {
    const [servers, setServers] = useState<ServerData[]>([]);
    const { activeServerId, setActiveServerId, currentAccount, knownServers, trustedServers, setServerMap, setTrustedServers } = useAppStore();
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, serverId: string } | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newServerUrl, setNewServerUrl] = useState('');
    const [joinError, setJoinError] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newServerName, setNewServerName] = useState('');
    const [createError, setCreateError] = useState('');

    const fetchServers = async () => {
        if (!currentAccount) return;
        const safeKnown = Array.isArray(knownServers) ? knownServers : [];
        const safeTrusted = Array.isArray(trustedServers) ? trustedServers : [];
        const allUrls = Array.from(new Set([...safeTrusted, ...safeKnown]));
        const serverResults: (ServerData[] | null)[] = new Array(allUrls.length).fill(null);
        const newMap: Record<string, string> = {};
        const allProfiles: any[] = [];

        await Promise.all(allUrls.map(async (url, index) => {
            try {
                const res = await fetch(`${url}/api/servers`, { headers: { 'Authorization': `Bearer ${currentAccount.token}` } });
                if (res.ok) {
                    const data = await res.json();
                    serverResults[index] = data;
                    for (const s of data) {
                        if (!newMap[s.id]) newMap[s.id] = url;
                    }
                }
                const profRes = await fetch(`${url}/api/accounts/${currentAccount.id}/profiles`, {
                    headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                });
                if (profRes.ok) {
                    const profiles = await profRes.json();
                    allProfiles.push(...profiles);
                }
            } catch (err) {
                console.error(`Failed to fetch from ${url}`, err);
            }
        }));

        const allServers: ServerData[] = [];
        serverResults.forEach((data) => {
            if (data) {
                for (const s of data) {
                    if (!allServers.find(existing => existing.id === s.id)) {
                        allServers.push(s);
                    }
                }
            }
        });

        setServers(allServers);
        setServerMap(newMap);
        // Use functional state update to merge and de-duplicate profiles
        useAppStore.setState((state) => {
            const combined = [...state.claimedProfiles, ...allProfiles];
            const unique = Array.from(new Map(combined.map(p => [p.id, p])).values());
            return { claimedProfiles: unique };
        });

        const showGlobalClaim = !useAppStore.getState().isGuestSession && !useAppStore.getState().dismissedGlobalClaim;

        if (allServers.length > 0 && !useAppStore.getState().activeServerId && !showGlobalClaim) {
            setActiveServerId(allServers[0].id);
        }
    };

    useEffect(() => {
        fetchServers();
    }, [currentAccount, (Array.isArray(knownServers) ? knownServers.join(',') : ''), (Array.isArray(trustedServers) ? trustedServers.join(',') : '')]);

    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    const onDragEnd = async (result: DropResult) => {
        if (!result.destination) return;
        const sourceIndex = result.source.index;
        const destIndex = result.destination.index;
        if (sourceIndex === destIndex) return;

        const newServers = Array.from(servers);
        const [moved] = newServers.splice(sourceIndex, 1);
        newServers.splice(destIndex, 0, moved);

        setServers(newServers); // Optimistic UI update

        const newUrls = newServers.map(s => useAppStore.getState().serverMap[s.id]);
        setTrustedServers(newUrls);

        if (currentAccount) {
            const updatedAccount = { ...currentAccount, trusted_servers: newUrls };
            useAppStore.getState().setCurrentAccount(updatedAccount);
            localStorage.setItem('harmony_account', JSON.stringify(updatedAccount));
        }

        const homeServer = knownServers[0] || trustedServers[0];
        if (!homeServer) return;

        try {
            await fetch(`${homeServer}/api/accounts/${currentAccount?.id}/trusted_servers/reorder`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount?.token}`
                },
                body: JSON.stringify({ trusted_servers: newUrls })
            });
        } catch (err) {
            console.error("Failed to reorder servers:", err);
        }
    };

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
            headers: { 'Authorization': `Bearer ${currentAccount.token}` }
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
        setJoinError('');

        const targetUrl = newServerUrl.trim().replace(/\/$/, ""); // trim trailing slash

        try {
            // Register this new server as trusted on our Home server so we roam
            // The Home server will automatically push our Identity payload to the new server securely!
            const homeServer = knownServers[0] || trustedServers[0];
            const res = await fetch(`${homeServer}/api/accounts/${currentAccount.id}/trusted_servers`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${currentAccount.token}` 
                },
                body: JSON.stringify({ serverUrl: targetUrl })
            });

            if (res.ok) {
                // Update client state
                const nextTrustedList = [...trustedServers, targetUrl];
                setTrustedServers(nextTrustedList);

                if (currentAccount) {
                    const updatedAccount = { ...currentAccount, trusted_servers: nextTrustedList };
                    useAppStore.getState().setCurrentAccount(updatedAccount);
                    localStorage.setItem('harmony_account', JSON.stringify(updatedAccount));
                }

                setNewServerUrl('');
                await fetchServers();
                setShowAddModal(false);
            } else {
                const errorData = await res.json().catch(() => ({}));
                setJoinError(errorData.error || "Failed to add trusted server.");
            }
        } catch (err: any) {
            console.error("Error adding server:", err);
            setJoinError("Network error while adding server: " + err.message);
        }
    };

    const handleCreateServer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentAccount || !newServerName.trim()) return;
        setCreateError('');

        const homeServer = knownServers[0] || trustedServers[0];

        try {
            const res = await fetch(`${homeServer}/api/servers`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${currentAccount.token}` 
                },
                body: JSON.stringify({ name: newServerName.trim() })
            });

            if (res.ok) {
                const data = await res.json();
                setNewServerName('');
                setShowCreateModal(false);
                await fetchServers();
                setActiveServerId(data.id);
            } else {
                const errorData = await res.json().catch(() => ({}));
                setCreateError(errorData.error || "Failed to create server.");
            }
        } catch (err: any) {
            console.error("Error creating server:", err);
            setCreateError("Network error while creating server: " + err.message);
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

            <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="servers-list">
                    {(provided) => (
                        <div {...provided.droppableProps} ref={provided.innerRef} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                            {servers.map((server, index) => (
                                <Draggable key={server.id} draggableId={server.id} index={index}>
                                    {(provided) => (
                                        <div
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            {...provided.dragHandleProps}
                                            style={{
                                                width: '48px', height: '48px', borderRadius: activeServerId === server.id ? '16px' : '24px',
                                                backgroundColor: activeServerId === server.id ? 'var(--brand-experiment)' : 'var(--bg-primary)',
                                                display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                                                transition: 'background-color 0.2s, border-radius 0.2s', position: 'relative',
                                                ...provided.draggableProps.style
                                            }}
                                            onClick={() => setActiveServerId(server.id)}
                                            onContextMenu={(e) => handleContextMenu(e, server.id)}
                                        >
                                            {server.name.substring(0, 2).toUpperCase()}
                                        </div>
                                    )}
                                </Draggable>
                            ))}
                            {provided.placeholder}
                        </div>
                    )}
                </Droppable>
            </DragDropContext>

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
                onClick={() => {
                    setJoinError('');
                    setShowAddModal(true);
                }}
            >
                <Plus size={24} />
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(currentAccount?.is_creator || currentAccount?.is_admin) && (
                    <div
                        title="Create New Server"
                        data-testid="create-server-btn"
                        style={{
                            width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                            display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                            color: 'var(--brand-experiment)'
                        }}
                        onClick={() => {
                            setCreateError('');
                            setShowCreateModal(true);
                        }}
                    >
                        <FolderPlus size={24} />
                    </div>
                )}
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
                                        'Authorization': `Bearer ${currentAccount.token}`
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
                    data-testid="logout-btn"
                    style={{
                        width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                        display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                        color: '#ed4245'
                    }}
                    onClick={() => {
                        localStorage.removeItem('harmony_account');
                        clearSessionKey().catch(console.error);
                        useAppStore.getState().setSessionPrivateKey(null);
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

                        {joinError && (
                            <div style={{ color: '#ed4245', marginBottom: '16px', fontSize: '13px', padding: '8px', backgroundColor: 'rgba(237, 66, 69, 0.1)', border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px' }}>
                                {joinError}
                            </div>
                        )}

                        <form onSubmit={handleAddServer} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <input
                                type="url"
                                placeholder="https://localhost:3002 or https://..."
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

            {showCreateModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
                    <div className="glass-panel" style={{ padding: '32px', borderRadius: '8px', width: '400px', color: 'var(--text-normal)' }}>
                        <h2 style={{ marginBottom: '16px' }}>Create Chat Server</h2>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '14px' }}>
                            Create a new portable chat server instance on this Harmony node.
                        </p>

                        {createError && (
                            <div style={{ color: '#ed4245', marginBottom: '16px', fontSize: '13px', padding: '8px', backgroundColor: 'rgba(237, 66, 69, 0.1)', border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px' }}>
                                {createError}
                            </div>
                        )}

                        <form onSubmit={handleCreateServer} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <input
                                type="text"
                                placeholder="Server Name"
                                required
                                value={newServerName}
                                onChange={e => setNewServerName(e.target.value)}
                                style={{ padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'white' }}
                            />

                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                <button type="button" onClick={() => setShowCreateModal(false)} style={{ flex: 1, padding: '10px', border: '1px solid var(--background-modifier-accent)', backgroundColor: 'transparent', color: 'white', cursor: 'pointer', borderRadius: '4px' }}>Cancel</button>
                                <button type="submit" className="btn" style={{ flex: 1, padding: '10px', fontWeight: 'bold' }}>Create Server</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

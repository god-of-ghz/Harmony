import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import type { ServerData } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { Home, Plus, FolderSync, LogOut } from 'lucide-react';

export const ServerSidebar = () => {
    const [servers, setServers] = useState<ServerData[]>([]);
    const { activeServerId, setActiveServerId, currentAccount, serverUrl } = useAppStore();
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, serverId: string } | null>(null);

    const fetchServers = () => {
        if (!currentAccount) return; // Added this check
        fetch(`${serverUrl}/api/servers`, { // Replaced 'http://localhost:3001' with `${serverUrl}`
            headers: { 'X-Account-Id': currentAccount.id } // Added headers for authentication
        })
            .then(res => res.json())
            .then(data => {
                setServers(data);
                if (data.length > 0 && !activeServerId) {
                    setActiveServerId(data[0].id);
                }
            })
            .catch(err => console.error(err));
    };

    useEffect(() => {
        fetchServers();
    }, [currentAccount, serverUrl]); // Added currentAccount and serverUrl to dependencies

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
        fetch(`${serverUrl}/api/servers/${serverId}`, { // Replaced 'http://localhost:3001' with `${serverUrl}`
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
                style={{
                    width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                    color: '#23a559'
                }}
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
                            if (path) {
                                fetch(`${serverUrl}/api/import`, { // Replaced 'http://localhost:3001' with `${serverUrl}`
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
        </div>
    );
};

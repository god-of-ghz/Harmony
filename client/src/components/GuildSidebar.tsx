import { useEffect, useState, useRef } from 'react';
import type { MouseEvent } from 'react';
import type { GuildData, Permission } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { Home, Plus, FolderSync, LogOut, Settings } from 'lucide-react';
import { clearSessionKey } from '../utils/keyStore';
import { apiFetch } from '../utils/apiFetch';
import { loadSlaCache } from '../utils/slaTracker';
import { CreateJoinModal } from './guild/CreateJoinModal';
import { GuildSetupWizard } from './guild/GuildSetupWizard';
import { NodeAdminPanel } from './NodeAdminPanel';
import { useContextMenuStore } from '../store/contextMenuStore';
import { buildGuildMenu } from './context-menu/menuBuilders';

export const GuildSidebar = () => {
    const { activeGuildId, setActiveGuildId, currentAccount, connectedServers, guildMap, setGuildMap, nodeStatus, currentUserPermissions, guilds } = useAppStore();

    const [showCreateJoinModal, setShowCreateJoinModal] = useState(false);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardProvisionCode, setWizardProvisionCode] = useState<string | undefined>(undefined);
    const [wizardTargetNodeUrl, setWizardTargetNodeUrl] = useState<string | undefined>(undefined);
    const [showAdminPanel, setShowAdminPanel] = useState(false);

    // Generation counter to prevent stale fetchGuilds responses from
    // overwriting newer ones. Each call increments this; only the latest
    // generation's results are applied. This fixes the race condition where
    // a useEffect-triggered fetch (fired before a guild join completes)
    // finishes AFTER the join-flow's fetch, overwriting the guild list
    // with stale data that excludes the newly joined guild.
    const fetchGeneration = useRef(0);

    /** Derive the "home node" URL — the primary node or first connected node. */
    const getHomeNodeUrl = (): string | undefined => {
        if (currentAccount?.primary_server_url) return currentAccount.primary_server_url;
        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        return safe[0]?.url || localStorage.getItem('harmony_last_server_url') || undefined;
    };

    const fetchGuilds = async () => {
        // Increment generation so concurrent/older fetches become stale.
        const thisGeneration = ++fetchGeneration.current;

        // Read from live store state, not the render-time closure.
        // This is critical because JoinGuildFlow may update connectedServers
        // (adding a new node) and then immediately call fetchGuilds() —
        // the closure would still have the old value.
        const { currentAccount: account, connectedServers: servers, guildMap: existingMap } = useAppStore.getState();
        if (!account) return;
        const safe = Array.isArray(servers) ? servers : [];
        const allUrls = Array.from(new Set(safe.map(s => s.url)));
        const guildResults: (GuildData[] | null)[] = new Array(allUrls.length).fill(null);
        // Start with the existing map so eager updates from JoinGuildFlow survive
        const newMap: Record<string, string> = { ...existingMap };
        const allProfiles: any[] = [];

        console.log('[fetchGuilds] gen', thisGeneration, 'Starting. URLs:', allUrls, 'existingMap:', Object.keys(existingMap));

        await Promise.all(allUrls.map(async (url, index) => {
            try {
                const res = await apiFetch(`${url}/api/guilds`, { headers: { 'Authorization': `Bearer ${account.token}` } });
                console.log('[fetchGuilds]', url, '/api/guilds =>', res.status);
                if (res.ok) {
                    const data = await res.json();
                    console.log('[fetchGuilds]', url, 'returned', data.length, 'guilds:', data.map((g: any) => g.id));
                    guildResults[index] = data;
                    for (const g of data) {
                        if (!newMap[g.id]) newMap[g.id] = url;
                    }
                } else {
                    console.warn('[fetchGuilds]', url, '/api/guilds failed:', res.status, await res.text().catch(() => ''));
                }
                const profRes = await apiFetch(`${url}/api/accounts/${account.id}/profiles`, {
                    headers: { 'Authorization': `Bearer ${account.token}` }
                });
                if (profRes.ok) {
                    const profiles = await profRes.json();
                    allProfiles.push(...profiles);
                }
            } catch (err) {
                console.error(`Failed to fetch from ${url}`, err);
            }
        }));

        // If a newer fetchGuilds call started while we were awaiting,
        // discard our stale results to avoid overwriting fresher data.
        if (thisGeneration !== fetchGeneration.current) {
            console.log('[fetchGuilds] gen', thisGeneration, 'is stale (current:', fetchGeneration.current, '), discarding results');
            return;
        }

        const allGuilds: GuildData[] = [];
        guildResults.forEach((data) => {
            if (data) {
                for (const g of data) {
                    if (!allGuilds.find(existing => existing.id === g.id)) {
                        allGuilds.push(g);
                    }
                }
            }
        });

        // Merge API results with existing guilds that are in guildMap but
        // weren't returned (e.g. guild was eagerly added by JoinGuildFlow
        // but the API doesn't return it yet because profile setup is pending).
        const existingGuilds = useAppStore.getState().guilds;
        for (const existing of existingGuilds) {
            if (newMap[existing.id] && !allGuilds.find(g => g.id === existing.id)) {
                allGuilds.push(existing);
            }
        }

        console.log('[fetchGuilds] gen', thisGeneration, 'Final map:', Object.entries(newMap), 'guilds:', allGuilds.map(g => g.id));
        useAppStore.getState().setGuilds(allGuilds);
        setGuildMap(newMap);
        // Use functional state update to merge and de-duplicate profiles
        useAppStore.setState((state) => {
            const combined = [...state.claimedProfiles, ...allProfiles];
            const unique = Array.from(new Map(combined.map(p => [`${p.id}:${p.server_id}`, p])).values());
            return { claimedProfiles: unique, profilesLoaded: true };
        });
    };


    const dismissedGlobalClaim = useAppStore(state => state.dismissedGlobalClaim);
    const isGuestSession = useAppStore(state => state.isGuestSession);

    useEffect(() => {
        const showGlobalClaim = !isGuestSession && !dismissedGlobalClaim;
        if (guilds.length > 0 && activeGuildId === null && !showGlobalClaim) {
            setActiveGuildId(guilds[0].id);
        }
    }, [guilds, activeGuildId, isGuestSession, dismissedGlobalClaim, setActiveGuildId]);

    useEffect(() => {
        fetchGuilds();
    }, [currentAccount, JSON.stringify(connectedServers)]);



    const onDragEnd = async (result: DropResult) => {
        if (!result.destination) return;
        const sourceIndex = result.source.index;
        const destIndex = result.destination.index;
        if (sourceIndex === destIndex) return;

        const reordered = Array.from(guilds);
        const [moved] = reordered.splice(sourceIndex, 1);
        reordered.splice(destIndex, 0, moved);

        useAppStore.getState().setGuilds(reordered); // Optimistic UI update

        const homeNode = getHomeNodeUrl();
        if (!homeNode || !currentAccount) return;

        // Rebuild the connected node order based on the new guild order
        const newUrls = reordered.map(g => useAppStore.getState().guildMap[g.id]).filter(Boolean);

        try {
            await apiFetch(`${homeNode}/api/accounts/${currentAccount.id}/trusted_servers/reorder`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                },
                body: JSON.stringify({ trusted_servers: newUrls })
            });
        } catch (err) {
            console.error("Failed to reorder guilds:", err);
        }
    };

    const handleContextMenu = (e: MouseEvent, guildId: string) => {
        e.preventDefault();
        const guild = guilds.find(g => g.id === guildId);
        if (!guild || !currentAccount) return;

        const items = buildGuildMenu({
            guildId,
            guildName: guild.name,
            currentPermissions: useAppStore.getState().currentUserPermissions,
            isOwner: currentAccount.is_creator ?? false,
            token: currentAccount.token ?? '',
            onRefresh: fetchGuilds,
        });

        useContextMenuStore.getState().openContextMenu(
            { x: e.pageX, y: e.pageY },
            items,
        );
    };

    /** Open the Guild Setup Wizard (P13) from the Create flow. */
    const handleStartGuildSetup = (provisionCode?: string, targetNodeUrl?: string) => {
        setShowCreateJoinModal(false);
        setWizardProvisionCode(provisionCode);
        setWizardTargetNodeUrl(targetNodeUrl);
        setWizardOpen(true);
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
                className={`server-icon ${activeGuildId === null ? 'active' : ''}`}
                style={{
                    width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'all 0.2s'
                }}
                onClick={() => setActiveGuildId('')}
            >
                <Home size={28} />
            </div>

            <div style={{ width: '32px', height: '2px', backgroundColor: 'var(--divider)', margin: '4px 0' }} />

            <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="guilds-list">
                    {(provided) => (
                        <div {...provided.droppableProps} ref={provided.innerRef} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                            {guilds.map((guild, index) => {
                                const nodeUrl = guildMap[guild.id];
                                const status = nodeUrl ? (nodeStatus?.[nodeUrl] || 'unknown') : 'unknown';
                                let indicatorColor = '';
                                let opacity = 1;
                                let filter = 'none';
                                let tooltip = guild.name;

                                if (status === 'offline') {
                                    const cache = loadSlaCache();
                                    const data = cache[nodeUrl];
                                    let offlineStart = Date.now();
                                    
                                    if (data && data.events.length > 0) {
                                        const rev = [...data.events].reverse();
                                        for (const ev of rev) {
                                            if (ev.status === 'offline') {
                                                offlineStart = ev.timestamp;
                                            } else {
                                                break;
                                            }
                                        }
                                    }
                                    const downMs = Date.now() - offlineStart;
                                    const downMins = Math.floor(downMs / 60000);
                                    
                                    if (downMs < 2 * 60 * 1000) {
                                        indicatorColor = '#faa61a';
                                        opacity = 0.7;
                                    } else {
                                        indicatorColor = '#ed4245';
                                        opacity = 0.5;
                                        filter = 'grayscale(100%)';
                                        tooltip = `${guild.name} (Unreachable for ${downMins} minutes)`;
                                    }
                                }

                                return (
                                <Draggable key={guild.id} draggableId={guild.id} index={index}>
                                    {(provided) => (
                                        <div
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            {...provided.dragHandleProps}
                                            style={{ ...provided.draggableProps.style, position: 'relative' }}
                                        >
                                            <div
                                                title={tooltip}
                                                style={{
                                                    width: '48px', height: '48px', borderRadius: activeGuildId === guild.id ? '16px' : '24px',
                                                    backgroundColor: activeGuildId === guild.id ? 'var(--brand-experiment)' : 'var(--bg-primary)',
                                                    display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                                                    transition: 'background-color 0.2s, border-radius 0.2s', position: 'relative',
                                                    opacity, filter
                                                }}
                                                onClick={() => setActiveGuildId(guild.id)}
                                                onContextMenu={(e) => handleContextMenu(e, guild.id)}
                                            >
                                                {guild.name.substring(0, 2).toUpperCase()}
                                            </div>
                                            {indicatorColor && (
                                                <div style={{
                                                    position: 'absolute', bottom: -2, right: -2,
                                                    width: '14px', height: '14px', borderRadius: '50%',
                                                    backgroundColor: indicatorColor, border: '3px solid var(--bg-tertiary)',
                                                    zIndex: 2
                                                }} />
                                            )}
                                        </div>
                                    )}
                                </Draggable>
                                );
                            })}
                            {provided.placeholder}
                        </div>
                    )}
                </Droppable>
            </DragDropContext>



            <div
                title="Create or Join a Guild"
                data-testid="create-join-btn"
                style={{
                    width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                    color: '#23a559', transition: 'border-radius 0.2s'
                }}
                onClick={() => setShowCreateJoinModal(true)}
            >
                <Plus size={24} />
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {currentAccount?.is_creator && (
                    <div
                        title="Node Admin Panel"
                        data-testid="admin-panel-btn"
                        style={{
                            width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                            display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                            color: 'var(--brand-experiment)'
                        }}
                        onClick={() => setShowAdminPanel(true)}
                    >
                        <Settings size={24} />
                    </div>
                )}
                {currentAccount?.is_creator && (
                    <div
                        title="Import Guild (Creator Only)"
                        data-testid="import-guild-btn"
                        style={{
                            width: '48px', height: '48px', borderRadius: '24px', backgroundColor: 'var(--bg-primary)',
                            display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
                            color: 'var(--brand-experiment)'
                        }}
                        onClick={async () => {
                            const homeNode = getHomeNodeUrl();
                            if (!homeNode || !currentAccount) return;

                            // Use Electron file picker if available, otherwise fall back to an input element
                            let file: File | null = null;
                            if ((window as any).electron?.showOpenDialog) {
                                const result = await (window as any).electron.showOpenDialog({
                                    title: 'Select Guild Export ZIP',
                                    filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
                                    properties: ['openFile']
                                });
                                if (result?.canceled || !result?.filePaths?.length) return;
                                const filePath = result.filePaths[0];
                                const response = await fetch(`file://${filePath}`);
                                const blob = await response.blob();
                                file = new File([blob], filePath.split(/[\\/]/).pop() || 'export.zip', { type: 'application/zip' });
                            } else {
                                // Fallback: create a temporary file input
                                file = await new Promise<File | null>((resolve) => {
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.accept = '.zip';
                                    input.onchange = () => resolve(input.files?.[0] || null);
                                    input.click();
                                });
                            }

                            if (!file) return;

                            const formData = new FormData();
                            formData.append('file', file);

                            try {
                                const res = await apiFetch(`${homeNode}/api/guilds/import`, {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${currentAccount.token}`
                                    },
                                    body: formData
                                });
                                if (res.ok) {
                                    await fetchGuilds();
                                    alert('Guild imported successfully!');
                                } else {
                                    const err = await res.json().catch(() => ({}));
                                    alert(err.error || 'Import failed. Check server logs.');
                                }
                            } catch (err) {
                                console.error('Guild import failed:', err);
                                alert('Import failed. Check server logs.');
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
                        localStorage.removeItem('harmony_session');
                        clearSessionKey().catch(console.error);
                        useAppStore.getState().setSessionPrivateKey(null);
                        useAppStore.getState().setCurrentAccount(null);
                        useAppStore.getState().setClaimedProfiles([]);
                        useAppStore.getState().setActiveGuildId('');
                        useAppStore.getState().setProfilesLoaded(false);
                        useAppStore.getState().setConnectedServers([]);
                    }}
                >
                    <LogOut size={24} />
                </div>
            </div>

            <CreateJoinModal
                isOpen={showCreateJoinModal}
                onClose={() => setShowCreateJoinModal(false)}
                fetchGuilds={fetchGuilds}
                onStartGuildSetup={handleStartGuildSetup}
            />

            <GuildSetupWizard
                isOpen={wizardOpen}
                onClose={() => setWizardOpen(false)}
                provisionCode={wizardProvisionCode}
                targetNodeUrl={wizardTargetNodeUrl || getHomeNodeUrl()}
                fetchGuilds={fetchGuilds}
            />

            {showAdminPanel && (
                <NodeAdminPanel onClose={() => setShowAdminPanel(false)} />
            )}
        </div>
    );
};

/** @deprecated Use GuildSidebar */
export const ServerSidebar = GuildSidebar;

import React, { useState, useEffect } from 'react';
import { useAppStore, Permission } from '../store/appStore';
import { X, Plus, Trash, GripVertical, Save, Edit2, Shield, Users, Layers } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import type { RoleData } from '../store/appStore';

type Channel = { id: string, name: string, category_id: string | null, position: number, type?: 'text' | 'voice' };
type Category = { id: string, name: string, position: number };
type ProfileExt = { id: string, nickname: string, aliases: string };

export const ServerSettings = ({ onClose }: { onClose: () => void }) => {
    const { activeServerId, currentAccount, claimedProfiles, showUnknownTags, setShowUnknownTags, serverMap, currentUserPermissions } = useAppStore();
    const serverUrl = serverMap[activeServerId || ''];
    const currentProfile = claimedProfiles.find(p => p.server_id === activeServerId);

    const [activeTab, setActiveTab] = useState<'hierarchy' | 'roles' | 'members'>('hierarchy');
    const [editingChannelPerms, setEditingChannelPerms] = useState<Channel | null>(null);
    const [channelOverrides, setChannelOverrides] = useState<any[]>([]);
    const [channels, setChannels] = useState<Channel[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [newChannelName, setNewChannelName] = useState('');
    const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text');
    const [newCategoryName, setNewCategoryName] = useState('');
    const [editingCategory, setEditingCategory] = useState<string | null>(null);
    const [editingCategoryName, setEditingCategoryName] = useState('');
    const [editingChannel, setEditingChannel] = useState<string | null>(null);
    const [editingChannelNameLocal, setEditingChannelNameLocal] = useState('');
    const [profiles, setProfiles] = useState<ProfileExt[]>([]);
    const [aliasEdits, setAliasEdits] = useState<Record<string, string>>({});

    const [roles, setRoles] = useState<RoleData[]>([]);
    const [newRoleName, setNewRoleName] = useState('');
    const [editingRole, setEditingRole] = useState<RoleData | null>(null);
    const [profileRoles, setProfileRoles] = useState<Record<string, string[]>>({}); // profileId -> roleIds[]

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    useEffect(() => {
        if (!activeServerId || !serverUrl) return;
        Promise.all([
            fetch(`${serverUrl}/api/servers/${activeServerId}/categories`).then(r => r.json()),
            fetch(`${serverUrl}/api/servers/${activeServerId}/channels`).then(r => r.json()),
            fetch(`${serverUrl}/api/servers/${activeServerId}/profiles`).then(r => r.json()),
            fetch(`${serverUrl}/api/servers/${activeServerId}/roles`).then(r => r.json())
        ]).then(([cats, chans, profs, serverRoles]) => {
            setCategories(cats);
            setChannels(chans);
            setProfiles(profs);
            setRoles(serverRoles);
            
            const initialEdits: Record<string, string> = {};
            profs.forEach((p: any) => initialEdits[p.id] = p.aliases || '');
            setAliasEdits(initialEdits);

            // Fetch role assignments for each profile
            profs.forEach((p: any) => {
                fetch(`${serverUrl}/api/servers/${activeServerId}/profiles/${p.id}/roles`)
                    .then(r => r.json())
                    .then(data => {
                        setProfileRoles(prev => ({ ...prev, [p.id]: data.map((r: any) => r.id) }));
                    });
            });
        }).catch(console.error);
    }, [activeServerId, serverUrl]);

    const handleCreateChannel = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newChannelName.trim() || !currentAccount || !activeServerId || !serverUrl) return;
        const payload = { name: newChannelName, categoryId: null, type: newChannelType };
        fetch(`${serverUrl}/api/servers/${activeServerId}/channels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: JSON.stringify(payload)
        })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (data && data.id) {
                    setChannels(prev => [...prev, data]);
                    setNewChannelName('');
                }
            })
            .catch(err => {
                console.error("Failed to create channel:", err);
            });
    };

    const handleCreateCategory = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCategoryName.trim() || !currentAccount || !activeServerId || !serverUrl) return;

        fetch(`${serverUrl}/api/servers/${activeServerId}/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: JSON.stringify({ name: newCategoryName, position: categories.length })
        })
            .then(res => res.json())
            .then(data => {
                if (data && data.id) {
                    setCategories([...categories, data]);
                    setNewCategoryName('');
                }
            })
            .catch(console.error);
    };

    const handleDeleteCategory = (categoryId: string) => {
        if (!currentAccount || !serverUrl) return;
        fetch(`${serverUrl}/api/categories/${categoryId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id }
        }).then(() => {
            setCategories(categories.filter(c => c.id !== categoryId));
            setChannels(channels.map(ch => ch.category_id === categoryId ? { ...ch, category_id: null } : ch));
        }).catch(console.error);
    };

    const handleRenameCategory = (categoryId: string) => {
        if (!currentAccount || !editingCategoryName.trim() || !serverUrl) return;
        fetch(`${serverUrl}/api/categories/${categoryId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: JSON.stringify({ name: editingCategoryName })
        }).then(() => {
            setCategories(categories.map(c => c.id === categoryId ? { ...c, name: editingCategoryName } : c));
            setEditingCategory(null);
        }).catch(console.error);
    };

    const handleDeleteChannel = (channelId: string) => {
        if (!currentAccount || !activeServerId || !serverUrl) return;
        fetch(`${serverUrl}/api/channels/${channelId}?serverId=${activeServerId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id }
        }).then(res => {
            if (res.ok) {
                setChannels(channels.filter(c => c.id !== channelId));
            }
        }).catch(console.error);
    };

    const handleRenameChannel = (channelId: string) => {
        if (!currentAccount || !editingChannelNameLocal.trim() || !serverUrl) return;
        fetch(`${serverUrl}/api/channels/${channelId}?serverId=${activeServerId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: JSON.stringify({ name: editingChannelNameLocal })
        }).then(res => res.json()).then(data => {
            setChannels(channels.map(c => c.id === channelId ? { ...c, name: data.name } : c));
            setEditingChannel(null);
        }).catch(console.error);
    };

    const handleSavePositions = () => {
        if (!currentAccount || !activeServerId || !serverUrl) return;
        fetch(`${serverUrl}/api/servers/${activeServerId}/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: JSON.stringify({ categories, channels: channels.map(ch => ({ id: ch.id, position: ch.position, categoryId: ch.category_id })) })
        }).then(() => {
            onClose();
        }).catch(console.error);
    };

    const handleSaveAlias = (profileId: string) => {
        if (!currentAccount || !serverUrl) return;
        fetch(`${serverUrl}/api/profiles/${profileId}/aliases`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: JSON.stringify({ aliases: aliasEdits[profileId] })
        }).catch(console.error);
    };

    const handleCreateRole = () => {
        if (!newRoleName.trim() || !activeServerId || !serverUrl || !currentAccount) return;
        fetch(`${serverUrl}/api/servers/${activeServerId}/roles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: JSON.stringify({ name: newRoleName, color: '#99aab5', permissions: 0, position: roles.length })
        }).then(r => r.json()).then(role => {
            setRoles([...roles, role]);
            setNewRoleName('');
        });
    };

    const handleUpdateRole = (role: RoleData) => {
        if (!activeServerId || !serverUrl || !currentAccount) return;
        fetch(`${serverUrl}/api/servers/${activeServerId}/roles/${role.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: JSON.stringify(role)
        }).then(() => {
            setRoles(roles.map(r => r.id === role.id ? role : r));
        });
    };

    const handleDeleteRole = (roleId: string) => {
        if (!activeServerId || !serverUrl || !currentAccount) return;
        fetch(`${serverUrl}/api/servers/${activeServerId}/roles/${roleId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id }
        }).then(() => {
            setRoles(roles.filter(r => r.id !== roleId));
        });
    };

    const handleToggleRoleAssignment = (profileId: string, roleId: string) => {
        if (!activeServerId || !serverUrl || !currentAccount) return;
        const isAssigned = profileRoles[profileId]?.includes(roleId);
        const method = isAssigned ? 'DELETE' : 'POST';
        const url = `${serverUrl}/api/servers/${activeServerId}/profiles/${profileId}/roles${isAssigned ? '/' + roleId : ''}`;
        
        fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: isAssigned ? undefined : JSON.stringify({ roleId })
        }).then(() => {
            setProfileRoles(prev => ({
                ...prev,
                [profileId]: isAssigned 
                    ? prev[profileId].filter(id => id !== roleId)
                    : [...(prev[profileId] || []), roleId]
            }));
        });
    };

    const onDragEnd = (result: DropResult) => {
        const { source, destination, type } = result;
        if (!destination) return;

        if (type === 'CATEGORY') {
            const arr = Array.from(categories);
            const [removed] = arr.splice(source.index, 1);
            arr.splice(destination.index, 0, removed);
            const reordered = arr.map((cat, idx) => ({ ...cat, position: idx }));
            setCategories(reordered);
            return;
        }

        if (type === 'CHANNEL') {
            const sourceCatId = source.droppableId === 'root' ? null : source.droppableId.replace('category-', '');
            const destCatId = destination.droppableId === 'root' ? null : destination.droppableId.replace('category-', '');
            const getChannels = (catId: string | null) =>
                channels.filter(ch => catId === null ? !ch.category_id : ch.category_id === catId).sort((a, b) => a.position - b.position);

            if (sourceCatId === destCatId) {
                const catChannels = getChannels(sourceCatId);
                const [removed] = catChannels.splice(source.index, 1);
                if (!removed) return;
                catChannels.splice(destination.index, 0, removed);
                const otherChannels = channels.filter(ch => sourceCatId === null ? !!ch.category_id : ch.category_id !== sourceCatId);
                const reorderedCatChannels = catChannels.map((ch, idx) => ({ ...ch, position: idx }));
                setChannels([...otherChannels, ...reorderedCatChannels]);
            } else {
                const sourceChannels = getChannels(sourceCatId);
                const destChannels = getChannels(destCatId);
                const [movedChannel] = sourceChannels.splice(source.index, 1);
                if (!movedChannel) return;
                const updatedMovedChannel = { ...movedChannel, category_id: destCatId };
                destChannels.splice(destination.index, 0, updatedMovedChannel);
                const sourceReordered = sourceChannels.map((ch, idx) => ({ ...ch, position: idx }));
                const destReordered = destChannels.map((ch, idx) => ({ ...ch, position: idx }));
                const otherChannels = channels.filter(ch => {
                    const isSource = sourceCatId === null ? !ch.category_id : ch.category_id === sourceCatId;
                    const isDest = destCatId === null ? !ch.category_id : ch.category_id === destCatId;
                    return !isSource && !isDest;
                });
                setChannels([...otherChannels, ...sourceReordered, ...destReordered]);
            }
        }
    };
    const PERMISSIONS = [
        { name: 'Administrator', val: 1 << 0 },
        { name: 'Manage Server', val: 1 << 1 },
        { name: 'Manage Roles', val: 1 << 2 },
        { name: 'Manage Channels', val: 1 << 3 },
        { name: 'Kick Members', val: 1 << 4 },
        { name: 'Ban Members', val: 1 << 5 },
        { name: 'Manage Messages', val: 1 << 6 },
        { name: 'Send Messages', val: 1 << 7 },
        { name: 'Attach Files', val: 1 << 8 },
        { name: 'Mention @everyone', val: 1 << 9 },
        { name: 'View Channel', val: 1 << 10 },
        { name: 'Read Message History', val: 1 << 11 },
    ];

    const fetchOverrides = (channelId: string) => {
        if (!activeServerId || !serverUrl) return;
        fetch(`${serverUrl}/api/channels/${channelId}/overrides`)
            .then(r => r.json())
            .then(data => setChannelOverrides(data))
            .catch(console.error);
    };

    const handleSaveOverride = (channelId: string, targetId: string, targetType: 'ROLE' | 'MEMBER', allow: number, deny: number) => {
        if (!activeServerId || !serverUrl || !currentAccount) return;
        fetch(`${serverUrl}/api/channels/${channelId}/overrides?serverId=${activeServerId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: JSON.stringify({ targetId, targetType, allow, deny })
        }).then(() => fetchOverrides(channelId)).catch(console.error);
    };

    const handleDeleteOverride = (channelId: string, targetId: string) => {
        if (!activeServerId || !serverUrl || !currentAccount) return;
        fetch(`${serverUrl}/api/channels/${channelId}/overrides/${targetId}?serverId=${activeServerId}`, {
            method: 'DELETE',
            headers: { 'X-Account-Id': currentAccount.id }
        }).then(() => fetchOverrides(channelId)).catch(console.error);
    };

    if (!currentProfile || (currentUserPermissions & (Permission.MANAGE_SERVER | Permission.ADMINISTRATOR)) === 0) {
        return (
            <div data-testid="access-denied" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                <div className="glass-panel" style={{ padding: '32px', borderRadius: '8px', color: 'white' }}>
                    <h2>Access Denied</h2>
                    <p>You do not have permission to view server settings.</p>
                    <button className="btn" onClick={onClose}>Close</button>
                </div>
            </div>
        );
    }

    const uncategorizedChannels = channels.filter(c => !c.category_id).sort((a, b) => a.position - b.position);
    const sortedCategories = [...categories].sort((a, b) => a.position - b.position);

    return (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
            <div className="glass-panel" style={{ backdropFilter: 'none', WebkitBackdropFilter: 'none', padding: '32px', borderRadius: '8px', width: '800px', maxWidth: '95%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', color: 'var(--text-normal)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <div 
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', cursor: 'pointer', borderRadius: '4px', backgroundColor: activeTab === 'hierarchy' ? 'var(--bg-modifier-selected)' : 'transparent' }}
                            onClick={() => setActiveTab('hierarchy')}
                        >
                            <Layers size={20} /> <span style={{ fontWeight: 600 }}>Hierarchy</span>
                        </div>
                        <div 
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', cursor: 'pointer', borderRadius: '4px', backgroundColor: activeTab === 'roles' ? 'var(--bg-modifier-selected)' : 'transparent' }}
                            onClick={() => setActiveTab('roles')}
                        >
                            <Shield size={20} /> <span style={{ fontWeight: 600 }}>Roles</span>
                        </div>
                        <div 
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', cursor: 'pointer', borderRadius: '4px', backgroundColor: activeTab === 'members' ? 'var(--bg-modifier-selected)' : 'transparent' }}
                            onClick={() => setActiveTab('members')}
                        >
                            <Users size={20} /> <span style={{ fontWeight: 600 }}>Members</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {activeTab === 'hierarchy' && (
                            <button onClick={handleSavePositions} className="btn" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Save size={16} /> Save Changes
                            </button>
                        )}
                        <X data-testid="close-settings" onClick={onClose} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} size={24} />
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '12px' }}>
                    {activeTab === 'hierarchy' && editingChannelPerms ? (
                        <div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
                                <button className="btn" onClick={() => setEditingChannelPerms(null)}>Back</button>
                                <h3>Permissions for #{editingChannelPerms.name}</h3>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {roles.map(r => {
                                    const override = channelOverrides.find((o: any) => o.target_type === 'ROLE' && o.target_id === r.id) || { allow: 0, deny: 0 };
                                    return (
                                        <div key={r.id} style={{ backgroundColor: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                <span style={{ fontWeight: 'bold', color: r.color }}>{r.name} Role</span>
                                                <Trash size={14} color="var(--status-danger)" style={{ cursor: 'pointer' }} onClick={() => handleDeleteOverride(editingChannelPerms.id, r.id)} />
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, auto) 1fr 1fr 1fr', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
                                                <div style={{ fontWeight: '600', color: 'var(--text-muted)' }}>Permission</div>
                                                <div style={{ textAlign: 'center', color: '#23a559' }}>Allow</div>
                                                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Neutral</div>
                                                <div style={{ textAlign: 'center', color: '#ed4245' }}>Deny</div>

                                                {PERMISSIONS.map(p => {
                                                    const isAllowed = (override.allow & p.val) !== 0;
                                                    const isDenied = (override.deny & p.val) !== 0;
                                                    const isNeutral = !isAllowed && !isDenied;

                                                    return (
                                                        <React.Fragment key={p.val}>
                                                            <div>{p.name}</div>
                                                            <div style={{ textAlign: 'center' }}>
                                                                <input type="radio" checked={isAllowed} onChange={() => handleSaveOverride(editingChannelPerms.id, r.id, 'ROLE', override.allow | p.val, override.deny & ~p.val)} />
                                                            </div>
                                                            <div style={{ textAlign: 'center' }}>
                                                                <input type="radio" checked={isNeutral} onChange={() => handleSaveOverride(editingChannelPerms.id, r.id, 'ROLE', override.allow & ~p.val, override.deny & ~p.val)} />
                                                            </div>
                                                            <div style={{ textAlign: 'center' }}>
                                                                <input type="radio" checked={isDenied} onChange={() => handleSaveOverride(editingChannelPerms.id, r.id, 'ROLE', override.allow & ~p.val, override.deny | p.val)} />
                                                            </div>
                                                        </React.Fragment>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ) : activeTab === 'hierarchy' && !editingChannelPerms ? (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                            {/* Create Channel Form */}
                            <form onSubmit={handleCreateChannel} style={{ display: 'flex', gap: '8px', marginBottom: '20px', padding: '12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--divider)' }}>
                                <div style={{ flex: 1 }}>
                                    <input
                                        data-testid="new-channel-name"
                                        type="text"
                                        value={newChannelName}
                                        onChange={e => setNewChannelName(e.target.value)}
                                        placeholder="new-channel"
                                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)' }}
                                    />
                                </div>
                                <select
                                    value={newChannelType}
                                    onChange={e => setNewChannelType(e.target.value as 'text' | 'voice')}
                                    style={{ padding: '8px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)' }}
                                >
                                    <option value="text">Text</option>
                                    <option value="voice">Voice</option>
                                </select>
                                <button data-testid="add-channel-btn" type="submit" className="btn" style={{ padding: '8px 16px' }}>Add Channel</button>
                            </form>

                            <DragDropContext onDragEnd={onDragEnd}>
                            {/* ROOT CHANNELS (No Category) */}
                            <div style={{ marginBottom: '16px' }}>
                            <h3 style={{ textTransform: 'uppercase', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Uncategorized Channels</h3>
                            <Droppable droppableId="root" type="CHANNEL">
                                {(provided, snapshot) => (
                                    <div
                                        {...provided.droppableProps}
                                        ref={provided.innerRef}
                                        style={{ minHeight: '40px', padding: '4px', backgroundColor: snapshot.isDraggingOver ? 'var(--bg-modifier-hover)' : 'transparent', borderRadius: '4px' }}
                                    >
                                        {uncategorizedChannels.map((c, index) => (
                                            <Draggable key={c.id} draggableId={c.id} index={index}>
                                                {(provided, snapshot) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        {...provided.draggableProps}
                                                        {...provided.dragHandleProps}
                                                        style={{
                                                            ...provided.draggableProps.style,
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', backgroundColor: snapshot.isDragging ? 'var(--bg-modifier-selected)' : 'var(--bg-tertiary)',
                                                            borderRadius: '4px', marginBottom: '4px', border: '1px solid rgba(255,255,255,0.05)'
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                                            <GripVertical size={14} color="var(--text-muted)" style={{ marginRight: '8px', cursor: 'grab' }} />
                                                            {editingChannel === c.id ? (
                                                                <input data-testid="rename-channel-input" autoFocus value={editingChannelNameLocal} onChange={(e) => setEditingChannelNameLocal(e.target.value)} onBlur={() => handleRenameChannel(c.id)} onKeyDown={(e) => e.key === 'Enter' && handleRenameChannel(c.id)} style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)', border: 'none', padding: '2px 4px', borderRadius: '4px' }} />
                                                            ) : (
                                                                <span data-testid={`channel-name-${c.name}`}>{c.type === 'voice' ? '🔊' : '#'} {c.name}</span>
                                                            )}
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                                            <Shield size={14} color="var(--text-muted)" style={{ cursor: 'pointer', marginRight: '8px' }} onClick={() => { setEditingChannelPerms(c); fetchOverrides(c.id); }} />
                                                            <Edit2 data-testid={`rename-channel-${c.name}`} size={14} color="var(--text-muted)" style={{ cursor: 'pointer', marginRight: '8px' }} onClick={() => { setEditingChannel(c.id); setEditingChannelNameLocal(c.name); }} />
                                                            <Trash data-testid={`delete-channel-${c.name}`} size={14} color="var(--text-muted)" style={{ cursor: 'pointer' }} onClick={() => handleDeleteChannel(c.id)} />
                                                        </div>
                                                    </div>
                                                )}
                                            </Draggable>
                                        ))}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>

                            <form onSubmit={handleCreateChannel} style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                                <input type="text" value={newChannelName} onChange={e => setNewChannelName(e.target.value)} placeholder="new-channel" style={{ flex: 1, padding: '8px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)' }} />
                                <select value={newChannelType} onChange={e => setNewChannelType(e.target.value as any)} style={{ padding: '8px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)' }}>
                                    <option value="text">Text</option>
                                    <option value="voice">Voice</option>
                                </select>
                                <button type="submit" className="btn" style={{ padding: '8px 16px', display: 'flex', gap: '4px', alignItems: 'center' }}><Plus size={16} /> Add</button>
                            </form>
                        </div>

                        {/* CATEGORIES */}
                        <h3 style={{ textTransform: 'uppercase', fontSize: '12px', color: 'var(--text-muted)', marginTop: '24px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Categories</span>
                        </h3>

                        <Droppable droppableId="all-categories" type="CATEGORY">
                            {(provided) => (
                                <div {...provided.droppableProps} ref={provided.innerRef}>
                                    {sortedCategories.map((cat, index) => {
                                        const catChannels = channels.filter(c => c.category_id === cat.id).sort((a, b) => a.position - b.position);
                                        return (
                                            <Draggable key={cat.id} draggableId={cat.id} index={index}>
                                                {(provided, snapshot) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        {...provided.draggableProps}
                                                        style={{
                                                            ...provided.draggableProps.style,
                                                            backgroundColor: 'var(--bg-secondary)', padding: '12px', borderRadius: '6px', marginBottom: '12px',
                                                            border: snapshot.isDragging ? '2px solid var(--interactive-active)' : '1px solid rgba(255,255,255,0.05)'
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '8px', borderBottom: '1px solid var(--bg-modifier-hover)', marginBottom: '8px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <div {...provided.dragHandleProps} style={{ cursor: 'grab', padding: '4px' }}>
                                                                    <GripVertical size={16} color="var(--text-muted)" />
                                                                </div>
                                                                {editingCategory === cat.id ? (
                                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                                        <input autoFocus value={editingCategoryName} onChange={(e) => setEditingCategoryName(e.target.value)} onBlur={() => handleRenameCategory(cat.id)} onKeyDown={(e) => e.key === 'Enter' && handleRenameCategory(cat.id)} style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)', border: 'none', padding: '2px 4px', borderRadius: '4px' }} />
                                                                    </div>
                                                                ) : (
                                                                    <span style={{ fontWeight: 'bold', textTransform: 'uppercase', fontSize: '12px' }}>{cat.name}</span>
                                                                )}
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <Edit2 size={14} color="var(--text-muted)" style={{ cursor: 'pointer' }} onClick={() => { setEditingCategory(cat.id); setEditingCategoryName(cat.name); }} />
                                                                <Trash size={14} color="var(--text-danger, #f04747)" style={{ cursor: 'pointer' }} onClick={() => handleDeleteCategory(cat.id)} />
                                                            </div>
                                                        </div>

                                                        <Droppable droppableId={`category-${cat.id}`} type="CHANNEL">
                                                            {(provided, snapshot) => (
                                                                <div
                                                                    {...provided.droppableProps}
                                                                    ref={provided.innerRef}
                                                                    style={{ minHeight: '30px', backgroundColor: snapshot.isDraggingOver ? 'var(--bg-modifier-hover)' : 'transparent', borderRadius: '4px', padding: '4px' }}
                                                                >
                                                                    {catChannels.map((c, index) => (
                                                                        <Draggable key={c.id} draggableId={c.id} index={index}>
                                                                            {(provided, snapshot) => (
                                                                                <div
                                                                                    ref={provided.innerRef}
                                                                                    {...provided.draggableProps}
                                                                                    {...provided.dragHandleProps}
                                                                                    style={{
                                                                                        ...provided.draggableProps.style,
                                                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', backgroundColor: snapshot.isDragging ? 'var(--bg-modifier-selected)' : 'var(--bg-tertiary)',
                                                                                        borderRadius: '4px', marginBottom: '4px'
                                                                                    }}
                                                                                >
                                                                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                                                                        <GripVertical size={14} color="var(--text-muted)" style={{ marginRight: '8px', cursor: 'grab' }} />
                                                                                        {editingChannel === c.id ? (
                                                                                            <input data-testid="rename-channel-input" autoFocus value={editingChannelNameLocal} onChange={(e) => setEditingChannelNameLocal(e.target.value)} onBlur={() => handleRenameChannel(c.id)} onKeyDown={(e) => e.key === 'Enter' && handleRenameChannel(c.id)} style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)', border: 'none', padding: '2px 4px', borderRadius: '4px' }} />
                                                                                        ) : (
                                                                                            <span data-testid={`channel-name-${c.name}`}>{c.type === 'voice' ? '🔊' : '#'} {c.name}</span>
                                                                                        )}
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                                                                        <Shield size={14} color="var(--text-muted)" style={{ cursor: 'pointer', marginRight: '8px' }} onClick={() => { setEditingChannelPerms(c); fetchOverrides(c.id); }} />
                                                                                        <Edit2 data-testid={`rename-channel-${c.name}`} size={14} color="var(--text-muted)" style={{ cursor: 'pointer', marginRight: '8px' }} onClick={() => { setEditingChannel(c.id); setEditingChannelNameLocal(c.name); }} />
                                                                                        <Trash data-testid={`delete-channel-${c.name}`} size={14} color="var(--text-muted)" style={{ cursor: 'pointer' }} onClick={() => handleDeleteChannel(c.id)} />
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </Draggable>
                                                                    ))}
                                                                    {provided.placeholder}
                                                                </div>
                                                            )}
                                                        </Droppable>
                                                    </div>
                                                )}
                                            </Draggable>
                                        )
                                    })}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>

                        {/* Create Category */}
                        <form onSubmit={handleCreateCategory} style={{ display: 'flex', gap: '8px', marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', border: '1px dashed var(--bg-modifier-hover)' }}>
                            <input type="text" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="NEW CATEGORY" style={{ flex: 1, padding: '8px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)' }} />
                            <button type="submit" className="btn" style={{ padding: '8px 16px', display: 'flex', gap: '4px', alignItems: 'center' }}><Plus size={16} /> Add Category</button>
                        </form>

                        {/* PROFILE ALIASES (Creator Only) */}
                        {currentAccount?.is_creator && profiles.length > 0 && (
                            <div style={{ marginTop: '32px', borderTop: '1px solid var(--divider)', paddingTop: '16px' }}>
                                <h3 style={{ textTransform: 'uppercase', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Profile Aliases (Creator Only)</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {profiles.map(p => (
                                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: '4px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', width: '30%' }}>
                                                <span style={{ fontWeight: 'bold' }}>{p.nickname}</span>
                                                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>ID: {p.id}</span>
                                            </div>
                                            <div style={{ display: 'flex', flex: 1, gap: '8px' }}>
                                                <input value={aliasEdits[p.id] || ''} onChange={e => setAliasEdits({ ...aliasEdits, [p.id]: e.target.value })} placeholder="Comma-separated IDs..." style={{ flex: 1, padding: '6px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-normal)', fontSize: '12px' }} />
                                                <button onClick={() => handleSaveAlias(p.id)} className="btn" style={{ fontSize: '12px', padding: '6px 12px' }}>Save</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* DEBUG TOGGLES (Creator Only) */}
                        {currentAccount?.is_creator && (
                            <div style={{ marginTop: '32px', borderTop: '1px solid var(--divider)', paddingTop: '16px' }}>
                                <h3 style={{ textTransform: 'uppercase', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Debug Settings</h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="checkbox"
                                        id="showUnknownTags"
                                        checked={showUnknownTags}
                                        onChange={(e) => setShowUnknownTags(e.target.checked)}
                                    />
                                    <label htmlFor="showUnknownTags" style={{ fontSize: '12px', cursor: 'pointer' }}>Show raw IDs for unknown profile tags</label>
                                </div>
                            </div>
                        )}
                            </DragDropContext>
                        </div>
                    ) : null}

                    {activeTab === 'roles' && (
                        <div style={{ display: 'flex', height: '100%' }}>
                            {/* Left Sidebar: Role List */}
                            <div style={{ width: '200px', borderRight: '1px solid var(--divider)', paddingRight: '16px' }}>
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                    <input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="New role..." style={{ flex: 1, padding: '6px', borderRadius: '4px', backgroundColor: 'var(--bg-tertiary)', border: 'none', color: 'white', fontSize: '12px' }} />
                                    <button data-testid="create-role-btn" onClick={handleCreateRole} className="btn" style={{ padding: '6px' }}><Plus size={14} /></button>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {roles.map(r => (
                                        <div 
                                            key={r.id} 
                                            onClick={() => setEditingRole(r)}
                                            style={{ padding: '8px', borderRadius: '4px', cursor: 'pointer', backgroundColor: editingRole?.id === r.id ? 'var(--bg-modifier-selected)' : 'transparent', color: r.color }}
                                        >
                                            {r.name}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Right Panel: Role Editing */}
                            <div style={{ flex: 1, paddingLeft: '24px' }}>
                                {editingRole ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <h3>Editing Role: {editingRole.name}</h3>
                                            <button onClick={() => handleDeleteRole(editingRole.id)} className="btn" style={{ backgroundColor: 'var(--status-danger)', padding: '6px 12px' }}>Delete Role</button>
                                        </div>
                                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Role Name</label>
                                                <input value={editingRole.name} onChange={e => setEditingRole({ ...editingRole, name: e.target.value })} onBlur={() => handleUpdateRole(editingRole)} style={{ width: '100%', padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-tertiary)', border: 'none', color: 'white' }} />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Color</label>
                                                <input type="color" value={editingRole.color} onChange={e => { const updated = { ...editingRole, color: e.target.value }; setEditingRole(updated); handleUpdateRole(updated); }} style={{ height: '38px', width: '60px', border: 'none', cursor: 'pointer' }} />
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            <h4 style={{ textTransform: 'uppercase', fontSize: '11px', color: 'var(--text-muted)' }}>Permissions</h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                                {PERMISSIONS.map(p => (
                                                    <div key={p.val} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px' }}>
                                                        <span>{p.name}</span>
                                                        <input 
                                                            type="checkbox"
                                                            data-testid={`perm-${p.name.toLowerCase().replace(/\s+/g, '-')}`}
                                                            checked={(editingRole.permissions & p.val) !== 0} 
                                                            onChange={e => {
                                                                const updated = { ...editingRole, permissions: e.target.checked ? (editingRole.permissions | p.val) : (editingRole.permissions & ~p.val) };
                                                                setEditingRole(updated);
                                                                handleUpdateRole(updated);
                                                            }}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                                        Select a role to edit its permissions or color.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'members' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {profiles.map(p => (
                                <div key={p.id} style={{ backgroundColor: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        <div className="avatar" style={{ width: '32px', height: '32px' }}>{p.nickname.substring(0, 2).toUpperCase()}</div>
                                        <span>{p.nickname}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        {roles.map(role => (
                                            <div 
                                                key={role.id}
                                                onClick={() => handleToggleRoleAssignment(p.id, role.id)}
                                                style={{ 
                                                    padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer',
                                                    border: `1px solid ${profileRoles[p.id]?.includes(role.id) ? role.color : 'var(--divider)'}`,
                                                    backgroundColor: profileRoles[p.id]?.includes(role.id) ? `${role.color}22` : 'transparent',
                                                    color: profileRoles[p.id]?.includes(role.id) ? role.color : 'var(--text-muted)'
                                                }}
                                            >
                                                {role.name}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

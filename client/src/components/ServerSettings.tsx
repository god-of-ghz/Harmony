import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { X, Plus, Trash, GripVertical, Save, Edit2 } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';

type Channel = { id: string, name: string, category_id: string | null, position: number };
type Category = { id: string, name: string, position: number };
type ProfileExt = { id: string, nickname: string, aliases: string };

export const ServerSettings = ({ onClose }: { onClose: () => void }) => {
    const { activeServerId, currentAccount, claimedProfiles, showUnknownTags, setShowUnknownTags, serverMap } = useAppStore();
    const serverUrl = serverMap[activeServerId || ''];
    const currentProfile = claimedProfiles.find(p => p.server_id === activeServerId);

    const [channels, setChannels] = useState<Channel[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [newChannelName, setNewChannelName] = useState('');
    const [newCategoryName, setNewCategoryName] = useState('');
    const [editingCategory, setEditingCategory] = useState<string | null>(null);
    const [editingCategoryName, setEditingCategoryName] = useState('');
    const [profiles, setProfiles] = useState<ProfileExt[]>([]);
    const [aliasEdits, setAliasEdits] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!activeServerId || !serverUrl) return;
        Promise.all([
            fetch(`${serverUrl}/api/servers/${activeServerId}/categories`).then(r => r.json()),
            fetch(`${serverUrl}/api/servers/${activeServerId}/channels`).then(r => r.json()),
            currentAccount?.is_creator ? fetch(`${serverUrl}/api/servers/${activeServerId}/profiles`).then(r => r.json()) : Promise.resolve([])
        ]).then(([cats, chans, profs]) => {
            setCategories(cats);
            setChannels(chans);
            if (profs && profs.length > 0) {
                setProfiles(profs);
                const initialEdits: Record<string, string> = {};
                profs.forEach((p: any) => initialEdits[p.id] = p.aliases || '');
                setAliasEdits(initialEdits);
            }
        }).catch(console.error);
    }, [activeServerId, currentAccount]);

    const handleCreateChannel = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newChannelName.trim() || !currentAccount || !activeServerId || !serverUrl) return;
        fetch(`${serverUrl}/api/servers/${activeServerId}/channels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount.id },
            body: JSON.stringify({ name: newChannelName, categoryId: null })
        })
            .then(res => res.json())
            .then(data => {
                if (data && data.id) {
                    setChannels([...channels, data]);
                    setNewChannelName('');
                }
            })
            .catch(console.error);
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
        if (!currentAccount) return;
        // The REST route for Channel Deletion isn't set up yet, but we'll prune it from React state
        setChannels(channels.filter(c => c.id !== channelId));
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

    const onDragEnd = (result: DropResult) => {
        const { source, destination, type } = result;
        if (!destination) return;

        if (type === 'CATEGORY') {
            const arr = Array.from(categories);
            const [removed] = arr.splice(source.index, 1);
            arr.splice(destination.index, 0, removed);
            // Re-calc positions
            const reordered = arr.map((cat, idx) => ({ ...cat, position: idx }));
            setCategories(reordered);
            return;
        }

        if (type === 'CHANNEL') {
            const sourceCatId = source.droppableId === 'root' ? null : source.droppableId.replace('category-', '');
            const destCatId = destination.droppableId === 'root' ? null : destination.droppableId.replace('category-', '');

            const getChannels = (catId: string | null) =>
                channels.filter(ch => catId === null ? !ch.category_id : ch.category_id === catId).sort((a, b) => a.position - b.position);

            // Reordering within the same category
            if (sourceCatId === destCatId) {
                const catChannels = getChannels(sourceCatId);
                const [removed] = catChannels.splice(source.index, 1);
                if (!removed) return; // Prevent out-of-bounds phantom creation

                catChannels.splice(destination.index, 0, removed);

                const otherChannels = channels.filter(ch => sourceCatId === null ? !!ch.category_id : ch.category_id !== sourceCatId);
                const reorderedCatChannels = catChannels.map((ch, idx) => ({ ...ch, position: idx }));
                setChannels([...otherChannels, ...reorderedCatChannels]);
            } else {
                // Moving between categories
                const sourceChannels = getChannels(sourceCatId);
                const destChannels = getChannels(destCatId);

                const [movedChannel] = sourceChannels.splice(source.index, 1);
                if (!movedChannel) return; // Prevent out-of-bounds phantom creation

                const updatedMovedChannel = { ...movedChannel, category_id: destCatId }; // Create a fresh copy
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

    if (!currentProfile || (!['OWNER', 'ADMIN'].includes(currentProfile.role) && !currentAccount?.is_creator)) {
        return (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
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
            <div className="glass-panel" style={{ backdropFilter: 'none', WebkitBackdropFilter: 'none', padding: '32px', borderRadius: '8px', width: '600px', maxWidth: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', color: 'var(--text-normal)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <h2>Hierarchy & Settings</h2>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={handleSavePositions} className="btn" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Save size={16} /> Save Changes
                        </button>
                        <X onClick={onClose} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} size={24} />
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '12px' }}>
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
                                                            <span># {c.name}</span>
                                                        </div>
                                                        <Trash size={14} color="var(--text-muted)" style={{ cursor: 'pointer' }} onClick={() => handleDeleteChannel(c.id)} />
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
                                                                                        <span># {c.name}</span>
                                                                                    </div>
                                                                                    <Trash size={14} color="var(--text-muted)" style={{ cursor: 'pointer' }} onClick={() => handleDeleteChannel(c.id)} />
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
            </div>
        </div>
    );
};

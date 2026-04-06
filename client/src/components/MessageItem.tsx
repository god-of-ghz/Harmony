import React, { useCallback } from 'react';
import type { MessageData, Profile, RoleData } from '../store/appStore';
import { Permission, useAppStore } from '../store/appStore';
import { Pencil, Trash2, Link, MessageSquareReply, Smile } from 'lucide-react';
import { UserFingerprint } from './UserFingerprint';
import { EmojiPicker } from './EmojiPicker';

interface MessageItemProps {
    msg: MessageData;
    isGrouped: boolean;
    showDaySeparator: boolean;
    isMentioned: boolean;
    isAuthor: boolean;
    isEditing: boolean;
    editValue: string;
    setEditValue: (val: string) => void;
    onEdit: (msgId: string) => void;
    onCancelEdit: () => void;
    onDelete: (msgId: string) => void;
    onAddReaction: (msgId: string, emoji: string) => void;
    onRemoveReaction: (msgId: string, emoji: string) => void;
    onCopyLink: (msgId: string) => void;
    onReply: (msg: MessageData) => void;
    activeEmojiPickerId: string | null;
    setActiveEmojiPickerId: (id: string | null) => void;
    serverMap: Record<string, string>;
    activeServerId: string | null;
}

export const MessageItem = React.memo(({
    msg,
    isGrouped,
    showDaySeparator,
    isMentioned,
    isAuthor,
    isEditing,
    editValue,
    setEditValue,
    onEdit,
    onCancelEdit,
    onDelete,
    onAddReaction,
    onRemoveReaction,
    onCopyLink,
    onReply,
    activeEmojiPickerId,
    setActiveEmojiPickerId,
    serverMap,
    activeServerId
}: MessageItemProps) => {
    // Targeted subscriptions
    const authorPresence = useAppStore(useCallback(state => {
        const profile = state.serverProfiles.find(p => p.id === msg.author_id);
        return profile?.account_id ? state.presenceMap[profile.account_id] : null;
    }, [msg.author_id]));

    const serverProfiles = useAppStore(state => state.serverProfiles);
    const serverRoles = useAppStore(state => state.serverRoles);
    const showUnknownTags = useAppStore(state => state.showUnknownTags);
    const currentUserPermissions = useAppStore(state => state.currentUserPermissions);
    const currentProfileId = useAppStore(useCallback(state => 
        state.claimedProfiles.find(p => p.server_id === activeServerId)?.id, 
    [activeServerId]));

    const msgDate = new Date(msg.timestamp);
    const attachments: string[] = JSON.parse(msg.attachments || '[]');
    const contentSegments = msg.content.split(/(<@&?[^>]+>)/g);

    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            {showDaySeparator && (
                <div className="date-separator">
                    {msgDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </div>
            )}
            <div className={`message-container ${isMentioned ? 'mentioned-message' : ''} ${isGrouped ? 'grouped' : ''}`} style={{ position: 'relative', display: 'flex', flexDirection: 'column', padding: '8px 16px', borderLeft: isMentioned ? undefined : '2px solid transparent' }}>
                {msg.reply_to && (
                    <div className="reply-container" style={{ 
                        fontSize: '13px', 
                        color: 'var(--text-muted)', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        marginBottom: '4px', 
                        marginLeft: '44px',
                        position: 'relative',
                        height: '20px'
                    }}>
                        <div className="reply-spine" />
                        <div className="reply-avatar">
                            {(msg.replied_author || 'U').substring(0, 1).toUpperCase()}
                        </div>
                        <span className="reply-author">@{msg.replied_author || 'Unknown'}</span>
                        <span className="reply-content">{msg.replied_content || <em>Original message deleted</em>}</span>
                    </div>
                )}
                <div style={{ display: 'flex', gap: '16px' }}>
                    {!isGrouped && (
                        <div className="avatar" style={{ width: '40px', height: '40px', position: 'relative' }}>
                            {msg.username.substring(0, 2).toUpperCase()}
                            {authorPresence && authorPresence.status !== 'offline' && (
                                <div style={{
                                    position: 'absolute', bottom: -2, right: -2,
                                    width: '12px', height: '12px', borderRadius: '50%',
                                    backgroundColor: authorPresence.status === 'online' ? '#23a559' : authorPresence.status === 'idle' ? '#faa61a' : '#ed4245',
                                    border: '2px solid var(--bg-primary)'
                                }} />
                            )}
                        </div>
                    )}
                    <div style={{ flex: 1 }} className={isGrouped ? 'message-content-wrapper' : ''}>
                        {!isGrouped && (
                            <div className="message-header" style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                <span style={{ fontWeight: '500', color: 'var(--interactive-active)' }}>{msg.username}</span>
                                <UserFingerprint publicKey={msg.public_key} />
                                {msg.edited_at && <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '4px' }}>(edited)</span>}
                            </div>
                        )}
                        {isEditing ? (
                            <div style={{ marginTop: '8px' }}>
                                <input
                                    className="input-field"
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') onEdit(msg.id);
                                        if (e.key === 'Escape') onCancelEdit();
                                    }}
                                />
                                <div style={{ fontSize: '12px', marginTop: '4px', color: 'var(--text-muted)' }}>
                                    escape to <span style={{ color: 'var(--text-link)', cursor: 'pointer' }} onClick={onCancelEdit}>cancel</span> • enter to <span style={{ color: 'var(--text-link)', cursor: 'pointer' }} onClick={() => onEdit(msg.id)}>save</span>
                                </div>
                            </div>
                        ) : (
                            <div style={{ marginTop: isGrouped ? '0' : '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.4' }}>
                                {contentSegments.map((segment, idx) => {
                                    if (segment.startsWith('<@&') && segment.endsWith('>')) {
                                        const id = segment.slice(3, -1);
                                        const r = serverRoles.find((role: RoleData) => role.id === id);
                                        return <span key={idx} className="mention-tag" style={{ borderLeft: r ? `2px solid ${r.color}` : undefined }}>@{r ? r.name : 'Unknown Role'}</span>;
                                    }
                                    if (segment.startsWith('<@') && segment.endsWith('>')) {
                                        let id = segment.slice(2, -1);
                                        if (id.startsWith('!')) id = id.slice(1);
                                        const p = serverProfiles.find((profile: Profile) => profile.id === id || (profile.aliases && profile.aliases.split(',').map((a: string) => a.trim()).includes(id)));
                                        if (p) {
                                            return <span key={idx} className="mention-tag">@{p.nickname}</span>;
                                        } else if (showUnknownTags) {
                                            return <span key={idx}>{segment}</span>;
                                        } else {
                                            return <span key={idx} className="mention-tag">@Unknown User</span>;
                                        }
                                    }
                                    return <span key={idx}>{segment}</span>;
                                })}
                                {!isGrouped && msg.edited_at && <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>(edited)</span>}
                                {isGrouped && msg.edited_at && <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>(edited)</span>}
                            </div>
                        )}
                        {/* Attachments */}
                        {attachments.length > 0 && (
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                                {attachments.map((url: string, i: number) => {
                                    const fullUrl = `${serverMap[activeServerId!]}${url}`;
                                    const ext = url.split('.').pop()?.toLowerCase();
                                    if (ext === 'mp4' || ext === 'webm') {
                                        return <video key={i} src={fullUrl} controls preload="metadata" style={{ maxWidth: '400px', maxHeight: '400px', borderRadius: '4px' }} />;
                                    } else if (ext === 'txt') {
                                        return <a key={i} href={fullUrl} target="_blank" rel="noreferrer" style={{ padding: '8px 12px', backgroundColor: 'var(--bg-modifier-selected)', borderRadius: '4px', textDecoration: 'none', color: 'var(--text-normal)', border: '1px solid var(--divider)' }}>📄 View Text File</a>;
                                    } else {
                                        return <img key={i} src={fullUrl} alt="attachment" style={{ maxWidth: '400px', maxHeight: '400px', borderRadius: '4px', cursor: 'zoom-in' }} />;
                                    }
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Reactions Display */}
                {msg.reactions && msg.reactions.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap', marginLeft: '56px' }}>
                        {Object.entries(msg.reactions.reduce((acc: any, r: any) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {})).map(([emoji, count]: any) => {
                            const hasReacted = msg.reactions?.some((r: any) => r.author_id === currentProfileId && r.emoji === emoji);
                            return (
                                <div key={emoji}
                                    style={{ padding: '2px 6px', backgroundColor: hasReacted ? 'var(--brand-experiment-30a)' : 'var(--bg-modifier-selected)', border: hasReacted ? '1px solid var(--brand-experiment)' : '1px solid transparent', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    onClick={() => {
                                        if (hasReacted) onRemoveReaction(msg.id, emoji);
                                        else onAddReaction(msg.id, emoji);
                                    }}
                                >
                                    {emoji} <span style={{ fontSize: '12px' }}>{count}</span>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Message Actions */}
                <div className="message-actions" style={{
                    position: 'absolute',
                    right: '16px',
                    top: '-16px',
                    backgroundColor: 'var(--bg-tertiary)',
                    borderRadius: '4px',
                    display: 'flex',
                    border: '1px solid var(--divider)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                    opacity: activeEmojiPickerId === msg.id ? 1 : undefined,
                    pointerEvents: activeEmojiPickerId === msg.id ? 'auto' : undefined,
                    width: '232px',
                    height: '32px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '0 10px' }}>
                        <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px' }} onClick={() => onAddReaction(msg.id, '👍')}>👍</span>
                        <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px' }} onClick={() => onAddReaction(msg.id, '❤️')}>❤️</span>
                        <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px' }} onClick={() => onAddReaction(msg.id, '😂')}>😂</span>

                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px' }}>
                            <Smile size={16} style={{ cursor: 'pointer', color: activeEmojiPickerId === msg.id ? 'var(--interactive-active)' : 'var(--text-muted)' }} onClick={() => setActiveEmojiPickerId(activeEmojiPickerId === msg.id ? null : msg.id)} />
                            {activeEmojiPickerId === msg.id && (
                                <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: '8px', zIndex: 100 }}>
                                    <EmojiPicker
                                        onSelect={(emoji) => onAddReaction(msg.id, emoji)}
                                        onClose={() => setActiveEmojiPickerId(null)}
                                    />
                                </div>
                            )}
                        </div>

                        <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--divider)' }} />

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px' }}>
                            <MessageSquareReply size={16} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => onReply(msg)} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px' }}>
                            <Link size={16} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => onCopyLink(msg.id)} />
                        </div>

                        {!isEditing && (
                            <>
                                {isAuthor && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px' }}>
                                        <Pencil size={16} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => { onCancelEdit(); onEdit(msg.id); setEditValue(msg.content); }} />
                                    </div>
                                )}

                                {(isAuthor || (currentUserPermissions & (Permission.MANAGE_MESSAGES | Permission.ADMINISTRATOR)) !== 0) && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px' }}>
                                        <Trash2 data-testid="delete-message" size={16} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => onDelete(msg.id)} />
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

MessageItem.displayName = 'MessageItem';

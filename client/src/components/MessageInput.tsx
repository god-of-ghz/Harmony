import React, { useState, useRef, useEffect } from 'react';
import { Send, Image as ImageIcon, X } from 'lucide-react';
import type { MessageData, Profile, RoleData } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { signPayload, deriveSharedKey, encryptMessageContent } from '../utils/crypto';
import { MentionAutocomplete } from './MentionAutocomplete';
import { EmojiAutocomplete } from './EmojiAutocomplete';
import { EMOJI_MAP } from '../utils/emojis';
import type { EmojiData } from '../utils/emojis';

interface MessageInputProps {
    activeChannelId: string;
    activeChannelName: string;
    activeServerId: string;
    serverUrl: string;
    currentProfile: Profile | null;
    currentAccount: any;
    sessionPrivateKey: CryptoKey | null;
    replyingTo: MessageData | null;
    setReplyingTo: (msg: MessageData | null) => void;
    wsRef: React.MutableRefObject<WebSocket | null>;
    onMessageSent?: () => void;
}

export const MessageInput = React.memo(({
    activeChannelId,
    activeChannelName,
    activeServerId,
    serverUrl,
    currentProfile,
    currentAccount,
    sessionPrivateKey,
    replyingTo,
    setReplyingTo,
    wsRef,
    onMessageSent
}: MessageInputProps) => {
    const [inputValue, setInputValue] = useState('');
    const [pendingAttachments, setPendingAttachments] = useState<string[]>([]);
    const [showAutocomplete, setShowAutocomplete] = useState(false);
    const [autocompleteFilter, setAutocompleteFilter] = useState('');
    const [autocompleteIndex, setAutocompleteIndex] = useState(0);
    const [autocompleteStartIdx, setAutocompleteStartIdx] = useState(-1);
    const [filteredOptions, setFilteredOptions] = useState<(Profile | RoleData)[]>([]);

    const [showEmojiAutocomplete, setShowEmojiAutocomplete] = useState(false);
    const [emojiFilter, setEmojiFilter] = useState('');
    const [emojiIndex, setEmojiIndex] = useState(0);
    const [filteredEmojis, setFilteredEmojis] = useState<EmojiData[]>([]);

    const serverProfiles = useAppStore(state => state.serverProfiles);
    const serverRoles = useAppStore(state => state.serverRoles);

    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (replyingTo || activeChannelId) {
            inputRef.current?.focus();
        }
    }, [replyingTo, activeChannelId]);

    const handleSend = async () => {
        if ((!inputValue.trim() && pendingAttachments.length === 0) || !currentProfile || !activeChannelId) return;

        // Parse mentions (@nickname or @username) to <@id>
        const profileTargets: { text: string, id: string }[] = [];
        for (const p of serverProfiles) {
            if (p.nickname) profileTargets.push({ text: p.nickname, id: p.id });
            if (p.original_username) profileTargets.push({ text: p.original_username, id: p.id });
        }
        // Sort by text length descending to avoid partial matches
        const sortedTargets = profileTargets.sort((a, b) => b.text.length - a.text.length);

        let parsedContent = inputValue;
        for (const target of sortedTargets) {
            // Use specialized regex to ensure we only match if it's not already inside a tag
            // and handle edge cases where nickname might have special characters
            const escapedText = target.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`@${escapedText}\\b`, 'g');
            parsedContent = parsedContent.replace(regex, `<@${target.id}>`);
        }

        // Parse @RoleName to <@&id>
        const sortedRoles = [...serverRoles].sort((a, b) => b.name.length - a.name.length);
        for (const r of sortedRoles) {
            const regex = new RegExp(`@${r.name}\\b`, 'g');
            parsedContent = parsedContent.replace(regex, `<@&${r.id}>`);
        }

        let signature = '';
        if (sessionPrivateKey) {
            try {
                signature = await signPayload(parsedContent, sessionPrivateKey);
            } catch (err) {
                console.error("Failed to sign payload", err);
            }
        }

        // --- E2EE Encryption ---
        let finalContent = parsedContent;
        let isEncrypted = false;

        // Attempt to find destination public key
        // 1. Check if it's a DM (peer public key)
        // 2. Check if it's a channel (channel public key)
        
        let destinationPublicKey = '';

        // For simplicity in this phase, we look for the peer's public key if it's a DM, 
        // or a channel public key if provided by the server.
        // We look in globalProfiles or profiles.
        
        // Check if we can find a matching profile with a public key for this channel
        // If it's a DM, the "channel ID" might be shared with the peer or we can find the peer's profile.
        // In this implementation, we'll look for any public key associated with the channel or recipient.
        
        // Try to get channel public key from server if not already known
        // (In a real app, this would be in the channel object in the store)
        try {
            const res = await fetch(`${serverUrl}/api/channels/${activeChannelId}`, {
                headers: {
                    'Authorization': `Bearer ${currentAccount?.token}`
                }
            });
            if (res.ok) {
                const channelData = await res.json();
                if (channelData.public_key) {
                    destinationPublicKey = channelData.public_key;
                }
            }
        } catch (e) {
            console.error("Failed to fetch channel public key", e);
        }

        if (destinationPublicKey && sessionPrivateKey) {
            try {
                const aesKey = await deriveSharedKey(sessionPrivateKey, destinationPublicKey);
                finalContent = await encryptMessageContent(parsedContent, aesKey);
                isEncrypted = true;
            } catch (err) {
                console.error("Encryption failed", err);
            }
        }
        // -----------------------

        fetch(`${serverUrl}/api/channels/${activeChannelId}/messages`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAccount?.token}`
            },
            body: JSON.stringify({
                content: finalContent,
                authorId: currentProfile.id,
                signature,
                attachments: JSON.stringify(pendingAttachments),
                reply_to: replyingTo?.id || null,
                is_encrypted: isEncrypted
            })
        }).catch(console.error);

        setInputValue('');
        setPendingAttachments([]);
        setReplyingTo(null);
        onMessageSent?.();
    };

    const handleMentionSelect = (option: Profile | RoleData) => {
        const name = 'color' in option ? option.name : option.nickname;
        const before = inputValue.substring(0, autocompleteStartIdx);
        const after = inputValue.substring(autocompleteStartIdx + autocompleteFilter.length + 1);
        const newValue = `${before}@${name}${after}`;
        setInputValue(newValue);
        setShowAutocomplete(false);
    };

    const handleEmojiSelect = (option: EmojiData) => {
        const before = inputValue.substring(0, autocompleteStartIdx);
        const after = inputValue.substring(autocompleteStartIdx + emojiFilter.length + 1);
        const newValue = `${before}${option.emoji}${after}`;
        setInputValue(newValue);
        setShowEmojiAutocomplete(false);
    };

    const lastTypingEventRef = useRef<number>(0);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (showAutocomplete) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setAutocompleteIndex(prev => (prev + 1) % Math.max(1, filteredOptions.length));
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setAutocompleteIndex(prev => (prev - 1 + filteredOptions.length) % Math.max(1, filteredOptions.length));
                return;
            } else if (e.key === 'Tab' || e.key === 'Enter') {
                if (filteredOptions.length > 0) {
                    e.preventDefault();
                    handleMentionSelect(filteredOptions[autocompleteIndex]);
                    return;
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setShowAutocomplete(false);
                return;
            }
        }

        if (showEmojiAutocomplete) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setEmojiIndex(prev => (prev + 1) % Math.max(1, filteredEmojis.length));
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setEmojiIndex(prev => (prev - 1 + filteredEmojis.length) % Math.max(1, filteredEmojis.length));
                return;
            } else if (e.key === 'Tab' || e.key === 'Enter') {
                if (filteredEmojis.length > 0) {
                    e.preventDefault();
                    handleEmojiSelect(filteredEmojis[emojiIndex]);
                    return;
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setShowEmojiAutocomplete(false);
                return;
            }
        }

        if (e.key === 'Enter') handleSend();
        else {
            if (activeChannelId && wsRef.current?.readyState === WebSocket.OPEN) {
                const accountId = currentAccount?.id;
                if (accountId) {
                    const now = Date.now();
                    if (now - lastTypingEventRef.current > 3000) {
                        lastTypingEventRef.current = now;
                        wsRef.current.send(JSON.stringify({ type: 'TYPING_START', data: { channelId: activeChannelId, accountId } }));
                    }
                }
            }
        }
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) files.push(blob);
            }
        }

        if (files.length > 0) {
            const formData = new FormData();
            files.forEach(f => formData.append('files', f));

            try {
                const res = await fetch(`${serverUrl}/api/servers/${activeServerId}/attachments`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${currentAccount?.token || ''}` },
                    body: formData
                });
                if (!res.ok) {
                    const err = await res.json();
                    alert(err.error || 'Upload failed');
                    return;
                }
                const data = await res.json();
                setPendingAttachments((prev: string[]) => [...prev, ...data.urls]);
            } catch (err) {
                console.error("Failed to upload attachments", err);
                alert("Upload failed");
            }
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Pending Attachments */}
            {pendingAttachments.length > 0 && (
                <div style={{ padding: '8px 16px', display: 'flex', gap: '8px', overflowX: 'auto', backgroundColor: 'var(--bg-secondary)', marginBottom: '8px', borderRadius: '4px' }}>
                    {pendingAttachments.map((url: string, i: number) => {
                        const ext = url.split('.').pop()?.toLowerCase();
                        const isVideo = ext === 'mp4' || ext === 'webm';
                        return (
                            <div key={i} style={{ position: 'relative' }}>
                                {isVideo ? (
                                    <div style={{ height: '60px', borderRadius: '4px', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                                        <video src={`${serverUrl}${url}`} style={{ height: '100%', display: 'block', objectFit: 'contain' }} controls={false} playsInline />
                                    </div>
                                ) : (
                                    <img src={`${serverUrl}${url}`} alt="preview" style={{ height: '60px', borderRadius: '4px' }} />
                                )}
                                <div
                                    style={{ position: 'absolute', top: '-8px', right: '-8px', backgroundColor: 'var(--status-danger)', borderRadius: '50%', padding: '2px', cursor: 'pointer' }}
                                    onClick={() => setPendingAttachments((prev: string[]) => prev.filter((_, idx) => idx !== i))}
                                >
                                    <X size={12} color="white" />
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            <div style={{ padding: '0 16px 8px 16px' }}>
                {replyingTo && (
                    <div style={{ 
                        padding: '8px 12px 8px 44px', 
                        backgroundColor: 'var(--bg-tertiary)', 
                        borderTopLeftRadius: '8px', 
                        borderTopRightRadius: '8px', 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        borderBottom: '1px solid var(--divider)',
                        width: '100%'
                    }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                            Replying to <span style={{ fontWeight: 600, color: 'var(--interactive-active)' }}>{replyingTo.username}</span>
                        </div>
                        <div 
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                width: '24px', 
                                height: '24px',
                                borderRadius: '50%',
                                cursor: 'pointer',
                                transition: 'background-color 0.1s'
                            }}
                            className="reply-close-btn"
                            onClick={() => setReplyingTo(null)}
                        >
                            <X size={16} style={{ color: 'var(--interactive-normal)' }} />
                        </div>
                    </div>
                )}
                <div style={{ position: 'relative', backgroundColor: 'var(--bg-tertiary)', borderRadius: replyingTo ? '0 0 8px 8px' : '8px', display: 'flex', alignItems: 'center', paddingRight: '12px' }}>
                    <label style={{ padding: '12px', color: 'var(--interactive-normal)', cursor: 'pointer', display: 'flex' }}>
                        <ImageIcon size={20} />
                        <input type="file" multiple style={{ display: 'none' }} onChange={async (e) => {
                            if (!e.target.files?.length) return;
                            const formData = new FormData();
                            Array.from(e.target.files).forEach(f => formData.append('files', f));
                            try {
                                const res = await fetch(`${serverUrl}/api/servers/${activeServerId}/attachments`, {
                                    method: 'POST',
                                    headers: { 'Authorization': `Bearer ${currentAccount?.token || ''}` },
                                    body: formData
                                });
                                if (!res.ok) {
                                    const err = await res.json();
                                    alert(err.error || 'Upload failed');
                                    return;
                                }
                                const data = await res.json();
                                setPendingAttachments((prev: string[]) => [...prev, ...data.urls]);
                            } catch (err) {
                                console.error("Failed to upload attachments", err);
                                alert("Failed to upload attachments");
                            }
                            e.target.value = '';
                        }} />
                    </label>
                    <input
                        ref={inputRef}
                        className="input-field"
                        style={{ backgroundColor: 'transparent' }}
                        placeholder={`Message #${activeChannelName || 'active-channel'}`}
                        value={inputValue}
                        onChange={e => {
                            const val = e.target.value;
                            const selectionStart = e.target.selectionStart || 0;
                            setInputValue(val);

                            // Trigger @ detection
                            const textBeforeCursor = val.substring(0, selectionStart);
                            const lastAt = textBeforeCursor.lastIndexOf('@');
                            if (lastAt !== -1 && (lastAt === 0 || textBeforeCursor[lastAt-1] === ' ')) {
                                const filter = textBeforeCursor.substring(lastAt + 1);
                                if (!filter.includes(' ')) {
                                    setAutocompleteFilter(filter);
                                    setAutocompleteStartIdx(lastAt);
                                    
                                    const options = [
                                        ...serverProfiles,
                                        ...serverRoles
                                    ].filter(o => {
                                        if ('color' in o) {
                                            return o.name.toLowerCase().includes(filter.toLowerCase());
                                        }
                                        const nickMatch = o.nickname.toLowerCase().includes(filter.toLowerCase());
                                        const userMatch = (o.original_username || '').toLowerCase().includes(filter.toLowerCase());
                                        return nickMatch || userMatch;
                                    }).sort((a, b) => {
                                        const filterLower = filter.toLowerCase();
                                        const aName = 'color' in a ? a.name.toLowerCase() : a.nickname.toLowerCase();
                                        const bName = 'color' in b ? b.name.toLowerCase() : b.nickname.toLowerCase();
                                        const aUser = 'color' in a ? '' : (a.original_username || '').toLowerCase();
                                        const bUser = 'color' in b ? '' : (b.original_username || '').toLowerCase();

                                        const aExact = aName === filterLower || aUser === filterLower;
                                        const bExact = bName === filterLower || bUser === filterLower;
                                        if (aExact && !bExact) return -1;
                                        if (!aExact && bExact) return 1;

                                        const aStarts = aName.startsWith(filterLower) || aUser.startsWith(filterLower);
                                        const bStarts = bName.startsWith(filterLower) || bUser.startsWith(filterLower);
                                        if (aStarts && !bStarts) return -1;
                                        if (!aStarts && bStarts) return 1;

                                        return aName.localeCompare(bName);
                                    });
                                    
                                    setFilteredOptions(options);
                                    setAutocompleteIndex(0);
                                    setShowAutocomplete(options.length > 0);
                                    setShowEmojiAutocomplete(false);
                                } else {
                                    setShowAutocomplete(false);
                                }
                            } else {
                                setShowAutocomplete(false);
                                
                                // Trigger : detection
                                const lastColon = textBeforeCursor.lastIndexOf(':');
                                if (lastColon !== -1 && (lastColon === 0 || textBeforeCursor[lastColon-1] === ' ')) {
                                    const filter = textBeforeCursor.substring(lastColon + 1);
                                    if (!filter.includes(' ')) {
                                        setEmojiFilter(filter);
                                        setAutocompleteStartIdx(lastColon);
                                        
                                        const options = EMOJI_MAP.filter(e => 
                                            e.name.toLowerCase().includes(filter.toLowerCase())
                                        ).slice(0, 10); // Limit suggestions
                                        
                                        setFilteredEmojis(options);
                                        setEmojiIndex(0);
                                        setShowEmojiAutocomplete(options.length > 0);

                                        // Auto-convert if exact match and closing colon typed
                                        if (val[selectionStart-1] === ':') {
                                            const possibleName = filter.substring(0, filter.length - 1);
                                            const exactMatch = EMOJI_MAP.find(e => e.name.toLowerCase() === possibleName.toLowerCase());
                                            if (exactMatch) {
                                                const before = val.substring(0, lastColon);
                                                const after = val.substring(selectionStart);
                                                setInputValue(`${before}${exactMatch.emoji}${after}`);
                                                setShowEmojiAutocomplete(false);
                                            }
                                        }
                                    } else {
                                        setShowEmojiAutocomplete(false);
                                    }
                                } else {
                                    setShowEmojiAutocomplete(false);
                                }
                            }
                        }}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                    />
                    <Send
                        size={20}
                        color={(inputValue.trim() || pendingAttachments.length > 0) ? "var(--interactive-hover)" : "var(--interactive-normal)"}
                        onClick={handleSend}
                        style={{ cursor: 'pointer' }}
                    />
                    {showAutocomplete && (
                        <MentionAutocomplete 
                            options={filteredOptions} 
                            selectedIndex={autocompleteIndex} 
                            onSelect={handleMentionSelect} 
                        />
                    )}
                    {showEmojiAutocomplete && (
                        <EmojiAutocomplete 
                            options={filteredEmojis} 
                            selectedIndex={emojiIndex} 
                            onSelect={handleEmojiSelect} 
                        />
                    )}
                </div>
            </div>
        </div>
    );
});

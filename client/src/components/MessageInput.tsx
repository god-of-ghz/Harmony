import React, { useState, useRef, useEffect } from 'react';
import { Send, Image as ImageIcon, X } from 'lucide-react';
import type { MessageData, Profile, RoleData } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { signPayload } from '../utils/crypto';
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

        // Parse @nickname to <@id>
        const sortedProfiles = [...serverProfiles].sort((a, b) => b.nickname.length - a.nickname.length);
        let parsedContent = inputValue;
        for (const p of sortedProfiles) {
            const regex = new RegExp(`@${p.nickname}\\b`, 'g');
            parsedContent = parsedContent.replace(regex, `<@${p.id}>`);
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

        fetch(`${serverUrl}/api/channels/${activeChannelId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: parsedContent,
                authorId: currentProfile.id,
                signature,
                attachments: JSON.stringify(pendingAttachments),
                reply_to: replyingTo?.id || null
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
                    headers: { 'X-Account-Id': currentAccount?.id || '' },
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
                                    <video src={`${serverUrl}${url}`} style={{ height: '60px', borderRadius: '4px' }} controls={false} />
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
                                    headers: { 'X-Account-Id': currentAccount?.id || '' },
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
                                        const name = 'color' in o ? o.name : o.nickname;
                                        return name.toLowerCase().includes(filter.toLowerCase());
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

import React, { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';

interface EmojiPickerProps {
    onSelect: (emoji: string) => void;
    onClose: () => void;
}

const EMOJI_LIST: Record<string, string[]> = {
    smileys: ['😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊', '😋', '😎', '😍', '😘', '😚', '😗', '😙', '😛', '😜', '😝', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'],
    gestures: ['👋', '🤚', '🖐', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏'],
    edgy: ['🍆', '🍑', '💦', '👅', '🍺', '🍷', '🥃', '🍸', '🍹', '🍻', '🚬', '🔞', '🧨', '🗡', '⚔️', '🛡', '⛓', '💊', '💉', '💰', '💣', '🐍', '👄', '🫦', '🧴', '🔥', '💥', '🚬', '🪦'],
    symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈️', '♉️', '♊️', '♋️', '♌️', '♍️', '♎️', '♏️', '♐️', '♑️', '♒️', '♓️', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚️', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕️', '🛑', '⛔️', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❓', '❔', '❕', '❗️', '〰️', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯️', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤'],
};

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose }) => {
    const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        const stored = localStorage.getItem('recent_emojis');
        if (stored) {
            setRecentEmojis(JSON.parse(stored));
        } else {
            // Default recents if empty
            setRecentEmojis(['👍', '❤️', '😂', '🔥', '🍆', '🍑', '🖕']);
        }
    }, []);

    const handleEmojiClick = (emoji: string) => {
        onSelect(emoji);
        const updated = [emoji, ...recentEmojis.filter(e => e !== emoji)].slice(0, 24);
        setRecentEmojis(updated);
        localStorage.setItem('recent_emojis', JSON.stringify(updated));
        onClose();
    };

    const filteredLists: Record<string, string[]> = searchQuery 
        ? {
            results: Object.values(EMOJI_LIST).flat().filter(e => e.includes(searchQuery) || searchQuery === '') // Basic search, mostly just showing all if query is empty
          }
        : EMOJI_LIST;

    return (
        <div className="glass-panel" style={{
            width: '320px',
            height: '400px',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: '8px',
            overflow: 'hidden',
            zIndex: 100,
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: '8px',
            animation: 'fadeInUp 0.15s ease-out'
        }}>
            <style>
                {`
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .emoji-item {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 24px;
                    width: 36px;
                    height: 36px;
                    cursor: pointer;
                    border-radius: 4px;
                    transition: background-color 0.1s, transform 0.1s;
                }
                .emoji-item:hover {
                    background-color: var(--bg-modifier-hover);
                    transform: scale(1.1);
                }
                .emoji-category-title {
                    font-size: 12px;
                    font-weight: 700;
                    color: var(--text-muted);
                    text-transform: uppercase;
                    padding: 8px 12px 4px 12px;
                }
                `}
            </style>

            <div style={{ padding: '12px', borderBottom: '1px solid var(--divider)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input 
                        type="text" 
                        placeholder="Search emojis..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            backgroundColor: 'var(--bg-secondary)',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '6px 8px 6px 28px',
                            color: 'var(--text-normal)',
                            fontSize: '14px',
                            outline: 'none'
                        }}
                    />
                </div>
                <X size={20} style={{ cursor: 'pointer', color: 'var(--interactive-normal)' }} onClick={onClose} />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
                {!searchQuery && recentEmojis.length > 0 && (
                    <>
                        <div className="emoji-category-title">Recent</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', padding: '0 8px' }}>
                            {recentEmojis.map(emoji => (
                                <div key={`recent-${emoji}`} className="emoji-item" onClick={() => handleEmojiClick(emoji)}>
                                    {emoji}
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {Object.entries(filteredLists).map(([cat, emojis]) => (
                    <React.Fragment key={cat}>
                        <div className="emoji-category-title">{cat}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', padding: '0 8px' }}>
                            {emojis.map((emoji, idx) => (
                                <div key={`${cat}-${idx}`} className="emoji-item" onClick={() => handleEmojiClick(emoji)}>
                                    {emoji}
                                </div>
                            ))}
                        </div>
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

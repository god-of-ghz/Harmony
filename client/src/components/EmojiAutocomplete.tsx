import React from 'react';
import type { EmojiData } from '../utils/emojis';

interface EmojiAutocompleteProps {
    options: EmojiData[];
    selectedIndex: number;
    onSelect: (option: EmojiData) => void;
}

export const EmojiAutocomplete: React.FC<EmojiAutocompleteProps> = ({ options, selectedIndex, onSelect }) => {
    if (options.length === 0) return null;

    return (
        <div style={{
            position: 'absolute',
            bottom: '100%',
            left: '16px',
            right: '16px',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '8px',
            boxShadow: '0 -2px 10px rgba(0,0,0,0.3)',
            marginBottom: '8px',
            maxHeight: '240px',
            overflowY: 'auto',
            border: '1px solid var(--divider)',
            zIndex: 100,
            animation: 'fadeInUp 0.1s ease-out'
        }}>
            <style>
                {`
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .emoji-option {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 8px 12px;
                    cursor: pointer;
                    transition: background-color 0.1s;
                }
                .emoji-option.selected {
                    background-color: var(--bg-modifier-hover);
                    color: var(--interactive-active);
                }
                .emoji-option:hover {
                    background-color: var(--bg-modifier-hover);
                }
                `}
            </style>
            <div style={{ 
                padding: '8px 12px', 
                borderBottom: '1px solid var(--divider)', 
                fontSize: '11px', 
                color: 'var(--text-muted)', 
                fontWeight: 700, 
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
            }}>
                Emoji Suggestions
            </div>
            {options.map((option, index) => (
                <div
                    key={option.name}
                    className={`emoji-option ${index === selectedIndex ? 'selected' : ''}`}
                    onMouseDown={(e) => {
                        e.preventDefault(); // Prevent input blur
                        onSelect(option);
                    }}
                >
                    <span style={{ fontSize: '20px', width: '24px', textAlign: 'center' }}>{option.emoji}</span>
                    <span style={{ fontSize: '14px' }}>:{option.name}:</span>
                </div>
            ))}
        </div>
    );
};

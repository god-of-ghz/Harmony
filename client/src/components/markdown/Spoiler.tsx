import React, { useState } from 'react';

export const Spoiler: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [revealed, setRevealed] = useState(false);

    return (
        <span
            className={`markdown-spoiler ${revealed ? 'revealed' : 'hidden'}`}
            onClick={() => setRevealed(true)}
            style={{
                backgroundColor: revealed ? 'var(--bg-modifier-hover)' : '#202225',
                color: revealed ? 'inherit' : 'transparent',
                borderRadius: '4px',
                padding: '0 4px',
                cursor: revealed ? 'text' : 'pointer',
                transition: 'background-color 0.2s, color 0.2s',
                userSelect: revealed ? 'text' : 'none'
            }}
            title={revealed ? undefined : "Click to reveal spoiler"}
        >
            {children}
        </span>
    );
};

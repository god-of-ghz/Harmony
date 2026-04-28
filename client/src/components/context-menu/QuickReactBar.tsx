import React from 'react';
import { useContextMenuStore } from '../../store/contextMenuStore';

interface QuickReactBarProps {
    onAddReaction: (emoji: string) => void;
}

const QUICK_EMOJIS = ['😂', '❤️', '👍', '😭'];

export const QuickReactBar: React.FC<QuickReactBarProps> = ({ onAddReaction }) => {
    const closeContextMenu = useContextMenuStore((s) => s.closeContextMenu);

    return (
        <div className="quick-react-bar" data-testid="quick-react-bar">
            {QUICK_EMOJIS.map((emoji) => (
                <button
                    key={emoji}
                    className="quick-react-btn"
                    data-testid={`quick-react-${emoji}`}
                    onClick={() => {
                        onAddReaction(emoji);
                        closeContextMenu();
                    }}
                    type="button"
                >
                    {emoji}
                </button>
            ))}
        </div>
    );
};

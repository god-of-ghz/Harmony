import React from 'react';
import { useAppStore } from '../../store/appStore';

export const CustomEmoji: React.FC<{ animated: string; name: string; id: string }> = ({ animated, name, id }) => {
    const activeServerId = useAppStore(state => state.activeServerId);
    const serverEmojisRaw = useAppStore(state => state.emojis[activeServerId || '']);
    const serverEmojis = serverEmojisRaw || [];

    const emoji = serverEmojis.find(e => e.id === id);

    if (emoji) {
        return (
            <img
                src={emoji.url}
                alt={name}
                title={`:${name}:`}
                className="inline-emoji"
                loading="lazy"
            />
        );
    } else {
        // Fallback: just render the shortcode if not found
        return <span>&lt;{animated ? 'a' : ''}:{name}:{id}&gt;</span>;
    }
};

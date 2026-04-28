import React from 'react';
import { useAppStore } from '../../store/appStore';

export const InternalLink: React.FC<{ serverId: string; channelId: string; messageId: string }> = ({ serverId, channelId, messageId }) => {
    const activeChannelId = useAppStore(state => state.activeChannelId);
    const activeChannelName = useAppStore(state => state.activeChannelName);

    let channelText = 'message';
    if (channelId === activeChannelId && activeChannelName) {
        channelText = activeChannelName;
    }

    return (
        <span
            className="chat-link internal-link"
            title={`#/server/${serverId}/channels/${channelId}/messages/${messageId}`}
            style={{ 
                cursor: 'pointer', 
                backgroundColor: 'var(--brand-experiment)', 
                padding: '2px 6px', 
                borderRadius: '3px', 
                fontSize: '14px', 
                display: 'inline-flex', 
                alignItems: 'center', 
                textDecoration: 'none', 
                color: '#ffffff', 
                fontWeight: 600,
                lineHeight: '18px',
                verticalAlign: 'bottom',
                marginBottom: '-2px'
            }}
            onClick={(e) => {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('harmony-jump', {
                    detail: { serverId, channelId, messageId }
                }));
            }}
        >
            <span style={{ opacity: 0.7, marginRight: '2px', fontWeight: 'normal' }}>#</span>
            <span>{channelText}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, margin: '0 4px' }}>
                <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" />
            </svg>
        </span>
    );
};

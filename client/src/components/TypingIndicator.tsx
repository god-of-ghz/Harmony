import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { MoreHorizontal } from 'lucide-react';

interface TypingIndicatorProps {
    activeChannelId: string;
    currentAccountId?: string;
    addTypingListener: (handler: (payload: any) => void) => (() => void);
}

export const TypingIndicator = React.memo(({ 
    activeChannelId, 
    currentAccountId, 
    addTypingListener 
}: TypingIndicatorProps) => {
    const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});
    const serverProfiles = useAppStore(state => state.serverProfiles);

    useEffect(() => {
        setTypingUsers({});

        const cleanup = addTypingListener((payload) => {
            if (payload.type === 'TYPING_START') {
                if (payload.data.channelId === activeChannelId) {
                    setTypingUsers(prev => ({ ...prev, [payload.data.accountId]: Date.now() }));
                }
            } else if (payload.type === 'TYPING_STOP') {
                if (payload.data.channelId === activeChannelId) {
                    setTypingUsers(prev => {
                        const next = { ...prev };
                        delete next[payload.data.accountId];
                        return next;
                    });
                }
            }
        });

        return cleanup;
    }, [activeChannelId, addTypingListener]);

    useEffect(() => {
        const interval = setInterval(() => {
            setTypingUsers(prev => {
                const now = Date.now();
                const next = { ...prev };
                let changed = false;
                for (const acc in next) {
                    if (now - next[acc] > 3000) {
                        delete next[acc];
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const otherTypingIds = Object.keys(typingUsers).filter(id => id !== currentAccountId);
    if (otherTypingIds.length === 0) return <div style={{ height: '0px' }} />;

    const names = otherTypingIds.map(id => {
        const prof = serverProfiles.find(p => p.account_id === id);
        return prof ? prof.nickname : 'Unknown User';
    });

    let text: React.ReactNode = null;
    if (names.length === 1) text = <span><strong>{names[0]}</strong> is typing...</span>;
    else if (names.length === 2) text = <span><strong>{names[0]}</strong> and <strong>{names[1]}</strong> are typing...</span>;
    else if (names.length === 3) text = <span><strong>{names[0]}</strong>, <strong>{names[1]}</strong> and <strong>{names[2]}</strong> are typing...</span>;
    else text = <span><strong>{names[0]}</strong>, <strong>{names[1]}</strong> and {names.length - 2} others are typing...</span>;

    return (
        <div style={{ height: '24px', display: 'flex', alignItems: 'center', padding: '0 16px', marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', marginRight: '8px' }}>
                <MoreHorizontal size={24} style={{ color: 'var(--text-muted)' }} />
            </div>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                {text}
            </div>
        </div>
    );

});

TypingIndicator.displayName = 'TypingIndicator';

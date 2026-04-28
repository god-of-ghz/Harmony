import React from 'react';
import { useAppStore } from '../../store/appStore';
import { useUserInteraction } from '../../hooks/useUserInteraction';

export const Mention: React.FC<{ id: string }> = ({ id }) => {
    const serverProfiles = useAppStore(state => state.serverProfiles);
    const showUnknownTags = useAppStore(state => state.showUnknownTags);
    const activeServerId = useAppStore(state => state.activeServerId);

    let cleanId = id;
    if (cleanId.startsWith('!')) cleanId = cleanId.slice(1);

    const profile = serverProfiles.find(p => p.id === cleanId || (p.aliases && p.aliases.split(',').map(a => a.trim()).includes(cleanId)));

    // User interaction hook — resolves even if profile is null (uses cleanId as profileId)
    const userInteraction = useUserInteraction({
        profileId: cleanId,
        accountId: profile?.account_id || undefined,
        guildId: activeServerId || '',
    });

    if (profile) {
        return (
            <span
                className="mention-tag"
                style={{ cursor: 'pointer' }}
                onContextMenu={userInteraction.onContextMenu}
                onClick={userInteraction.onClick}
            >
                @{profile.nickname}
            </span>
        );
    } else if (showUnknownTags) {
        return <span>&lt;@{id}&gt;</span>;
    } else {
        return <span className="mention-tag">@Unknown User</span>;
    }
};

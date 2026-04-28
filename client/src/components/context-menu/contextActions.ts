import { useContextMenuStore } from '../../store/contextMenuStore';
import { useAppStore } from '../../store/appStore';
import { apiFetch } from '../../utils/apiFetch';

/**
 * Copy text to clipboard and show a toast notification.
 */
export const copyToClipboard = async (text: string) => {
    try {
        await navigator.clipboard.writeText(text);
        useContextMenuStore.getState().showToast('Copied!');
    } catch (err) {
        console.error('Failed to copy to clipboard:', err);
    }
};

/**
 * Leave a guild. Extracted from GuildSidebar.handleLeaveGuild.
 */
export const leaveGuild = async (guildId: string, token: string) => {
    const { guildMap, activeGuildId, setActiveGuildId } = useAppStore.getState();
    const nodeUrl = guildMap[guildId];
    if (!nodeUrl) return;

    try {
        const res = await apiFetch(`${nodeUrl}/api/guilds/${guildId}/leave`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
            // Do NOT remove the node URL from connectedServers — leaving a single
            // guild is a membership change, not a node disconnect. Removing
            // the URL triggers federation deactivation which permanently marks the
            // account as is_deactivated=1 on the remote node, preventing rejoin.
            if (activeGuildId === guildId) setActiveGuildId('');
        }
    } catch (err) {
        console.error('Failed to leave guild:', err);
    }
};

/**
 * Delete a guild. Extracted from GuildSidebar.handleDeleteGuild.
 */
export const deleteGuild = async (guildId: string, token: string) => {
    const { guildMap, activeGuildId, setActiveGuildId, clearGuildSearchState } = useAppStore.getState();
    const nodeUrl = guildMap[guildId];
    if (!nodeUrl) return;

    try {
        const res = await apiFetch(`${nodeUrl}/api/guilds/${guildId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const result = await res.json();
        if (result.success) {
            if (activeGuildId === guildId) setActiveGuildId('');
            clearGuildSearchState(guildId);
        }
    } catch (err) {
        console.error('Failed to delete guild:', err);
    }
};

/**
 * Open guild settings for a given guild.
 */
export const openGuildSettings = (guildId: string, _tab?: string) => {
    const { setActiveGuildId, setShowGuildSettings } = useAppStore.getState();
    setActiveGuildId(guildId);
    setShowGuildSettings(true);
};

/**
 * Dispatch a custom event to insert an @mention into the active message input.
 */
export const insertMention = (nickname: string) => {
    window.dispatchEvent(
        new CustomEvent('harmony-insert-mention', { detail: { nickname } })
    );
};

/**
 * Delete a channel from a guild.
 */
export const deleteChannel = async (channelId: string, guildId: string, token: string) => {
    const { guildMap } = useAppStore.getState();
    const nodeUrl = guildMap[guildId];
    if (!nodeUrl) return;

    try {
        const res = await apiFetch(`${nodeUrl}/api/guilds/${guildId}/channels/${channelId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
            useContextMenuStore.getState().showToast('Channel deleted');
        }
    } catch (err) {
        console.error('Failed to delete channel:', err);
    }
};

/**
 * Mark a channel as read locally (updates readStates + removes from unreadChannels).
 */
export const markChannelAsRead = (channelId: string) => {
    const { updateReadState, removeUnreadChannel } = useAppStore.getState();
    // Use a sentinel value to mark as "read up to now"
    updateReadState(channelId, `read-${Date.now()}`);
    removeUnreadChannel(channelId);
};

/**
 * Delete a message from a channel via API.
 */
export const deleteMessage = async (messageId: string, channelId: string, guildId: string, token: string) => {
    const { guildMap } = useAppStore.getState();
    const nodeUrl = guildMap[guildId];
    if (!nodeUrl) return;

    try {
        const res = await apiFetch(`${nodeUrl}/api/guilds/${guildId}/channels/${channelId}/messages/${messageId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
            useContextMenuStore.getState().showToast('Message deleted');
        }
    } catch (err) {
        console.error('Failed to delete message:', err);
    }
};

/**
 * Copy a message link to clipboard. Generates a harmony:// style link.
 */
export const copyMessageLink = async (guildId: string, channelId: string, messageId: string) => {
    const link = `${window.location.origin}/channels/${guildId}/${channelId}/${messageId}`;
    await copyToClipboard(link);
};

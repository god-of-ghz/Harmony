import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { ProfileSetupUI } from './ProfileSetupUI';

interface UnclaimedProfile {
    id: string;
    global_name: string;
    avatar: string;
    bio?: string;
}

export const GlobalClaimProfile = () => {
    const { currentAccount, unclaimedProfiles, setUnclaimedProfiles, setDismissedGlobalClaim, isGuestSession, connectedServers } = useAppStore();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUnclaimed = async () => {
            if (!currentAccount?.token || isGuestSession) {
                setLoading(false);
                return;
            }
            try {
                const safe = Array.isArray(connectedServers) ? connectedServers : [];
                const homeServer = currentAccount.primary_server_url || safe[0]?.url;
                if (!homeServer) {
                    // Can't determine home server — dismiss silently so user isn't blocked
                    setDismissedGlobalClaim(true);
                    return;
                }
                const res = await fetch(`${homeServer}/api/accounts/unclaimed-imports`, {
                    headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setUnclaimedProfiles(data);
                    if (!data || data.length === 0) {
                        // No unclaimed Discord imports on this server — auto-dismiss
                        // so the user isn't blocked by a full-screen overlay after signup.
                        // Keep loading=true so we return null until App unmounts us.
                        setDismissedGlobalClaim(true);
                        return;
                    }
                } else {
                    // Server returned an error — don't block the user
                    setDismissedGlobalClaim(true);
                    return;
                }
            } catch (err) {
                console.error('Failed to fetch unclaimed profiles:', err);
                // If we can't reach the server, don't block the user with an overlay
                setDismissedGlobalClaim(true);
                return;
            }
            setLoading(false);
        };

        fetchUnclaimed();
    }, [currentAccount?.token, isGuestSession, setUnclaimedProfiles]);

    const handleFreshStart = async () => {
        if (!currentAccount?.token) return;
        // The user types their global profile name. 
        // Currently the system relies on claiming discord identities or skipping.
        // Let's create a global profile placeholder for them
        try {
            const safe = Array.isArray(connectedServers) ? connectedServers : [];
            const homeServer = currentAccount.primary_server_url || safe[0]?.url;
            if (!homeServer) { setDismissedGlobalClaim(true); return; }
            await fetch(`${homeServer}/api/accounts/dismiss-claim`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            // (Assuming we save their global name later. Dismiss-claim flags them as bypassing)
            setDismissedGlobalClaim(true);
        } catch (err) {
            console.error('Failed to dismiss claim:', err);
            setDismissedGlobalClaim(true); // Fallback
        }
    };

    const handleClaim = async (discord_id: string) => {
        if (!currentAccount?.token) return;
        try {
            const safe = Array.isArray(connectedServers) ? connectedServers : [];
            const homeServer = currentAccount.primary_server_url || safe[0]?.url;
            if (!homeServer) return;
            const res = await fetch(`${homeServer}/api/accounts/link-discord`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}` 
                },
                body: JSON.stringify({ discord_id })
            });
            if (res.ok) {
                setDismissedGlobalClaim(true);
                
                // Refresh per-guild claimed profiles
                const profRes = await fetch(`${homeServer}/api/accounts/${currentAccount.id}/profiles`, {
                    headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                });
                if (profRes.ok) {
                    const profiles = await profRes.json();
                    useAppStore.getState().setClaimedProfiles(profiles);
                }

                // Refresh global profile (display_name, avatar_url from claimed Discord identity)
                const globalRes = await fetch(`${homeServer}/api/federation/profile/${currentAccount.id}`, {
                    headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                });
                if (globalRes.ok) {
                    const globalProfile = await globalRes.json();
                    useAppStore.getState().updateGlobalProfile(globalProfile);
                }
            }
        } catch (err) {
            console.error('Failed to link discord:', err);
        }
    };

    if (loading || isGuestSession) return null;

    const mappedProfiles = ((unclaimedProfiles as unknown as UnclaimedProfile[]) || []).map(u => ({
        id: u.id,
        name: u.global_name,
        avatar: u.avatar
    }));

    return (
        <ProfileSetupUI 
            title="Setup Global Profile"
            description="Create your global Harmony identity, or optionally claim an imported Discord profile."
            profiles={mappedProfiles}
            serverUrl={currentAccount?.primary_server_url || (Array.isArray(connectedServers) ? connectedServers[0]?.url : '') || ''}
            onClaim={handleClaim}
            onFreshStart={handleFreshStart}
        />
    );
};

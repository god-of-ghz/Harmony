import { useEffect, useState } from 'react';
import type { Profile } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { ProfileSetupUI } from './ProfileSetupUI';
import { apiFetch } from '../utils/apiFetch';

export const ClaimProfile = ({ serverId }: { serverId: string }) => {
    const { currentAccount, addClaimedProfile, serverMap, connectedServers, isGuestSession } = useAppStore();
    const serverUrl = serverMap[serverId];
    const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(serverUrl);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    console.log('[ClaimProfile] Render', { serverId, serverUrl, resolvedUrl, serverMapKeys: Object.keys(serverMap), connectedServers: connectedServers?.map(s => s.url) });

    // If serverMap already has the URL, use it immediately.
    // Otherwise, actively probe connected servers to find which one hosts this guild.
    useEffect(() => {
        console.log('[ClaimProfile] Resolution effect', { serverUrl, serverId });
        if (serverUrl) {
            console.log('[ClaimProfile] serverMap HIT — using', serverUrl);
            setResolvedUrl(serverUrl);
            return;
        }
        // Active resolution: check each connected server for this guild
        let cancelled = false;
        const resolve = async () => {
            const safe = Array.isArray(connectedServers) ? connectedServers : [];
            console.log('[ClaimProfile] Active probe starting, servers:', safe.map(s => s.url));
            for (const srv of safe) {
                if (cancelled) return;
                try {
                    console.log('[ClaimProfile] Probing', srv.url);
                    const res = await apiFetch(`${srv.url}/api/guilds`, {
                        headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
                    });
                    console.log('[ClaimProfile] Probe response', srv.url, res.status);
                    if (res.ok) {
                        const guilds = await res.json();
                        const guildIds = Array.isArray(guilds) ? guilds.map((g: any) => g.id) : [];
                        console.log('[ClaimProfile] Guilds from', srv.url, ':', guildIds, '| looking for:', serverId);
                        if (Array.isArray(guilds) && guilds.some((g: any) => g.id === serverId)) {
                            console.log('[ClaimProfile] FOUND guild on', srv.url);
                            if (!cancelled) setResolvedUrl(srv.url);
                            return;
                        }
                    }
                } catch (err) {
                    console.error('[ClaimProfile] Probe failed for', srv.url, err);
                }
            }
            console.log('[ClaimProfile] All probes exhausted, waiting 3s for serverMap update...');
            // Exhausted all servers — wait and retry once (serverMap may update)
            if (!cancelled) {
                setTimeout(() => {
                    const latestMap = useAppStore.getState().serverMap;
                    const latestUrl = latestMap[serverId];
                    console.log('[ClaimProfile] Retry check — serverMap:', Object.keys(latestMap), 'url:', latestUrl);
                    if (latestUrl) {
                        setResolvedUrl(latestUrl);
                    } else {
                        setError('Unable to connect to this guild\'s server. The server URL is not available.');
                        setLoading(false);
                    }
                }, 3000);
            }
        };
        resolve();
        return () => { cancelled = true; };
    }, [serverId, serverUrl, connectedServers, currentAccount?.token]);

    useEffect(() => {
        if (!resolvedUrl) return;
        setLoading(true);
        setError('');
        fetch(`${resolvedUrl}/api/guilds/${serverId}/profiles`, {
            headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
        })
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setProfiles(data);
                } else if (data.error) {
                    setError(data.error);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setError('Failed to connect to server');
                setLoading(false);
            });
    }, [serverId, resolvedUrl, currentAccount?.token]);

    const handleClaim = (profileId: string) => {
        if (!currentAccount || !resolvedUrl) return; 
        fetch(`${resolvedUrl}/api/profiles/claim`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAccount.token}`
            },
            body: JSON.stringify({ profileId, serverId, guildId: serverId, accountId: currentAccount.id })
        })
            .then(res => res.json())
            .then(result => {
                if (result.success) {
                    const profile = profiles.find(p => p.id === profileId);
                    if (profile) {
                        addClaimedProfile({ ...profile, account_id: currentAccount.id });
                    }
                } else {
                    setError(result.error || 'Failed to claim profile');
                }
            })
            .catch(err => {
                console.error(err);
                setError('Network error while claiming profile');
            });
    };

    const handleFreshStart = (nickname: string) => {
        if (!nickname.trim() || !currentAccount) return;

        // Try resolvedUrl first, then check live serverMap, then try any connected server
        let url = resolvedUrl || useAppStore.getState().serverMap[serverId];
        if (!url) {
            console.error('[ClaimProfile] handleFreshStart: no URL resolved! serverId:', serverId, 'serverMap:', Object.keys(useAppStore.getState().serverMap));
            setError('Server URL not resolved. Please try again in a moment.');
            return;
        }

        fetch(`${url}/api/guilds/${serverId}/profiles`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAccount.token}`
            },
            body: JSON.stringify({ accountId: currentAccount.id, nickname: nickname, isGuest: isGuestSession })
        })
            .then(async res => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to join server');
                return data;
            })
            .then(newProfile => {
                addClaimedProfile(newProfile);
            })
            .catch(err => {
                console.error(err);
                setError(err.message || 'Network error while joining server');
            });
    };

    if (loading) {
        return <div style={{ color: 'white', padding: '24px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading available profiles...</div>;
    }

    const unclaimedProfiles = profiles.filter(p => !p.account_id).map(p => ({
        id: p.id,
        name: p.original_username,
        avatar: p.avatar
    }));

    // Handle injected errors via the legacy component wrapper for test resiliency
    return (
        <div style={{ flex: 1, position: 'relative' }}>
             {error && (
                <div style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 4000, color: '#ed4245', fontSize: '13px', padding: '8px', backgroundColor: 'rgba(237, 66, 69, 0.1)', border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px' }}>
                    {error}
                </div>
            )}
            <ProfileSetupUI 
                title="Join Server"
                description={unclaimedProfiles.length > 0 ? "Create your nickname or claim an existing imported identity." : "Choose a nickname to start fresh on this server."}
                profiles={unclaimedProfiles}
                serverUrl={resolvedUrl}
                onClaim={handleClaim}
                onFreshStart={handleFreshStart}
                isGuestSession={isGuestSession}
            />
        </div>
    );
};

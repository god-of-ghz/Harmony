import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { apiFetch } from '../../utils/apiFetch';
import { Shield, Crown, ArrowLeft, Users, Lock, Unlock } from 'lucide-react';

export interface JoinGuildFlowProps {
    onClose: () => void;
    onBack: () => void;
    fetchGuilds: () => Promise<void>;
}

interface DiscoverableGuild {
    id: string;
    name: string;
    icon: string;
    description: string;
    member_count: number;
    open_join: boolean;
    is_claimable: boolean;
}

export const JoinGuildFlow = ({ onClose, onBack, fetchGuilds }: JoinGuildFlowProps) => {
    const { currentAccount, connectedServers, setConnectedServers } = useAppStore();

    const [joinStep, setJoinStep] = useState<'url' | 'trust-decision' | 'unclaimed' | 'guild-picker' | 'connected-no-guilds'>('url');
    const [pendingNodeUrl, setPendingNodeUrl] = useState('');
    const [, setPendingNodeHasOwner] = useState(true);
    const [newNodeUrl, setNewNodeUrl] = useState('');
    const [joinError, setJoinError] = useState('');
    const [discoverableGuilds, setDiscoverableGuilds] = useState<DiscoverableGuild[]>([]);
    const [joiningGuildId, setJoiningGuildId] = useState<string | null>(null);

    // Track invite context so that after trust step we can auto-join the guild
    const [pendingInvite, setPendingInvite] = useState<{
        guildId: string;
        token: string;
        hostUri: string;
        guildName: string;
    } | null>(null);

    const getHomeNodeUrl = (): string | undefined => {
        if (currentAccount?.primary_server_url) return currentAccount.primary_server_url;
        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        return safe[0]?.url || localStorage.getItem('harmony_last_server_url') || undefined;
    };

    const trustedCount = Array.isArray(connectedServers)
        ? connectedServers.filter(s => s.trust_level === 'trusted').length
        : 0;

    /**
     * After reconnecting to a node, attempt to rejoin any guilds where the user
     * has a 'left' profile. This calls the /rejoin endpoint which reactivates both
     * the profile membership and the deactivated account (is_deactivated = 0).
     */
    const rejoinGuildsOnNode = async (nodeUrl: string) => {
        if (!currentAccount) return;
        try {
            const guildsRes = await apiFetch(`${nodeUrl}/api/guilds`, {
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (!guildsRes.ok) return;
            const nodeGuilds: any[] = await guildsRes.json();

            for (const guild of nodeGuilds) {
                try {
                    await apiFetch(`${nodeUrl}/api/guilds/${guild.id}/rejoin`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                    });
                } catch (e) {
                    // Best-effort — if rejoin fails for a guild, continue with the rest
                }
            }
        } catch (err) {
            console.error('Failed to rejoin guilds on node:', err);
        }
    };

    /**
     * Fetch discoverable guilds on a node and show the guild picker if any exist.
     * If an invite is pending, auto-join that guild instead.
     */
    const discoverAndPickGuilds = async (nodeUrl: string) => {
        if (!currentAccount) return;

        // If we have a pending invite, join that guild directly
        if (pendingInvite) {
            await joinGuildOnNode(nodeUrl, pendingInvite.guildId, pendingInvite.token);
            return;
        }

        // Attempt to rejoin any previously-left guilds first
        await rejoinGuildsOnNode(nodeUrl);

        // Fetch discoverable guilds (memberless + open_join)
        try {
            const res = await apiFetch(`${nodeUrl}/api/guilds/discoverable`, {
                headers: { 'Authorization': `Bearer ${currentAccount.token}` }
            });
            if (res.ok) {
                const guilds: DiscoverableGuild[] = await res.json();
                if (guilds.length > 0) {
                    setDiscoverableGuilds(guilds);
                    setJoinStep('guild-picker');
                    return;
                }
            }
        } catch (err) {
            console.error('Failed to fetch discoverable guilds:', err);
        }

        // No discoverable guilds — show a connected-but-nothing message
        setJoinStep('connected-no-guilds');
    };

    /**
     * Join a specific guild on a node, optionally with an invite token.
     */
    const joinGuildOnNode = async (nodeUrl: string, guildId: string, inviteToken?: string) => {
        if (!currentAccount) return;
        setJoiningGuildId(guildId);
        setJoinError('');

        try {
            const body: Record<string, string> = {};
            if (inviteToken) body.inviteToken = inviteToken;

            const res = await apiFetch(`${nodeUrl}/api/guilds/${guildId}/join`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                },
                body: JSON.stringify(body)
            });

            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                console.log('[JoinGuildFlow] Join succeeded:', { guildId, nodeUrl, data });

                // Eagerly update the guildMap so ClaimProfile can immediately
                // find the server URL, even before fetchGuilds finishes.
                const currentMap = useAppStore.getState().guildMap;
                console.log('[JoinGuildFlow] Eager update: currentMap:', Object.keys(currentMap), '| adding:', guildId, '->', nodeUrl);
                useAppStore.getState().setGuildMap({ ...currentMap, [guildId]: nodeUrl });
                console.log('[JoinGuildFlow] After eager update: serverMap:', Object.keys(useAppStore.getState().serverMap));

                // Eagerly add the guild to the store's guild list so the
                // sidebar shows the icon immediately. The server may include
                // guild metadata in the join response; otherwise fall back to
                // the discoverable guilds list that is already in local state.
                const discoveredEntry = discoverableGuilds.find(g => g.id === guildId);
                const eagerGuild = {
                    id: guildId,
                    name: data.guild_name || discoveredEntry?.name || guildId,
                    icon: data.guild_icon ?? discoveredEntry?.icon ?? '',
                };
                useAppStore.getState().addGuild(eagerGuild);
                console.log('[JoinGuildFlow] Eagerly added guild to store:', eagerGuild.name);

                await fetchGuilds();

                // Belt-and-suspenders: if fetchGuilds replaced the list and the
                // API didn't return this guild (e.g. needs_profile_setup with no
                // active profile), re-add it. The merge logic in fetchGuilds
                // should handle this, but guard against edge cases.
                if (!useAppStore.getState().guilds.some(g => g.id === guildId)) {
                    console.warn('[JoinGuildFlow] Guild missing after fetchGuilds, re-adding:', guildId);
                    useAppStore.getState().addGuild(eagerGuild);
                }

                console.log('[JoinGuildFlow] After fetchGuilds: serverMap:', Object.keys(useAppStore.getState().serverMap), '| has guild?', !!useAppStore.getState().serverMap[guildId]);

                if (data.needs_profile_setup) {
                    // Imported guild with unclaimed profiles — navigate to the guild
                    // so App.tsx renders ClaimProfile for claim-or-fresh-start choice.
                    console.log('[JoinGuildFlow] Setting activeGuildId:', guildId);
                    useAppStore.getState().setActiveGuildId(guildId);
                }

                onClose();
            } else {
                const data = await res.json().catch(() => ({}));
                setJoinError(data.error || `Failed to join guild (${res.status})`);
            }
        } catch (err: any) {
            setJoinError('Network error: ' + err.message);
        } finally {
            setJoiningGuildId(null);
        }
    };

    const handleUrlSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentAccount || !newNodeUrl.trim()) return;
        setJoinError('');
        setPendingInvite(null);

        let rawInput = newNodeUrl.trim();
        let targetHost = rawInput;

        try {
            if (rawInput.startsWith('harmony://invite')) {
                const url = new URL(rawInput);
                const host = url.searchParams.get('host');
                const token = url.searchParams.get('token');
                const guildId = url.searchParams.get('guild');

                if (!host || !token) {
                    setJoinError("Invalid harmony invite link.");
                    return;
                }

                if (!window.confirm(`Warning: You are connecting to an external homelab server (${host}). Are you sure you want to proceed?`)) {
                    return;
                }

                // Consume the invite to get guild metadata
                const consumeBody: Record<string, string> = { token };
                if (guildId) consumeBody.guild_id = guildId;

                const consumeRes = await apiFetch(`${host}/api/invites/consume`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${currentAccount.token}`
                    },
                    body: JSON.stringify(consumeBody)
                });

                if (!consumeRes.ok) {
                    const errorData = await consumeRes.json().catch(() => ({}));
                    setJoinError(errorData.error || "Failed to accept invite. It may be expired or already used.");
                    return;
                }

                const consumeData = await consumeRes.json();

                // Store invite context for after the trust step
                setPendingInvite({
                    guildId: consumeData.guild_id,
                    token,
                    hostUri: host,
                    guildName: consumeData.guild_name || 'Unknown Guild'
                });

                targetHost = host;
            }

            const targetUrl = targetHost.replace(/\/$/, "");

            // Check if already connected to this node
            const alreadyConnected = connectedServers.some(s => s.url === targetUrl);
            if (alreadyConnected) {
                // Already connected — skip trust step, go directly to guild discovery
                setPendingNodeUrl(targetUrl);
                await discoverAndPickGuilds(targetUrl);
                return;
            }

            // Try /api/node/status first; fall back to /api/health for older nodes
            let hasOwner = true; // safe default
            const statusRes = await apiFetch(`${targetUrl}/api/node/status`);
            if (statusRes.ok) {
                const statusData = await statusRes.json();
                hasOwner = statusData.hasOwner;
            } else if (statusRes.status === 404) {
                const healthRes = await apiFetch(`${targetUrl}/api/health`);
                if (!healthRes.ok) throw new Error("Failed to reach node.");
            } else {
                throw new Error("Failed to reach node.");
            }

            setPendingNodeUrl(targetUrl);
            setPendingNodeHasOwner(hasOwner);
            // TODO [VISION:V1] Before showing the trust decision UI, fetch the peer
            // server's Ed25519 fingerprint via /api/federation/key and display it to
            // the user in a human-readable format (SSH-style TOFU). The user should
            // verify the fingerprint matches what the server operator published.
            // On "Trust", pin the fingerprint in the trusted_servers table.
            // On reconnect, verify the fingerprint hasn't changed.
            // This is a V1 feature — do NOT attempt during alpha stabilization.
            setJoinStep(hasOwner ? 'trust-decision' : 'unclaimed');

        } catch (err: any) {
            console.error("Error adding node:", err);
            setJoinError("Network error while verifying node: " + err.message);
        }
    };

    const handleJoinWithoutTrusting = async () => {
        if (!currentAccount) return;
        const homeNode = getHomeNodeUrl();

        if (homeNode) {
            try {
                await apiFetch(`${homeNode}/api/accounts/${currentAccount.id}/servers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentAccount.token}` },
                    body: JSON.stringify({ serverUrl: pendingNodeUrl })
                });
            } catch (err) {
                console.error("Failed to register untrusted node:", err);
            }
        }

        // Deduplicate: only add if not already present
        const alreadyExists = connectedServers.some(s => s.url === pendingNodeUrl);
        if (!alreadyExists) {
            const updated = [...connectedServers, { url: pendingNodeUrl, trust_level: 'untrusted' as const, status: 'active' as const }];
            setConnectedServers(updated);
        }

        await discoverAndPickGuilds(pendingNodeUrl);
    };

    const handleJoinAndTrust = async () => {
        if (!currentAccount || !pendingNodeUrl) return;
        const homeNode = getHomeNodeUrl();
        if (!homeNode) return;

        try {
            const res = await apiFetch(`${homeNode}/api/accounts/${currentAccount.id}/trusted_servers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentAccount.token}` },
                body: JSON.stringify({ serverUrl: pendingNodeUrl })
            });

            if (res.ok) {
                // Deduplicate: only add if not already present
                const alreadyExists = connectedServers.some(s => s.url === pendingNodeUrl);
                if (!alreadyExists) {
                    const updated = [...connectedServers, { url: pendingNodeUrl, trust_level: 'trusted' as const, status: 'active' as const }];
                    setConnectedServers(updated);
                }

                await discoverAndPickGuilds(pendingNodeUrl);
            } else {
                const errorData = await res.json().catch(() => ({}));
                setJoinError(errorData.error || "Failed to add trusted node.");
            }
        } catch (err: any) {
            console.error("Error trusting node:", err);
            setJoinError("Network error: " + err.message);
        }
    };

    const handleBecomeOwner = async () => {
        if (!currentAccount || !pendingNodeUrl) return;
        setJoinError('');
        try {
            const claimRes = await apiFetch(`${pendingNodeUrl}/api/node/claim-ownership`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                }
            });
            if (!claimRes.ok) {
                const errorData = await claimRes.json().catch(() => ({}));
                setJoinError(errorData.error || "Failed to claim ownership.");
                return;
            }

            await handleJoinAndTrust();
        } catch (err: any) {
            console.error("Error becoming owner:", err);
            setJoinError("Network error: " + err.message);
        }
    };

    const handleBack = () => {
        if (joinStep === 'guild-picker' || joinStep === 'connected-no-guilds') {
            setJoinStep('url');
            setJoinError('');
            setDiscoverableGuilds([]);
        } else if (joinStep !== 'url') {
            setJoinStep('url');
            setJoinError('');
        } else {
            onBack();
        }
    };

    return (
        <div className="join-guild-flow">
            {joinStep === 'url' && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                        <button
                            onClick={handleBack}
                            aria-label="Back to guild options"
                            style={{
                                background: 'none', border: 'none', color: 'var(--text-muted)',
                                cursor: 'pointer', padding: '4px', display: 'flex', borderRadius: '4px'
                            }}
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <h2 style={{ margin: 0 }}>Join a Guild</h2>
                    </div>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '14px' }}>
                        Enter the URL of the Harmony node you want to join, or paste an invite link. The node will be added to your trusted network.
                    </p>

                    {joinError && (
                        <div style={{ color: '#ed4245', marginBottom: '16px', fontSize: '13px', padding: '8px', backgroundColor: 'rgba(237, 66, 69, 0.1)', border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px' }}>
                            {joinError}
                        </div>
                    )}

                    <form onSubmit={handleUrlSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <input
                            type="text"
                            placeholder="http://localhost:3002 or harmony://invite?..."
                            required
                            value={newNodeUrl}
                            onChange={e => setNewNodeUrl(e.target.value)}
                            autoFocus
                            aria-label="Node URL or invite link"
                            style={{ padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--bg-tertiary)', color: 'white' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', border: '1px solid var(--background-modifier-accent)', backgroundColor: 'transparent', color: 'white', cursor: 'pointer', borderRadius: '4px' }}>Cancel</button>
                            <button type="submit" className="btn" style={{ flex: 1, padding: '10px', fontWeight: 'bold' }}>Continue</button>
                        </div>
                    </form>
                </>
            )}

            {joinStep === 'trust-decision' && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                        <button
                            onClick={handleBack}
                            aria-label="Back"
                            style={{
                                background: 'none', border: 'none', color: 'var(--text-muted)',
                                cursor: 'pointer', padding: '4px', display: 'flex', borderRadius: '4px'
                            }}
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <Shield size={24} color="var(--brand-experiment)" />
                        <h2 style={{ margin: 0 }}>Do you trust this node's operator?</h2>
                    </div>
                    <p style={{ color: 'var(--text-normal)', marginBottom: '12px', fontSize: '14px' }}>
                        Trusting a node allows it to authenticate you on the Harmony network if your primary node goes down. Your encrypted identity will be synced to this node.
                    </p>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '12px', fontSize: '14px' }}>
                        We recommend 2-3 trusted nodes, but ONLY if you know and trust the node operator.
                    </p>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '14px', fontWeight: 'bold' }}>
                        You currently have {trustedCount} trusted node(s).
                    </p>

                    {pendingInvite && (
                        <div style={{
                            color: '#23a559', marginBottom: '16px', fontSize: '13px', padding: '10px',
                            backgroundColor: 'rgba(35, 165, 89, 0.1)',
                            border: '1px solid rgba(35, 165, 89, 0.4)', borderRadius: '4px'
                        }}>
                            Invite accepted! After connecting, you'll automatically join <strong>{pendingInvite.guildName}</strong>.
                        </div>
                    )}

                    {joinError && (
                        <div style={{ color: '#ed4245', marginBottom: '16px', fontSize: '13px', padding: '8px', backgroundColor: 'rgba(237, 66, 69, 0.1)', border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px' }}>
                            {joinError}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button onClick={handleJoinAndTrust} className="btn" style={{ padding: '10px', fontWeight: 'bold', width: '100%' }}>Join & Trust</button>
                        <button onClick={handleJoinWithoutTrusting} style={{ padding: '10px', border: '1px solid var(--background-modifier-accent)', backgroundColor: 'transparent', color: 'white', cursor: 'pointer', borderRadius: '4px', width: '100%' }}>Join Without Trusting</button>
                        <button onClick={onClose} style={{ padding: '10px', border: 'none', backgroundColor: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', width: '100%' }}>Cancel</button>
                    </div>
                </>
            )}

            {joinStep === 'unclaimed' && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                        <button
                            onClick={handleBack}
                            aria-label="Back"
                            style={{
                                background: 'none', border: 'none', color: 'var(--text-muted)',
                                cursor: 'pointer', padding: '4px', display: 'flex', borderRadius: '4px'
                            }}
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <Crown size={24} color="var(--brand-experiment)" />
                        <h2 style={{ margin: 0 }}>This node has no owner yet!</h2>
                    </div>
                    <p style={{ color: 'var(--text-normal)', marginBottom: '24px', fontSize: '14px' }}>
                        By continuing, you will become the creator and owner of this node. It will be automatically added to your trusted node list.
                    </p>

                    {joinError && (
                        <div style={{ color: '#ed4245', marginBottom: '16px', fontSize: '13px', padding: '8px', backgroundColor: 'rgba(237, 66, 69, 0.1)', border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px' }}>
                            {joinError}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button onClick={handleBecomeOwner} className="btn" style={{ padding: '10px', fontWeight: 'bold', width: '100%' }}>Become Owner</button>
                        <button onClick={handleJoinWithoutTrusting} style={{ padding: '10px', border: '1px solid var(--background-modifier-accent)', backgroundColor: 'transparent', color: 'white', cursor: 'pointer', borderRadius: '4px', width: '100%' }}>Join Without Ownership</button>
                        <button onClick={onClose} style={{ padding: '10px', border: 'none', backgroundColor: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', width: '100%' }}>Cancel</button>
                    </div>
                </>
            )}

            {joinStep === 'guild-picker' && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                        <button
                            onClick={handleBack}
                            aria-label="Back"
                            style={{
                                background: 'none', border: 'none', color: 'var(--text-muted)',
                                cursor: 'pointer', padding: '4px', display: 'flex', borderRadius: '4px'
                            }}
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <Users size={24} color="var(--brand-experiment)" />
                        <h2 style={{ margin: 0 }}>Available Guilds</h2>
                    </div>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '16px', fontSize: '14px' }}>
                        These guilds on <strong>{pendingNodeUrl}</strong> are available to join.
                        {discoverableGuilds.some(g => g.is_claimable) && (
                            <> Guilds marked as <em>claimable</em> have no owner — you'll become the owner by joining.</>
                        )}
                    </p>

                    {joinError && (
                        <div style={{ color: '#ed4245', marginBottom: '16px', fontSize: '13px', padding: '8px', backgroundColor: 'rgba(237, 66, 69, 0.1)', border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px' }}>
                            {joinError}
                        </div>
                    )}

                    <div style={{
                        display: 'flex', flexDirection: 'column', gap: '8px',
                        maxHeight: '300px', overflowY: 'auto', marginBottom: '16px'
                    }}>
                        {discoverableGuilds.map(guild => (
                            <div
                                key={guild.id}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '12px',
                                    padding: '12px', borderRadius: '8px',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    background: guild.is_claimable
                                        ? 'linear-gradient(135deg, rgba(250, 166, 26, 0.08), rgba(250, 166, 26, 0.02))'
                                        : 'rgba(255, 255, 255, 0.02)',
                                    transition: 'background 0.15s ease'
                                }}
                            >
                                {/* Guild icon */}
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '12px',
                                    background: guild.icon
                                        ? `url(${pendingNodeUrl}${guild.icon}) center/cover`
                                        : 'linear-gradient(135deg, var(--brand-experiment), #4752C4)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '16px', fontWeight: 'bold', color: 'white', flexShrink: 0
                                }}>
                                    {!guild.icon && guild.name.charAt(0).toUpperCase()}
                                </div>

                                {/* Guild info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '2px' }}>
                                        {guild.name}
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {guild.is_claimable ? (
                                            <><Crown size={12} color="#faa61a" /> Claimable — No members</>
                                        ) : guild.open_join ? (
                                            <><Unlock size={12} /> Open — {guild.member_count} member{guild.member_count !== 1 ? 's' : ''}</>
                                        ) : (
                                            <><Lock size={12} /> {guild.member_count} member{guild.member_count !== 1 ? 's' : ''}</>
                                        )}
                                    </div>
                                </div>

                                {/* Join button */}
                                <button
                                    className="btn"
                                    disabled={joiningGuildId === guild.id}
                                    onClick={() => joinGuildOnNode(pendingNodeUrl, guild.id)}
                                    style={{
                                        padding: '6px 16px', fontSize: '13px', fontWeight: 'bold',
                                        flexShrink: 0, opacity: joiningGuildId === guild.id ? 0.6 : 1
                                    }}
                                >
                                    {joiningGuildId === guild.id
                                        ? 'Joining...'
                                        : guild.is_claimable
                                            ? 'Claim & Join'
                                            : 'Join'}
                                </button>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={async () => { await fetchGuilds(); onClose(); }}
                        style={{
                            width: '100%', padding: '10px', border: 'none',
                            backgroundColor: 'transparent', color: 'var(--text-muted)',
                            cursor: 'pointer', borderRadius: '4px', fontSize: '14px'
                        }}
                    >
                        Skip — I'll join later with an invite
                    </button>
                </>
            )}

            {joinStep === 'connected-no-guilds' && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                        <button
                            onClick={handleBack}
                            aria-label="Back"
                            style={{
                                background: 'none', border: 'none', color: 'var(--text-muted)',
                                cursor: 'pointer', padding: '4px', display: 'flex', borderRadius: '4px'
                            }}
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <Shield size={24} color="var(--brand-experiment)" />
                        <h2 style={{ margin: 0 }}>Connected!</h2>
                    </div>
                    <p style={{ color: 'var(--text-normal)', marginBottom: '12px', fontSize: '14px' }}>
                        You've been connected to <strong>{pendingNodeUrl}</strong>, but there are currently no guilds available for you to join.
                    </p>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '14px' }}>
                        You'll need an invite link from a guild owner to join a specific guild on this node. Paste it in the URL field to get started.
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button onClick={async () => { await fetchGuilds(); onClose(); }} className="btn" style={{ padding: '10px', fontWeight: 'bold', width: '100%' }}>Done</button>
                        <button onClick={handleBack} style={{ padding: '10px', border: 'none', backgroundColor: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', width: '100%' }}>Try another node</button>
                    </div>
                </>
            )}
        </div>
    );
};

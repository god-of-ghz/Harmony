import { create } from 'zustand';
import { apiFetch } from '../utils/apiFetch';

export interface AccountSettings {
    notifications?: {
        muteAll?: boolean;
        muteMentions?: boolean;
        muteEveryone?: boolean;
        sound?: string;
    };
}

export interface ClientSettings {
    theme?: 'light' | 'dark' | 'system';
}

export interface AudioSettings {
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
    inputDeviceId?: string;
    outputDeviceId?: string;
    videoCameraId?: string;
    inputMode?: 'voiceActivity' | 'pushToTalk';
    pttKey?: string;
    voiceActivityMode?: 'auto' | 'manual';
    voiceActivityThreshold?: number;
}

export interface Account {
    id: string;
    email: string;
    is_creator: boolean;
    is_admin?: boolean;
    isGuest?: boolean;
    public_key?: string;
    encrypted_private_key?: string;
    key_salt?: string;
    key_iv?: string;
    // TODO [VISION:V1] Multi-Token Architecture — Currently the client stores a single
    // JWT (`token`) signed by the login server. All API requests to all nodes use this
    // same token. When the issuing server goes offline, other nodes can't verify the
    // token after their 5-minute PKI cache expires, locking the user out of the entire
    // federation. V1 should introduce a `tokenMap: Record<nodeUrl, string>` where each
    // connected node issues its own JWT signed by its own key. This eliminates the
    // single-point-of-failure and makes auth fully local on every node.
    // See also: apiFetch.ts, ChatArea.tsx (WS auth), app.ts (generateToken).
    token?: string;
    authority_role?: string;
    delegation_cert?: string;
    primary_server_url?: string;
    dismissed_global_claim?: boolean;
}

export interface Relationship {
    account_id: string;
    target_id: string;
    status: 'pending' | 'friend' | 'blocked' | 'none';
    timestamp: number;
}

export interface GlobalProfile {
    account_id: string;
    display_name: string;
    bio: string;
    status_message: string;
    avatar_url: string;
    banner_url: string;
}

export interface Profile {
    id: string;
    server_id: string;
    account_id: string | null;
    original_username: string;
    nickname: string;
    avatar: string;
    role: string;
    aliases: string;
    public_key?: string | null;
    primary_role_color?: string | null;
}

export interface RoleData {
    id: string;
    server_id: string;
    name: string;
    color: string;
    permissions: number;
    position: number;
}

export interface GuildData {
    id: string;
    name: string;
    icon: string;
}

/** @deprecated Use GuildData */
export type ServerData = GuildData;

export interface CategoryData {
    id: string;
    server_id: string;
    name: string;
    position: number;
}

export interface ChannelData {
    id: string;
    server_id: string;
    category_id: string | null;
    name: string;
    type?: 'text' | 'voice';
    public_key?: string | null;
}

export interface MessageData {
    id: string;
    channel_id: string;
    author_id: string;
    content: string;
    timestamp: string;
    username: string;
    avatar: string;
    public_key?: string | null;
    signature?: string;
    edited_at?: number | null;
    attachments?: string; // JSON array of string URLs
    reply_to?: string | null;
    replied_author?: string | null;
    replied_content?: string | null;
    reactions?: { author_id: string, emoji: string }[];
    is_encrypted?: boolean;
    embeds?: string; // JSON stringified array of Discord-style embed objects
}

export interface EmojiData {
    id: string;
    server_id: string;
    name: string;
    url: string;
    animated: boolean;
}

export interface PresenceData {
    accountId: string;
    status: 'online' | 'idle' | 'dnd' | 'offline';
    lastUpdated: number;
}

/** Represents a node connection in the user's account-bound server list (from account_servers table). */
export interface ConnectedNode {
    url: string;
    trust_level: 'trusted' | 'untrusted';
    status: 'active' | 'disconnected';
}

/** @deprecated Use ConnectedNode */
export type ConnectedServer = ConnectedNode;

export const Permission = {
    ADMINISTRATOR: 1 << 0,
    MANAGE_SERVER: 1 << 1,
    MANAGE_ROLES: 1 << 2,
    MANAGE_CHANNELS: 1 << 3,
    KICK_MEMBERS: 1 << 4,
    BAN_MEMBERS: 1 << 5,
    MANAGE_MESSAGES: 1 << 6,
    SEND_MESSAGES: 1 << 7,
    ATTACH_FILES: 1 << 8,
    MENTION_EVERYONE: 1 << 9,
    VIEW_CHANNEL: 1 << 10,
    READ_MESSAGE_HISTORY: 1 << 11,
} as const;

export type Permission = typeof Permission[keyof typeof Permission];

interface AppState {
    currentAccount: Account | null;
    setCurrentAccount: (account: Account | null) => void;

    claimedProfiles: Profile[];
    setClaimedProfiles: (profiles: Profile[]) => void;
    addClaimedProfile: (profile: Profile) => void;
    updateClaimedProfile: (profile: Profile) => void;

    guilds: GuildData[];
    setGuilds: (guilds: GuildData[]) => void;
    /** Eagerly add a guild entry (de-duplicated by id). */
    addGuild: (guild: GuildData) => void;

    activeGuildId: string | null;
    setActiveGuildId: (id: string) => void;
    /** @deprecated Use activeGuildId */
    activeServerId: string | null;
    /** @deprecated Use setActiveGuildId */
    setActiveServerId: (id: string) => void;

    activeChannelId: string | null;
    setActiveChannelId: (id: string, name?: string) => void;
    activeChannelName: string;

    activeVoiceChannelId: string | null;
    setActiveVoiceChannelId: (id: string | null) => void;

    isMuted: boolean;
    setIsMuted: (muted: boolean) => void;
    isDeafened: boolean;
    setIsDeafened: (deafened: boolean) => void;
    audioSettings: AudioSettings;
    setAudioSettings: (settings: Partial<AudioSettings>) => void;

    showUnknownTags: boolean;
    setShowUnknownTags: (show: boolean) => void;

    /** Node list sourced from the account_servers table — replaces knownServers + trustedServers. */
    connectedServers: ConnectedNode[];
    setConnectedServers: (servers: ConnectedNode[]) => void;

    // TODO [VISION:Beta] This simple guildId→URL mapping should be replaced with the
    // full `ServerTransport` registry defined in HARMONY_VISION.md: { fingerprint,
    // localUrl, publicUrl, preferLocal, lastSeenLocal }. This enables adaptive
    // LAN/internet switching where the client auto-routes to localUrl when at home
    // and falls back to publicUrl when remote. Not needed during alpha stabilization.
    guildMap: Record<string, string>;
    setGuildMap: (map: Record<string, string>) => void;
    /** @deprecated Use guildMap */
    serverMap: Record<string, string>;
    /** @deprecated Use setGuildMap */
    setServerMap: (map: Record<string, string>) => void;

    isGuestSession: boolean;
    setIsGuestSession: (isGuest: boolean) => void;

    sessionPrivateKey: CryptoKey | null;
    setSessionPrivateKey: (key: CryptoKey | null) => void;

    guildRoles: RoleData[];
    setGuildRoles: (roles: RoleData[]) => void;
    /** @deprecated Use guildRoles */
    serverRoles: RoleData[];
    /** @deprecated Use setGuildRoles */
    setServerRoles: (roles: RoleData[]) => void;

    guildProfiles: Profile[];
    setGuildProfiles: (profiles: Profile[]) => void;
    updateGuildProfile: (profile: Profile) => void;
    /** @deprecated Use guildProfiles */
    serverProfiles: Profile[];
    /** @deprecated Use setGuildProfiles */
    setServerProfiles: (profiles: Profile[]) => void;
    /** @deprecated Use updateGuildProfile */
    updateServerProfile: (profile: Profile) => void;

    presenceMap: Record<string, PresenceData>;
    setPresenceMap: (map: Record<string, PresenceData>) => void;
    updatePresence: (presence: PresenceData) => void;

    readStates: Record<string, string>; // channelId -> lastMessageId
    setReadStates: (states: Record<string, string>) => void;
    updateReadState: (channelId: string, lastMessageId: string) => void;

    unreadChannels: Set<string>;
    addUnreadChannel: (channelId: string) => void;
    removeUnreadChannel: (channelId: string) => void;

    relationships: Relationship[];
    setRelationships: (rels: Relationship[]) => void;
    updateRelationship: (rel: Relationship) => void;

    globalProfiles: Record<string, GlobalProfile>;
    setGlobalProfiles: (profiles: Record<string, GlobalProfile>) => void;
    updateGlobalProfile: (profile: GlobalProfile) => void;

    currentUserPermissions: number;
    setCurrentUserPermissions: (perms: number) => void;

    searchStateByGuild: Record<string, { isOpen: boolean, query: string, results: any[] }>;
    setSearchSidebarOpen: (open: boolean) => void;
    setSearchQuery: (query: string) => void;
    setSearchResults: (results: any[]) => void;
    clearGuildSearchState: (guildId: string) => void;

    pendingJump: { channelId: string, messageId: string } | null;
    setPendingJump: (jump: { channelId: string, messageId: string } | null) => void;

    emojis: Record<string, EmojiData[]>;
    fetchGuildEmojis: (guildId: string) => Promise<void>;
    /** @deprecated Use fetchGuildEmojis */
    fetchServerEmojis: (serverId: string) => Promise<void>;

    zoomedImageUrl: string | null;
    setZoomedImageUrl: (url: string | null) => void;

    unclaimedProfiles: Profile[];
    setUnclaimedProfiles: (profiles: Profile[]) => void;
    dismissedGlobalClaim: boolean;
    setDismissedGlobalClaim: (dismissed: boolean) => void;
    
    nodeStatus: Record<string, 'online' | 'offline' | 'unknown'>;
    setNodeStatus: (status: Record<string, 'online' | 'offline' | 'unknown'>) => void;
    /** @deprecated Use nodeStatus */
    serverStatus: Record<string, 'online' | 'offline' | 'unknown'>;
    /** @deprecated Use setNodeStatus */
    setServerStatus: (status: Record<string, 'online' | 'offline' | 'unknown'>) => void;
    
    primaryOfflineMessage: string | null;
    setPrimaryOfflineMessage: (msg: string | null) => void;

    showGuildSettings: boolean;
    setShowGuildSettings: (show: boolean) => void;

    showUserSettings: boolean;
    setShowUserSettings: (show: boolean) => void;

    profilesLoaded: boolean;
    setProfilesLoaded: (loaded: boolean) => void;

    accountSettings: AccountSettings;
    setAccountSettings: (settings: Partial<AccountSettings>) => void;
    updateAccountSettings: (settings: Partial<AccountSettings>) => Promise<void>;
    
    clientSettings: ClientSettings;
    setClientSettings: (settings: Partial<ClientSettings>) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
    currentAccount: null,
    setCurrentAccount: (account) => {
        set({ currentAccount: account });
    },

    claimedProfiles: [],
    setClaimedProfiles: (profiles) => set({ claimedProfiles: profiles }),
    addClaimedProfile: (profile) => set((state) => ({ claimedProfiles: [...state.claimedProfiles, profile] })),
    updateClaimedProfile: (profile) => set((state) => ({ claimedProfiles: state.claimedProfiles.map(p => p.id === profile.id && p.server_id === profile.server_id ? profile : p) })),

    guilds: [],
    setGuilds: (guilds) => set({ guilds }),
    addGuild: (guild) => set((state) => {
        if (state.guilds.some(g => g.id === guild.id)) return state;
        return { guilds: [...state.guilds, guild] };
    }),

    activeGuildId: null,
    activeServerId: null, // @deprecated alias — kept in sync with activeGuildId
    setActiveGuildId: (id) => {
        set({ activeGuildId: id, activeServerId: id, activeChannelId: null, activeChannelName: '', currentUserPermissions: 0 });
    },
    // @deprecated — use setActiveGuildId
    setActiveServerId: (id) => {
        set({ activeGuildId: id, activeServerId: id, activeChannelId: null, activeChannelName: '', currentUserPermissions: 0 });
    },

    activeChannelId: null,
    activeChannelName: '',
    setActiveChannelId: (id, name = '') => {
        set({ activeChannelId: id, activeChannelName: name });
    },

    activeVoiceChannelId: null,
    setActiveVoiceChannelId: (id) => set({ activeVoiceChannelId: id }),

    isMuted: false,
    setIsMuted: (muted) => set({ isMuted: muted }),
    isDeafened: false,
    setIsDeafened: (deafened) => set({ isDeafened: deafened }),

    audioSettings: (() => {
        try {
            const stored = localStorage.getItem('harmony_audio_settings');
            if (stored) return JSON.parse(stored);
        } catch (e) {}
        return { noiseSuppression: true, echoCancellation: true, autoGainControl: true, inputMode: 'voiceActivity', voiceActivityMode: 'auto', voiceActivityThreshold: -50, pttKey: '' };
    })(),
    setAudioSettings: (settings) => set((state) => {
        const next = { ...state.audioSettings, ...settings };
        localStorage.setItem('harmony_audio_settings', JSON.stringify(next));
        return { audioSettings: next };
    }),

    accountSettings: {},
    setAccountSettings: (settings) => set((state) => ({ accountSettings: { ...state.accountSettings, ...settings } })),
    updateAccountSettings: async (settings) => {
        const state = get();
        const next = { ...state.accountSettings, ...settings };
        set({ accountSettings: next });
        
        if (state.currentAccount?.token && state.currentAccount.primary_server_url) {
            try {
                await apiFetch(`${state.currentAccount.primary_server_url}/api/accounts/settings`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.currentAccount.token}`
                    },
                    body: JSON.stringify(next)
                });
            } catch (err) {
                console.error('Failed to sync account settings', err);
            }
        }
    },

    clientSettings: (() => {
        try {
            const stored = localStorage.getItem('harmony_client_settings');
            if (stored) return JSON.parse(stored);
        } catch (e) {}
        return { theme: 'dark' };
    })(),
    setClientSettings: (settings) => set((state) => {
        const next = { ...state.clientSettings, ...settings };
        localStorage.setItem('harmony_client_settings', JSON.stringify(next));
        if (next.theme) {
            if (next.theme === 'light') document.body.classList.add('theme-light');
            else document.body.classList.remove('theme-light');
        }
        return { clientSettings: next };
    }),

    showUnknownTags: false,
    setShowUnknownTags: (show: boolean) => set({ showUnknownTags: show }),

    connectedServers: [],
    setConnectedServers: (servers) => {
        const safe = Array.isArray(servers) ? servers : [];
        set({ connectedServers: safe });
    },

    guildMap: {},
    serverMap: {}, // @deprecated alias — kept in sync with guildMap
    setGuildMap: (map) => set({ guildMap: map, serverMap: map }),
    // @deprecated — use setGuildMap
    setServerMap: (map) => set({ guildMap: map, serverMap: map }),

    isGuestSession: false,
    setIsGuestSession: (isGuest) => set({ isGuestSession: isGuest }),

    sessionPrivateKey: null,
    setSessionPrivateKey: (key) => set({ sessionPrivateKey: key }),

    guildRoles: [],
    serverRoles: [], // @deprecated alias — kept in sync with guildRoles
    setGuildRoles: (roles) => set({ guildRoles: roles, serverRoles: roles }),
    // @deprecated — use setGuildRoles
    setServerRoles: (roles) => set({ guildRoles: roles, serverRoles: roles }),

    guildProfiles: [],
    serverProfiles: [], // @deprecated alias — kept in sync with guildProfiles
    setGuildProfiles: (profiles) => set({ guildProfiles: profiles, serverProfiles: profiles }),
    // @deprecated — use setGuildProfiles
    setServerProfiles: (profiles) => set({ guildProfiles: profiles, serverProfiles: profiles }),
    updateGuildProfile: (profile) => set((state) => {
        const exists = state.guildProfiles.some(p => p.id === profile.id);
        if (exists) {
            return { guildProfiles: state.guildProfiles.map(p => p.id === profile.id ? profile : p), serverProfiles: state.guildProfiles.map(p => p.id === profile.id ? profile : p) };
        }
        return { guildProfiles: [...state.guildProfiles, profile], serverProfiles: [...state.guildProfiles, profile] };
    }),
    // @deprecated — use updateGuildProfile
    updateServerProfile: (profile) => set((state) => {
        const exists = state.guildProfiles.some(p => p.id === profile.id);
        if (exists) {
            return { guildProfiles: state.guildProfiles.map(p => p.id === profile.id ? profile : p), serverProfiles: state.guildProfiles.map(p => p.id === profile.id ? profile : p) };
        }
        return { guildProfiles: [...state.guildProfiles, profile], serverProfiles: [...state.guildProfiles, profile] };
    }),

    presenceMap: {},
    setPresenceMap: (map) => set({ presenceMap: map }),
    updatePresence: (presence) => set((state) => ({ 
        presenceMap: { ...state.presenceMap, [presence.accountId]: presence } 
    })),

    readStates: {},
    setReadStates: (states) => set({ readStates: states }),
    updateReadState: (channelId, lastMessageId) => set((state) => ({
        readStates: { ...state.readStates, [channelId]: lastMessageId }
    })),

    unreadChannels: new Set(),
    addUnreadChannel: (channelId) => set((state) => {
        const next = new Set(state.unreadChannels);
        next.add(channelId);
        return { unreadChannels: next };
    }),
    removeUnreadChannel: (channelId) => set((state) => {
        const next = new Set(state.unreadChannels);
        next.delete(channelId);
        return { unreadChannels: next };
    }),

    relationships: [],
    setRelationships: (rels) => set({ relationships: rels }),
    updateRelationship: (rel) => set((state) => {
        const existing = state.relationships.filter(r => 
            !(r.account_id === rel.account_id && r.target_id === rel.target_id) &&
            !(r.account_id === rel.target_id && r.target_id === rel.account_id)
        );
        if (rel.status === 'none') return { relationships: existing };
        return { relationships: [...existing, rel] };
    }),

    globalProfiles: {},
    setGlobalProfiles: (profiles) => set({ globalProfiles: profiles }),
    updateGlobalProfile: (profile) => set((state) => ({
        globalProfiles: { ...state.globalProfiles, [profile.account_id]: profile }
    })),

    currentUserPermissions: 0,
    setCurrentUserPermissions: (perms) => set({ currentUserPermissions: perms }),

    searchStateByGuild: {},
    clearGuildSearchState: (guildId) => set((state) => {
        const next = { ...state.searchStateByGuild };
        delete next[guildId];
        return { searchStateByGuild: next };
    }),
    setSearchSidebarOpen: (open) => set((state) => {
        const guildId = state.activeGuildId;
        if (!guildId) return state;
        if (!open) {
            const next = { ...state.searchStateByGuild };
            delete next[guildId];
            return { searchStateByGuild: next };
        }
        const current = state.searchStateByGuild[guildId] || { isOpen: false, query: '', results: [] };
        return { searchStateByGuild: { ...state.searchStateByGuild, [guildId]: { ...current, isOpen: open } } };
    }),
    setSearchQuery: (query) => set((state) => {
        const guildId = state.activeGuildId;
        if (!guildId) return state;
        const current = state.searchStateByGuild[guildId] || { isOpen: false, query: '', results: [] };
        return { searchStateByGuild: { ...state.searchStateByGuild, [guildId]: { ...current, query } } };
    }),
    setSearchResults: (results) => set((state) => {
        const guildId = state.activeGuildId;
        if (!guildId) return state;
        const current = state.searchStateByGuild[guildId] || { isOpen: false, query: '', results: [] };
        return { searchStateByGuild: { ...state.searchStateByGuild, [guildId]: { ...current, results } } };
    }),

    pendingJump: null,
    setPendingJump: (jump) => set({ pendingJump: jump }),

    emojis: {},
    fetchGuildEmojis: async (guildId) => {
        const state = get();
        if (state.emojis[guildId]) return;

        const token = state.currentAccount?.token;
        if (!token) return;

        try {
            const response = await fetch(`/api/guilds/${guildId}/emojis`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                set((state) => ({
                    emojis: {
                        ...state.emojis,
                        [guildId]: data
                    }
                }));
            }
        } catch (error) {
            console.error('Failed to fetch emojis:', error);
        }
    },
    // @deprecated — use fetchGuildEmojis
    fetchServerEmojis: async (serverId) => {
        return get().fetchGuildEmojis(serverId);
    },

    zoomedImageUrl: null,
    setZoomedImageUrl: (url) => set({ zoomedImageUrl: url }),

    unclaimedProfiles: [],
    setUnclaimedProfiles: (profiles) => set({ unclaimedProfiles: profiles }),
    dismissedGlobalClaim: false,
    setDismissedGlobalClaim: (dismissed) => set({ dismissedGlobalClaim: dismissed }),
    
    nodeStatus: {},
    serverStatus: {}, // @deprecated alias — kept in sync with nodeStatus
    setNodeStatus: (status) => set({ nodeStatus: status, serverStatus: status }),
    // @deprecated — use setNodeStatus
    setServerStatus: (status) => set({ nodeStatus: status, serverStatus: status }),
    
    primaryOfflineMessage: null,
    setPrimaryOfflineMessage: (msg) => set({ primaryOfflineMessage: msg }),

    showGuildSettings: false,
    setShowGuildSettings: (show) => set({ showGuildSettings: show }),

    showUserSettings: false,
    setShowUserSettings: (show) => set({ showUserSettings: show }),

    profilesLoaded: false,
    setProfilesLoaded: (loaded) => set({ profilesLoaded: loaded }),
}));

if (typeof window !== 'undefined') {
    (window as any).useAppStore = useAppStore;
}

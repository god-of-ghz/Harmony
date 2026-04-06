import { create } from 'zustand';

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
    trusted_servers?: string[];
}

export interface Relationship {
    account_id: string;
    target_id: string;
    status: 'pending' | 'friend' | 'blocked' | 'none';
    timestamp: number;
}

export interface GlobalProfile {
    account_id: string;
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
}

export interface RoleData {
    id: string;
    server_id: string;
    name: string;
    color: string;
    permissions: number;
    position: number;
}

export interface ServerData {
    id: string;
    name: string;
    icon: string;
}

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
}

export interface PresenceData {
    accountId: string;
    status: 'online' | 'idle' | 'dnd' | 'offline';
    lastUpdated: number;
}

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

    activeServerId: string | null;
    setActiveServerId: (id: string) => void;

    activeChannelId: string | null;
    setActiveChannelId: (id: string, name?: string) => void;
    activeChannelName: string;

    activeVoiceChannelId: string | null;
    setActiveVoiceChannelId: (id: string | null) => void;

    showUnknownTags: boolean;
    setShowUnknownTags: (show: boolean) => void;

    knownServers: string[];
    setKnownServers: (urls: string[]) => void;
    addKnownServer: (url: string) => void;

    trustedServers: string[];
    setTrustedServers: (urls: string[]) => void;

    serverMap: Record<string, string>;
    setServerMap: (map: Record<string, string>) => void;

    isGuestSession: boolean;
    setIsGuestSession: (isGuest: boolean) => void;

    sessionPrivateKey: CryptoKey | null;
    setSessionPrivateKey: (key: CryptoKey | null) => void;

    serverRoles: RoleData[];
    setServerRoles: (roles: RoleData[]) => void;

    serverProfiles: Profile[];
    setServerProfiles: (profiles: Profile[]) => void;
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
}

export const useAppStore = create<AppState>((set) => ({
    currentAccount: null,
    setCurrentAccount: (account) => set({ currentAccount: account }),

    claimedProfiles: [],
    setClaimedProfiles: (profiles) => set({ claimedProfiles: profiles }),
    addClaimedProfile: (profile) => set((state) => ({ claimedProfiles: [...state.claimedProfiles, profile] })),

    activeServerId: null,
    setActiveServerId: (id) => set({ activeServerId: id, activeChannelId: null, activeChannelName: '', currentUserPermissions: 0 }),

    activeChannelId: null,
    activeChannelName: '',
    setActiveChannelId: (id, name = '') => set({ activeChannelId: id, activeChannelName: name }),

    activeVoiceChannelId: null,
    setActiveVoiceChannelId: (id) => set({ activeVoiceChannelId: id }),

    showUnknownTags: false,
    setShowUnknownTags: (show: boolean) => set({ showUnknownTags: show }),

    knownServers: JSON.parse(localStorage.getItem('harmony_known_servers') || '[]'),
    setKnownServers: (urls) => {
        localStorage.setItem('harmony_known_servers', JSON.stringify(urls));
        set({ knownServers: urls });
    },
    addKnownServer: (url) => set((state) => {
        if (!state.knownServers.includes(url)) {
            const newServers = [...state.knownServers, url];
            localStorage.setItem('harmony_known_servers', JSON.stringify(newServers));
            return { knownServers: newServers };
        }
        return state;
    }),

    trustedServers: [],
    setTrustedServers: (urls) => set({ trustedServers: urls }),

    serverMap: {},
    setServerMap: (map) => set({ serverMap: map }),

    isGuestSession: false,
    setIsGuestSession: (isGuest) => set({ isGuestSession: isGuest }),

    sessionPrivateKey: null,
    setSessionPrivateKey: (key) => set({ sessionPrivateKey: key }),

    serverRoles: [],
    setServerRoles: (roles) => set({ serverRoles: roles }),

    serverProfiles: [],
    setServerProfiles: (profiles) => set({ serverProfiles: profiles }),
    updateServerProfile: (profile) => set((state) => {
        const exists = state.serverProfiles.some(p => p.id === profile.id);
        if (exists) {
            return { serverProfiles: state.serverProfiles.map(p => p.id === profile.id ? profile : p) };
        }
        return { serverProfiles: [...state.serverProfiles, profile] };
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
    setCurrentUserPermissions: (perms) => set({ currentUserPermissions: perms })
}));

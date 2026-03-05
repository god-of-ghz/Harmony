import { create } from 'zustand';

export interface Account {
    id: string;
    email: string;
    is_creator: boolean;
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
}

export interface MessageData {
    id: string;
    channel_id: string;
    author_id: string;
    content: string;
    timestamp: string;
    username: string;
    avatar: string;
}

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

    showUnknownTags: boolean;
    setShowUnknownTags: (show: boolean) => void;

    serverUrl: string;
    setServerUrl: (url: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
    currentAccount: null,
    setCurrentAccount: (account) => set({ currentAccount: account }),

    claimedProfiles: [],
    setClaimedProfiles: (profiles) => set({ claimedProfiles: profiles }),
    addClaimedProfile: (profile) => set((state) => ({ claimedProfiles: [...state.claimedProfiles, profile] })),

    activeServerId: null,
    setActiveServerId: (id) => set({ activeServerId: id, activeChannelId: null, activeChannelName: '' }),

    activeChannelId: null,
    activeChannelName: '',
    setActiveChannelId: (id, name = '') => set({ activeChannelId: id, activeChannelName: name }),

    showUnknownTags: false,
    setShowUnknownTags: (show) => set({ showUnknownTags: show }),

    serverUrl: localStorage.getItem('harmony_server_url') || 'http://localhost:3001',
    setServerUrl: (url) => {
        localStorage.setItem('harmony_server_url', url);
        set({ serverUrl: url });
    },
}));

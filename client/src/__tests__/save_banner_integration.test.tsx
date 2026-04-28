import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import type { Account, Profile } from '../store/appStore';
import { NodeSettings } from '../components/admin/NodeSettings';
import { GuildSettings } from '../components/GuildSettings';
import { UserSettings } from '../components/UserSettings';

// Mock @hello-pangea/dnd
vi.mock('@hello-pangea/dnd', async (importOriginal) => {
    return {
        DragDropContext: ({ children }: any) => children,
        Droppable: ({ children }: any) => {
            const provided = {
                droppableProps: {},
                innerRef: vi.fn(),
                placeholder: null,
            };
            return children(provided, { isDraggingOver: false });
        },
        Draggable: ({ children }: any) => {
            const provided = {
                draggableProps: { style: {} },
                dragHandleProps: {},
                innerRef: vi.fn(),
            };
            return children(provided, { isDragging: false });
        },
    };
});

// Mock lucide-react
vi.mock('lucide-react', () => ({
    Home: () => 'HomeIcon', Plus: () => 'PlusIcon', Link: () => 'LinkIcon',
    FolderSync: () => 'FolderSyncIcon', LogOut: () => 'LogOutIcon', Shield: () => 'ShieldIcon',
    Crown: () => 'CrownIcon', Settings: () => 'SettingsIcon', ArrowLeft: () => 'ArrowLeftIcon',
    Sparkles: () => 'SparklesIcon', KeyRound: () => 'KeyRoundIcon', Globe: () => 'GlobeIcon',
    Hash: () => 'HashIcon', ChevronDown: () => 'ChevronDownIcon', ChevronRight: () => 'ChevronRightIcon',
    Volume2: () => 'Volume2Icon', Layers: () => 'LayersIcon', Users: () => 'UsersIcon',
    X: () => 'XIcon',
    GripVertical: () => 'GripIcon', Trash: () => 'TrashIcon', Save: () => 'SaveIcon',
    User: () => 'UserIcon', Edit2: () => 'Edit2Icon', Info: () => 'InfoIcon',
    Package: () => 'PackageIcon', AlertTriangle: () => 'AlertIcon', Server: () => 'ServerIcon', Lock: () => 'LockIcon'
}));

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({
    apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// Mock setup for window object (used by some settings)
Object.defineProperty(window, 'navigator', {
    value: { mediaDevices: { enumerateDevices: () => Promise.resolve([]) } },
    writable: true
});

const mockAccount: Account = {
    id: 'account-1',
    email: 'test@example.com',
    is_creator: true,
    is_admin: true,
    token: 'test-token',
    primary_server_url: 'http://localhost:3001',
};

const ownerProfile: Profile = {
    id: 'profile-owner',
    server_id: 'guild-1',
    account_id: 'account-1',
    original_username: 'TestOwner',
    nickname: 'TestOwner',
    avatar: '',
    role: 'OWNER',
    aliases: '',
};

let fetchMock: ReturnType<typeof vi.fn>;
const setupFetchMock = () => {
    fetchMock = vi.fn().mockImplementation((url: string, opts?: any) => {
        if (url.includes('/categories')) return Promise.resolve({ ok: true, json: () => Promise.resolve([{id: 'cat-1', name: 'Cat 1', position: 0}]) });
        if (url.includes('/channels')) return Promise.resolve({ ok: true, json: () => Promise.resolve([{id: 'ch-1', name: 'Ch 1', position: 0, category_id: 'cat-1'}]) });
        if (url.includes('/profiles') && !url.includes('/roles') && opts?.method !== 'PATCH') return Promise.resolve({ ok: true, json: () => Promise.resolve([ownerProfile]) });
        if (url.includes('/profiles') && opts?.method === 'PATCH') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...ownerProfile, nickname: JSON.parse(opts.body).nickname }) });
        if (url.includes('/roles')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        if (url.match(/\/api\/guilds\/[^/]+$/) && (!opts?.method || opts.method === 'GET')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'guild-1', name: 'Test Guild', fingerprint: 'abc123' }) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = fetchMock;
};

const resetStore = () => {
    useAppStore.setState({
        activeGuildId: 'guild-1',
        activeServerId: 'guild-1',
        currentAccount: mockAccount,
        connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active', name: 'Local', last_sync: Date.now() }],
        guildMap: { 'guild-1': 'http://localhost:3001' },
        serverMap: { 'guild-1': 'http://localhost:3001' },
        nodeStatus: {},
        serverStatus: {},
        claimedProfiles: [ownerProfile],
        guildProfiles: [ownerProfile],
        serverProfiles: [ownerProfile],
        currentUserPermissions: 0xFFFFFFFF,
    });
};

describe('Save Banner Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
        setupFetchMock();
        mockApiFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/api/node/settings')) {
                if (opts?.method === 'PUT') return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(opts.body)) });
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ max_guilds: 5 }) });
            }
            if (url.includes('/api/federation/profile/')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: 'GlobalName' }) });
            }
            if (url.includes('/api/profiles/global')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: JSON.parse(opts.body).display_name }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('NodeSettings: shows banner on edit, hides on save, saves data via API', async () => {
        render(<NodeSettings />);
        
        await waitFor(() => {
            expect(screen.getByTestId('max-guilds-setting')).toBeTruthy();
        });

        // Banner should not be visible
        expect(screen.queryByText('Careful — you have unsaved changes!')).toBeNull();

        // Change a value
        const input = screen.getByTestId('max-guilds-setting');
        fireEvent.change(input, { target: { value: '10' } });

        // Banner should appear
        expect(screen.getByText('Careful — you have unsaved changes!')).toBeTruthy();

        // Click save
        fireEvent.click(screen.getByText('Save Changes'));

        await waitFor(() => {
            expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/node/settings'), expect.objectContaining({
                method: 'PUT',
                body: expect.stringContaining('"max_guilds":10')
            }));
            // Banner should disappear
            expect(screen.queryByText('Careful — you have unsaved changes!')).toBeNull();
        });
    });

    it('UserSettings: shows banner on profile edit, hides on reset', async () => {
        render(<UserSettings onClose={vi.fn()} />);
        
        // Go to Profile tab
        fireEvent.click(screen.getByText('Profile'));

        await waitFor(() => {
            expect(screen.getByDisplayValue('GlobalName')).toBeTruthy();
        });

        // Banner should not be visible
        expect(screen.queryByText('Careful — you have unsaved changes!')).toBeNull();

        // Change display name
        const input = screen.getByDisplayValue('GlobalName');
        fireEvent.change(input, { target: { value: 'NewGlobalName' } });

        // Banner should appear
        expect(screen.getByText('Careful — you have unsaved changes!')).toBeTruthy();

        // Click Reset
        fireEvent.click(screen.getByText('Reset'));

        await waitFor(() => {
            // Input should be reset
            expect(screen.getByDisplayValue('GlobalName')).toBeTruthy();
            // Banner should disappear
            expect(screen.queryByText('Careful — you have unsaved changes!')).toBeNull();
        });
        
        // Ensure no API call was made
        const putCalls = mockApiFetch.mock.calls.filter(c => c[1]?.method === 'PUT');
        expect(putCalls.length).toBe(0);
    });

    it('GuildSettings: shows banner on profile edit, saves via fetch', async () => {
        render(<GuildSettings onClose={vi.fn()} />);
        
        await waitFor(() => {
            expect(screen.getByText('Profile')).toBeTruthy();
        });
        
        // Already on Profile Tab by default if we don't have permissions, but we are OWNER so we are on Channels tab
        fireEvent.click(screen.getByText('Profile'));

        await waitFor(() => {
            expect(screen.getByPlaceholderText('TestOwner')).toBeTruthy();
        });

        // Banner should not be visible
        expect(screen.queryByText('Careful — you have unsaved changes!')).toBeNull();

        // Change nickname
        const inputs = screen.getAllByRole('textbox');
        const nickInput = inputs.find((el: any) => el.placeholder === 'TestOwner');
        if (nickInput) {
            fireEvent.change(nickInput, { target: { value: 'NewNick' } });
        }

        // Banner should appear
        expect(screen.getByText('Careful — you have unsaved changes!')).toBeTruthy();

        // Click Save
        fireEvent.click(screen.getByText('Save Changes'));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/guilds/guild-1/profiles/'), expect.objectContaining({
                method: 'PATCH',
                body: expect.stringContaining('"nickname":"NewNick"')
            }));
            // Banner should disappear
            expect(screen.queryByText('Careful — you have unsaved changes!')).toBeNull();
        });
    });
});

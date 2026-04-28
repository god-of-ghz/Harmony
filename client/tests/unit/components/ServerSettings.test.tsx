import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ServerSettings } from '../../../src/components/ServerSettings';
import { useAppStore, Permission } from '../../../src/store/appStore';

// Mock @hello-pangea/dnd to avoid drag-and-drop complexity in tests
vi.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children }: any) => <div>{children}</div>,
    Droppable: ({ children }: any) => children({
        droppableProps: {},
        innerRef: vi.fn(),
        placeholder: null,
    }, { isDraggingOver: false }),
    Draggable: ({ children }: any) => children({
        draggableProps: { style: {} },
        dragHandleProps: {},
        innerRef: vi.fn(),
    }, { isDragging: false }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
    Layers: (props: any) => <span {...props}>Layers</span>,
    Shield: (props: any) => <span {...props}>Shield</span>,
    Users: (props: any) => <span {...props}>Users</span>,
    X: ({ onClick, ...props }: any) => <span data-testid="close-settings" onClick={onClick} {...props}>X</span>,
    Plus: (props: any) => <span {...props}>+</span>,
    GripVertical: (props: any) => <span {...props}>Grip</span>,
    Trash: (props: any) => <span {...props}>Trash</span>,
    Save: (props: any) => <span {...props}>Save</span>,
    User: (props: any) => <span {...props}>User</span>,
    Edit2: (props: any) => <span {...props}>Edit</span>,
}));

global.fetch = vi.fn();

describe('ServerSettings', () => {
    const mockOnClose = vi.fn();

    const mockRoles = [
        { id: 'role-1', server_id: 'server1', name: 'Admin', color: '#ff0000', permissions: Permission.ADMINISTRATOR, position: 0 },
        { id: 'role-2', server_id: 'server1', name: 'Moderator', color: '#00ff00', permissions: Permission.MANAGE_MESSAGES | Permission.KICK_MEMBERS, position: 1 },
    ];

    const mockCategories = [
        { id: 'cat-1', server_id: 'server1', name: 'General', position: 0 },
    ];

    const mockChannels = [
        { id: 'ch-1', name: 'general', category_id: 'cat-1', position: 0, type: 'text' },
        { id: 'ch-2', name: 'voice-lounge', category_id: null, position: 0, type: 'voice' },
    ];

    const mockProfiles = [
        { id: 'prof-1', nickname: 'testuser', aliases: '' },
        { id: 'prof-2', nickname: 'anotheruser', aliases: '' },
    ];

    const setupFetchMock = () => {
        (global.fetch as any).mockImplementation((url: string, opts?: any) => {
            if (url.includes('/categories')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockCategories) });
            }
            if (url.includes('/channels')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockChannels) });
            }
            if (url.includes('/profiles') && url.includes('/roles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProfiles) });
            }
            if (url.includes('/roles')) {
                if (opts?.method === 'POST') {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ id: 'role-new', server_id: 'server1', name: 'NewRole', color: '#FFFFFF', permissions: 0, position: 2 }),
                    });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRoles) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });
    };

    beforeEach(() => {
        vi.clearAllMocks();

        useAppStore.setState({
            activeGuildId: 'server1',
            activeServerId: 'server1',
            currentAccount: {
                id: 'account1',
                email: 'test@example.com',
                is_creator: false,
                token: 'test-jwt-token',
            },
            claimedProfiles: [{
                id: 'prof-1',
                server_id: 'server1',
                account_id: 'account1',
                original_username: 'testuser',
                nickname: 'testuser',
                avatar: '',
                role: 'USER',
                aliases: '',
            }],
            guildMap: { server1: 'http://localhost' },
            serverMap: { server1: 'http://localhost' },
            currentUserPermissions: 0, // START WITH ZERO — test permissions explicitly
            guildRoles: [],
            serverRoles: [],
            serverProfiles: [],
            showUnknownTags: false,
        });

    });

    // --- Permission Tests ---

    it('shows only "Profile" tab when user has no permissions', async () => {
        useAppStore.setState({ currentUserPermissions: 0 });
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        expect(screen.getByText('Profile')).toBeInTheDocument();
        // Admin-only tabs should not be present
        expect(screen.queryByText('Hierarchy')).not.toBeInTheDocument();
        expect(screen.queryByText('Roles')).not.toBeInTheDocument();
        expect(screen.queryByText('Members')).not.toBeInTheDocument();
    });

    it('shows all tabs when user has ADMINISTRATOR permission', async () => {
        useAppStore.setState({ currentUserPermissions: Permission.ADMINISTRATOR });
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        expect(screen.getByText('Profile')).toBeInTheDocument();
        expect(screen.getByText('Hierarchy')).toBeInTheDocument();
        expect(screen.getByText('Roles')).toBeInTheDocument();
        expect(screen.getByText('Members')).toBeInTheDocument();
    });

    it('shows all tabs when user has MANAGE_SERVER permission', async () => {
        useAppStore.setState({ currentUserPermissions: Permission.MANAGE_SERVER });
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        expect(screen.getByText('Hierarchy')).toBeInTheDocument();
        expect(screen.getByText('Roles')).toBeInTheDocument();
        expect(screen.getByText('Members')).toBeInTheDocument();
    });

    // --- Access Denied ---

    it('shows Access Denied when user has no profile on the server', async () => {
        useAppStore.setState({ claimedProfiles: [] });

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        expect(screen.getByTestId('access-denied')).toBeInTheDocument();
        expect(screen.getByText('Access Denied')).toBeInTheDocument();
        expect(screen.getByText('You do not have a profile on this server.')).toBeInTheDocument();
    });

    it('Access Denied close button calls onClose', async () => {
        useAppStore.setState({ claimedProfiles: [] });

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        fireEvent.click(screen.getByText('Close'));
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    // --- Profile Tab ---

    it('renders profile tab with server nickname input', async () => {
        useAppStore.setState({ currentUserPermissions: 0 });
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        // Profile tab is the default for non-admin users
        expect(screen.getByText('Server Identity')).toBeInTheDocument();
        expect(screen.getByText('Server Nickname')).toBeInTheDocument();
    });

    it('shows "Save Profile Changes" button on profile tab', async () => {
        useAppStore.setState({ currentUserPermissions: 0 });
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        expect(screen.getByText('Save Profile Changes')).toBeInTheDocument();
    });

    // --- Roles Tab ---

    it('renders roles list and "Select a role" message on roles tab', async () => {
        useAppStore.setState({ currentUserPermissions: Permission.ADMINISTRATOR });
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        // Navigate to roles tab
        fireEvent.click(screen.getByText('Roles'));

        await waitFor(() => {
            expect(screen.getByText('Admin')).toBeInTheDocument();
            expect(screen.getByText('Moderator')).toBeInTheDocument();
            expect(screen.getByText('Select a role to edit its permissions or color.')).toBeInTheDocument();
        });
    });

    it('clicking a role shows permission checkboxes', async () => {
        useAppStore.setState({ currentUserPermissions: Permission.ADMINISTRATOR });
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        fireEvent.click(screen.getByText('Roles'));

        await waitFor(() => {
            expect(screen.getByText('Admin')).toBeInTheDocument();
        });

        // Click on the Admin role to edit it
        fireEvent.click(screen.getByText('Admin'));

        await waitFor(() => {
            expect(screen.getByText(/Editing Role: Admin/)).toBeInTheDocument();
            expect(screen.getByText('Permissions')).toBeInTheDocument();
            expect(screen.getByText('Administrator')).toBeInTheDocument();
            expect(screen.getByText('Manage Server')).toBeInTheDocument();
        });
    });

    it('permission checkboxes reflect the role bitfield correctly', async () => {
        useAppStore.setState({ currentUserPermissions: Permission.ADMINISTRATOR });
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        fireEvent.click(screen.getByText('Roles'));

        await waitFor(() => {
            expect(screen.getByText('Moderator')).toBeInTheDocument();
        });

        // Click on Moderator role (has MANAGE_MESSAGES | KICK_MEMBERS)
        fireEvent.click(screen.getByText('Moderator'));

        await waitFor(() => {
            // Moderator has MANAGE_MESSAGES (bit 6) and KICK_MEMBERS (bit 4)
            const manageMessagesCheckbox = screen.getByTestId('perm-manage-messages');
            const kickCheckbox = screen.getByTestId('perm-kick-members');
            const adminCheckbox = screen.getByTestId('perm-administrator');

            expect(manageMessagesCheckbox).toBeChecked();
            expect(kickCheckbox).toBeChecked();
            expect(adminCheckbox).not.toBeChecked();
        });
    });

    // --- Members Tab ---

    it('renders member list on members tab', async () => {
        useAppStore.setState({ currentUserPermissions: Permission.ADMINISTRATOR });
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        fireEvent.click(screen.getByText('Members'));

        await waitFor(() => {
            expect(screen.getByText('testuser')).toBeInTheDocument();
            expect(screen.getByText('anotheruser')).toBeInTheDocument();
        });
    });

    // --- Hierarchy Tab ---

    it('renders channel list and category on hierarchy tab', async () => {
        useAppStore.setState({ currentUserPermissions: Permission.ADMINISTRATOR });
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        // Hierarchy is the default tab for authorized users
        await waitFor(() => {
            expect(screen.getByText('Uncategorized Channels')).toBeInTheDocument();
            expect(screen.getByText('Categories')).toBeInTheDocument();
        });
    });

    // --- Escape key ---

    it('Escape key calls onClose', async () => {
        setupFetchMock();

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(mockOnClose).toHaveBeenCalled();
    });

    // --- Fetch Failure ---

    it('handles fetch failure for initial data gracefully', async () => {
        (global.fetch as any).mockRejectedValue(new Error('Network error'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        useAppStore.setState({ currentUserPermissions: Permission.ADMINISTRATOR });

        await act(async () => {
            render(<ServerSettings onClose={mockOnClose} />);
        });

        // Component should still render without crashing
        expect(screen.getByText('Hierarchy')).toBeInTheDocument();
        consoleSpy.mockRestore();
    });
});

/// <reference types="@testing-library/jest-dom" />
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerSidebar } from '../src/components/ServerSidebar';
import { useAppStore } from '../src/store/appStore';

// Mock fetch
global.fetch = vi.fn();

// Mock Zustand store
vi.mock('../src/store/appStore', () => {
    const mock = vi.fn();
    (mock as any).getState = vi.fn();
    (mock as any).setState = vi.fn();
    return {
        useAppStore: mock
    };
});



// Mock @hello-pangea/dnd
vi.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children }: any) => <div>{children}</div>,
    Droppable: ({ children }: any) => children({
        droppableProps: {},
        innerRef: vi.fn(),
        placeholder: null
    }),
    Draggable: ({ children }: any) => children({
        draggableProps: {},
        dragHandleProps: {},
        innerRef: vi.fn()
    })
}));

describe('ServerSidebar Component', () => {
    const mockSetActiveServerId = vi.fn();
    const mockSetServerMap = vi.fn();
    const mockSetClaimedProfiles = vi.fn();

    const mockState = {
        activeServerId: 's1',
        setActiveServerId: mockSetActiveServerId,
        currentAccount: { id: 'account1', is_creator: true },
        knownServers: ['http://localhost:3001'],
        trustedServers: [],
        serverMap: { 's1': 'http://localhost:3001' },
        setServerMap: mockSetServerMap,
        setClaimedProfiles: mockSetClaimedProfiles,
        setTrustedServers: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as any).mockReturnValue(mockState);
        (useAppStore as any).getState = () => mockState;
        
        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/api/servers')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([{ id: 's1', name: 'Test Server', icon: '' }])
                });
            }
            if (url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    it('renders server icons and handles navigation', async () => {
        render(<ServerSidebar />);

        await waitFor(() => {
            const serverIcon = screen.getByText('TE'); // First 2 chars of Test Server
            expect(serverIcon).toBeInTheDocument();
            fireEvent.click(serverIcon);
            expect(mockSetActiveServerId).toHaveBeenCalledWith('s1');
        });
    });

    it('opens "Add Peer Server" modal when Plus button is clicked', async () => {
        render(<ServerSidebar />);

        const plusButton = screen.getByTitle('Add Peer Server');
        expect(plusButton).toBeInTheDocument();
        
        fireEvent.click(plusButton);
        
        expect(screen.getByText('Join a Peer Server')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('http://localhost:3002 or https://...')).toBeInTheDocument();
    });

    it('opens "Create Chat Server" modal when FolderPlus button is clicked', async () => {
        render(<ServerSidebar />);

        const folderPlusButton = screen.getByTitle('Create New Server');
        expect(folderPlusButton).toBeInTheDocument();
        
        fireEvent.click(folderPlusButton);
        
        expect(screen.getByText('Create Chat Server')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Server Name')).toBeInTheDocument();
    });
});

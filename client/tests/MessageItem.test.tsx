/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageItem } from '../src/components/MessageItem';
import { useAppStore } from '../src/store/appStore';

// Mock UserFingerprint to avoid crypto issues in tests
vi.mock('../src/components/UserFingerprint', () => ({
    UserFingerprint: () => <div data-testid="user-fingerprint" />
}));

vi.mock('../src/store/appStore', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        useAppStore: actual.useAppStore
    };
});

describe('MessageItem Component', () => {
    const mockMsg = {
        id: 'msg1',
        channel_id: 'ch1',
        author_id: 'prof1',
        content: 'Hello world',
        timestamp: new Date().toISOString(),
        username: 'GlobalUser',
        avatar: '/global-avatar.png',
        attachments: '[]',
        reactions: []
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const defaultProps = {
        isGrouped: false,
        showDaySeparator: false,
        isMentioned: false,
        isHighlighted: false,
        isAuthor: false,
        isEditing: false,
        editValue: '',
        setEditValue: vi.fn(),
        onEdit: vi.fn(),
        onCancelEdit: vi.fn(),
        onDelete: vi.fn(),
        onAddReaction: vi.fn(),
        onRemoveReaction: vi.fn(),
        onCopyLink: vi.fn(),
        onReply: vi.fn(),
        activeEmojiPickerId: null,
        setActiveEmojiPickerId: vi.fn(),
        serverMap: { 'server1': 'http://localhost:3001' },
        activeServerId: 'server1'
    };

    it('renders global fallback when no server profile exists', () => {
        useAppStore.setState({
            serverProfiles: [],
            serverMap: { 'server1': 'http://localhost:3001' },
            activeServerId: 'server1',
            claimedProfiles: [],
            presenceMap: {},
            emojis: {}
        });

        render(<MessageItem {...defaultProps} msg={mockMsg as any} />);

        expect(screen.getByText('GlobalUser')).toBeInTheDocument();
        const img = screen.getByRole('img');
        expect(img).toHaveAttribute('src', 'http://localhost:3001/global-avatar.png');
    });

    it('prioritizes server-specific nickname and avatar from profiles', () => {
        useAppStore.setState({
            serverProfiles: [{
                id: 'prof1',
                server_id: 'server1',
                account_id: 'acc1',
                original_username: 'GlobalUser',
                nickname: 'ServerNickname',
                avatar: '/server-avatar.png',
                role: 'USER',
                aliases: ''
            }],
            serverMap: { 'server1': 'http://localhost:3001' },
            activeServerId: 'server1',
            claimedProfiles: [],
            presenceMap: {},
            emojis: {}
        });

        render(<MessageItem {...defaultProps} msg={mockMsg as any} />);

        expect(screen.queryByText('GlobalUser')).not.toBeInTheDocument();
        expect(screen.getByText('ServerNickname')).toBeInTheDocument();
        
        const img = screen.getByRole('img');
        expect(img).toHaveAttribute('src', 'http://localhost:3001/server-avatar.png');
    });

    it('renders initials fallback when no avatar is provided anywhere', () => {
        const noAvatarMsg = { ...mockMsg, avatar: '' };
        useAppStore.setState({
            serverProfiles: [{
                id: 'prof1',
                server_id: 'server1',
                account_id: 'acc1',
                original_username: 'GlobalUser',
                nickname: 'NoAvatarUser',
                avatar: '',
                role: 'USER',
                aliases: ''
            }],
            serverMap: { 'server1': 'http://localhost:3001' },
            activeServerId: 'server1',
            claimedProfiles: [],
            presenceMap: {},
            emojis: {}
        });

        render(<MessageItem {...defaultProps} msg={noAvatarMsg as any} />);

        expect(screen.getByText('NO')).toBeInTheDocument(); // Initials of NoAvatarUser
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('correctly handles absolute avatar URLs', () => {
        useAppStore.setState({
            serverProfiles: [{
                id: 'prof1',
                server_id: 'server1',
                account_id: 'acc1',
                original_username: 'GlobalUser',
                nickname: 'AbsoluteUser',
                avatar: 'https://example.com/avatar.png',
                role: 'USER',
                aliases: ''
            }],
            serverMap: { 'server1': 'http://localhost:3001' },
            activeServerId: 'server1',
            claimedProfiles: [],
            presenceMap: {},
            emojis: {}
        });

        render(<MessageItem {...defaultProps} msg={mockMsg as any} />);

        const img = screen.getByRole('img');
        expect(img).toHaveAttribute('src', 'https://example.com/avatar.png');
    });
});

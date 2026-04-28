import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserSettings } from '../../../src/components/UserSettings';
import { useAppStore } from '../../../src/store/appStore';

// Mock navigator.mediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
    value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: vi.fn()
    },
    writable: true
});

describe('UserSettings Navigation UI', () => {
    beforeEach(() => {
        useAppStore.setState({
            currentAccount: { id: 'test-user', email: 'test@example.com' } as any,
            connectedServers: [{ url: 'http://localhost:3000', trust_level: 'trusted' }],
            clientSettings: { theme: 'dark' }
        });
        vi.clearAllMocks();
    });

    it('renders exactly one of each sidebar navigation tab', () => {
        const { container } = render(<UserSettings onClose={vi.fn()} />);

        // We search within the sidebar to avoid matching headings in the content area
        const sidebar = container.querySelector('div[style*="width: 240px"]');
        expect(sidebar).not.toBeNull();

        const tabs = [
            'My Account',
            'Profile',
            'Appearance',
            'Voice & Video',
            'Notifications',
            'Network & Federation'
        ];

        tabs.forEach(tabText => {
            // Check that exactly one tab with this text exists in the sidebar
            const matchingTabs = Array.from(sidebar!.querySelectorAll('div')).filter(
                el => el.textContent === tabText
            );
            expect(matchingTabs).toHaveLength(1);
        });
    });

    it('does not render duplicate Voice & Video tabs', () => {
        render(<UserSettings onClose={vi.fn()} />);
        
        // Since activeTab defaults to 'account', 'Voice & Video' is only in the sidebar
        const voiceVideoTabs = screen.getAllByText('Voice & Video');
        expect(voiceVideoTabs).toHaveLength(1);
    });
});

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { EmojiPicker } from '../../../src/components/EmojiPicker';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
    X: ({ onClick, ...props }: any) => <span data-testid="close-icon" onClick={onClick} {...props}>X</span>,
    Search: (props: any) => <span data-testid="search-icon" {...props}>Search</span>,
}));

describe('EmojiPicker', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Clear localStorage to have predictable defaults
        localStorage.removeItem('recent_emojis');
    });

    it('renders emoji grid with category headers', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        // Should show the default categories
        expect(screen.getByText('smileys')).toBeInTheDocument();
        expect(screen.getByText('gestures')).toBeInTheDocument();
        expect(screen.getByText('edgy')).toBeInTheDocument();
        expect(screen.getByText('symbols')).toBeInTheDocument();
    });

    it('shows "Recent" category with default emojis when no localStorage', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        // Default recents should include 👍, ❤️, etc.
        expect(screen.getByText('Recent')).toBeInTheDocument();
        // 👍 appears in both recents and gestures, so use getAllByText
        expect(screen.getAllByText('👍').length).toBeGreaterThanOrEqual(1);
    });

    it('loads recent emojis from localStorage', () => {
        localStorage.setItem('recent_emojis', JSON.stringify(['🎉', '🚀', '💯']));

        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        expect(screen.getByText('Recent')).toBeInTheDocument();
        expect(screen.getByText('🎉')).toBeInTheDocument();
        expect(screen.getByText('🚀')).toBeInTheDocument();
    });

    it('clicking an emoji calls onSelect with the correct emoji', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        // Click on a known emoji
        const emojiElement = screen.getByText('😀');
        fireEvent.click(emojiElement);

        expect(onSelect).toHaveBeenCalledWith('😀');
    });

    it('clicking an emoji also calls onClose', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        const emojiElement = screen.getByText('😁');
        fireEvent.click(emojiElement);

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking an emoji updates recent emojis in localStorage', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        fireEvent.click(screen.getByText('😎'));

        const stored = JSON.parse(localStorage.getItem('recent_emojis')!);
        expect(stored[0]).toBe('😎');
    });

    it('search field filters visible emojis', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        const searchInput = screen.getByPlaceholderText('Search emojis...');
        fireEvent.change(searchInput, { target: { value: '😈' } });

        // When searching, category headers change to "results"
        expect(screen.getByText('results')).toBeInTheDocument();
        // Category headers like 'smileys' should be gone
        expect(screen.queryByText('smileys')).not.toBeInTheDocument();
    });

    it('recent section is hidden during search', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        const searchInput = screen.getByPlaceholderText('Search emojis...');
        fireEvent.change(searchInput, { target: { value: 'test' } });

        // Recent header should not be displayed during search
        expect(screen.queryByText('Recent')).not.toBeInTheDocument();
    });

    it('close (X) button calls onClose', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        const closeIcon = screen.getByTestId('close-icon');
        fireEvent.click(closeIcon);

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders search input with placeholder text', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument();
    });

    it('recently clicked emoji appears first in recent list', () => {
        localStorage.setItem('recent_emojis', JSON.stringify(['👍', '❤️']));
        const { rerender } = render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        // Click a new emoji to add it to recents
        fireEvent.click(screen.getByText('😀'));

        // After close + rerender, check localStorage
        const stored = JSON.parse(localStorage.getItem('recent_emojis')!);
        expect(stored[0]).toBe('😀');
        expect(stored).toContain('👍');
        expect(stored).toContain('❤️');
    });

    it('does not crash with empty search query', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);

        const searchInput = screen.getByPlaceholderText('Search emojis...');
        fireEvent.change(searchInput, { target: { value: '' } });

        // Should still show normal categories
        expect(screen.getByText('smileys')).toBeInTheDocument();
    });

    it('closes when the Escape key is pressed', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
        
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes when clicking outside the component', () => {
        render(
            <div>
                <div data-testid="outside-element">Outside</div>
                <EmojiPicker onSelect={onSelect} onClose={onClose} />
            </div>
        );
        
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(screen.getByTestId('outside-element'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when clicking inside the component', () => {
        render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
        
        expect(onClose).not.toHaveBeenCalled();
        // The search input is inside the EmojiPicker
        const searchInput = screen.getByPlaceholderText('Search emojis...');
        fireEvent.mouseDown(searchInput);
        expect(onClose).not.toHaveBeenCalled();
    });
});

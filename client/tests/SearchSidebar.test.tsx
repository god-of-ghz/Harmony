/// <reference types="@testing-library/jest-dom" />
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchSidebar } from '../src/components/SearchSidebar';
import { useAppStore } from '../src/store/appStore';

// Mock the store
vi.mock('../src/store/appStore', () => ({
    useAppStore: vi.fn(),
}));

describe('SearchSidebar Component', () => {
    const mockOnJumpToMessage = vi.fn();
    const mockSetSearchSidebarOpen = vi.fn();
    const mockSetSearchQuery = vi.fn();
    const mockSetSearchResults = vi.fn();

    const mockMessages = [
        { 
            id: 'm1', 
            content: 'test disease result', 
            username: 'bob', 
            timestamp: Date.now(), 
            channel_id: 'ch1', 
            channel_name: 'general',
            avatar: ''
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Setup mock store responses
        (useAppStore as any).mockImplementation((selector: any) => {
            const state = {
                isSearchSidebarOpen: true,
                setSearchSidebarOpen: mockSetSearchSidebarOpen,
                searchQuery: 'disease',
                setSearchQuery: mockSetSearchQuery,
                searchResults: mockMessages,
                setSearchResults: mockSetSearchResults,
                serverMap: { 'sv1': 'http://localhost:3001' },
                activeServerId: 'sv1'
            };
            return selector(state);
        });
    });

    it('renders search results when sidebar is open', () => {
        render(<SearchSidebar onJumpToMessage={mockOnJumpToMessage} />);
        
        expect(screen.getByText('Search Results')).toBeInTheDocument();
        const resultItem = screen.getByTestId('search-result-item');
        expect(resultItem).toBeInTheDocument();
        expect(resultItem).toHaveTextContent(/test disease result/i);
        expect(screen.getByText('bob')).toBeInTheDocument();
        expect(screen.getByText('# general')).toBeInTheDocument();
    });

    it('calls onJumpToMessage when a search result is clicked', () => {
        render(<SearchSidebar onJumpToMessage={mockOnJumpToMessage} />);
        
        const resultItem = screen.getByTestId('search-result-item');
        fireEvent.click(resultItem);
        
        expect(mockOnJumpToMessage).toHaveBeenCalledWith('sv1', 'ch1', 'm1');
    });

    it('updates search query when typing in the input', () => {
        render(<SearchSidebar onJumpToMessage={mockOnJumpToMessage} />);
        
        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'new query' } });
        
        expect(mockSetSearchQuery).toHaveBeenCalledWith('new query');
    });

    it('calls setSearchSidebarOpen(false) when close button is clicked', () => {
        render(<SearchSidebar onJumpToMessage={mockOnJumpToMessage} />);
        
        const closeBtn = screen.getByTestId('close-search');
        fireEvent.click(closeBtn);
        
        expect(mockSetSearchSidebarOpen).toHaveBeenCalledWith(false);
    });

    it('renders empty state when no results and not searching', () => {
        // Override mock for this test
        (useAppStore as any).mockImplementation((selector: any) => {
            const state = {
                isSearchSidebarOpen: true,
                setSearchSidebarOpen: mockSetSearchSidebarOpen,
                searchQuery: 'notfound',
                setSearchQuery: mockSetSearchQuery,
                searchResults: [],
                setSearchResults: mockSetSearchResults,
                serverMap: { 'sv1': 'http://localhost:3001' },
                activeServerId: 'sv1'
            };
            return selector(state);
        });

        render(<SearchSidebar onJumpToMessage={mockOnJumpToMessage} />);
        
        expect(screen.getByText('No results found')).toBeInTheDocument();
        expect(screen.getByText('Try a different keyword or check your spelling.')).toBeInTheDocument();
    });

    it('does not render when isSearchSidebarOpen is false', () => {
        (useAppStore as any).mockImplementation((selector: any) => {
            const state = {
                isSearchSidebarOpen: false,
                setSearchSidebarOpen: mockSetSearchSidebarOpen,
                searchQuery: '',
                setSearchQuery: mockSetSearchQuery,
                searchResults: [],
                setSearchResults: mockSetSearchResults,
                serverMap: { 'sv1': 'http://localhost:3001' },
                activeServerId: 'sv1'
            };
            return selector(state);
        });

        const { container } = render(<SearchSidebar onJumpToMessage={mockOnJumpToMessage} />);
        expect(container.firstChild).toBeNull();
    });
});

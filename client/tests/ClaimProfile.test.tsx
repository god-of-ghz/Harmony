/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ClaimProfile } from '../src/components/ClaimProfile';
import { useAppStore } from '../src/store/appStore';

// Mock fetch to simulate API response
global.fetch = vi.fn();

// Mock the Zustand store
vi.mock('../src/store/appStore', () => ({
    useAppStore: vi.fn(),
}));

describe('ClaimProfile Component', () => {
    it('renders loading state initially', () => {
        (useAppStore as any).mockReturnValue({
            setCurrentUser: vi.fn(),
        });

        // Mock fetch to return a pending promise so loading state stays true
        (global.fetch as any).mockImplementationOnce(() => new Promise(() => { }));

        render(<ClaimProfile />);
        expect(screen.getByText(/Loading available profiles/i)).toBeInTheDocument();
    });
});

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ImageModal } from '../../../src/components/ImageModal';
import { useAppStore } from '../../../src/store/appStore';

// Mock lucide-react
vi.mock('lucide-react', () => ({
    X: (props: any) => <span data-testid="close-x" {...props}>X</span>,
}));

describe('ImageModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        useAppStore.setState({
            zoomedImageUrl: null,
        });
    });

    it('renders nothing when zoomedImageUrl is null', () => {
        const { container } = render(<ImageModal />);
        expect(container.innerHTML).toBe('');
    });

    it('renders fullscreen overlay when zoomedImageUrl is set', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        render(<ImageModal />);

        expect(screen.getByAltText('Zoomed attachment')).toBeInTheDocument();
        expect(screen.getByText('Click outside or press Escape to close')).toBeInTheDocument();
    });

    it('displays the correct image src', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/photo.jpg' });

        render(<ImageModal />);

        const img = screen.getByAltText('Zoomed attachment');
        expect(img).toHaveAttribute('src', 'http://localhost/photo.jpg');
    });

    it('close button clears zoomed image URL', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        render(<ImageModal />);

        // Click the close (X) button
        const closeBtn = screen.getByTestId('close-x').closest('button');
        expect(closeBtn).toBeTruthy();

        act(() => {
            fireEvent.click(closeBtn!);
        });

        expect(useAppStore.getState().zoomedImageUrl).toBeNull();
    });

    it('clicking the backdrop (overlay) closes the modal', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        render(<ImageModal />);

        const overlay = document.getElementById('image-zoom-overlay');
        expect(overlay).toBeTruthy();

        act(() => {
            fireEvent.click(overlay!);
        });

        expect(useAppStore.getState().zoomedImageUrl).toBeNull();
    });

    it('clicking the image itself does NOT close the modal (stopPropagation)', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        render(<ImageModal />);

        const img = screen.getByAltText('Zoomed attachment');
        act(() => {
            fireEvent.click(img);
        });

        // Image should still be visible — clicking on it shouldn't close
        expect(useAppStore.getState().zoomedImageUrl).toBe('http://localhost/image.png');
    });

    it('Escape key closes the modal', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        render(<ImageModal />);

        act(() => {
            fireEvent.keyDown(window, { key: 'Escape' });
        });

        expect(useAppStore.getState().zoomedImageUrl).toBeNull();
    });

    it('sets body overflow to hidden when modal is open', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        render(<ImageModal />);

        expect(document.body.style.overflow).toBe('hidden');
    });

    it('restores body overflow when modal is closed', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        const { rerender } = render(<ImageModal />);
        expect(document.body.style.overflow).toBe('hidden');

        // Close the modal
        act(() => {
            useAppStore.setState({ zoomedImageUrl: null });
        });

        rerender(<ImageModal />);
        expect(document.body.style.overflow).toBe('');
    });

    it('renders overlay with correct z-index for stacking', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        render(<ImageModal />);

        const overlay = document.getElementById('image-zoom-overlay');
        expect(overlay).toBeTruthy();
        expect(overlay!.style.zIndex).toBe('3000');
    });

    it('applies zoom-out cursor to overlay', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        render(<ImageModal />);

        const overlay = document.getElementById('image-zoom-overlay');
        expect(overlay!.style.cursor).toBe('zoom-out');
    });

    it('handles various image URL formats', () => {
        // Test with a relative URL
        useAppStore.setState({ zoomedImageUrl: '/uploads/server1/image.png' });

        render(<ImageModal />);

        const img = screen.getByAltText('Zoomed attachment');
        expect(img).toHaveAttribute('src', '/uploads/server1/image.png');
    });

    it('non-Escape keys do not close the modal', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        render(<ImageModal />);

        act(() => {
            fireEvent.keyDown(window, { key: 'Enter' });
        });

        // Should still be open
        expect(useAppStore.getState().zoomedImageUrl).toBe('http://localhost/image.png');
    });

    it('close hint text is visible to guide the user', () => {
        useAppStore.setState({ zoomedImageUrl: 'http://localhost/image.png' });

        render(<ImageModal />);

        expect(screen.getByText('Click outside or press Escape to close')).toBeInTheDocument();
    });
});

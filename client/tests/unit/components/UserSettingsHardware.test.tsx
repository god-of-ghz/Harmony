import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserSettings } from '../../../src/components/UserSettings';
import { useAppStore } from '../../../src/store/appStore';

// Mock navigator.mediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
    value: {
        enumerateDevices: vi.fn(),
        getUserMedia: vi.fn()
    },
    writable: true
});

describe('UserSettings Hardware Settings', () => {
    beforeEach(() => {
        useAppStore.setState({
            currentAccount: { id: 'test-user', email: 'test@example.com' } as any,
            audioSettings: {
                noiseSuppression: true,
                echoCancellation: true,
                autoGainControl: true,
                inputDeviceId: 'default',
                outputDeviceId: 'default',
                videoCameraId: 'default'
            }
        });
        vi.clearAllMocks();
    });

    it('enumerates hardware devices and populates dropdowns', async () => {
        const mockDevices = [
            { kind: 'audioinput', deviceId: 'mic-1', label: 'Test Mic 1' },
            { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Test Speaker 1' },
            { kind: 'videoinput', deviceId: 'cam-1', label: 'Test Camera 1' }
        ];
        (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue(mockDevices);

        render(<UserSettings onClose={vi.fn()} />);

        fireEvent.click(screen.getByText('Voice & Video'));

        await waitFor(() => {
            expect(screen.getByText('Test Mic 1')).toBeInTheDocument();
            expect(screen.getByText('Test Speaker 1')).toBeInTheDocument();
            expect(screen.getByText('Test Camera 1')).toBeInTheDocument();
        });
    });

    it('updates hardware settings state correctly upon selection', async () => {
        const mockDevices = [
            { kind: 'audioinput', deviceId: 'mic-2', label: 'Test Mic 2' },
            { kind: 'audiooutput', deviceId: 'speaker-2', label: 'Test Speaker 2' },
            { kind: 'videoinput', deviceId: 'cam-2', label: 'Test Camera 2' }
        ];
        (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue(mockDevices);

        render(<UserSettings onClose={vi.fn()} />);
        
        fireEvent.click(screen.getByText('Voice & Video'));

        await waitFor(() => {
            expect(screen.getByText('Test Speaker 2')).toBeInTheDocument();
        });

        const selects = screen.getAllByRole('combobox');
        
        // Output device select is the second one
        fireEvent.change(selects[1], { target: { value: 'speaker-2' } });

        const state = useAppStore.getState();
        expect(state.audioSettings.outputDeviceId).toBe('speaker-2');
    });
});

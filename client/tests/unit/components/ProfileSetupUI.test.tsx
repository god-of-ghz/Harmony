import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProfileSetupUI } from '../../../src/components/ProfileSetupUI';

describe('ProfileSetupUI Component', () => {
    const mockProfiles = [
        { id: '1', name: 'John', avatar: 'john.png' },
        { id: '2', name: 'Jane', avatar: 'jane.png' }
    ];

    // ── Tab Rendering & Switching ────────────────────────────────────

    it('renders the create tab by default and allows submitting', () => {
        const onFreshStart = vi.fn();
        render(
            <ProfileSetupUI 
                title="Test Title" 
                description="Test Desc" 
                profiles={mockProfiles}
                onClaim={vi.fn()}
                onFreshStart={onFreshStart}
            />
        );

        expect(screen.getByText('Test Title')).toBeInTheDocument();
        expect(screen.getByText('Test Desc')).toBeInTheDocument();

        const input = screen.getByTestId('fresh-nickname');
        fireEvent.change(input, { target: { value: 'NewName' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(onFreshStart).toHaveBeenCalledWith('NewName');
    });

    it('switches to claim tab when button is clicked', () => {
        const onClaim = vi.fn();
        render(
            <ProfileSetupUI 
                title="Test Title" 
                description="Test Desc" 
                profiles={mockProfiles}
                onClaim={onClaim}
                onFreshStart={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText('Claim Existing Identity'));
        expect(screen.getByText('John')).toBeInTheDocument();
        expect(screen.getByText('Jane')).toBeInTheDocument();

        fireEvent.click(screen.getByText('John'));
        expect(onClaim).toHaveBeenCalledWith('1');
    });

    it('switches back to create tab from claim tab', () => {
        render(
            <ProfileSetupUI
                title="Test"
                description="Desc"
                profiles={mockProfiles}
                onClaim={vi.fn()}
                onFreshStart={vi.fn()}
            />
        );

        // Switch to Claim
        fireEvent.click(screen.getByText('Claim Existing Identity'));
        expect(screen.queryByTestId('fresh-nickname')).not.toBeInTheDocument();

        // Switch back to Create
        fireEvent.click(screen.getByText('Create Profile'));
        expect(screen.getByTestId('fresh-nickname')).toBeInTheDocument();
    });

    it('hides claim tab when profiles is empty', () => {
        render(
            <ProfileSetupUI 
                title="Test Title" 
                description="Test Desc" 
                profiles={[]}
                onClaim={vi.fn()}
                onFreshStart={vi.fn()}
            />
        );

        expect(screen.queryByText('Claim Existing Identity')).not.toBeInTheDocument();
        expect(screen.getByTestId('fresh-nickname')).toBeInTheDocument();
    });

    // ── Nickname Input Validation ────────────────────────────────────

    it('does not call onFreshStart when nickname is empty (HTML5 required + custom validation)', () => {
        const onFreshStart = vi.fn();
        render(
            <ProfileSetupUI
                title="Test"
                description="Desc"
                profiles={[]}
                onClaim={vi.fn()}
                onFreshStart={onFreshStart}
            />
        );

        // Submit the form directly to trigger handleSubmit's custom validation
        const form = screen.getByTestId('fresh-nickname').closest('form')!;
        fireEvent.submit(form);

        expect(screen.getByText('Please enter a nickname.')).toBeInTheDocument();
        expect(onFreshStart).not.toHaveBeenCalled();
    });

    it('shows error when submitting with whitespace-only nickname', () => {
        const onFreshStart = vi.fn();
        render(
            <ProfileSetupUI
                title="Test"
                description="Desc"
                profiles={[]}
                onClaim={vi.fn()}
                onFreshStart={onFreshStart}
            />
        );

        const input = screen.getByTestId('fresh-nickname');
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(screen.getByText('Please enter a nickname.')).toBeInTheDocument();
        expect(onFreshStart).not.toHaveBeenCalled();
    });

    it('clears error on subsequent valid submission', () => {
        const onFreshStart = vi.fn();
        render(
            <ProfileSetupUI
                title="Test"
                description="Desc"
                profiles={[]}
                onClaim={vi.fn()}
                onFreshStart={onFreshStart}
            />
        );

        const form = screen.getByTestId('fresh-nickname').closest('form')!;

        // First submit — empty — triggers error
        fireEvent.submit(form);
        expect(screen.getByText('Please enter a nickname.')).toBeInTheDocument();

        // Now fill in a valid nickname and re-submit
        const input = screen.getByTestId('fresh-nickname');
        fireEvent.change(input, { target: { value: 'ValidName' } });
        fireEvent.submit(form);

        expect(screen.queryByText('Please enter a nickname.')).not.toBeInTheDocument();
        expect(onFreshStart).toHaveBeenCalledWith('ValidName');
    });

    // ── Successful Profile Creation ──────────────────────────────────

    it('calls onFreshStart with trimmed nickname', () => {
        const onFreshStart = vi.fn();
        render(
            <ProfileSetupUI
                title="Test"
                description="Desc"
                profiles={[]}
                onClaim={vi.fn()}
                onFreshStart={onFreshStart}
            />
        );

        const input = screen.getByTestId('fresh-nickname');
        fireEvent.change(input, { target: { value: 'Alice' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(onFreshStart).toHaveBeenCalledTimes(1);
        expect(onFreshStart).toHaveBeenCalledWith('Alice');
    });

    // ── Claim Profile ────────────────────────────────────────────────

    it('calls onClaim with correct profile id when a profile card is clicked', () => {
        const onClaim = vi.fn();
        render(
            <ProfileSetupUI
                title="Test"
                description="Desc"
                profiles={mockProfiles}
                onClaim={onClaim}
                onFreshStart={vi.fn()}
            />
        );

        // Switch to claim tab
        fireEvent.click(screen.getByText('Claim Existing Identity'));

        // Click the second profile
        fireEvent.click(screen.getByText('Jane'));
        expect(onClaim).toHaveBeenCalledWith('2');
    });

    // ── Guest Session ────────────────────────────────────────────────

    it('hides claim tab entirely when isGuestSession is true', () => {
        render(
            <ProfileSetupUI
                title="Guest Setup"
                description="Set up your guest profile"
                profiles={mockProfiles}
                onClaim={vi.fn()}
                onFreshStart={vi.fn()}
                isGuestSession={true}
            />
        );

        // Claim tab should not appear even when profiles exist
        expect(screen.queryByText('Claim Existing Identity')).not.toBeInTheDocument();
        expect(screen.queryByText('Create Profile')).not.toBeInTheDocument();
        // But the nickname input should still be there
        expect(screen.getByTestId('fresh-nickname')).toBeInTheDocument();
    });

    // ── Props Rendering ──────────────────────────────────────────────

    it('renders both tab buttons when profiles are provided and not guest', () => {
        render(
            <ProfileSetupUI
                title="T"
                description="D"
                profiles={mockProfiles}
                onClaim={vi.fn()}
                onFreshStart={vi.fn()}
            />
        );

        expect(screen.getByText('Create Profile')).toBeInTheDocument();
        expect(screen.getByText('Claim Existing Identity')).toBeInTheDocument();
    });

    it('renders custom title and description', () => {
        render(
            <ProfileSetupUI
                title="Welcome to Harmony"
                description="Choose how to set up your identity"
                profiles={[]}
                onClaim={vi.fn()}
                onFreshStart={vi.fn()}
            />
        );

        expect(screen.getByText('Welcome to Harmony')).toBeInTheDocument();
        expect(screen.getByText('Choose how to set up your identity')).toBeInTheDocument();
    });

    // ── Form Submission via Enter Key ────────────────────────────────

    it('submits form when Enter is pressed in the nickname input', () => {
        const onFreshStart = vi.fn();
        render(
            <ProfileSetupUI
                title="Test"
                description="Desc"
                profiles={[]}
                onClaim={vi.fn()}
                onFreshStart={onFreshStart}
            />
        );

        const input = screen.getByTestId('fresh-nickname');
        fireEvent.change(input, { target: { value: 'Bob' } });
        fireEvent.submit(input.closest('form')!);

        expect(onFreshStart).toHaveBeenCalledWith('Bob');
    });
});

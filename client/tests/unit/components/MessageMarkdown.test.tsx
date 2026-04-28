import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageMarkdown } from '../../../src/components/markdown/MessageMarkdown';

// Mock the appStore
vi.mock('../../../src/store/appStore', () => ({
    useAppStore: vi.fn((selector) => {
        const mockState = {
            activeServerId: 'server1',
            activeChannelId: 'channel1',
            activeChannelName: 'general',
            emojis: {
                'server1': [{ id: '123', name: 'catjam', url: 'catjam.png' }]
            },
            serverProfiles: [
                { id: 'user1', nickname: 'Alice' },
                { id: 'user2', nickname: 'Bob', aliases: 'Bobby' }
            ],
            serverRoles: [
                { id: 'role1', name: 'Admin', color: '#ff0000' }
            ],
            showUnknownTags: false
        };
        return selector(mockState);
    })
}));

describe('MessageMarkdown Component', () => {
    it('renders basic markdown', () => {
        render(<MessageMarkdown content="**bold** _italic_ ~~strikethrough~~" />);
        
        expect(screen.getByText('bold').tagName).toBe('STRONG');
        expect(screen.getByText('italic').tagName).toBe('EM');
        expect(screen.getByText('strikethrough').tagName).toBe('DEL');
    });

    it('escapes dangerous HTML (XSS prevention)', () => {
        render(<MessageMarkdown content="<script>alert(1)</script> **test**" />);
        
        // The script tag should be rendered as text, not executed as HTML
        expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
        expect(screen.getByText('test').tagName).toBe('STRONG');
    });

    it('renders spoilers', () => {
        render(<MessageMarkdown content="||hidden secret||" />);
        
        const spoiler = screen.getByText('hidden secret');
        expect(spoiler).toBeInTheDocument();
        expect(spoiler.className).toContain('hidden');
        
        // Click to reveal
        fireEvent.click(spoiler);
        expect(spoiler.className).toContain('revealed');
    });

    it('renders user mentions', () => {
        render(<MessageMarkdown content="Hello <@user1> and <@user2>" />);
        
        expect(screen.getByText('@Alice')).toBeInTheDocument();
        expect(screen.getByText('@Bob')).toBeInTheDocument();
    });

    it('renders unknown user mentions gracefully', () => {
        render(<MessageMarkdown content="Hello <@unknown99>" />);
        expect(screen.getByText('@Unknown User')).toBeInTheDocument();
    });

    it('renders role mentions', () => {
        render(<MessageMarkdown content="Ping <@&role1>" />);
        
        const roleMention = screen.getByText('@Admin');
        expect(roleMention).toBeInTheDocument();
        expect(roleMention).toHaveStyle({ borderLeft: '2px solid #ff0000' });
    });

    it('renders custom emojis', () => {
        render(<MessageMarkdown content="Check this out <:catjam:123>" />);
        
        const img = screen.getByAltText('catjam') as HTMLImageElement;
        expect(img).toBeInTheDocument();
        expect(img.src).toContain('catjam.png');
        expect(img).toHaveClass('inline-emoji');
    });

    it('renders internal links', () => {
        render(<MessageMarkdown content="Go to #/server/server1/channels/channel1/messages/msg1" />);
        
        const link = screen.getByText('general');
        expect(link).toBeInTheDocument();
        expect(link.parentElement?.className).toContain('internal-link');
    });

    it('renders nested combinations', () => {
        render(<MessageMarkdown content="||**<@user1>** is <:catjam:123>||" />);
        
        // The custom elements should be rendered correctly inside the spoiler
        const spoilerContainer = screen.getByText((content, element) => element?.tagName === 'SPAN' && element.className.includes('markdown-spoiler'));
        
        expect(screen.getByText('@Alice').tagName).toBe('SPAN');
        expect(screen.getByText('@Alice').parentElement?.tagName).toBe('STRONG');
        expect(screen.getByAltText('catjam')).toBeInTheDocument();
    });

    it('preserves single newlines as line breaks', () => {
        const { container } = render(<MessageMarkdown content={"Line one\nLine two\nLine three"} />);
        
        // Single newlines should produce <br> elements
        const brElements = container.querySelectorAll('br');
        expect(brElements.length).toBeGreaterThanOrEqual(2);
    });

    it('preserves double newlines as paragraph breaks', () => {
        const { container } = render(<MessageMarkdown content={"Paragraph one\n\nParagraph two"} />);
        
        // Double newlines should create separate <p> elements
        const pElements = container.querySelectorAll('p');
        expect(pElements.length).toBeGreaterThanOrEqual(2);
        expect(pElements[0].textContent).toContain('Paragraph one');
        expect(pElements[1].textContent).toContain('Paragraph two');
    });

    it('renders blockquotes', () => {
        const { container } = render(<MessageMarkdown content="> quoted text" />);
        
        const blockquote = container.querySelector('blockquote');
        expect(blockquote).toBeInTheDocument();
        expect(blockquote?.textContent).toBe('quoted text');
    });

    it('renders multi-line blockquotes', () => {
        const { container } = render(<MessageMarkdown content={"> line 1\n> line 2"} />);
        
        const blockquotes = container.querySelectorAll('blockquote');
        expect(blockquotes.length).toBe(1);
        expect(blockquotes[0].textContent).toContain('line 1');
        expect(blockquotes[0].textContent).toContain('line 2');
    });
});

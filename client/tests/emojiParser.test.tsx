import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { parseCustomEmojis } from '../src/utils/emojiParser';
import type { EmojiData } from '../src/store/appStore';
import React from 'react';

/**
 * @vitest-environment jsdom
 */

const mockEmojis: EmojiData[] = [
    { id: '12345', name: 'kekw', url: 'https://example.com/kekw.png', server_id: 's1', animated: false },
    { id: '67890', name: 'catjam', url: 'https://example.com/catjam.gif', server_id: 's1', animated: true },
];

describe('parseCustomEmojis', () => {
    it('returns original string if no emojis present', () => {
        const content = 'Hello world';
        const result = parseCustomEmojis(content, mockEmojis);
        expect(result).toEqual(['Hello world']);
    });

    it('parses a single custom emoji correctly', () => {
        const content = 'Hello <:kekw:12345>!';
        const result = parseCustomEmojis(content, mockEmojis);
        
        // Structure should be [ 'Hello ', ReactElement, '!' ]
        expect(result).toHaveLength(3);
        expect(result[0]).toBe('Hello ');
        expect(result[2]).toBe('!');
        
        const { container } = render(<>{result}</>);
        const img = container.querySelector('img');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/kekw.png');
        expect(img).toHaveAttribute('alt', 'kekw');
        expect(img).toHaveClass('inline-emoji');
    });

    it('parses an animated custom emoji correctly', () => {
        const content = '<a:catjam:67890>';
        const result = parseCustomEmojis(content, mockEmojis);
        expect(result).toHaveLength(1);
        
        const { container } = render(<>{result}</>);
        const img = container.querySelector('img');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/catjam.gif');
        expect(img).toHaveAttribute('alt', 'catjam');
    });

    it('handles multiple emojis and mixed text', () => {
        const content = '<:kekw:12345> text <a:catjam:67890> more text';
        const result = parseCustomEmojis(content, mockEmojis);
        expect(result).toHaveLength(4);
        
        const { container } = render(<>{result}</>);
        const imgs = container.querySelectorAll('img');
        expect(imgs).toHaveLength(2);
        expect(imgs[0]).toHaveAttribute('alt', 'kekw');
        expect(imgs[1]).toHaveAttribute('alt', 'catjam');
        expect(container.textContent).toContain(' text ');
        expect(container.textContent).toContain(' more text');
    });

    it('leaves unknown shortcodes as text if id not found in store', () => {
        const content = 'Check this <:unknown:99999>';
        const result = parseCustomEmojis(content, mockEmojis);
        expect(result).toHaveLength(2);
        expect(result[0]).toBe('Check this ');
        expect(result[1]).toBe('<:unknown:99999>');
    });

    it('handles malformed shortcodes by ignoring them', () => {
        const testCases = [
            'Not an emoji <:name:>',
            'Missing id <a:name:>',
            'Wrong format <emoji:name:123>',
            'Almost <:name:id'
        ];

        testCases.forEach(content => {
            const result = parseCustomEmojis(content, mockEmojis);
            expect(result).toEqual([content]);
        });
    });

    it('handles empty content gracefully', () => {
        expect(parseCustomEmojis('', mockEmojis)).toEqual([]);
    });
});

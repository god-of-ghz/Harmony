import { describe, it, expect } from 'vitest';
import { parseLinks } from '../src/utils/linkParser';
import { render } from '@testing-library/react';
import React from 'react';

describe('linkParser', () => {
    it('should return empty array for empty string', () => {
        expect(parseLinks('')).toEqual([]);
    });

    it('should return simple string when no links are present', () => {
        const result = parseLinks('Hello world');
        expect(result).toHaveLength(1);
        expect(result[0]).toBe('Hello world');
    });

    it('should parse a single link', () => {
        const result = parseLinks('Check out https://google.com for info');
        expect(result).toHaveLength(3);
        expect(result[0]).toBe('Check out ');
        
        const { container } = render(<>{result[1]}</>);
        const link = container.querySelector('a');
        expect(link).toBeDefined();
        expect(link?.getAttribute('href')).toBe('https://google.com');
        expect(link?.textContent).toBe('https://google.com');
        expect(link?.getAttribute('target')).toBe('_blank');

        expect(result[2]).toBe(' for info');
    });

    it('should parse multiple links', () => {
        const result = parseLinks('Go to https://a.com and http://b.org/path');
        expect(result).toHaveLength(4);
        expect(result[0]).toBe('Go to ');
        expect((result[1] as any).props.href).toBe('https://a.com');
        expect(result[2]).toBe(' and ');
        expect((result[3] as any).props.href).toBe('http://b.org/path');
    });

    it('should handle trailing punctuation correctly', () => {
        const result = parseLinks('Is this google.com? No, it is https://google.com!');
        expect(result).toHaveLength(3);
        expect(result[0]).toBe('Is this google.com? No, it is ');
        expect((result[1] as any).props.href).toBe('https://google.com');
        expect(result[2]).toBe('!');
    });

    it('should handle links at the beginning or end', () => {
        const result = parseLinks('https://google.com');
        expect(result).toHaveLength(1);
        expect((result[0] as any).props.href).toBe('https://google.com');

        const result2 = parseLinks('Check this: https://google.com');
        expect(result2).toHaveLength(2);
        expect(result2[0]).toBe('Check this: ');
        expect((result2[1] as any).props.href).toBe('https://google.com');
    });

    it('should handle query parameters and hash fragments', () => {
        const result = parseLinks('Visit https://example.com/search?q=test#top now');
        expect(result).toHaveLength(3);
        expect((result[1] as any).props.href).toBe('https://example.com/search?q=test#top');
        expect(result[2]).toBe(' now');
    });

    it('should handle links inside brackets', () => {
        const result = parseLinks('Look at this (https://google.com)');
        expect(result).toHaveLength(3);
        expect(result[0]).toBe('Look at this (');
        expect((result[1] as any).props.href).toBe('https://google.com');
        expect(result[2]).toBe(')');
    });

    it('should handle multiple links with surrounding text', () => {
        const result = parseLinks('Check https://a.com, https://b.com and maybe https://c.com!');
        expect(result).toHaveLength(7);
        expect((result[1] as any).props.href).toBe('https://a.com');
        expect(result[2]).toBe(', ');
        expect((result[3] as any).props.href).toBe('https://b.com');
        expect(result[4]).toBe(' and maybe ');
        expect((result[5] as any).props.href).toBe('https://c.com');
    });
});

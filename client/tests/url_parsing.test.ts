import { describe, it, expect } from 'vitest';
import { convertToWsUrl } from '../src/utils/url';

describe('URL Utilities', () => {
    it('should convert http to ws', () => {
        expect(convertToWsUrl('http://localhost:3001')).toBe('ws://localhost:3001');
    });

    it('should convert https to wss', () => {
        expect(convertToWsUrl('https://example.com')).toBe('wss://example.com');
    });

    it('should handle URLs with paths', () => {
        expect(convertToWsUrl('http://localhost:3001/api')).toBe('ws://localhost:3001/api');
        expect(convertToWsUrl('https://example.com/v1')).toBe('wss://example.com/v1');
    });

    it('should handle IP addresses', () => {
        expect(convertToWsUrl('http://192.168.1.1:3000')).toBe('ws://192.168.1.1:3000');
    });
});

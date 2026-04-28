import { describe, it, expect } from 'vitest';
import { convertToWsUrl } from '../../../src/utils/url';

describe('URL Utilities', () => {
    // ── Basic Protocol Conversion ────────────────────────────────────

    it('should convert http to ws', () => {
        expect(convertToWsUrl('http://localhost:3001')).toBe('ws://localhost:3001');
    });

    it('should convert https to wss', () => {
        expect(convertToWsUrl('https://example.com')).toBe('wss://example.com');
    });

    // ── URLs with Paths ──────────────────────────────────────────────

    it('should handle URLs with paths', () => {
        expect(convertToWsUrl('http://localhost:3001/api')).toBe('ws://localhost:3001/api');
        expect(convertToWsUrl('https://example.com/v1')).toBe('wss://example.com/v1');
    });

    it('should handle URLs with nested paths', () => {
        expect(convertToWsUrl('http://localhost:3001/api/v1/ws')).toBe('ws://localhost:3001/api/v1/ws');
    });

    // ── Port Numbers ─────────────────────────────────────────────────

    it('should handle IP addresses', () => {
        expect(convertToWsUrl('http://192.168.1.1:3000')).toBe('ws://192.168.1.1:3000');
    });

    it('should handle various port numbers', () => {
        expect(convertToWsUrl('http://localhost:8080')).toBe('ws://localhost:8080');
        expect(convertToWsUrl('https://example.com:443')).toBe('wss://example.com:443');
        expect(convertToWsUrl('http://example.com:80')).toBe('ws://example.com:80');
    });

    it('should handle URLs without explicit port', () => {
        expect(convertToWsUrl('http://example.com')).toBe('ws://example.com');
        expect(convertToWsUrl('https://example.com')).toBe('wss://example.com');
    });

    // ── Trailing Slash Handling ───────────────────────────────────────

    it('should preserve trailing slash', () => {
        expect(convertToWsUrl('http://localhost:3001/')).toBe('ws://localhost:3001/');
    });

    it('should preserve trailing path with slash', () => {
        expect(convertToWsUrl('https://example.com/api/')).toBe('wss://example.com/api/');
    });

    // ── IPv4 Addresses ───────────────────────────────────────────────

    it('should handle various IPv4 addresses', () => {
        expect(convertToWsUrl('http://10.0.0.1:3001')).toBe('ws://10.0.0.1:3001');
        expect(convertToWsUrl('https://172.16.0.1')).toBe('wss://172.16.0.1');
        expect(convertToWsUrl('http://127.0.0.1:8080')).toBe('ws://127.0.0.1:8080');
    });

    // ── IPv6 Addresses ───────────────────────────────────────────────

    it('should handle IPv6 addresses', () => {
        expect(convertToWsUrl('http://[::1]:3001')).toBe('ws://[::1]:3001');
    });

    it('should handle full IPv6 addresses', () => {
        expect(convertToWsUrl('http://[2001:db8::1]:8080')).toBe('ws://[2001:db8::1]:8080');
    });

    it('should handle IPv6 with https', () => {
        expect(convertToWsUrl('https://[::1]:443')).toBe('wss://[::1]:443');
    });

    // ── Federation-Relevant Edge Cases ───────────────────────────────

    it('should handle server URLs with query parameters', () => {
        expect(convertToWsUrl('http://example.com:3001?token=abc')).toBe('ws://example.com:3001?token=abc');
    });

    it('should handle URLs with fragments', () => {
        expect(convertToWsUrl('http://example.com:3001#section')).toBe('ws://example.com:3001#section');
    });

    it('should handle subdomains (common in federation)', () => {
        expect(convertToWsUrl('https://harmony.example.com')).toBe('wss://harmony.example.com');
        expect(convertToWsUrl('http://node1.federation.local:3001')).toBe('ws://node1.federation.local:3001');
    });

    // ── Edge Cases / Robustness ──────────────────────────────────────

    it('should handle URL that is already ws:// (no-op effectively)', () => {
        // The function replaces ^http -> ws, so ws:// stays as-is (no match)
        // Actually "http" at the start of "http" matches, and ws already starts with ws
        // Let's verify behavior:
        const result = convertToWsUrl('ws://localhost:3001');
        // 'ws://' doesn't start with 'http', so regex /^http/ won't match — pass-through
        expect(result).toBe('ws://localhost:3001');
    });

    it('should handle URL that is already wss:// (no-op)', () => {
        const result = convertToWsUrl('wss://localhost:3001');
        expect(result).toBe('wss://localhost:3001');
    });

    it('should handle uppercase HTTP', () => {
        // The regex /^http/ is case-sensitive, so HTTP won't match
        const result = convertToWsUrl('HTTP://example.com');
        expect(result).toBe('HTTP://example.com');
    });

    it('should handle URL with auth credentials', () => {
        expect(convertToWsUrl('http://user:pass@example.com:3001')).toBe('ws://user:pass@example.com:3001');
    });

    it('should not corrupt URLs with "http" in the path or hostname', () => {
        // The regex /^http/ only matches at the start, so "http" elsewhere should be safe
        expect(convertToWsUrl('http://httpbin.org')).toBe('ws://httpbin.org');
    });

    it('should handle localhost without port', () => {
        expect(convertToWsUrl('http://localhost')).toBe('ws://localhost');
    });
});

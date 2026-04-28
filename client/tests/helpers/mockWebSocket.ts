/**
 * Shared WebSocket mock for Harmony client tests.
 *
 * Two test files (ChatArea.test.tsx and auth_headers.test.tsx) were each
 * defining their own MockWebSocket class with nearly identical code.
 * This module provides a single implementation and convenience helpers.
 *
 * Usage:
 *   import { installMockWebSocket, getMockWebSocketInstances } from './helpers/mockWebSocket';
 *
 *   beforeEach(() => {
 *     installMockWebSocket();
 *   });
 *
 *   // Later, to simulate a message:
 *   const ws = getMockWebSocketInstances()[0];
 *   ws.onmessage({ data: JSON.stringify({ type: 'NEW_MESSAGE', data: {...} }) });
 */
import { vi } from 'vitest';

/**
 * Lightweight WebSocket mock that captures open/message/close handlers
 * and records send/close calls as vi.fn() spies.
 */
export class MockWebSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    send = vi.fn();
    close = vi.fn();
    readyState = 1; // WebSocket.OPEN

    constructor(_url: string) {
        // Fire onopen asynchronously (matches real WebSocket behavior)
        setTimeout(() => {
            if (this.onopen) this.onopen();
        }, 0);
    }
}

/** The vi.fn() constructor installed as global.WebSocket. */
let mockWebSocketConstructor: ReturnType<typeof vi.fn>;

/**
 * Install the MockWebSocket as global.WebSocket.
 * Call this in beforeEach() to get a fresh constructor per test.
 */
export function installMockWebSocket() {
    mockWebSocketConstructor = vi.fn().mockImplementation(function (this: any, url: string) {
        return new MockWebSocket(url);
    });
    global.WebSocket = mockWebSocketConstructor as any;
    return mockWebSocketConstructor;
}

/**
 * Get all MockWebSocket instances created during the current test.
 * Useful for simulating incoming messages or asserting on send() calls.
 */
export function getMockWebSocketInstances(): MockWebSocket[] {
    if (!mockWebSocketConstructor) return [];
    return mockWebSocketConstructor.mock.instances as MockWebSocket[];
}

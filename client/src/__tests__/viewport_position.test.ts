/**
 * Unit tests for useViewportAwarePosition hook & computePosition utility.
 *
 * These test the pure positioning math (computePosition) to verify that
 * submenus are correctly repositioned when they would overflow the viewport
 * at the top, middle, and bottom of the screen.
 */

import { describe, it, expect } from 'vitest';
import { computePosition, VIEWPORT_MARGIN } from '../hooks/useViewportAwarePosition';

// Helper to build a minimal DOMRect-like object.
function makeRect(top: number, left: number, width: number, height: number) {
    return {
        top,
        left,
        right: left + width,
        bottom: top + height,
        width,
        height,
    };
}

const VIEWPORT_W = 1280;
const VIEWPORT_H = 800;

describe('computePosition — viewport-aware submenu positioning', () => {
    // ─────────────────────────────────────────────
    // Middle of screen — no adjustments needed
    // ─────────────────────────────────────────────
    describe('middle of screen (no overflow)', () => {
        it('returns no overrides when fully visible', () => {
            // Submenu at (400, 300) with 200×250 — well within 1280×800
            const floating = makeRect(300, 400, 200, 250);
            const anchor = { top: 300 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H);

            expect(result.left).toBeUndefined();
            expect(result.right).toBeUndefined();
            expect(result.top).toBeUndefined();
        });

        it('leaves position untouched when submenu fits with margin', () => {
            // Submenu bottom = 300 + 200 = 500; viewport bottom = 800 - 24 = 776 → fits
            const floating = makeRect(300, 500, 200, 200);
            const anchor = { top: 300 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H);

            expect(result).toEqual({});
        });
    });

    // ─────────────────────────────────────────────
    // Bottom of screen — should shift upward
    // ─────────────────────────────────────────────
    describe('bottom of screen (vertical overflow)', () => {
        it('shifts submenu up when it overflows the bottom edge', () => {
            // Anchor near bottom: top=700. Submenu is 200px tall.
            // Submenu bottom = 700 + 200 = 900 > 800 - 24 = 776 → overflow
            const floating = makeRect(700, 400, 200, 200);
            const anchor = { top: 700 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H);

            expect(result.top).toBeDefined();
            // Parse the computed top value
            const topPx = parseFloat(result.top!);
            // The submenu's global top = anchor.top + topPx
            const globalTop = anchor.top + topPx;
            const globalBottom = globalTop + floating.height;

            // Must not exceed the viewport bottom minus margin
            expect(globalBottom).toBeLessThanOrEqual(VIEWPORT_H - VIEWPORT_MARGIN);
            // Must not go above the top margin
            expect(globalTop).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
        });

        it('clamps to top margin when submenu is taller than available space', () => {
            // Submenu is 780px tall (nearly the full viewport).
            // Anchor at top=600. Bottom = 600 + 780 = 1380, way overflowing.
            const floating = makeRect(600, 400, 200, 780);
            const anchor = { top: 600 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H);

            expect(result.top).toBeDefined();
            const topPx = parseFloat(result.top!);
            const globalTop = anchor.top + topPx;

            // Should be clamped to the minimum margin
            expect(globalTop).toBe(VIEWPORT_MARGIN);
        });

        it('positions flush against margin for exact overflow', () => {
            // Submenu height 300, anchor top 500.
            // Bottom = 500 + 300 = 800, viewport limit = 800 - 24 = 776 → just overflows
            const floating = makeRect(500, 400, 200, 300);
            const anchor = { top: 500 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H);

            expect(result.top).toBeDefined();
            const topPx = parseFloat(result.top!);
            const globalTop = anchor.top + topPx;
            const globalBottom = globalTop + floating.height;

            expect(globalBottom).toBe(VIEWPORT_H - VIEWPORT_MARGIN);
        });
    });

    // ─────────────────────────────────────────────
    // Top of screen — should stay within margin
    // ─────────────────────────────────────────────
    describe('top of screen (no upward overflow)', () => {
        it('does not shift when submenu is near top but fits', () => {
            // Submenu at top=30 (above margin of 24, so within bounds), height 200
            // Bottom = 30 + 200 = 230 < 776 → fits fine
            const floating = makeRect(30, 400, 200, 200);
            const anchor = { top: 30 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H);

            expect(result.top).toBeUndefined();
        });

        it('does not produce negative global top when anchor is at very top', () => {
            // Anchor at top=10, submenu 100px tall. Bottom=110 < 776 → no overflow
            const floating = makeRect(10, 400, 200, 100);
            const anchor = { top: 10 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H);

            // No adjustment needed — submenu fits perfectly
            expect(result.top).toBeUndefined();
        });
    });

    // ─────────────────────────────────────────────
    // Right edge — should flip horizontally
    // ─────────────────────────────────────────────
    describe('right edge (horizontal overflow)', () => {
        it('flips to the left when exceeding the right edge', () => {
            // Submenu right edge = 1100 + 200 = 1300 > 1280 - 24 = 1256
            const floating = makeRect(300, 1100, 200, 200);
            const anchor = { top: 300 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H);

            expect(result.left).toBe('auto');
            expect(result.right).toBe('100%');
        });

        it('does not flip when there is enough horizontal space', () => {
            // Right edge = 400 + 200 = 600 < 1256
            const floating = makeRect(300, 400, 200, 200);
            const anchor = { top: 300 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H);

            expect(result.left).toBeUndefined();
            expect(result.right).toBeUndefined();
        });
    });

    // ─────────────────────────────────────────────
    // Corner cases — both axes overflow
    // ─────────────────────────────────────────────
    describe('corner case (both axes overflow)', () => {
        it('flips horizontally AND shifts vertically when in bottom-right corner', () => {
            // Bottom-right corner: anchor at (700, 1100), submenu 200×200
            const floating = makeRect(700, 1100, 200, 200);
            const anchor = { top: 700 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H);

            // Should flip left
            expect(result.left).toBe('auto');
            expect(result.right).toBe('100%');

            // Should shift up
            expect(result.top).toBeDefined();
            const topPx = parseFloat(result.top!);
            const globalTop = anchor.top + topPx;
            const globalBottom = globalTop + floating.height;

            expect(globalBottom).toBeLessThanOrEqual(VIEWPORT_H - VIEWPORT_MARGIN);
            expect(globalTop).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
        });
    });

    // ─────────────────────────────────────────────
    // Custom margin
    // ─────────────────────────────────────────────
    describe('custom margin parameter', () => {
        it('respects a custom margin value', () => {
            const customMargin = 50;
            // Bottom = 700 + 200 = 900 > 800 - 50 = 750 → overflow
            const floating = makeRect(700, 400, 200, 200);
            const anchor = { top: 700 };

            const result = computePosition(floating, anchor, VIEWPORT_W, VIEWPORT_H, customMargin);

            expect(result.top).toBeDefined();
            const topPx = parseFloat(result.top!);
            const globalTop = anchor.top + topPx;
            const globalBottom = globalTop + floating.height;

            expect(globalBottom).toBeLessThanOrEqual(VIEWPORT_H - customMargin);
            expect(globalTop).toBeGreaterThanOrEqual(customMargin);
        });
    });

    // ─────────────────────────────────────────────
    // Default margin constant
    // ─────────────────────────────────────────────
    it('exports VIEWPORT_MARGIN as 24', () => {
        expect(VIEWPORT_MARGIN).toBe(24);
    });
});

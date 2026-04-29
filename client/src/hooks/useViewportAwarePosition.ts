import { useEffect, type RefObject } from 'react';

/** Default viewport margin (px) kept between positioned elements and window edges. */
export const VIEWPORT_MARGIN = 24;

/**
 * Positioning options for the viewport-aware hook.
 */
export interface ViewportPositionOptions {
    /** Whether the positioned element is currently visible / active. */
    active: boolean;
    /** Ref to the positioned (floating) element. */
    floatingRef: RefObject<HTMLElement | null>;
    /** Ref to the anchor element that the floating element is positioned relative to. */
    anchorRef: RefObject<HTMLElement | null>;
    /**
     * Default inline offset applied when resetting position.
     * For submenus this is typically `'100%'` (right of parent).
     */
    defaultLeft?: string;
    /**
     * Default block offset applied when resetting position.
     * For submenus this is typically `'-6px'`.
     */
    defaultTop?: string;
}

/**
 * Reusable hook that keeps a floating element (e.g. a submenu) fully visible
 * within the browser viewport.
 *
 * Features:
 * - Flips horizontally when the element would overflow the right edge.
 * - Shifts vertically so the element stays within `VIEWPORT_MARGIN` of
 *   both the top and bottom edges.
 * - Uses a `ResizeObserver` so position is recalculated automatically when
 *   the floating element's size changes (e.g. async-loaded role lists).
 *
 * All positioning math is exported as `computePosition` for unit-testing
 * without needing a DOM.
 */
export function useViewportAwarePosition(opts: ViewportPositionOptions): void {
    const { active, floatingRef, anchorRef, defaultLeft = '100%', defaultTop = '-6px' } = opts;

    useEffect(() => {
        if (!active || !floatingRef.current || !anchorRef.current) return;

        const floating = floatingRef.current;
        const anchor = anchorRef.current;

        const update = () => {
            const anchorRect = anchor.getBoundingClientRect();

            // Reset to natural position so we get an unbiased bounding rect
            floating.style.top = defaultTop;
            floating.style.bottom = 'auto';
            floating.style.left = defaultLeft;
            floating.style.right = 'auto';

            // Force synchronous layout
            void floating.offsetWidth;

            const rect = floating.getBoundingClientRect();

            const { left, right, top } = computePosition(
                rect,
                anchorRect,
                window.innerWidth,
                window.innerHeight,
            );

            if (left !== undefined) floating.style.left = left;
            if (right !== undefined) floating.style.right = right;
            if (top !== undefined) floating.style.top = top;
        };

        // Initial calculation
        update();

        // Recalculate whenever the floating element resizes (e.g. async content loads)
        const observer = new ResizeObserver(() => update());
        observer.observe(floating);

        return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);
}

/**
 * Pure function that computes the CSS overrides necessary to keep a floating
 * element visible inside the viewport.
 *
 * This is deliberately free of DOM side-effects so it can be unit-tested easily.
 *
 * @param floatingRect  - The bounding rect of the floating element (in viewport coords).
 * @param anchorRect    - The bounding rect of the anchor element (in viewport coords).
 * @param viewportW     - `window.innerWidth`.
 * @param viewportH     - `window.innerHeight`.
 * @param margin        - Minimum gap (px) between the floating element and the viewport edge.
 * @returns An object with optional CSS property overrides to apply.
 */
export function computePosition(
    floatingRect: { top: number; bottom: number; left: number; right: number; height: number; width: number },
    anchorRect:   { top: number },
    viewportW: number,
    viewportH: number,
    margin: number = VIEWPORT_MARGIN,
): { left?: string; right?: string; top?: string } {
    const result: { left?: string; right?: string; top?: string } = {};

    // ── Horizontal ──
    if (floatingRect.right > viewportW - margin) {
        result.left = 'auto';
        result.right = '100%';
    }

    // ── Vertical ──
    if (floatingRect.bottom > viewportH - margin) {
        const targetBottom = viewportH - margin;
        const targetTop = targetBottom - floatingRect.height;
        const finalTop = Math.max(margin, targetTop);
        const relativeTop = finalTop - anchorRect.top;
        result.top = `${relativeTop}px`;
    }

    return result;
}

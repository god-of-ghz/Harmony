import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

(global as any).mockScrollToIndex = vi.fn();

vi.mock('react-virtuoso', () => {
    const React = require('react');
    return {
        Virtuoso: React.forwardRef(({
            // Virtuoso-specific props — destructure to prevent DOM leakage
            data,
            itemContent,
            components,
            startReached,
            firstItemIndex,
            computeItemKey,
            followOutput,
            alignToBottom,
            atBottomThreshold,
            increaseViewportBy,
            initialTopMostItemIndex,
            totalCount,
            overscan,
            defaultItemHeight,
            fixedItemHeight,
            scrollSeekConfiguration,
            rangeChanged,
            isScrolling,
            endReached,
            atBottomStateChange,
            atTopStateChange,
            itemsRendered,
            totalListHeightChanged,
            scrollerRef,
            // Safe HTML-passthrough props
            ...htmlProps
        }: any, ref: any) => {
            const viewportRef = React.useRef(null);
            React.useImperativeHandle(ref, () => ({
                scrollToIndex: (global as any).mockScrollToIndex,
                scrollTo: vi.fn(),
            }));

            return (
                <div 
                    {...htmlProps} 
                    ref={viewportRef}
                    style={{ overflowY: 'auto', ...htmlProps.style }}
                    onScroll={(e: any) => {
                        if (e.target.scrollTop === 0 && startReached) {
                            startReached();
                        }
                        htmlProps.onScroll?.(e);
                    }}
                >
                    {components?.Header && components.Header()}
                    {data?.map((item: any, index: number) => (
                        <div key={index}>{itemContent(index, item)}</div>
                    ))}
                    {components?.Footer && components.Footer()}
                </div>
            );
        }),
        GroupedVirtuoso: () => React.createElement('div', { 'data-testid': 'mock-grouped-virtuoso' })
    };
});

// Global ResizeObserver mock — used by scroll components, ChatArea, etc.
// Must be a proper class (not vi.fn()) so `new ResizeObserver(cb)` works.
global.ResizeObserver = class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(_callback?: ResizeObserverCallback) {}
} as any;

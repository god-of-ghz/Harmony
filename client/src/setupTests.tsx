import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('react-virtuoso', () => {
    const React = require('react');
    return {
        Virtuoso: React.forwardRef(({ data, itemContent, components, startReached, ...props }: any, ref: any) => {
            const viewportRef = React.useRef(null);
            React.useImperativeHandle(ref, () => ({
                scrollToIndex: vi.fn(),
                scrollTo: vi.fn(),
            }));

            return (
                <div 
                    {...props} 
                    ref={viewportRef}
                    style={{ overflowY: 'auto', ...props.style }}
                    onScroll={(e: any) => {
                        if (e.target.scrollTop === 0 && startReached) {
                            startReached();
                        }
                        props.onScroll?.(e);
                    }}
                >
                    {components?.Header && components.Header()}
                    {data.map((item: any, index: number) => (
                        <div key={index}>{itemContent(index, item)}</div>
                    ))}
                    {components?.Footer && components.Footer()}
                </div>
            );
        }),
        GroupedVirtuoso: () => React.createElement('div', { 'data-testid': 'mock-grouped-virtuoso' })
    };
});

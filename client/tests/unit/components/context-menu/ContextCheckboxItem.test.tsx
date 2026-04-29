import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { ContextCheckboxItem } from '../../../../src/components/context-menu/menuBuilders';

describe('ContextCheckboxItem', () => {
    it('renders with label and checked state', () => {
        const onChange = vi.fn();
        render(<ContextCheckboxItem label="Test Toggle" checked={true} onChange={onChange} />);

        expect(screen.getByText('Test Toggle')).toBeInTheDocument();
        // Since it's checked, the SVG polyline should be rendered
        const svg = document.querySelector('svg');
        expect(svg).toBeInTheDocument();
        
        // Also check for the checked class
        const checkboxSpan = document.querySelector('.context-menu-checkbox');
        expect(checkboxSpan).toHaveClass('checked');
    });

    it('renders without checkmark when unchecked', () => {
        const onChange = vi.fn();
        render(<ContextCheckboxItem label="Test Toggle" checked={false} onChange={onChange} />);

        const svg = document.querySelector('svg');
        expect(svg).not.toBeInTheDocument();
        
        const checkboxSpan = document.querySelector('.context-menu-checkbox');
        expect(checkboxSpan).not.toHaveClass('checked');
    });

    it('calls onChange with opposite value when clicked', () => {
        const onChange = vi.fn();
        render(<ContextCheckboxItem label="Test Toggle" checked={false} onChange={onChange} />);

        fireEvent.click(screen.getByText('Test Toggle'));
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('stops event propagation when clicked to keep menu open', () => {
        const onChange = vi.fn();
        const onParentClick = vi.fn();
        
        render(
            <div onClick={onParentClick}>
                <ContextCheckboxItem label="Test Toggle" checked={true} onChange={onChange} />
            </div>
        );

        fireEvent.click(screen.getByText('Test Toggle'));
        expect(onChange).toHaveBeenCalledWith(false);
        expect(onParentClick).not.toHaveBeenCalled();
    });
});

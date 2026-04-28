import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { MessageEmbed, DiscordEmbed } from '../../../src/components/MessageEmbed';

describe('MessageEmbed component', () => {
    it('renders basic embed information', () => {
        const embed: DiscordEmbed = {
            title: 'Test Title',
            description: 'Test Description',
            color: 16711680 // Red (hex FF0000)
        };

        render(<MessageEmbed embed={embed} />);

        expect(screen.getByText('Test Title')).toBeInTheDocument();
        expect(screen.getByText('Test Description')).toBeInTheDocument();
        
        const container = screen.getByText('Test Title').closest('.message-embed');
        expect(container).toHaveStyle({ borderLeft: '4px solid #ff0000' });
    });

    it('renders author and footer', () => {
        const embed: DiscordEmbed = {
            author: {
                name: 'Author Name',
                icon_url: 'http://example.com/icon.png'
            },
            footer: {
                text: 'Footer Text'
            }
        };

        render(<MessageEmbed embed={embed} />);

        expect(screen.getByText('Author Name')).toBeInTheDocument();
        expect(screen.getByText('Footer Text')).toBeInTheDocument();
        expect(screen.getByAltText('author icon')).toHaveAttribute('src', 'http://example.com/icon.png');
    });

    it('renders image if present', () => {
        const embed: DiscordEmbed = {
            image: {
                url: 'http://example.com/image.png'
            }
        };

        render(<MessageEmbed embed={embed} />);

        const img = screen.getByAltText('embed');
        expect(img).toHaveAttribute('src', 'http://example.com/image.png');
    });

    it('handles missing properties gracefully', () => {
        const embed: DiscordEmbed = {};

        const { container } = render(<MessageEmbed embed={embed} />);
        
        // Should still render the container but be mostly empty
        expect(container.querySelector('.message-embed')).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('handles fields correctly', () => {
        const embed: DiscordEmbed = {
            fields: [
                { name: 'Field 1', value: 'Value 1', inline: true },
                { name: 'Field 2', value: 'Value 2' }
            ]
        };

        render(<MessageEmbed embed={embed} />);

        expect(screen.getByText('Field 1')).toBeInTheDocument();
        expect(screen.getByText('Value 1')).toBeInTheDocument();
        expect(screen.getByText('Field 2')).toBeInTheDocument();
        expect(screen.getByText('Value 2')).toBeInTheDocument();
    });

    it('formats string colors correctly', () => {
        const embed: DiscordEmbed = {
            title: 'Color Test',
            color: '#00ff00'
        };

        render(<MessageEmbed embed={embed} />);

        const container = screen.getByText('Color Test').closest('.message-embed');
        expect(container).toHaveStyle({ borderLeft: '4px solid #00ff00' });
    });

    it('renders clickable links in description', () => {
        const embed: DiscordEmbed = {
            description: 'Go to https://google.com for more info'
        };

        render(<MessageEmbed embed={embed} />);

        const link = screen.getByRole('link', { name: 'https://google.com' });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'https://google.com');
    });

    it('renders clickable links in field values', () => {
        const embed: DiscordEmbed = {
            fields: [
                { name: 'Documentation', value: 'See https://docs.example.com' }
            ]
        };

        render(<MessageEmbed embed={embed} />);

        const link = screen.getByRole('link', { name: 'https://docs.example.com' });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'https://docs.example.com');
    });
});

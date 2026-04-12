import React from 'react';
import { useAppStore } from '../store/appStore';
import { parseLinks } from '../utils/linkParser';

export interface DiscordEmbed {
    title?: string;
    description?: string;
    url?: string;
    timestamp?: string;
    color?: number | string;
    footer?: { text: string; icon_url?: string };
    image?: { url: string };
    thumbnail?: { url: string };
    author?: { name: string; url?: string; icon_url?: string };
    fields?: { name: string; value: string; inline?: boolean }[];
}

interface MessageEmbedProps {
    embed: DiscordEmbed;
}

const formatColor = (color: number | string | undefined): string => {
    if (!color) return 'var(--background-tertiary, #2f3136)';
    if (typeof color === 'string') {
        if (color.startsWith('#')) return color;
        const num = parseInt(color);
        if (!isNaN(num)) color = num;
        else return color;
    }
    if (typeof color === 'number') {
        return `#${color.toString(16).padStart(6, '0')}`;
    }
    return 'var(--background-tertiary, #2f3136)';
};

export const MessageEmbed: React.FC<MessageEmbedProps> = ({ embed }) => {
    const borderColor = formatColor(embed.color);

    return (
        <div className="message-embed" style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            backgroundColor: 'var(--background-secondary, #2f3136)',
            borderRadius: '4px',
            borderLeft: `4px solid ${borderColor}`,
            padding: '8px 12px',
            marginTop: '8px',
            maxWidth: '520px',
            fontSize: 'max(0.875rem, 14px)',
        }}>
            <div style={{ gridColumn: '2' }}>
                {embed.author && (
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        marginBottom: '8px' 
                    }}>
                        {embed.author.icon_url && (
                            <img src={embed.author.icon_url} alt="author icon" style={{ 
                                width: '24px', 
                                height: '24px', 
                                borderRadius: '50%' 
                            }} />
                        )}
                        {embed.author.url ? (
                            <a href={embed.author.url} target="_blank" rel="noreferrer" style={{ 
                                fontWeight: 600, 
                                color: 'var(--interactive-active, #fff)',
                                textDecoration: 'none'
                            }}>
                                {embed.author.name}
                            </a>
                        ) : (
                            <span style={{ fontWeight: 600, color: 'var(--interactive-active, #fff)' }}>
                                {embed.author.name}
                            </span>
                        )}
                    </div>
                )}

                {embed.title && (
                    <div style={{ marginBottom: '4px' }}>
                        {embed.url ? (
                            <a href={embed.url} target="_blank" rel="noreferrer" style={{ 
                                fontWeight: 600, 
                                color: 'var(--text-link, #00aff4)',
                                fontSize: '1rem',
                                textDecoration: 'none'
                            }}>
                                {embed.title}
                            </a>
                        ) : (
                            <span style={{ 
                                fontWeight: 600, 
                                color: 'var(--header-primary, #fff)',
                                fontSize: '1rem' 
                            }}>
                                {embed.title}
                            </span>
                        )}
                    </div>
                )}

                {embed.description && (
                    <div style={{ 
                        color: 'var(--text-normal, #dcddde)',
                        whiteSpace: 'pre-wrap',
                        lineHeight: '1.375rem',
                        marginTop: '4px'
                    }}>
                        {parseLinks(embed.description)}
                    </div>
                )}

                {embed.fields && embed.fields.length > 0 && (
                    <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                        gap: '8px',
                        marginTop: '8px'
                    }}>
                        {embed.fields.map((field, i) => (
                            <div key={i} style={{ gridColumn: field.inline ? 'auto' : '1 / -1' }}>
                                <div style={{ 
                                    fontWeight: 600, 
                                    color: 'var(--header-primary, #fff)',
                                    marginBottom: '2px'
                                }}>
                                    {field.name}
                                </div>
                                <div style={{ 
                                    color: 'var(--text-normal, #dcddde)',
                                    whiteSpace: 'pre-wrap'
                                }}>
                                    {parseLinks(field.value)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {embed.image && embed.image.url && (
                    <div style={{ marginTop: '16px' }}>
                        <img src={embed.image.url} alt="embed" style={{ 
                            maxWidth: '100%', 
                            maxHeight: '400px', 
                            borderRadius: '4px',
                            cursor: 'zoom-in'
                        }} onClick={() => {
                            if (embed.image?.url) useAppStore.getState().setZoomedImageUrl(embed.image.url);
                        }} />
                    </div>
                )}

                {embed.footer && (
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        marginTop: '8px',
                        fontSize: '12px',
                        color: 'var(--text-muted, #96989d)'
                    }}>
                        {embed.footer.icon_url && (
                            <img src={embed.footer.icon_url} alt="footer icon" style={{ 
                                width: '20px', 
                                height: '20px', 
                                borderRadius: '50%' 
                            }} />
                        )}
                        <span>{embed.footer.text}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

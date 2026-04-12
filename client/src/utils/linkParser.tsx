import type { ReactNode } from 'react';
import { useAppStore } from '../store/appStore';

/**
 * Robust URL regex that excludes trailing punctuation.
 * Matches http:// and https:// links.
 */
const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s!?])/g;

/**
 * Parses a string and wraps any detected URLs in <a> tags.
 * 
 * @param content The text content to parse.
 * @returns An array of React nodes (strings and <a> elements).
 */
export function parseLinks(content: string): ReactNode[] {
    if (!content) return [];
    
    const results: ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = URL_REGEX.exec(content)) !== null) {
        const url = match[0];

        // Push text before the match
        if (match.index > lastIndex) {
            results.push(content.substring(lastIndex, match.index));
        }

        const harmonyMatch = url.match(/#\/server\/([^\/]+)\/channels\/([^\/]+)\/messages\/([^\/]+)/);
        
        if (harmonyMatch) {
            const { activeChannelId, activeChannelName } = useAppStore.getState();
            const targetServer = harmonyMatch[1];
            const targetChannel = harmonyMatch[2];
            const targetMessage = harmonyMatch[3];
            
            let channelText = 'message';
            if (targetChannel === activeChannelId && activeChannelName) {
                channelText = activeChannelName;
            }

            results.push(
                <span
                    key={`link-${url}-${match.index}`}
                    className="chat-link internal-link"
                    title={url}
                    style={{ 
                        cursor: 'pointer', 
                        backgroundColor: 'var(--brand-experiment)', 
                        padding: '2px 6px', 
                        borderRadius: '3px', 
                        fontSize: '14px', 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        textDecoration: 'none', 
                        color: '#ffffff', 
                        fontWeight: 600,
                        lineHeight: '18px',
                        verticalAlign: 'bottom',
                        marginBottom: '-2px'
                    }}
                    onClick={(e) => {
                        e.preventDefault();
                        window.dispatchEvent(new CustomEvent('harmony-jump', {
                            detail: { serverId: targetServer, channelId: targetChannel, messageId: targetMessage }
                        }));
                    }}
                >
                    <span style={{ opacity: 0.7, marginRight: '2px', fontWeight: 'normal' }}>#</span>
                    <span>{channelText}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, margin: '0 4px' }}>
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" />
                    </svg>
                </span>
            );
        } else {
            results.push(
                <a
                    key={`link-${url}-${match.index}`}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chat-link"
                >
                    {url}
                </a>
            );
        }

        lastIndex = URL_REGEX.lastIndex;
    }

    // Push remaining text
    if (lastIndex < content.length) {
        results.push(content.substring(lastIndex));
    }

    return results;
}

/**
 * Processes an array of ReactNodes and parses links within any string nodes.
 * Useful for chaining with other parsers (like the emoji parser).
 * 
 * @param nodes The array of React nodes to process.
 * @returns A flattened array of React nodes with links parsed.
 */
export function parseLinksInNodes(nodes: ReactNode[]): ReactNode[] {
    const results: ReactNode[] = [];
    
    nodes.forEach((node) => {
        if (typeof node === 'string') {
            const parsed = parseLinks(node);
            results.push(...parsed);
        } else {
            results.push(node);
        }
    });

    return results;
}

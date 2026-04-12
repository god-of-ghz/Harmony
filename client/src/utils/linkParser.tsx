import type { ReactNode } from 'react';

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

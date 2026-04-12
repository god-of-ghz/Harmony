import type { ReactNode } from 'react';
import type { EmojiData } from '../store/appStore';

/**
 * Parses Discord-style custom emoji shortcodes (<:name:id> or <a:name:id>)
 * and replaces them with <img> tags if the emoji is found in the provided array.
 * 
 * @param content The raw message content string.
 * @param emojis The list of available custom emojis for the current server.
 * @returns An array of React nodes (strings and <img> elements).
 */
export function parseCustomEmojis(content: string, emojis: EmojiData[]): ReactNode[] {
    if (!content) return [];
    
    // Discord emoji regex: <:name:id> or <a:name:id>
    const emojiRegex = /<(a?):(\w+):(\d+)>/g;
    const results: ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = emojiRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const name = match[2];
        const id = match[3];

        // Push text before the match
        if (match.index > lastIndex) {
            results.push(content.substring(lastIndex, match.index));
        }

        // Try to find the emoji in our cache
        const emoji = emojis.find(e => e.id === id);

        if (emoji) {
            results.push(
                <img
                    key={`emoji-${id}-${match.index}`}
                    src={emoji.url}
                    alt={name}
                    title={`:${name}:`}
                    className="inline-emoji"
                    loading="lazy"
                />
            );
        } else {
            // Fallback: just render the shortcode if not found in our cache
            results.push(fullMatch);
        }

        lastIndex = emojiRegex.lastIndex;
    }

    // Push remaining text
    if (lastIndex < content.length) {
        results.push(content.substring(lastIndex));
    }

    return results;
}

import React, { useMemo } from 'react';
import Markdown from 'markdown-to-jsx';
import { Spoiler } from './Spoiler';
import { Mention } from './Mention';
import { RoleMention } from './RoleMention';
import { CustomEmoji } from './CustomEmoji';
import { InternalLink } from './InternalLink';

interface MessageMarkdownProps {
    content: string;
}

export const MessageMarkdown: React.FC<MessageMarkdownProps> = ({ content }) => {
    const processedContent = useMemo(() => {
        if (!content) return '';

        // 0. Discord doesn't support Setext headings (e.g. Text \n ---). 
        // markdown-to-jsx will turn large blocks of text into massive headers if a line 
        // of dashes follows them. We escape lines of dashes/equals to prevent this.
        let safeText = content.replace(/^([=-]{2,})\s*$/gm, '\\$1');

        // 1. Preserve newlines: Discord treats every \n as a visible line break,
        // but standard Markdown ignores single newlines. Convert each \n to a
        // Markdown hard break (two trailing spaces + newline) so markdown-to-jsx
        // emits <br/> for them. We do this before HTML escaping since we're
        // operating on raw content structure.
        safeText = safeText.replace(/\n/g, '  \n');

        // 1. Escape HTML to prevent XSS. 
        // We replace < so that any user-typed HTML is rendered as text.
        // We don't escape > because markdown-to-jsx uses it for blockquotes.
        safeText = safeText.replace(/</g, '&lt;');

        // 2. Inject our custom XML tags for specific Harmony features.
        // markdown-to-jsx will recognize these tags and render our custom components.
        
        // Spoilers: ||text|| -> <Spoiler>text</Spoiler>
        safeText = safeText.replace(/\|\|([\s\S]+?)\|\|/g, '<Spoiler>$1</Spoiler>');

        // Role Mentions: <@&id> -> <RoleMention id="id"/>
        safeText = safeText.replace(/&lt;@&([^>]+)>/g, '<RoleMention id="$1"/>');

        // User Mentions: <@id> -> <Mention id="id"/>
        // Note: Because we escaped <, we look for &lt; and >
        safeText = safeText.replace(/&lt;@!?([^>]+)>/g, '<Mention id="$1"/>');

        // Custom Emojis: <:name:id> or <a:name:id> -> <CustomEmoji animated="a" name="name" id="id"/>
        safeText = safeText.replace(/&lt;(a?):(\w+):(\d+)>/g, '<CustomEmoji animated="$1" name="$2" id="$3"/>');

        // Internal Links: #/server/... -> <InternalLink serverId="..." channelId="..." messageId="..."/>
        safeText = safeText.replace(/(?:https?:\/\/[^\s]+)?#\/server\/([^\/]+)\/channels\/([^\/]+)\/messages\/([^\/\s&]+)/g, '<InternalLink serverId="$1" channelId="$2" messageId="$3"/>');

        return safeText;
    }, [content]);

    const isEmojiOnly = useMemo(() => {
        if (!content) return false;
        // Check if the original content consists ONLY of unicode emojis, custom emojis, and whitespace.
        // We include ZWJ (\u200d), variation selectors (\ufe0f), and keycap modifiers (\u20e3).
        const emojiRegex = /^(?:[\s\u200d\ufe0f\u20e3]|<a?:\w+:\d+>|\p{Emoji_Presentation}|\p{Extended_Pictographic})+$/u;
        return content.trim().length > 0 && emojiRegex.test(content);
    }, [content]);

    return (
        <div className={isEmojiOnly ? "emoji-only-message" : ""}>
            <Markdown
            options={{
                overrides: {
                    Spoiler: { component: Spoiler },
                    Mention: { component: Mention },
                    RoleMention: { component: RoleMention },
                    CustomEmoji: { component: CustomEmoji },
                    InternalLink: { component: InternalLink },
                    // Force external links to open in a new tab
                    a: {
                        component: (props: any) => (
                            <a {...props} target="_blank" rel="noopener noreferrer" className="chat-link" />
                        )
                    }
                },
                // markdown-to-jsx configuration to prevent block-level wrappers if unnecessary
                forceBlock: true,
                wrapper: React.Fragment,
            }}
        >
            {processedContent}
        </Markdown>
        </div>
    );
};

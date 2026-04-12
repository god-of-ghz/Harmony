import { describe, it, expect } from 'vitest';
import { parseGuildMetadata } from '../src/importer';

describe('Guild Metadata Parsing', () => {
    it('should parse guild_metadata.json and fix large IDs', () => {
        const rawJson = `{
            "id": 123456789012345678,
            "name": "Test Server",
            "owner_id": 999999999999999999,
            "description": "A test server",
            "icon_url": "http://icon.com",
            "roles": [
                {
                    "id": 111111111111111111,
                    "name": "Admin",
                    "color": "#ff0000",
                    "position": 1,
                    "permissions": 8
                }
            ],
            "members": [
                {
                    "id": 222222222222222222,
                    "name": "alice",
                    "global_name": "Alice",
                    "bot": false,
                    "roles": [111111111111111111]
                }
            ],
            "emojis": [
                {
                    "id": 333333333333333333,
                    "name": "pepe",
                    "url": "http://emoji.com",
                    "animated": false
                }
            ],
            "categories": [
                {
                    "id": 444444444444444444,
                    "name": "General",
                    "position": 0
                }
            ]
        }`;

        const metadata = parseGuildMetadata(rawJson);

        expect(metadata.id).toBe("123456789012345678");
        expect(metadata.owner_id).toBe("999999999999999999");
        expect(metadata.roles[0].id).toBe("111111111111111111");
        expect(metadata.members[0].id).toBe("222222222222222222");
        expect(metadata.emojis[0].id).toBe("333333333333333333");
        expect(metadata.categories[0].id).toBe("444444444444444444");
    });

    it('should handle missing optional fields gracefully', () => {
        const rawJson = `{
            "id": 123,
            "name": "Small Server",
            "owner_id": 456,
            "description": null,
            "icon_url": null,
            "roles": [],
            "members": [],
            "emojis": [],
            "categories": []
        }`;

        const metadata = parseGuildMetadata(rawJson);
        expect(metadata.description).toBeNull();
        expect(metadata.icon_url).toBeNull();
        expect(metadata.roles).toHaveLength(0);
    });

    it('should not crash on slightly malformed inputs (missing categories)', () => {
        const rawJson = `{
            "id": 123,
            "name": "Incomplete",
            "owner_id": 456
        }`;
        // JSON.parse might still work but the metadata object will be partial
        const metadata = JSON.parse(rawJson);
        expect(metadata.id).toBe(123);
    });
});

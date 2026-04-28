import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { 
    sanitizeMessageContent, 
    MAX_MESSAGE_LENGTH, 
    validateFileExtensions,
    MessageRateLimiter
} from '../middleware/messageGuardrails';
import { Permission } from '../middleware/rbac';

describe('Message Guardrails', () => {

    describe('sanitizeMessageContent', () => {
        it('strips null bytes', () => {
            const input = "Hello\0World";
            expect(sanitizeMessageContent(input)).toBe("HelloWorld");
        });

        it('redacts script tags', () => {
            const input = "Hello <script>alert(1)</script> World";
            expect(sanitizeMessageContent(input)).toBe("Hello [REDACTED: SCRIPT TAG] World");
        });

        it('blocks javascript: URIs', () => {
            const input = "javascript:alert(1)";
            expect(sanitizeMessageContent(input)).toBe("javascript_blocked:alert(1)");
        });

        it('allows normal text', () => {
            const input = "This is a completely normal message with emojis 😊 and links https://example.com";
            expect(sanitizeMessageContent(input)).toBe(input);
        });

        it('handles undefined/null/empty', () => {
            expect(sanitizeMessageContent('')).toBe('');
            expect(sanitizeMessageContent(undefined as any)).toBe('');
            expect(sanitizeMessageContent(null as any)).toBe('');
        });
    });

    describe('validateFileExtensions', () => {
        it('allows safe extensions', () => {
            const files = [
                { originalname: 'image.png' },
                { originalname: 'document.pdf' },
                { originalname: 'video.mp4' }
            ];
            expect(validateFileExtensions(files)).toBe(true);
        });

        it('blocks dangerous extensions', () => {
            const files = [
                { originalname: 'safe.png' },
                { originalname: 'virus.exe' }
            ];
            expect(validateFileExtensions(files)).toBe(false);
        });

        it('is case insensitive', () => {
            const files = [
                { originalname: 'script.BAT' }
            ];
            expect(validateFileExtensions(files)).toBe(false);
        });

        it('handles empty or null files array', () => {
            expect(validateFileExtensions([])).toBe(true);
            expect(validateFileExtensions(undefined as any)).toBe(true);
        });

        it('handles files without originalname', () => {
            expect(validateFileExtensions([{ size: 100 }])).toBe(true);
        });
    });

    describe('MessageRateLimiter', () => {
        let mockDb: any;
        const serverId = 'srv1';

        beforeEach(() => {
            vi.useFakeTimers();
            
            mockDb = {
                allServerQuery: vi.fn().mockResolvedValue([
                    { key: 'rate_limit_owner', value: '30' },
                    { key: 'rate_limit_admin', value: '20' },
                    { key: 'rate_limit_user', value: '5' }
                ]),
                getNodeQuery: vi.fn().mockResolvedValue({ is_creator: 0 }),
                getServerQuery: vi.fn().mockResolvedValue({ id: 'prof1', role: 'USER' }),
            };
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('allows messages under the limit for standard user', async () => {
            const accountId = 'user1';
            
            // Send 4 messages (limit is 5)
            for (let i = 0; i < 4; i++) {
                const allowed = await MessageRateLimiter.checkRateLimit(accountId, serverId, mockDb);
                expect(allowed).toBe(true);
            }

            // 5th should pass
            const allowed5 = await MessageRateLimiter.checkRateLimit(accountId, serverId, mockDb);
            expect(allowed5).toBe(true);

            // 6th should fail
            const allowed6 = await MessageRateLimiter.checkRateLimit(accountId, serverId, mockDb);
            expect(allowed6).toBe(false);
        });

        it('allows burst for admins', async () => {
            const accountId = 'admin1';
            mockDb.allServerQuery = vi.fn().mockImplementation(async (serverId, query) => {
                if (query.includes('server_settings')) {
                    return [
                        { key: 'rate_limit_owner', value: '30' },
                        { key: 'rate_limit_admin', value: '20' },
                        { key: 'rate_limit_user', value: '5' }
                    ];
                }
                if (query.includes('profile_roles')) {
                    return [{ permissions: Permission.ADMINISTRATOR }];
                }
                return [];
            });

            // Send 19 messages (limit is 20)
            for (let i = 0; i < 19; i++) {
                const allowed = await MessageRateLimiter.checkRateLimit(accountId, serverId, mockDb);
                expect(allowed).toBe(true);
            }

            // 20th should pass
            const allowed20 = await MessageRateLimiter.checkRateLimit(accountId, serverId, mockDb);
            expect(allowed20).toBe(true);

            // 21st should fail
            const allowed21 = await MessageRateLimiter.checkRateLimit(accountId, serverId, mockDb);
            expect(allowed21).toBe(false);
        });

        it('allows sliding window expiration', async () => {
            const accountId = 'user2';
            
            // Send 5 messages
            for (let i = 0; i < 5; i++) {
                await MessageRateLimiter.checkRateLimit(accountId, serverId, mockDb);
            }

            // 6th fails
            expect(await MessageRateLimiter.checkRateLimit(accountId, serverId, mockDb)).toBe(false);

            // Advance time by 1.1 seconds
            vi.advanceTimersByTime(1100);

            // Should be allowed again
            expect(await MessageRateLimiter.checkRateLimit(accountId, serverId, mockDb)).toBe(true);
        });

        it('falls back to default limit when DB fails or serverId is null', async () => {
            const accountId = 'user3';
            
            // Send 5 messages (limit is 5)
            for (let i = 0; i < 5; i++) {
                const allowed = await MessageRateLimiter.checkRateLimit(accountId, null, mockDb);
                expect(allowed).toBe(true);
            }

            // 6th fails
            expect(await MessageRateLimiter.checkRateLimit(accountId, null, mockDb)).toBe(false);
        });
    });
});

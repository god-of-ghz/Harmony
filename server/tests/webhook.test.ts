import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchSecurityAlert } from '../src/utils/webhook';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Webhook Utility', () => {
    let originalEnvUrl: string | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        originalEnvUrl = process.env.ADMIN_WEBHOOK_URL;
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2023-10-01T00:00:00.000Z'));
    });

    afterEach(() => {
        process.env.ADMIN_WEBHOOK_URL = originalEnvUrl;
        vi.useRealTimers();
    });

    it('dispatchSecurityAlert logs to console format always', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.ADMIN_WEBHOOK_URL; // ensures no fetch

        await dispatchSecurityAlert('BRUTE_FORCE', 'Multiple failed logins', '1.1.1.1');

        expect(consoleSpy).toHaveBeenCalledWith('[SECURITY] BRUTE_FORCE IP: 1.1.1.1 - Multiple failed logins');
        consoleSpy.mockRestore();
    });

    it('dispatchSecurityAlert skips fetch when ADMIN_WEBHOOK_URL is not set', async () => {
        delete process.env.ADMIN_WEBHOOK_URL;

        await dispatchSecurityAlert('TEST', 'Msg', '1.2.3.4');

        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('dispatchSecurityAlert sends correct payload structure when URL is set', async () => {
        process.env.ADMIN_WEBHOOK_URL = 'http://webhook.url';
        mockFetch.mockResolvedValueOnce({ ok: true });

        await dispatchSecurityAlert('ALERT_TYPE', 'Something happened', '2.2.2.2');

        expect(mockFetch).toHaveBeenCalledWith('http://webhook.url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                embeds: [{
                    title: `Security Alert: ALERT_TYPE`,
                    description: 'Something happened',
                    color: 0xff0000,
                    fields: [
                        { name: "IP Address", value: '2.2.2.2', inline: true },
                        { name: "Timestamp", value: '2023-10-01T00:00:00.000Z', inline: true }
                    ]
                }]
            })
        });
    });

    it('dispatchSecurityAlert catches and logs fetch errors gracefully', async () => {
        process.env.ADMIN_WEBHOOK_URL = 'http://webhook.url';
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        await dispatchSecurityAlert('TEST', 'Msg', '1.2.3.4');

        expect(consoleSpy).toHaveBeenCalledWith('Failed to dispatch security webhook:', expect.any(Error));
        consoleSpy.mockRestore();
    });
});

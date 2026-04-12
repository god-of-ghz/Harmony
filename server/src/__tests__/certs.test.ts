import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getOrGenerateCerts } from '../certs';
import selfsigned from 'selfsigned';

vi.mock('fs');
vi.mock('selfsigned');

describe('certs module', () => {
    const mockCwd = '/test-dir';
    const originalCwd = process.cwd;

    beforeEach(() => {
        process.cwd = () => mockCwd;
        vi.resetAllMocks();
    });

    afterEach(() => {
        process.cwd = originalCwd;
    });

    it('should read existing certificates if they exist', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation((p) => {
            if (p.toString().endsWith('key.pem')) return Buffer.from('existing_key');
            if (p.toString().endsWith('cert.pem')) return Buffer.from('existing_cert');
            return Buffer.from('');
        });

        const certs = await getOrGenerateCerts();
        expect(certs).not.toBeNull();
        expect(certs?.key.toString()).toBe('existing_key');
        expect(certs?.cert.toString()).toBe('existing_cert');
        expect(selfsigned.generate).not.toHaveBeenCalled();
    });

    it('should generate and write new certificates if they do not exist', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(selfsigned.generate).mockResolvedValue({
            private: 'new_key',
            cert: 'new_cert',
            public: 'new_pub'
        } as any);

        const certs = await getOrGenerateCerts();
        
        expect(selfsigned.generate).toHaveBeenCalled();
        expect(fs.writeFileSync).toHaveBeenCalledWith(path.join(mockCwd, 'key.pem'), 'new_key');
        expect(fs.writeFileSync).toHaveBeenCalledWith(path.join(mockCwd, 'cert.pem'), 'new_cert');
        
        expect(certs).not.toBeNull();
        expect(certs?.key.toString()).toBe('new_key');
        expect(certs?.cert.toString()).toBe('new_cert');
    });

    it('should return null if generation fails', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(selfsigned.generate).mockRejectedValue(new Error('generation failed'));

        const certs = await getOrGenerateCerts();
        expect(certs).toBeNull();
    });
});

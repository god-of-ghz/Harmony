/**
 * Shared mock database manager for Harmony server tests.
 *
 * Three test files (app.test.ts, federation_fixes.test.ts, security.test.ts)
 * each define nearly identical mock database objects with 10+ vi.fn() methods.
 * This module provides a single factory.
 *
 * NOTE ON vi.hoisted():
 *   If your test uses vi.hoisted() to define the mock (needed when the mock
 *   variable is referenced in a vi.mock() factory), you CANNOT import this
 *   helper inside vi.hoisted() because imports haven't resolved yet.
 *
 *   Pattern A — For tests that define the mock INLINE in vi.mock() factory
 *   (like security.test.ts), you can use this helper freely:
 *
 *     import { createMockDbManager, MOCK_DB_EXPORTS } from './helpers/mockDatabase';
 *     const mockDb = createMockDbManager();
 *     vi.mock('../src/database', () => ({ ...MOCK_DB_EXPORTS, default: mockDb }));
 *
 *   Pattern B — For tests that use vi.hoisted() (like app.test.ts), continue
 *   using the inline definition but reference this file as the canonical shape.
 *   New tests should prefer Pattern A when possible.
 */
import { vi } from 'vitest';

/**
 * Creates a fresh mock DB manager with all methods as vi.fn() spies.
 * Each call returns a new set of spies (safe for per-test isolation).
 */
export function createMockDbManager() {
    return {
        channelToServerId: {
            get: (id: any) => String(id).includes('Unknown') ? null : 'sv1',
            set: () => {},
            delete: () => {},
        },
        allNodeQuery: vi.fn(),
        getNodeQuery: vi.fn(),
        runNodeQuery: vi.fn(),
        allServerQuery: vi.fn().mockResolvedValue([]),
        getServerQuery: vi.fn(),
        runServerQuery: vi.fn(),
        getAllLoadedServers: vi.fn().mockResolvedValue([{ id: 'sv1' }]),
        initializeServerBundle: vi.fn(),
        unloadServerInstance: vi.fn(),
    };
}

/**
 * Standard named exports for the database module mock.
 * Spread this into your vi.mock factory alongside the default export.
 *
 *   vi.mock('../src/database', () => ({
 *       ...MOCK_DB_EXPORTS,
 *       default: mockDbManager,
 *   }));
 */
export const MOCK_DB_EXPORTS = {
    SERVERS_DIR: 'mock_servers_dir',
    DATA_DIR: 'mock_data_dir',
    nodeDbPath: 'mock_data_dir/node.db',
};

/* eslint-disable react-hooks/rules-of-hooks, @typescript-eslint/no-explicit-any, no-empty-pattern */
import { test as base } from '@playwright/test';
import { LoginPage } from '../models/LoginPage';
import { ProfilePage } from '../models/ProfilePage';
import { ChatPage } from '../models/ChatPage';
import { SettingsPage } from '../models/SettingsPage';
import crypto from 'crypto';

export const SERVER_URL = process.env.HARMONY_SERVER_URL ?? 'https://localhost:3001';
export const TEST_PASS = 'E2eTestPass!42';

const RUN_ID = process.env.E2E_DEBUG_RUN_ID || Date.now().toString(36);

/**
 * Deterministically generates credentials based on the test name.
 * Provides consistency for debugging while maintaining a distributed
 * set of accounts across the entire test suite.
 */
export function getTestAccount(testName: string, suffix = '') {
  const hash = crypto.createHash('md5').update(testName + suffix).digest('hex').substring(0, 6);
  return {
    email: `test_${hash}_${RUN_ID}@e2e.local`,
    nickname: `User_${hash}`,
    password: TEST_PASS
  };
}

type MyFixtures = {
  loginPage: LoginPage;
  profilePage: ProfilePage;
  chatPage: ChatPage;
  settingsPage: SettingsPage;
  testAccount: ReturnType<typeof getTestAccount>;
};

export const test = base.extend<MyFixtures>({
  loginPage: async ({ page }, use) => {
    // Navigate and reset client state before each test
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      const dbs = window.indexedDB.databases ? window.indexedDB.databases() : Promise.resolve([]);
      return dbs.then((list: any[]) => list.forEach((db: any) => window.indexedDB.deleteDatabase(db.name)));
    });
    await page.reload();
    await page.waitForSelector('#email', { timeout: 10_000 });
    
    await use(new LoginPage(page));
  },
  profilePage: async ({ page }, use) => {
    await use(new ProfilePage(page));
  },
  chatPage: async ({ page }, use) => {
    await use(new ChatPage(page));
  },
  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
  testAccount: async ({}, use, testInfo) => {
    // Provide a deterministic account base for the running test
    await use(getTestAccount(testInfo.title));
  }
});

export { expect } from '@playwright/test';

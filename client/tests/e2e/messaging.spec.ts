import { test, expect, SERVER_URL } from './fixtures/harmony';

// We perform an initial setup before tests if needed, or just let each test setup.
// Since these are messaging tests, having a fresh user every time ensures isolated state.

test.describe.serial('Messaging & Chat Area', () => {
  test('should display channel sidebar and #general channel header', async ({ loginPage, profilePage, chatPage, testAccount }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await profilePage.claimFreshProfile(testAccount.nickname);

    await chatPage.waitForLoad();
    await chatPage.verifyChannelActive('general');
  });

  test('should display the message input with correct placeholder', async ({ loginPage, profilePage, chatPage, testAccount }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await profilePage.claimFreshProfile(testAccount.nickname);

    await chatPage.waitForLoad();
    await expect(chatPage.messageInput).toBeVisible({ timeout: 10_000 });
    const placeholder = await chatPage.messageInput.getAttribute('placeholder');
    expect(placeholder).toContain('general');
  });

  test('should send a message and see it appear in chat', async ({ loginPage, profilePage, chatPage, testAccount, page }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await profilePage.claimFreshProfile(testAccount.nickname);
    await chatPage.waitForLoad();

    const testMessage = `Hello from Messaging E2E ${testAccount.nickname}`;
    await chatPage.sendMessage(testMessage);

    await chatPage.verifyMessageVisible(testMessage);
    await expect(page.getByText(testAccount.nickname).first()).toBeVisible({ timeout: 10_000 });
  });

  test('should send multiple messages and display them in order', async ({ loginPage, profilePage, chatPage, testAccount }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await profilePage.claimFreshProfile(testAccount.nickname);
    await chatPage.waitForLoad();

    for (let i = 1; i <= 3; i++) {
        await chatPage.sendMessage(`Seq #${i} ${testAccount.nickname}`);
        await chatPage.page.waitForTimeout(600);
    }

    for (let i = 1; i <= 3; i++) {
        await chatPage.verifyMessageVisible(`Seq #${i} ${testAccount.nickname}`);
    }
  });

  test('should display message timestamps', async ({ loginPage, profilePage, chatPage, testAccount, page }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await profilePage.claimFreshProfile(testAccount.nickname);
    await chatPage.waitForLoad();

    await chatPage.sendMessage(`Timestamp test ${testAccount.nickname}`);
    await chatPage.verifyMessageVisible(`Timestamp test ${testAccount.nickname}`);

    // The day separator renders toDateString() format (e.g. "Sun Apr 12 2026")
    const today = new Date();
    const dateStr = today.toDateString(); // e.g. "Sun Apr 12 2026"
    await expect(page.getByText(dateStr)).toBeVisible({ timeout: 5_000 });
  });

  test('should display the mock server icon in the sidebar', async ({ loginPage, testAccount, page }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    // After login, give it a moment for the sidebar to load the joined servers
    await page.waitForTimeout(3000);
    // The "Harmony Mock Server" abbreviated to "HA"
    await expect(page.getByText('HA').first()).toBeVisible({ timeout: 10_000 });
  });

  test('should upload a .png file and verify rich rendering in chat', async ({ loginPage, profilePage, chatPage, testAccount }) => {
    await loginPage.signup(testAccount.email, testAccount.password, SERVER_URL);
    await profilePage.claimFreshProfile(testAccount.nickname);
    await chatPage.waitForLoad();

    const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    
    await chatPage.uploadAttachment('e2e-test-img.png', buffer, 'image/png');
    await chatPage.sendMessage('Check out this picture!');

    await expect(chatPage.chatImage.first()).toBeVisible({ timeout: 15_000 });

    const src = await chatPage.chatImage.first().getAttribute('src');
    expect(src).toMatch(/\/uploads\/[^/]+\/.*e2e-test-img\.png/);
  });
});

import { expect, type Locator, type Page } from '@playwright/test';

export class ProfilePage {
  readonly page: Page;
  readonly joinServerHeading: Locator;
  readonly freshStartButton: Locator;
  readonly claimExistingButton: Locator;
  readonly nicknameInput: Locator;
  readonly formSubmitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.joinServerHeading = page.getByRole('heading', { name: 'Join Server' });
    this.freshStartButton = page.getByRole('button', { name: 'Fresh Start' });
    this.claimExistingButton = page.getByRole('button', { name: 'Claim Existing' });
    this.nicknameInput = page.locator('form input[type="text"]');
    this.formSubmitButton = page.locator('form button[type="submit"]');
  }

  async waitForJoinScreen() {
    await expect(this.joinServerHeading).toBeVisible({ timeout: 15_000 });
  }

  async claimFreshProfile(nickname: string) {
    await this.waitForJoinScreen();
    await this.freshStartButton.click();
    await this.page.waitForTimeout(300);

    await expect(this.nicknameInput).toBeVisible({ timeout: 5_000 });
    await this.nicknameInput.fill(nickname);

    await this.formSubmitButton.click();
  }
}

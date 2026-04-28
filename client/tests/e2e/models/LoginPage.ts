import { expect, type Locator, type Page } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly serverUrlInput: Locator;
  readonly loginButton: Locator;
  readonly signupButton: Locator;
  readonly toggleSignupModeBtn: Locator;
  readonly toggleLoginModeBtn: Locator;
  readonly continueAsGuestBtn: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('#email');
    this.passwordInput = page.locator('#password');
    this.confirmPasswordInput = page.locator('#confirmPassword');
    this.serverUrlInput = page.locator('#initialServerUrl');
    this.loginButton = page.getByRole('button', { name: 'Login' });
    this.signupButton = page.getByRole('button', { name: 'Signup' });
    this.continueAsGuestBtn = page.getByRole('button', { name: 'Continue as Guest' });
    this.toggleSignupModeBtn = page.getByText('Register');
    this.toggleLoginModeBtn = page.getByText('Login').locator('..').filter({ hasText: 'Login' }); // Or whatever specific locator works best
    this.errorMessage = page.locator('div').filter({ hasText: /error|Invalid|Failed|Account not found/i }).first();
  }

  async setServerUrl(url: string) {
    // Wait for the server url input
    await this.serverUrlInput.waitFor({ state: 'visible' });
    await this.serverUrlInput.fill(url);
  }

  async login(email: string, password: string, serverUrl?: string) {
    if (serverUrl) {
      await this.setServerUrl(serverUrl);
    }
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async signup(email: string, password: string, serverUrl?: string, confirmPassword?: string) {
    await this.toggleSignupModeBtn.click();
    await this.confirmPasswordInput.waitFor({ state: 'visible', timeout: 5000 });

    if (serverUrl) {
      await this.setServerUrl(serverUrl);
    }
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.confirmPasswordInput.fill(confirmPassword ?? password);
    await this.signupButton.click();
  }

  async loginAsGuest(serverUrl?: string) {
    if (serverUrl) {
      await this.setServerUrl(serverUrl);
    }
    await this.continueAsGuestBtn.click();
  }

  async switchMode(mode: 'login' | 'signup') {
    if (mode === 'signup') {
      await this.toggleSignupModeBtn.click();
    } else {
      // In the legacy test, the 'Login' string could match multiple elements (like the button and the toggle).
      // We will select the toggle specifically.
      const logins = this.page.getByText('Login');
      await logins.last().click();
    }
  }

  async assertErrorMessageVisible() {
    await expect(this.errorMessage).toBeVisible({ timeout: 15_000 });
  }

  async assertPasswordMismatchVisible() {
    await expect(this.page.getByText('Passwords do not match')).toBeVisible({ timeout: 5_000 });
  }
}

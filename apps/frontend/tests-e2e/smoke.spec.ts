import { test, expect } from '@playwright/test';

test('app loads and shows the login page', async ({ page }) => {
  await page.goto('/');
  // The root redirect should bring us to /app which, without auth, should show login
  await expect(page).toHaveTitle(/Editor Narrativo/i);

  // Wait for React to render — either the login form or the main heading should appear
  const loginOrHeading = page.locator('text=/accedi|login|email/i').first();
  await expect(loginOrHeading).toBeVisible({ timeout: 10_000 });
});

test('register page is accessible', async ({ page }) => {
  await page.goto('/register');
  await expect(page).toHaveTitle(/Editor Narrativo/i);

  // The register form should contain a password field
  const passwordField = page.locator('input[type="password"]');
  await expect(passwordField.first()).toBeVisible({ timeout: 10_000 });
});

test('login page has email and password fields', async ({ page }) => {
  await page.goto('/login');

  const emailField = page.locator('input[type="email"], input[name="email"]').first();
  const passwordField = page.locator('input[type="password"]').first();

  await expect(emailField).toBeVisible({ timeout: 10_000 });
  await expect(passwordField).toBeVisible({ timeout: 10_000 });
});

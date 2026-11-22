import { test, expect } from '@playwright/test';
test('home offers navigation and a theme control', async ({page}) => {
  await page.route('**/content/manifest.json', route => route.fulfill({json:{schema_version:2,series:[],build_id:'release-'+'a'.repeat(64),content_version:'a'.repeat(64),articles:[],counts:{levels:{},topics:{}}}}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/阅读不必赶路/})).toBeVisible();
  await page.getByRole('button',{name:'切换到深色模式'}).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.app')).toHaveAttribute('data-theme','dark');
});

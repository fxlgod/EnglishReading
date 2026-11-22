import { test, expect } from '@playwright/test';

const version = 'a'.repeat(64);
const entry = i => ({ id: `test-${i}`, revision: 1, title_en: `Story ${i}`, title_zh: `故事 ${i}`, level: i % 2 ? 'A2' : 'B1', primary_topic: i % 2 ? 'school' : 'mystery', tags: ['example'], source_type: i === 1 ? 'original_serial' : 'ai_original', fiction: true, summary_zh:'故事从一个意外的发现开始。', featured:i===1, admitted_at:i===2?'2026-11-18T10:00:00Z':'2026-11-17T10:00:00Z', path: `articles/test-${i}.1.json`, sha256: 'b'.repeat(64), word_count: 300, ...(i === 1 ? {series: { id: 'test-series', chapter: 1 }} : {}) });
const manifest = articles => ({ schema_version: 2, build_id: `release-${version}`, content_version: version, articles, series: articles.some(item => item.series) ? [{id:'test-series',title:'Story Collection',synopsis_zh:'走进这组相连的故事。'}] : [], counts: { levels: {}, topics: {} } });

test('empty library, responsive layout and theme', async ({ page }) => {
  const bodyRequests = [];
  await page.route('**/content/manifest.json', route => route.fulfill({json: manifest([])}));
  page.on('request', request => { if (request.url().includes('/content/articles/')) bodyRequests.push(request.url()); });
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({width, height: 850});
    await page.goto('/');
    await expect(page.getByText('书架正在准备中，文章通过审核后会出现在这里。')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    if (width === 390 || width === 1280) await page.screenshot({path: `docs/evidence/P3-01-regression-home-home-${width}.png`,fullPage:true});
  }
  await page.getByRole('button', {name:'切换到深色模式'}).click();
  await page.screenshot({path:'docs/evidence/P3-01-regression-home-home-dark.png',fullPage:true});
  expect(bodyRequests).toEqual([]);
});

test('large catalogue remains bounded and filters and searches', async ({page}) => {
  const articles = Array.from({length:10000}, (_, i) => entry(i + 1));
  await page.route('**/content/manifest.json', route => route.fulfill({json: manifest(articles)}));
  await page.goto('/');
  await expect(page.locator('#explore .article-card').first()).toBeVisible();
  expect(await page.locator('#explore .article-card').count()).toBe(24);
  await page.getByRole('button', {name:'显示更多'}).click();
  await expect(page.locator('#explore .article-card')).toHaveCount(48);
  await page.getByRole('button', {name:'A2',exact:true}).click();
  await expect(page.locator('#explore .article-card')).toHaveCount(24);
  await page.getByLabel('搜索文章').fill('Story 9999');
  await expect(page.locator('#explore .article-card')).toHaveCount(1);
  await expect(page.locator('#series')).toContainText('Story Collection');
  await page.getByRole('link', {name:'查看连载章节 →'}).click();
  await expect(page.getByRole('heading', {name:'Story Collection'})).toBeVisible();
  await page.goBack();
  await page.getByRole('button', {name:'A2',exact:true}).click();
  await page.getByLabel('搜索文章').fill('Story 9999');
  await page.getByRole('button', {name:'悬疑与推理'}).click();
  await expect(page.getByText('没有找到符合条件的文章。试试其他关键词或条件。')).toBeVisible();
});

test('catalogue failure remains visible and can retry', async ({page}) => {
  let fail = true;
  await page.route('**/content/manifest.json', route => {
    if (fail) { fail = false; return route.fulfill({status:500}); }
    return route.fulfill({json:manifest([])});
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('无法加载');
  await page.getByRole('button',{name:'重试'}).click();
  await expect(page.getByText('书架正在准备中，文章通过审核后会出现在这里。')).toBeVisible();
});

test('production home can show every article in the current catalogue', async ({page}) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  const response = await page.request.get('/content/manifest.json');
  expect(response.ok()).toBeTruthy();
  const { articles } = await response.json();
  await page.goto('/');
  if (articles.length === 0) {
    await expect(page.getByText('书架正在准备中，文章通过审核后会出现在这里。')).toBeVisible();
  } else {
    const explore = page.locator('#explore');
    await expect(explore.getByText(`已显示 ${Math.min(24, articles.length)} / 共 ${articles.length} 篇`)).toBeVisible();
    for (let displayed = 24; displayed < articles.length; displayed += 24) {
      await explore.getByRole('button', {name:'显示更多'}).click();
    }
    await expect(explore.locator('.article-card h3 a')).toHaveText(articles.map(article => article.title_en));
  }
  expect(requests.some(url => url.includes('/content/manifest.json'))).toBeTruthy();
  expect(requests.some(url => url.includes('/content/articles/'))).toBeFalsy();
});

test('home presents only editorial selections and published series metadata', async ({page}) => {
  const requests = [];
  page.on('request', request => { if (request.url().includes('/content/articles/')) requests.push(request.url()); });
  await page.route('**/content/manifest.json', route => route.fulfill({json:manifest([entry(1),entry(2)])}));
  await page.goto('/');
  const featured = page.getByRole('region',{name:'编辑精选'});
  await expect(featured.locator('.article-card')).toHaveCount(1);
  await expect(featured.getByRole('heading',{name:'Story 1'})).toBeVisible();
  await expect(featured).toContainText('故事从一个意外的发现开始。');
  await expect(page.locator('#series')).toContainText('走进这组相连的故事。');
  await expect(page.locator('#series')).not.toContainText('test-series');
  expect(requests).toEqual([]);
  await page.screenshot({path:'docs/evidence/P3-01-regression-home-featured.png',fullPage:true});
});

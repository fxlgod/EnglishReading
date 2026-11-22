import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const version = 'a'.repeat(64);
const article = i => ({ id:`test-${i}`,revision:1,title_en:`Story ${i}`,title_zh:`故事 ${i}`,level:i%2?'A2':'B1',primary_topic:i%2?'school':'mystery',tags:['example'],source_type:i<=3?'original_serial':'ai_original',fiction:true,summary_zh:'故事从一个意外的发现开始。',featured:i===1,admitted_at:i===2?'2026-11-18T10:00:00Z':'2026-11-17T10:00:00Z',path:`articles/test-${i}.1.json`,sha256:'b'.repeat(64),word_count:300,...(i<=3?{series:{id:'test-series',chapter:i}}:{}) });
const manifest = articles => ({schema_version:2,build_id:`release-${version}`,content_version:version,articles,series: articles.some(item => item.series) ? [{id:'test-series',title:'Story Collection',synopsis_zh:'走进这组相连的故事。'}] : [], counts:{levels:{},topics:{}}});

test('catalogue pagination, combined filtering and return state', async ({page}) => {
  await page.route('**/content/manifest.json', r=>r.fulfill({json:manifest(Array.from({length:1000},(_,i)=>article(i+1)))}));
  await page.goto('/#/library');
  await expect(page.locator('.article-card')).toHaveCount(24);
  await expect(page.getByText('找到 1000 篇 · 第 1 / 42 页')).toBeVisible();
  await page.getByRole('button',{name:'下一页'}).click();
  await expect(page.getByText('第 2 / 42 页').first()).toBeVisible();
  await page.getByLabel('难度').selectOption('A2');
  await page.getByLabel('题材').selectOption('school');
  await page.getByLabel('搜索文章').fill('Story 999');
  await expect(page.locator('.article-card')).toHaveCount(1);
  await page.screenshot({path:'docs/evidence/P3-01-regression-library-library-filter.png',fullPage:true});
  await page.getByRole('link',{name:'Story 999'}).click();
  await expect(page.getByRole('heading',{name:'Story 999'})).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('搜索文章')).toHaveValue('Story 999');
  await page.getByRole('button',{name:'清除筛选'}).click();
  await page.getByLabel('系列').selectOption('test-series');
  await expect(page.locator('.article-card')).toHaveCount(3);
  await page.getByRole('button',{name:'清除筛选'}).click();
  await expect(page.getByText('找到 1000 篇 · 第 1 / 42 页')).toBeVisible();
  await page.getByLabel('搜索文章').fill('not present');
  await expect(page.getByText('没有找到符合条件的文章。')).toBeVisible();
});

test('series and chapters, invalid IDs, mobile and subpath refresh', async ({page}) => {
  await page.route('**/content/manifest.json', r=>r.fulfill({json:manifest([article(3),article(1),article(2)])}));
  await page.setViewportSize({width:390,height:850});
  await page.goto('/#/series/test-series');
  await expect(page.getByRole('heading',{name:'Story Collection'})).toBeVisible();
  await expect(page.getByText('走进这组相连的故事。')).toBeVisible();
  await expect(page.locator('.chapter-list li')).toHaveCount(3);
  await expect(page.locator('.chapter-list li').nth(0)).toContainText('Story 1');
  await expect(page.locator('.chapter-list li').nth(2)).toContainText('Story 3');
  await page.screenshot({path:'docs/evidence/P3-01-regression-library-library-series.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.getByRole('link',{name:/Story 2/}).click();
  await expect(page.getByRole('link',{name:'上一章'})).toHaveAttribute('href','#/article/test-1');
  await expect(page.getByRole('link',{name:'下一章'})).toHaveAttribute('href','#/article/test-3');
  await page.reload();
  await expect(page.getByRole('heading',{name:'Story 2'})).toBeVisible();
  await page.unroute('**/content/manifest.json');
  await page.route('**/content/manifest.json', r=>r.fulfill({json:manifest([article(1),article(3)])}));
  await page.goto('/#/series/test-series');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('章节目录不完整');
  await page.goto('/#/series/missing');
  await expect(page.getByRole('heading',{name:'未找到这个系列'})).toBeVisible();
  await page.goto('/#/article/missing');
  await expect(page.getByRole('heading',{name:'未找到这篇文章'})).toBeVisible();
  await page.goto('/#/series/%2e%2e');
  await expect(page.getByRole('heading',{name:'页面不存在'})).toBeVisible();
  await page.goto('/#/library');
  await page.screenshot({path:'docs/evidence/P3-01-regression-library-library-mobile.png',fullPage:true});
});

test('empty and failure', async ({page}) => {
  await page.route('**/content/manifest.json', r=>r.fulfill({json:manifest([])}));
  await page.goto('/#/library');
  await expect(page.getByText('书架正在准备中，文章通过审核后会出现在这里。')).toBeVisible();
  await page.setViewportSize({width:1280,height:850});
  await page.screenshot({path:'docs/evidence/P3-01-regression-library-library-library.png',fullPage:true});
  await page.unroute('**/content/manifest.json');
  await page.route('**/content/manifest.json', r=>r.fulfill({status:500}));
  await page.reload();
  await expect(page.getByRole('heading',{name:'目录暂时无法加载'})).toBeVisible();
});

test('ten thousand items are fully reachable by page number', async ({page}, testInfo) => {
  await page.route('**/content/manifest.json', r=>r.fulfill({json:manifest(Array.from({length:10000},(_,i)=>article(i+1)))}));
  const start = Date.now();
  await page.goto('/#/library');
  await expect(page.getByText('找到 10000 篇 · 第 1 / 417 页')).toBeVisible();
  const firstPageMs = Date.now() - start;
  const sortStart = Date.now();
  await page.getByLabel('排序').selectOption('latest');
  await expect(page.locator('.article-card').first()).toContainText('Story 2');
  await expect(page.locator('.article-card').first()).toContainText('故事从一个意外的发现开始。');
  const latestSortMs = Date.now() - sortStart;
  await page.getByLabel('排序').selectOption('default');
  const jumpStart = Date.now();
  await page.getByLabel('跳转页码').fill('417');
  await expect(page.getByRole('heading',{name:'Story 10000'})).toBeVisible();
  await expect(page.locator('.article-card')).toHaveCount(16);
  const metrics = { entries:10000, firstPageMs, latestSortMs, lastPageMs:Date.now()-jumpStart, lastPageCards:16 };
  await testInfo.attach('catalogue-metrics', {body:JSON.stringify(metrics),contentType:'application/json'});
  console.log('P1-M01 synthetic catalogue:', JSON.stringify(metrics));
});

test('static project subpath survives direct entry and refresh', async ({page}) => {
  const bodyRequests = [];
  const server = createServer(async (req, res) => {
    const requested = req.url === '/EnglishReading/' ? 'index.html' : req.url.replace(/^\/EnglishReading\//, '');
    if (!/^(index\.html|assets\/[a-zA-Z0-9_.-]+|content\/(manifest|series|attributions)\.json)$/.test(requested)) { res.writeHead(404).end(); return; }
    try {
      const data = await readFile(resolve('dist', requested));
      const type = requested.endsWith('.js') ? 'text/javascript' : requested.endsWith('.css') ? 'text/css' : requested.endsWith('.json') ? 'application/json' : 'text/html';
      res.writeHead(200, {'content-type':type}).end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  page.on('request', request => { if (request.url().includes('/content/articles/')) bodyRequests.push(request.url()); });
  try {
  await page.goto(`http://127.0.0.1:${server.address().port}/EnglishReading/#/library`);
  await expect(page.getByText('书架正在准备中，文章通过审核后会出现在这里。')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'书库'})).toBeVisible();
  expect(bodyRequests).toEqual([]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

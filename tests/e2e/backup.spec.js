import { Buffer } from 'node:buffer';
import { test, expect, chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const url = 'http://127.0.0.1:4173/#/privacy';
const date = '2026-01-01T00:00:00.000Z';
const later = '2026-01-02T00:00:00.000Z';
const progress = {articleId:'removed-book',revision:2,sentenceId:'s1',completed:true,updatedAt:date};
const favorite = {articleId:'removed-book',createdAt:date};
const vocab = {id:JSON.stringify(['removed-book','s1','phrase',0,7]),lemma:'give up',surface:'give up',pos:'短语',gloss:'放弃',articleId:'removed-book',sentenceId:'s1',phraseSpan:[0,7],sentence:'give up now',createdAt:date};
const settings = [{id:'rate',value:1.25,updatedAt:date}];
const data = {progress:[progress],favorites:[favorite],vocab:[vocab],settings};
const envelope = {...data,format_version:1,exported_at:later};

async function download(page) {
  const file = page.waitForEvent('download');
  await page.getByRole('button',{name:'导出 JSON 备份'}).click();
  return readFile(await (await file).path());
}
async function upload(page,value) {
  await page.getByLabel('选择备份文件').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))});
}
async function merge(page,value) {
  await upload(page,value);
  await expect(page.getByRole('heading',{name:'导入预览'})).toBeVisible();
  await page.getByRole('button',{name:'确认合并'}).click();
  await expect(page.getByRole('status')).toHaveText('备份已导入。');
}
async function seed(page, data) {
  await download(page);
  await page.evaluate(async data => {
    const db = await new Promise((resolve,reject) => {
      const r = indexedDB.open('english-reading',1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve,reject) => {
      const tx = db.transaction(Object.keys(data),'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      for (const [name, records] of Object.entries(data)) {
        for (const record of records) tx.objectStore(name).put(record);
      }
    });
    db.close();
  }, data);
}
function stores(bytes) {
  const {progress,favorites,vocab,settings} = JSON.parse(bytes);
  return {progress,favorites,vocab,settings};
}

test('actual Chrome download restores all stores in a clean Edge browser and after clearing', async ({page}) => {
  await page.goto('/#/personal');
  await page.getByRole('link',{name:'数据与隐私设置'}).click();
  await seed(page,data);
  const bytes = await download(page);
  expect(stores(bytes)).toEqual(data);
  expect(Object.keys(JSON.parse(bytes)).sort()).toEqual(['exported_at','favorites','format_version','progress','settings','vocab']);
  const edge = await chromium.launch({channel:'msedge'});
  try {
    const destination = await edge.newPage({serviceWorkers:'block',viewport:{width:390,height:900}});
    await destination.goto(url);
    const requests = [];
    destination.on('request', request => {
      if (request.url() !== new URL('./icon-192.png', url).href) requests.push(request.url());
    });
    expect(stores(await download(destination))).toEqual({progress:[],favorites:[],vocab:[],settings:[]});
    await upload(destination,bytes);
    await expect(destination.getByRole('heading',{name:'导入预览'})).toBeVisible();
    await destination.screenshot({path:'docs/evidence/P3-01-regression-backup-privacy-preview.png',fullPage:true});
    await destination.getByRole('button',{name:'确认合并'}).click();
    await expect(destination.getByRole('status')).toHaveText('备份已导入。');
    expect(stores(await download(destination))).toEqual(data);
    await destination.getByRole('button',{name:'清除个人数据…'}).click();
    await destination.getByRole('button',{name:'返回'}).click();
    expect(stores(await download(destination))).toEqual(data);
    await destination.getByRole('button',{name:'清除个人数据…'}).click();
    await destination.getByRole('button',{name:'永久清除'}).click();
    await expect(destination.getByRole('status')).toHaveText('本机个人数据已清除。');
    expect(stores(await download(destination))).toEqual({progress:[],favorites:[],vocab:[],settings:[]});
    await merge(destination,bytes);
    expect(stores(await download(destination))).toEqual(data);
    expect(requests).toEqual([]);
    await destination.getByRole('link',{name:'我的阅读'}).click();
    await expect(destination.getByText('来源文章已不可用')).toBeVisible();
    await expect(destination.getByText('已读',{exact:false}).first()).toBeVisible();
  } finally {
    await edge.close();
  }
});

test('merge is idempotent, selects newer records and ties keep local; overwrite is confirmed', async ({page}) => {
  await page.goto(url);
  await seed(page,data);
  const imported = {...envelope,progress:[{...progress,updatedAt:later,completed:false}],vocab:[{...vocab,gloss:'同时间的冲突'}],favorites:[]};
  await merge(page,imported);
  await merge(page,imported);
  expect(stores(await download(page))).toEqual({...data,progress:imported.progress});
  await upload(page,imported);
  await page.getByRole('button',{name:'覆盖恢复…'}).click();
  await expect(page.getByRole('heading',{name:'确认覆盖个人数据'})).toBeVisible();
  await page.getByRole('button',{name:'确认覆盖'}).click();
  await expect(page.getByRole('status')).toHaveText('备份已导入。');
  expect(stores(await download(page))).toEqual({progress:imported.progress,favorites:[],vocab:imported.vocab,settings});
});

test('invalid JSON, UTF-8, version, timestamps, missing fields, duplicates, markup and size are rejected', async ({page}) => {
  await page.goto(url);
  await seed(page,data);
  const cases = [
    Buffer.from('{'), Buffer.from([255]), {...envelope,format_version:2},
    {...envelope,exported_at:'2026-02-30T00:00:00Z'},
    {...envelope,settings:undefined}, {...envelope,favorites:[favorite,favorite]},
    {...envelope,vocab:[{...vocab,gloss:'<b>无效内容</b>'}]},
    {...envelope,progress:[{...progress,revision:0}]},
    {...envelope,settings:[{...settings[0],id:'browser-info'}]},
    Buffer.alloc(5 * 1024 * 1024 + 1),
  ];
  for (const value of cases) {
    await upload(page,value);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('heading',{name:'导入预览'})).toHaveCount(0);
  }
  expect(stores(await download(page))).toEqual(data);
});

test('overwrite rolls back queued writes and clears when a later store write fails', async ({page}) => {
  await page.goto(url);
  await seed(page,data);
  await upload(page,{...envelope,progress:[],favorites:[]});
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'vocab') throw new DOMException('injected failure','QuotaExceededError');
      return put.apply(this,args);
    };
  });
  await page.getByRole('button',{name:'覆盖恢复…'}).click();
  await page.getByRole('button',{name:'确认覆盖'}).click();
  await expect(page.getByRole('alert')).toContainText('原有记录已保留');
  await page.getByRole('button',{name:'返回'}).click();
  expect(stores(await download(page))).toEqual(data);
});

test('asynchronous transaction abort rolls back a completed put during merge', async ({page}) => {
  await page.goto(url);
  await seed(page,data);
  await upload(page,{...envelope, progress:[{...progress,updatedAt:later,completed:false}]});
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      const request = put.apply(this,args);
      if (this.name === 'progress') request.addEventListener('success', () => request.transaction.abort());
      return request;
    };
  });
  await page.getByRole('button',{name:'确认合并'}).click();
  await expect(page.getByRole('alert')).toContainText('原有记录已保留');
  expect(stores(await download(page))).toEqual(data);
});

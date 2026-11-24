import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export async function buildPwa(directory) {
  const assets = (await readdir(join(directory, 'assets'))).sort().map(name => 'assets/' + name);
  const files = ['index.html', 'app.webmanifest', 'icon-192.png', 'icon-512.png',
    'content/manifest.json', 'content/series.json', 'content/attributions.json', ...assets];
  const extensionDirectory=join(directory,'content','extensions');
  const sections=await readdir(extensionDirectory).catch(error=>{
    if (error.code==='ENOENT') return [];
    throw error;
  });
  for (const section of ['novels','grammar']) if (sections.includes(section)) {
    files.push('content/extensions/'+section+'/manifest.json','content/extensions/'+section+'/withdrawn.json');
  }
  const sha256 = data => createHash('sha256').update(data).digest('hex');
  const shell = Object.fromEntries(await Promise.all(files.map(async path =>
    [path, sha256(await readFile(join(directory, path)))])));
  const worker = await readFile(new URL('worker.js', import.meta.url), 'utf8');
  const version = sha256(worker + JSON.stringify(shell));
  await writeFile(join(directory, 'sw.js'),
    `const VERSION = ${JSON.stringify(version)};\nconst SHELL = ${JSON.stringify(shell)};\n${worker}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildPwa(process.argv[2]);
}

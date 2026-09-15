import {mkdir, copyFile, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export async function buildVercel(output = new URL('./.vercel/output/', import.meta.url)) {
  const root = new URL('./', import.meta.url);
  await rm(output, {recursive: true, force: true});
  const fn = new URL('functions/index.func/', output);
  await mkdir(new URL('public/', fn), {recursive: true});
  await mkdir(new URL('content/', fn), {recursive: true});
  // Explicit allowlist: .env, screenshots, editor assets and future files stay out.
  for (const name of ['server.mjs','render.mjs','live.mjs','live-server.mjs',
    'vercel-handler.mjs','content/articles.mjs','public/style.css','public/leona-wordmark.png']) {
    await copyFile(new URL(name, root), new URL(name, fn));
  }
  const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2)+'\n');
  await json(new URL('.vc-config.json', fn), {
    runtime: 'nodejs24.x', handler: 'vercel-handler.mjs', launcherType: 'Nodejs',
    maxDuration: 180, supportsResponseStreaming: true,
  });
  await json(new URL('config.json', output), {version: 3, routes: [{src: '/(.*)', dest: '/index'}]});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildVercel();

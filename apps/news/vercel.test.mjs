import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {buildVercel} from './build-vercel.mjs';

test('built Vercel function serves real API data, excludes secrets, forces public mode', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'leona-news-build-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const output = pathToFileURL(dir+'/output/');
  await buildVercel(output);
  const names = await readdir(output,{recursive:true});
  assert(!names.some(name=>/\.env|artifacts|editor\.js|hero\.png|node_modules/.test(name)));
  const manifest = JSON.parse(await readFile(new URL('config.json',output)));
  assert.deepEqual(manifest.routes,[{src:'/(.*)',dest:'/index'}]);
  let available = true;
  const upstream = createServer((req,res)=>{
    assert.equal(req.headers.authorization,undefined);
    assert.match(req.url,/^\/v1\/news\/articles/);
    res.writeHead(available?200:503,{'Content-Type':'application/json'});
    res.end(JSON.stringify({items:[],next_cursor:null}));
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>upstream.close(r)));
  const env = {...process.env};
  t.after(()=>{for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);});
  Object.assign(process.env,{
    LEONA_NEWS_MODE:'editor', LEONA_NEWS_EDITOR_TOKEN:'test-token-must-not-leak',
    LEONA_NEWS_API_URL:`http://127.0.0.1:${upstream.address().port}`,
    SITE_URL:'https://news.leonaquantum.com', VERCEL_ENV:'preview',
  });
  const {default:handler} = await import(new URL('functions/index.func/vercel-handler.mjs',output));
  const server = createServer(handler);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
  assert.doesNotMatch(await response.text(),/サンプル記事|test-token-must-not-leak/);
  for(const path of ['/assets/style.css','/assets/leona-wordmark.png','/readyz'])assert.equal((await fetch(base+path)).status,200);
  for(const path of ['/editor','/.env','/assets/editor.js','/assets/hero.png'])assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/editor/collect',{method:'POST'})).status,405);
  available=false;
  assert.equal((await fetch(base+'/readyz')).status,503);
  assert.equal((await fetch(base)).status,503);
});

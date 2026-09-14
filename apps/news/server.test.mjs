import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsServer } from './server.mjs';

test('preview routes, search, escaping, and private file boundaries', async t => {
 const server=createNewsServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const home=await fetch(base);assert.equal(home.status,200);assert.match(await home.text(),/公開前プレビュー/);
 const article=await fetch(base+'/articles/understanding-error-correction');assert.equal(article.status,200);assert.match(await article.text(),/この記事で読むこと/);
 const category=await (await fetch(base+'/?category=industry')).text();assert.match(category,/1件/);assert.match(category,/reading-quantum-roadmaps/);assert.doesNotMatch(category,/starting-with-superposition/);
 const empty=await (await fetch(base+'/?q=zzzzzz')).text();assert.match(empty,/一致する記事がありません/);
 const search=await (await fetch(base+'/?q='+encodeURIComponent('重ね合わせ'))).text();assert.match(search,/starting-with-superposition/);
 const injected=await (await fetch(base+'/?q='+encodeURIComponent('"><script>alert(1)</script>'))).text();assert.doesNotMatch(injected,/<script>/);assert.match(injected,/&lt;script&gt;/);
 for(const path of ['/.env','/.env.example','/server.mjs','/assets/../.env','/articles/no-such-story'])assert.equal((await fetch(base+path)).status,404,path);
 assert.equal((await fetch(base,{method:'POST'})).status,405);
 const head=await fetch(base,{method:'HEAD'});assert.equal(await head.text(),'');assert.equal(head.headers.get('x-robots-tag'),'noindex, nofollow');
 assert.match(await (await fetch(base+'/robots.txt')).text(),/Disallow: \//);
 for(const file of ['hero.png','research.png','industry.png','guide.png','leona-wordmark.png'])assert.equal((await fetch(base+'/assets/'+file)).headers.get('content-type'),'image/png');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsServer} from './server.mjs';
const id='01900000-0000-7000-8000-000000000001';
const record={id,published_at:'2026-09-10T00:00:00Z',created_at:'2026-09-10T00:00:00Z',digest:'a'.repeat(64),status:'draft',image:{kind:'generated',credit:'AI生成画像 / Leona',alt:'量子コンピュータの概念イラスト'},review:{result:{verdict:'pass',notes:'出典を確認しました。',blockers:[]}},document:{title:'世界の量子コンピュータを読み解く',lead:'研究を背景から読み解く、日本語のニュース記事です。',category:'research',sections:[{heading:'研究の背景',paragraphs:[{text:'<script>alert(1)</script> 研究の内容を確認します。',sources:['s1']}]}],sources:[{id:'s1',title:'公式発表',url:'https://example.org/research',publisher:'研究機関',locator:'Results'}]}};
async function serve(t,options){const server=createNewsServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}`;}
test('published rendering, provenance, RSS and no sample fallback',async t=>{
 const paths=[];const base=await serve(t,{mode:'published',apiUrl:'https://api.example.org',fetchImpl:async(url,opts)=>{paths.push(new URL(url).pathname);assert.equal(opts.headers.Authorization,undefined);return Response.json(new URL(url).pathname.endsWith(id)?record:{items:[record],next_cursor:null});}});
 const home=await fetch(base);assert.equal(home.status,200);assert.equal(home.headers.get('x-robots-tag'),null);assert.doesNotMatch(await home.text(),/公開前プレビュー|サンプル記事/);
 const text=await(await fetch(base+'/articles/'+id)).text();assert.match(text,/https:\/\/example.org\/research/);assert.match(text,/&lt;script&gt;/);assert.doesNotMatch(text,/<script>alert/);assert.match(text,/AI生成画像/);
 assert.match(await(await fetch(base+'/feed.xml')).text(),/<rss/);
 assert.match(await(await fetch(base+'/sitemap.xml')).text(),/<urlset/);
 assert.equal((await fetch(base+'/editor')).status,404);
 assert.equal((await fetch(base+'/.env')).status,404);
 assert.equal((await fetch(base+'/editor/collect',{method:'POST'})).status,405);
 assert(paths.every(p=>p.startsWith('/v1/news/articles')));
});
test('upstream failures are 503, never sample success',async t=>{
 const base=await serve(t,{mode:'published',apiUrl:'https://api.example.org',fetchImpl:async()=>new Response('',{status:503})});const response=await fetch(base);assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/サンプル記事|量子コンピュータは、/);
});
test('editor is loopback-only, server-token-only, CSRF protected, idempotent form',async t=>{
 assert.throws(()=>createNewsServer({mode:'editor',host:'0.0.0.0',apiUrl:'https://api.example.org',token:'test-only'}),/loopback/);
 const mutations=[];const base=await serve(t,{mode:'editor',apiUrl:'https://api.example.org',token:'test-only',fetchImpl:async(url,opts)=>{assert.equal(opts.headers.Authorization,'Bearer test-only');if(opts.method==='POST'){mutations.push(opts);return Response.json({id});}return Response.json({items:[record]});}});
 const page=await(await fetch(base+'/editor')).text();assert.doesNotMatch(page,/test-only/);const csrf=page.match(/name="csrf" value="([^"]+)"/)[1],key=page.match(/name="collection_key" value="([^"]+)"/)[1];
 const body=new URLSearchParams({csrf,collection_key:key,brief:'世界の量子コンピュータのニュースを探してください。',generate_image:'on'});
 assert.equal((await fetch(base+'/editor/collect',{method:'POST',body,headers:{Origin:'https://attacker.example'},redirect:'manual'})).status,403);
 const response=await fetch(base+'/editor/collect',{method:'POST',body,headers:{Origin:base},redirect:'manual'});assert.equal(response.status,303);assert.equal(mutations[0].headers['Idempotency-Key'],key);
});

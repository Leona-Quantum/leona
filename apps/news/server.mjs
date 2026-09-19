import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createLiveHandler } from './live-server.mjs';
import { home, articlePage, about, notFound } from './render.mjs';
const assets = new Map(['editor.js','style.css','leona-wordmark.png','hero.png','research.png','industry.png','guide.png'].map(name=>['/assets/'+name,new URL('./public/'+name,import.meta.url)]));
export function createNewsHandler(options = {}) {
 const mode = options.mode || process.env.LEONA_NEWS_MODE || 'preview';
 const servedAssets = new Map([...assets].filter(([path])=>mode==='preview'||['/assets/style.css','/assets/leona-wordmark.png',...(mode==='editor'?['/assets/editor.js']:[])].includes(path)));
 const live = mode === 'preview' ? null : createLiveHandler({mode,apiUrl:process.env.LEONA_NEWS_API_URL,token:process.env.LEONA_NEWS_EDITOR_TOKEN,siteUrl:process.env.SITE_URL || 'https://news.leonaquantum.com',host:process.env.HOST || '127.0.0.1',...options});
 return async (req,res)=>{
  const headers = {
   'X-Content-Type-Options':'nosniff', ...(mode!=='published'||options.noindex?{'X-Robots-Tag':'noindex, nofollow'}:{}),
   'Referrer-Policy':'strict-origin-when-cross-origin',
   'Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
   'Cache-Control':'no-store',
  };
  try {
   const requestedUrl = new URL(req.url,'http://localhost');
   if(live && !servedAssets.has(requestedUrl.pathname) && requestedUrl.pathname!=='/healthz'){
     const result=await live(req,requestedUrl);
     res.writeHead(result.status,{...headers,'Content-Type':result.type||'text/plain; charset=utf-8',...result.headers});
     res.end(req.method==='HEAD'?undefined:result.body);return;
   }
   if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{...headers,Allow:'GET, HEAD'});res.end();return;}
   const url = new URL(req.url,'http://localhost');
   let status=200, content, type='text/html; charset=utf-8';
   if(servedAssets.has(url.pathname)) {content=await readFile(servedAssets.get(url.pathname));type=url.pathname.endsWith('.css')?'text/css; charset=utf-8':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'image/png';}
   else if(url.pathname==='/robots.txt'){content='User-agent: *\nDisallow: /\n';type='text/plain; charset=utf-8';}
   else if(url.pathname==='/healthz'){content=JSON.stringify({status:'ok',mode});type='application/json';}
   else if(url.pathname==='/')content=home(url.searchParams);
   else if(url.pathname==='/about')content=about();
   else if(/^\/articles\/[a-z0-9-]+$/.test(url.pathname))content=articlePage(url.pathname.split('/').at(-1));
   if(content===undefined || content===null){status=404;content=notFound();}
   res.writeHead(status,{...headers,'Content-Type':type});res.end(req.method==='HEAD'?undefined:content);
  }catch{res.writeHead(500,{...headers,'Content-Type':'text/plain; charset=utf-8'});res.end('ページを表示できませんでした。時間をおいて再度お試しください。');}
 };
}
export function createNewsServer(options = {}) {
 return createServer(createNewsHandler(options));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const port = Number(process.env.PORT || 3100), host = process.env.HOST || '127.0.0.1';
 const server=createNewsServer();
 server.listen(port,host,()=>console.log(`Leona News: http://${host}:${port}`));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();});
}

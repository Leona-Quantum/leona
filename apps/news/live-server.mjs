import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import {createNewsClient,listing,articleView,editorView,reviewView,messagePage,aboutLive,rss} from './live.mjs';
import {escapeHtml as e} from './render.mjs';
const idPattern='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function createLiveHandler({mode,apiUrl,token,siteUrl,host='127.0.0.1',fetchImpl=fetch}){
 if(!['published','editor'].includes(mode))throw new Error('Unknown news mode');
 const editor=mode==='editor';
 if(editor&&!['127.0.0.1','localhost','::1'].includes(host))throw new Error('Editorial preview must bind to loopback');
 const canonical=new URL(siteUrl);
 if(canonical.protocol!=='https:'||canonical.username||canonical.password||canonical.pathname!=='/')throw new Error('SITE_URL must be an HTTPS origin');
 const config={editor,siteUrl:canonical.href};
 const api=createNewsClient({apiUrl,token,editor,fetchImpl});
 const prefix=editor?'/editor/articles':'/articles';
 const csrf=randomBytes(32).toString('hex');
 const html=(body,status=200)=>({status,body,type:'text/html; charset=utf-8'});
 return async function handle(req,url){
  try{
   if(req.method==='POST'){
    if(!editor)return html(messagePage('操作できません','この操作は編集画面で行ってください。',config),405);
    const origin=new URL(req.headers.origin||'https://invalid.example');
    if(origin.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||origin.host!==req.headers.host)return html(messagePage('操作できません','編集画面を開き直してください。',config),403);
    if(!(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))return html(messagePage('操作できません','フォームから操作してください。',config),415);
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>950000)return html(messagePage('入力が長すぎます','短くして再度お試しください。',config),413);chunks.push(chunk);}
    const form=new URLSearchParams(Buffer.concat(chunks).toString());const supplied=Buffer.from(form.get('csrf')||'');
    if(supplied.length!==csrf.length||!timingSafeEqual(supplied,Buffer.from(csrf)))return html(messagePage('操作できません','編集画面を開き直してください。',config),403);
    if(url.pathname==='/editor/collect'){
      const key=form.get('collection_key');if(!key||!/^[0-9a-f-]{36}$/.test(key))return html(messagePage('操作できません','編集画面を開き直してください。',config),400);
      const data=await api('/collections',{method:'POST',body:{brief:form.get('brief'),generate_image:form.has('generate_image')},key});
      return {status:303,body:'',headers:{Location:`/editor/collections/${data.id}`}};
    }
    const retry=url.pathname.match(new RegExp(`^/editor/collections/(${idPattern})/retry$`));
    if(retry){await api('/collections/'+retry[1]+'/retry',{method:'POST',key:form.get('retry_key')});return {status:303,body:'',headers:{Location:'/editor/collections/'+retry[1]}};}
    const revision=url.pathname.match(new RegExp(`^/editor/articles/(${idPattern})/revise$`));
    if(revision){const current=await api('/editor/articles/'+revision[1]);const article=structuredClone(current.document);article.title=form.get('title');article.lead=form.get('lead');article.sections.forEach((s,i)=>{s.heading=form.get('heading_'+i);s.paragraphs.forEach((p,j)=>{p.text=form.get('paragraph_'+i+'_'+j);});});await api('/editor/articles/'+revision[1],{method:'PUT',body:{article,expected_digest:form.get('expected_digest'),note:form.get('note')}});return {status:303,body:'',headers:{Location:'/editor/articles/'+revision[1]}};}
    const upload=url.pathname.match(new RegExp(`^/editor/articles/(${idPattern})/image$`));
    if(upload){const body=Object.fromEntries(['data_base64','alt','credit','source_url','license_url','permission_note'].map(k=>[k,form.get(k)]));await api('/editor/articles/'+upload[1]+'/image',{method:'PUT',body});return {status:200,type:'application/json',body:'{"saved":true}'};}
    const mutation=url.pathname.match(new RegExp(`^/editor/articles/(${idPattern})/(publish|withdraw)$`));
    if(mutation){await api(`/editor/articles/${mutation[1]}/${mutation[2]}`,{method:'POST',body:{expected_digest:form.get('expected_digest'),expected_image_digest:form.get('expected_image_digest')||null,note:form.get('note')}});return {status:303,body:'',headers:{Location:`/editor/articles/${mutation[1]}`}};}
    return html(messagePage('ページが見つかりません','操作先を確認してください。',config),404);
   }
   if(!['GET','HEAD'].includes(req.method))return {status:405,body:'',headers:{Allow:editor?'GET, HEAD, POST':'GET, HEAD'}};
   if(url.pathname==='/readyz'){await api(prefix+'?limit=1');return {status:200,type:'application/json',body:'{"ready":true}'};}
   if(url.pathname==='/'){
    const params=new URLSearchParams({limit:'20'});for(const key of ['before','q','category'])if(url.searchParams.has(key))params.set(key,url.searchParams.get(key));
    return html(listing(await api(prefix+'?'+params),url.searchParams,config));
   }
   if(url.pathname==='/about')return html(aboutLive(config));
   const article=url.pathname.match(new RegExp(`^/articles/(${idPattern})$`));
   if(article)return html(articleView(await api(prefix+'/'+article[1]),config));
   const media=url.pathname.match(new RegExp(`^/media/(${idPattern})$`));
   if(media)return {status:200,body:await api(prefix+'/'+media[1]+'/image'),type:'image/webp'};
   if(editor&&url.pathname==='/editor')return html(editorView(await api('/editor/articles'),csrf,config).replace('name="collection_key" value=""',`name="collection_key" value="${randomUUID()}"`));
   const review=url.pathname.match(new RegExp(`^/editor/articles/(${idPattern})$`));
   if(editor&&review)return html(reviewView(await api('/editor/articles/'+review[1]),csrf,config));
   const batch=url.pathname.match(new RegExp(`^/editor/collections/(${idPattern})$`));
   if(editor&&batch){const data=await api('/collections/'+batch[1]);const labels={queued:'順番を待っています',research:'調査結果を保存しました',draft:'本文を保存しました',review:'記事の検証中です',image:'画像を準備しています',done:'下書きの準備ができました',held:'確認が必要なため保留しました',failed:'処理に失敗しました'};return html(messagePage('記事作成の状況',`${labels[data.stage]||data.stage}。API呼び出しは${data.calls}回です。${data.error?'理由：'+data.error:''} ページを再読み込みすると最新の状況を確認できます。`,config).replace('</main>',`${['held','failed'].includes(data.stage)?`<form class="editor-form" method="post" action="/editor/collections/${e(data.id)}/retry"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="retry_key" value="${randomUUID()}"><button>残りの利用枠で再試行する</button></form>`:''}${data.article_id?`<p><a class="back-link" href="/editor/articles/${e(data.article_id)}">下書きを確認する</a></p>`:''}</main>`));}
   if(url.pathname==='/robots.txt')return {status:200,type:'text/plain; charset=utf-8',body:editor?'User-agent: *\nDisallow: /\n':`User-agent: *\nAllow: /\nDisallow: /editor\nSitemap: ${new URL('/sitemap.xml',siteUrl).href}\n`};
   if(!editor&&url.pathname==='/feed.xml')return {status:200,type:'application/rss+xml; charset=utf-8',body:rss((await api('/articles?limit=50')).items,siteUrl)};
   if(!editor&&url.pathname==='/sitemap.xml'){
    const entries=[];let before='';for(let i=0;i<10;i++){const data=await api('/articles?limit=50'+(before?'&before='+before:''));entries.push(...data.items);if(!data.next_cursor)break;before=data.next_cursor;}
    return {status:200,type:'application/xml; charset=utf-8',body:`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${e(siteUrl)}</loc></url>${entries.map(a=>`<url><loc>${e(new URL('/articles/'+a.id,siteUrl).href)}</loc></url>`).join('')}</urlset>`};
   }
   return html(messagePage('ページが見つかりません','URLを確認するか、記事一覧から探してください。',config),404);
  }catch(error){const status=error.status===404?404:503;return html(messagePage(status===404?'記事が見つかりません':'一時的に利用できません',status===404?'公開されていないか、取り下げられた記事です。':error.status===409?'内容が更新されたか、公開の条件が揃っていません。記事の検証結果を確認してください。':'しばらくしてから再度お試しください。',config),error.status===409?409:status);}
 };
}

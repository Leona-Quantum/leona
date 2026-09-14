const form=document.querySelector('#image-upload');
if(form)form.addEventListener('submit',async event=>{
 event.preventDefault();
 const file=form.querySelector('[type=file]').files[0],message=form.querySelector('[role=status]');
 if(!file||file.size>550000){message.textContent='550 KB以下のPNG・JPEG・WebP画像を選んでください。';return;}
 const button=form.querySelector('button');button.disabled=true;message.textContent='画像を保存しています…';
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
  const body=new URLSearchParams();for(const [key,value] of new FormData(form))if(typeof value==='string')body.set(key,value);
  body.set('data_base64',btoa(binary));
  const response=await fetch(form.action,{method:'POST',body,credentials:'same-origin'});
  if(!response.ok)throw new Error();
  location.reload();
 }catch{message.textContent='保存できませんでした。画像の形式・容量と入力内容を確認してください。';button.disabled=false;}
});

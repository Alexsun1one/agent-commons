(() => {
'use strict';
// This workspace is local-only. No network, account, or publication is implied.
const DB_NAME='commons-contributions-v1', STORE='drafts', FALLBACK_KEY='contributions-text-v1';
const MAX_FILE=5*1024*1024, MAX_TOTAL=12*1024*1024, MAX_FILES=5;
const kinds=['实践案例','作品','方法笔记'], statuses={draft:'本机草稿',review:'模拟待审核'};
const state={ready:false,loading:null,db:null,mode:'loading',records:[],editor:null,dirty:false,busy:false,message:'',filter:'all',urls:[],previewRecord:null,pendingEditorId:null};
const C=()=>window.Commons, esc=value=>C().esc(String(value??'')), icon=name=>C().icon(name);
const isLive=()=>!!(window.CommonsAPI&&window.CommonsAPI.mode==='live');
const closed=()=>{C().toast('这个功能还没开放');return false;};
const closedLiveMark='if(isLive())return closed();';
const serverStatuses={draft:'草稿',review:'审核中',accepted:'已通过'};
const api=()=>window.CommonsAPI;
const writeKeys={};
function keyFor(signature){if(!writeKeys[signature])writeKeys[signature]=api().newIdempotencyKey();return writeKeys[signature];}
function dropKey(signature){delete writeKeys[signature];}
function statusText(row){return (state.mode==='server'?serverStatuses:statuses)[row.status]||'';}
function liveError(error){
 const code=error&&error.code;
 if(code==='capability_unavailable')return '这个功能还没开放';
 if(code==='version_conflict')return '另一处已经改过这份投稿，本次没有覆盖。请重新打开后再试。';
 if(code==='precondition_required')return '缺少版本，本次没有保存。';
 if(code==='validation_failed'||code==='state_conflict')return (error&&error.message)||'这份投稿现在不能这样改。';
 if(code==='unauthenticated'||code==='session_expired')return '登录已过期。请重新登录后再继续。';
 return (error&&error.message)||'没有完成。原内容还在。';
}
function fromApi(row){
 if(!row||typeof row.id!=='string')return null;
 const history=Array.isArray(row.history)?row.history.map(item=>({version:item.version,at:item.at,event:item.event||'',title:item.title||'',kind:kinds.includes(item.kind)?item.kind:kinds[0],summary:item.summary||'',body:item.body||'',files:[]})).slice(-12):[];
 return {id:row.id,title:String(row.title||'').slice(0,80),kind:kinds.includes(row.kind)?row.kind:kinds[0],summary:String(row.summary||'').slice(0,240),body:String(row.body||'').slice(0,20000),status:row.status==='accepted'?'accepted':row.status==='review'?'review':'draft',createdAt:String(row.created_at||''),updatedAt:String(row.updated_at||''),version:Number.isInteger(row.version)?row.version:0,files:[],history};
}
function upsert(row){state.records=[row,...state.records.filter(item=>item.id!==row.id)];}
async function pullLive(){
 let cursor=null,items=[];
 do{
  const res=await api().get('/account/contributions',cursor?{cursor}:null);
  items.push(...((res.data&&res.data.items)||[]).map(fromApi).filter(Boolean));
  cursor=res.meta&&res.meta.cursor;
 }while(cursor);
 state.records=items;state.mode='server';
}
async function openLive(id){
 const res=await api().get('/account/contributions/'+encodeURIComponent(id));
 const row=fromApi(res.data);if(!row)throw new Error('bad');upsert(row);return row;
}
const uid=()=>globalThis.crypto?.randomUUID?.()||'draft-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const clone=row=>({...row,files:[...(row.files||[])],history:[...(row.history||[])]});
const now=()=>new Date().toISOString();
const stamp=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚未保存';
const bytes=value=>value<1048576?`${Math.max(1,Math.round(value/1024))} KB`:`${(value/1048576).toFixed(1)} MB`;
const title=row=>row.title?.trim()||'未命名草稿';
const edited=()=>state.editor&&state.editor.status==='draft';
const current=()=>document.querySelector('[data-contributions-root]');
const fileName=file=>String(file.name||'未命名附件').slice(0,160);
const textRows=()=>{const rows=C().read(FALLBACK_KEY,[]);return (Array.isArray(rows)?rows:[]).map(normalize).filter(Boolean);};
const signature=row=>{let hash=2166136261;for(const char of JSON.stringify([row.id,row.version,row.updatedAt,row.title,row.kind,row.summary,row.body]))hash=Math.imul(hash^char.charCodeAt(0),16777619);return row.id+':'+(hash>>>0).toString(36);};
const snapshot=row=>({version:row.version,at:row.updatedAt,event:row.status==='review'?'模拟提交审核':'保存草稿',title:row.title,kind:row.kind,summary:row.summary,body:row.body,files:row.files.map(file=>file.name)});
function revoke(){state.urls.forEach(url=>URL.revokeObjectURL(url));state.urls=[];}
/* safe-fn: URL.createObjectURL 生成的 blob: 地址，不含用户可控文本 */
function url(blob){const value=URL.createObjectURL(blob);state.urls.push(value);return value;}
function normalize(row){
 if(!row||typeof row.id!=='string')return null;
 return {id:row.id,title:String(row.title||'').slice(0,80),kind:kinds.includes(row.kind)?row.kind:kinds[0],summary:String(row.summary||'').slice(0,240),body:String(row.body||'').slice(0,20000),status:row.status==='review'?'review':'draft',createdAt:String(row.createdAt||now()),updatedAt:String(row.updatedAt||''),fallbackOrigin:String(row.fallbackOrigin||''),version:Number.isInteger(row.version)?row.version:0,files:(Array.isArray(row.files)?row.files:[]).filter(file=>file&&file.blob instanceof Blob).slice(0,MAX_FILES),history:Array.isArray(row.history)?row.history.slice(-12):[]};
}
function openDB(){return new Promise((resolve,reject)=>{
 if(!globalThis.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
 const request=indexedDB.open(DB_NAME,1);let settled=false;
 const timer=setTimeout(()=>{settled=true;reject(new Error('IndexedDB timeout'));},4500);
 request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'});};
 request.onsuccess=()=>{clearTimeout(timer);if(settled){request.result.close();return;}settled=true;resolve(request.result);};
 request.onerror=()=>{clearTimeout(timer);settled=true;reject(request.error);};
 request.onblocked=()=>{clearTimeout(timer);settled=true;reject(new Error('IndexedDB blocked'));};
 });}
function transaction(mode,operation){return new Promise((resolve,reject)=>{
 let result;try{const tx=state.db.transaction(STORE,mode),request=operation(tx.objectStore(STORE));if(request)request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||new Error('Storage failed'));tx.onabort=()=>reject(tx.error||new Error('Storage aborted'));}catch(error){reject(error);}
 });}
async function initialize(){
 if(state.ready)return;if(state.loading)return state.loading;
 state.loading=(async()=>{
  if(isLive()){
   try{await pullLive();}
   catch(error){state.mode='closed';state.records=[];state.message=liveError(error);if(error&&error.code==='capability_unavailable')closed();}
   state.ready=true;render();return;
  }
  try{state.db=await openDB();state.records=(await transaction('readonly',store=>store.getAll())).map(normalize).filter(Boolean);await recoverTextDrafts();state.mode='files';state.db.onversionchange=()=>{state.db.close();state.message='数据需要更新。请先复制未保存的文字，再重新打开页面。';notice();};}
  catch{state.mode='text';state.records=textRows();}
  state.ready=true;render();
 })();return state.loading;
}
async function recoverTextDrafts(){
 const fallback=textRows(),recovered=[];if(!fallback.length)return;
 for(const source of fallback){const fingerprint=signature(source);if(state.records.some(row=>row.fallbackOrigin===fingerprint))continue;const existing=state.records.find(row=>row.id===source.id);
  if(existing&&signature(existing)===fingerprint)recovered.push({...existing,fallbackOrigin:fingerprint});
  else recovered.push({...source,id:existing?uid():source.id,title:existing?title(source)+'（恢复稿）':source.title,fallbackOrigin:fingerprint});
 }
 if(recovered.length){await transaction('readwrite',store=>{recovered.forEach(row=>store.put(row));});state.records=[...recovered,...state.records.filter(row=>!recovered.some(item=>item.id===row.id))];}
 // Retained migration markers make a failed cleanup safe to retry.
 C().write(FALLBACK_KEY,[]);
}
async function persist(row){
 if(state.mode==='files')await new Promise((resolve,reject)=>{
  let conflict=false;try{const tx=state.db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get(row.id);request.onsuccess=()=>{if((request.result?.version||0)!==row.version-1){conflict=true;tx.abort();return;}store.put(row);};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('Storage failed'));tx.onabort=()=>reject(new Error(conflict?'VERSION_CONFLICT':'Storage aborted'));}catch(error){reject(error);}
 });
 else{const latest=textRows(),previous=latest.find(item=>item.id===row.id);if((previous?.version||0)!==row.version-1)throw new Error('VERSION_CONFLICT');const all=[row,...latest.filter(item=>item.id!==row.id)];if(!C().write(FALLBACK_KEY,all))throw new Error('Text storage failed');}
 state.records=[row,...state.records.filter(item=>item.id!==row.id)];
}
function localNotice(){return `<div class="contribution-local">${icon('shield')}<p><b>本机试用</b> 内容与附件只保存在本机。模拟审核不会上传或公开。${state.mode==='text'?'<span>本机无法存附件，仍可保存文字草稿。</span>':''}</p></div>`;}
function rowHTML(row){return `<article class="contribution-row"><div class="contribution-row-mark">${icon(row.kind==='作品'?'project':row.kind==='方法笔记'?'book':'pen')}</div><button class="contribution-row-main" data-action="contribution-edit" data-id="${esc(row.id)}"><span class="contribution-row-top"><b>${esc(title(row))}</b><span class="contribution-status ${row.status==='review'?'is-review':''}">${statusText(row)}</span></span><p>${esc(row.summary||'补充问题、做法和结果，让别人更容易理解。')}</p><small>${esc(row.kind)}<span>v${esc(row.version)} · ${stamp(row.updatedAt)}</span>${state.mode==='server'?'':`<span>${row.files.length} 个附件</span>`}</small></button><button class="button ghost contribution-row-open" data-action="contribution-edit" data-id="${esc(row.id)}" aria-label="${row.status==='draft'?'编辑':'查看'}${esc(title(row))}">${icon(row.status==='draft'?'pen':'arrow')}</button></article>`;}
function list(){
 const records=state.records.filter(row=>state.filter==='all'||row.status===state.filter).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const tabs=state.mode==='server'?[['all','全部'],['draft','草稿'],['review','审核中']]:[['all','全部'],['draft','草稿'],['review','模拟待审核']];
 const empty=state.filter==='review'?(state.mode==='server'?'还没有提交审核的内容。':'还没有模拟提交的内容。'):state.filter==='draft'?'还没有保存的草稿。':'还没有投稿，从做过的一件小事开始。';
 return `<div class="contribution-page-head"><span>把做过的事整理成可复用内容</span><div>${isLive()?'':'<span class="pill outline">示例</span>'}<button class="button primary" data-action="contribution-new">${icon('pen')} 写投稿</button></div></div>${isLive()?'':localNotice()}${state.editor&&state.dirty?`<div class="contribution-resume"><div><b>有修改还没保存</b><span>${esc(title(state.editor))} · 只留在当前页面</span></div><button class="button" data-action="contribution-resume">继续编辑 ${icon('arrow')}</button></div>`:''}<div class="contribution-list-tabs" role="group" aria-label="投稿状态">${tabs.map(([key,label])=>`<button data-action="contribution-filter" data-value="${key}" aria-pressed="${state.filter===key}">${label}<span>${state.records.filter(row=>key==='all'||row.status===key).length}</span></button>`).join('')}<button class="contribution-export" data-action="contribution-export">导出文字稿 ${icon('external')}</button></div>${records.length?`<div class="contribution-list">${records.map(rowHTML).join('')}</div>`:`<div class="contribution-empty"><span class="contribution-empty-icon">${icon('pen')}</span><h2>${empty}</h2><button class="button" data-action="contribution-new">写第一份投稿 ${icon('arrow')}</button></div>`}${isLive()?'':'<p class="contribution-storage-note">草稿只存在本机。</p>'}`;
}
function filesHTML(row,editable=true){return row.files.length?row.files.map((file,index)=>`<div class="contribution-file"><span class="contribution-file-icon">${icon(file.type?.startsWith('image/')?'project':'book')}</span><div><b>${esc(file.name)}</b><small>${bytes(file.size)} · ${state.dirty?'随草稿保存':'已存在本机'}</small></div><button type="button" class="button ghost" data-action="contribution-file" data-value="${index}" aria-label="查看${esc(file.name)}">${file.type==='application/pdf'?'下载':'查看'}</button>${file.type!=='application/pdf'?`<button type="button" class="button ghost" data-action="contribution-download-file" data-value="${index}" aria-label="下载${esc(file.name)}">下载</button>`:''}${editable?`<button type="button" class="button ghost" data-action="contribution-remove-file" data-value="${index}" aria-label="移除${esc(file.name)}">移除</button>`:''}</div>`).join(''):'<p class="contribution-no-files">还没有附件。可以先写文字，稍后再补。</p>';}
function reviewNote(row){
 if(row.status!=='review')return '';
 if(state.mode==='server')return '<div class="contribution-review-note"><button class="button" data-action="contribution-withdraw">撤回为草稿</button></div>';
 return '<div class="contribution-review-note"><b>已进入模拟审核状态</b><p>这份内容仍在本机，未发给管理员。要修改正文或附件，先撤回为草稿。</p><button class="button" data-action="contribution-withdraw">撤回为草稿</button></div>';
}
function editor(){
 const row=state.editor,readOnly=row.status!=='draft',disabled=readOnly?'disabled':'',persisted=state.records.some(item=>item.id===row.id);
 return `<h1 class="contribution-sr-only">编辑我的投稿</h1><div class="contribution-editor-head"><button class="back" data-action="contribution-list">${icon('back')} 我的投稿</button><span class="contribution-status ${row.status==='review'?'is-review':''}">${statusText(row)}</span><span class="contribution-save-status" data-contribution-save-status role="status">${state.dirty?'有未保存修改':row.updatedAt?'保存于 '+stamp(row.updatedAt):'尚未保存'}</span></div>${isLive()?'':localNotice()}${reviewNote(row)}<div class="contribution-editor-grid"><form class="contribution-form" data-form="contribution" novalidate><fieldset ${disabled}><legend class="contribution-sr-only">投稿内容</legend><div class="contribution-field contribution-title-field"><label for="contribution-title">标题 <span>80 字以内</span></label><input id="contribution-title" name="title" maxlength="80" placeholder="例如：我怎样用 Agent 整理每周报表" value="${esc(row.title)}" autocomplete="off"></div><div class="contribution-form-pair"><div class="contribution-field"><label for="contribution-kind">内容类型</label><select id="contribution-kind" name="kind">${kinds.map(kind=>`<option ${row.kind===kind?'selected':''}>${kind}</option>`).join('')}</select></div><div class="contribution-field"><label>当前可见范围</label><span class="contribution-scope">${icon('shield')} ${state.mode==='server'?'仅自己':'仅自己 · 只存本机'}</span></div></div><div class="contribution-field"><label for="contribution-summary">一句话介绍 <span>240 字以内</span></label><textarea id="contribution-summary" name="summary" maxlength="240" rows="2" placeholder="做了什么，适合谁参考？">${esc(row.summary)}</textarea></div><div class="contribution-field"><label for="contribution-body">具体内容</label><textarea id="contribution-body" name="body" maxlength="20000" rows="12" placeholder="遇到了什么问题？&#10;你具体怎么做？&#10;结果如何，有哪些不足？">${esc(row.body)}</textarea><span class="contribution-field-note">支持纯文字。链接与代码按文字展示，不执行。</span></div></fieldset>${state.mode==='server'?'':`<div class="contribution-attachments"><div class="contribution-section-head"><h2>附件</h2><span data-contribution-file-count>${row.files.length} / ${MAX_FILES}</span></div><div data-contribution-files>${filesHTML(row,!readOnly)}</div>${!readOnly?`<label class="contribution-file-picker ${state.mode==='text'?'is-disabled':''}">${icon('external')}<span>${state.mode==='text'?'本机暂不能保存附件':'选择图片或文件'}</span><input type="file" data-contribution-file-input accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md" multiple ${state.mode==='text'?'disabled':''}></label><p class="contribution-field-note">最多 5 个文件，共 12 MB。</p>`:''}</div>`}<p class="contribution-feedback" data-contribution-feedback role="status" aria-live="polite">${esc(state.message)}</p><div class="contribution-editor-actions">${!readOnly?`<button class="button primary" type="submit">保存草稿</button>`:''}<button class="button" type="button" data-action="contribution-preview">预览</button>${!readOnly?'<button class="button ghost" type="button" data-action="contribution-submit-review">'+(state.mode==='server'?'提交审核':'模拟提交审核')+'</button>':''}</div></form><aside class="contribution-guide"><div class="contribution-history"><div class="contribution-section-head"><h2>保存记录</h2><span>最近 12 版</span></div>${row.history.length?row.history.slice().reverse().map(version=>`<button type="button" data-action="contribution-version" data-value="${esc(version.version)}"><span><b>v${esc(version.version)}</b> ${esc(version.event)}</span><small>${stamp(version.at)}</small>${icon('arrow')}</button>`).join(''):'<p>第一次保存后，从这里查看之前的文字版本。</p>'}</div>${persisted?'<button class="contribution-delete" data-action="contribution-delete">'+(state.mode==='server'?'删除':'删除草稿')+'</button>':''}</aside></div>`;
}
let showingEditor=false;
function content(){
 if(!state.ready)return '<div class="contribution-loading" role="status">'+(isLive()?'正在读取投稿…':'正在读取本机草稿…')+'</div>';
 if(state.mode==='closed')return '<div class="contribution-empty"><span class="contribution-empty-icon">'+icon('pen')+'</span><h2>'+esc(state.message||'这个功能还没开放')+'</h2><button class="button" data-action="contribution-retry">重试</button></div>';
 return showingEditor&&state.editor?editor():list();
}
function view(){return `<section class="contributions-root" data-contributions-root aria-label="我的投稿">${content()}</section>`;}
function render(focus=''){
 const root=current();if(!root)return;root.innerHTML=content();if(focus)root.querySelector(focus)?.focus({preventScroll:true});
}
function notice(){const node=document.querySelector('[data-contribution-feedback]');if(node)node.textContent=state.message;const save=document.querySelector('[data-contribution-save-status]');if(save)save.textContent=state.busy?'正在保存…':state.dirty?'有未保存修改':state.editor?.updatedAt?'保存于 '+stamp(state.editor.updatedAt):'尚未保存';}
function busy(value){state.busy=value;document.querySelectorAll('.contribution-form button,.contribution-editor-head button,.contribution-review-note button').forEach(button=>button.disabled=value);const fields=document.querySelector('.contribution-form fieldset'),picker=document.querySelector('[data-contribution-file-input]');if(fields)fields.disabled=value||!edited();if(picker)picker.disabled=value||state.mode==='text';notice();}
function capture(form=document.querySelector('[data-form="contribution"]')){if(!form||!edited())return;for(const name of ['title','summary','body','kind']){const node=form.elements.namedItem(name);if(node)state.editor[name]=node.value;}}
function change(){state.dirty=true;state.message='';notice();}
function draft(){return {id:uid(),title:'',kind:kinds[0],summary:'',body:'',status:'draft',createdAt:now(),updatedAt:'',version:0,files:[],history:[]};}
function choose(row){
 if(state.busy)return false;if(state.dirty&&state.editor&&row?.id!==state.editor.id){showingEditor=true;state.message='当前编辑仍未保存。请先保存，或返回列表继续保留这份编辑。';render('#contribution-title');return false;}
 if(state.dirty&&row?.id===state.editor?.id){showingEditor=true;render('#contribution-title');return true;}
 state.editor=row?clone(row):draft();state.dirty=false;state.message='';showingEditor=true;render('#contribution-title');return true;
}
async function saveLive(status){
 if(state.busy||!state.editor)return false;capture();
 if(status==='review'&&(!state.editor.title.trim()||!state.editor.summary.trim()||!state.editor.body.trim())){state.message='提交审核前，请补齐标题、一句话介绍和具体内容。';notice();const missing=['title','summary','body'].find(key=>!state.editor[key].trim());document.getElementById('contribution-'+missing)?.focus();return false;}
 const payload={title:state.editor.title,kind:state.editor.kind,summary:state.editor.summary,body:state.editor.body};
 busy(true);
 try{
  let row=state.editor;
  if(!row.version){const sig='create:'+JSON.stringify(payload);const res=await api().post('/account/contributions',payload,{idempotencyKey:keyFor(sig)});dropKey(sig);row=fromApi(res.data);state.editor=row;state.dirty=false;upsert(row);}
  else if(state.dirty){const sig='update:'+row.id+':'+row.version+':'+JSON.stringify(payload);const res=await api().put('/account/contributions/'+encodeURIComponent(row.id),payload,{idempotencyKey:keyFor(sig),ifMatch:String(row.version)});dropKey(sig);row=fromApi(res.data);state.editor=row;state.dirty=false;upsert(row);}
  if(status==='review'&&row.status==='draft'){const sig='review:'+row.id+':'+row.version;const res=await api().post('/account/contributions/'+encodeURIComponent(row.id)+'/review',{},{idempotencyKey:keyFor(sig),ifMatch:String(row.version)});dropKey(sig);row=fromApi(res.data);state.editor=row;upsert(row);}
  state.dirty=false;state.message=row.status==='review'?'已提交审核。':'草稿已保存。';render(row.status==='review'?'[data-action="contribution-preview"]':'[type="submit"]');return true;
 }catch(error){if(error&&error.code==='capability_unavailable')closed();state.message=liveError(error);notice();return false;}
 finally{busy(false);}
}
async function withdrawLive(){
 const row=state.editor;if(!row||row.status!=='review'||state.busy)return;
 const sig='withdraw:'+row.id+':'+row.version;busy(true);
 try{const res=await api().post('/account/contributions/'+encodeURIComponent(row.id)+'/withdraw',{},{idempotencyKey:keyFor(sig),ifMatch:String(row.version)});dropKey(sig);const fresh=fromApi(res.data);state.editor=fresh;state.dirty=false;upsert(fresh);state.message='已撤回为草稿。';render('#contribution-title');}
 catch(error){state.message=liveError(error);notice();}
 finally{busy(false);}
}
async function removeLive(id,version){
 if(state.busy)return;if(!Number.isInteger(version)||version<1){C().toast('删除确认已失效，请重新打开这份投稿后再确认。');return;}
 const sig='delete:'+id+':'+version;busy(true);
 try{await api().del('/account/contributions/'+encodeURIComponent(id),{},{idempotencyKey:keyFor(sig),ifMatch:String(version)});dropKey(sig);state.records=state.records.filter(item=>item.id!==id);if(state.editor?.id===id){state.editor=null;state.dirty=false;}showingEditor=false;C().closeModal();render();if(routeId())C().go?.('contribute');C().toast('这份投稿已删除。');}
 catch(error){C().toast(liveError(error));}
 finally{busy(false);}
}
async function save(status='draft'){
 if(state.mode==='server')return saveLive(status);
 if(state.busy||!state.editor||!edited())return false;capture();
 if(status==='review'&&(!state.editor.title.trim()||!state.editor.summary.trim()||!state.editor.body.trim())){state.message='模拟提交前，请补齐标题、一句话介绍和具体内容。';notice();const missing=['title','summary','body'].find(key=>!state.editor[key].trim());document.getElementById('contribution-'+missing)?.focus();return false;}
 const row={...clone(state.editor),status,updatedAt:now(),version:state.editor.version+1};row.history=[...row.history,snapshot(row)].slice(-12);
 busy(true);try{await persist(row);state.editor=clone(row);state.dirty=false;state.message=status==='review'?'已保存为模拟待审核，未上传或公开。':'草稿'+(row.files.length?'与 '+row.files.length+' 个附件':'')+'已保存在本机。';render(status==='review'?'[data-action="contribution-preview"]':'[type="submit"]');return true;}catch(error){state.message=error.message==='VERSION_CONFLICT'?'另一页面已修改这份草稿，本次未覆盖。请先导出当前文字稿，再刷新查看新版。附件仍留在本页，可逐个下载。':'保存没有完成，输入和已选附件仍在此页面。请重试；也可以先导出文字稿。';notice();return false;}finally{busy(false);}
}
async function addFiles(input){
 if(state.busy||!edited()||state.mode!=='files')return;capture();const files=Array.from(input.files||[]);input.value='';if(!files.length)return;
 const accepted=[],errors=[];let total=state.editor.files.reduce((sum,file)=>sum+file.size,0);busy(true);
 for(const file of files){try{
  if(state.editor.files.length+accepted.length>=MAX_FILES)throw new Error('最多选 5 个附件，请先移除一些。');
  if(file.size===0||file.size>MAX_FILE)throw new Error(file.size===0?'这个文件是空的，请换一个。':'单个附件不能超过 5 MB，请压缩或换一个。');
  if(total+file.size>MAX_TOTAL)throw new Error('附件合计不能超过 12 MB，请减少附件或压缩。');
  const ext=file.name.split('.').pop().toLowerCase(),head=new Uint8Array(await file.slice(0,16).arrayBuffer());
  const ascii=String.fromCharCode(...head);let type;
  if(ext==='png'&&head[0]===137&&ascii.slice(1,4)==='PNG')type='image/png';
  else if(['jpg','jpeg'].includes(ext)&&head[0]===255&&head[1]===216&&head[2]===255)type='image/jpeg';
  else if(ext==='webp'&&ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP')type='image/webp';
  else if(ext==='pdf'&&ascii.startsWith('%PDF-'))type='application/pdf';
  else if(['txt','md'].includes(ext)){new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());type='text/plain';}
  else throw new Error('这个文件不支持。请换成 PNG、JPEG、WebP、PDF、TXT 或 MD。');
  accepted.push({id:uid(),name:fileName(file),size:file.size,type,blob:new Blob([file],{type})});total+=file.size;
 }catch(error){errors.push(fileName(file)+'：'+error.message);}}
 if(accepted.length){state.editor.files.push(...accepted);state.dirty=true;}
 state.message=[accepted.length?`已选择 ${accepted.length} 个附件，保存草稿后才会存入本机。`:'',...errors].filter(Boolean).join(' ');busy(false);
 const holder=document.querySelector('[data-contribution-files]');if(holder)holder.innerHTML=filesHTML(state.editor);const count=document.querySelector('[data-contribution-file-count]');if(count)count.textContent=state.editor.files.length+' / '+MAX_FILES;notice();
}
function focusDialog(){const dialog=document.querySelector('#dialog'),heading=document.querySelector('#dialog-title');if(dialog)dialog.scrollTop=0;if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}}
function downloadFile(file){if(!file)return;const href=URL.createObjectURL(file.blob),link=document.createElement('a');link.href=href;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);C().toast('正在下载本机附件。');}
function preview(row=state.editor,heading='投稿预览'){
 if(!row)return;capture();revoke();state.previewRecord=row;const meta=state.mode==='server'?esc(row.kind)+' · '+statusText(row)+' · 仅自己':esc(row.kind)+' · '+(row.status==='review'?'模拟待审核':'仅自己可见')+' · 本机内容';C().modal(heading,`<article class="contribution-preview"><div class="contribution-preview-meta">${meta}</div><h2>${esc(title(row))}</h2>${row.summary?`<p class="contribution-preview-summary">${esc(row.summary)}</p>`:''}<div class="contribution-preview-body">${esc(row.body||'还没有具体内容。')}</div>${row.files?.length?`<section class="contribution-preview-files"><h3>附件</h3>${row.files.map((file,index)=>file.type.startsWith('image/')?`<figure><img src="${url(file.blob)}" alt="${esc(file.name)}"><figcaption>${esc(file.name)}</figcaption></figure>`:`<button class="button" data-action="contribution-file" data-value="${index}">${icon('book')} ${esc(file.name)}</button>`).join('')}</section>`:''}</article>`);focusDialog();
}
async function showFile(index){
 const file=(state.previewRecord||state.editor)?.files[index];if(!file)return;if(file.type==='application/pdf'){downloadFile(file);return;}revoke();
 if(file.type.startsWith('image/'))C().modal(file.name,`<figure class="contribution-file-preview"><img src="${url(file.blob)}" alt="${esc(file.name)}"><figcaption>${bytes(file.size)} · 本机附件</figcaption></figure>`);

 else{const text=await file.blob.text();C().modal(file.name,`<pre class="contribution-text-preview">${esc(text)}</pre>`);}
 focusDialog();
}
function exportAll(){
 capture();const rows=state.records.map(row=>({...snapshot(row),id:row.id,status:row.status}));if(state.dirty&&state.editor)rows.unshift({...snapshot({...state.editor,updatedAt:now()}),id:state.editor.id,status:'unsaved',note:'当前尚未保存的编辑'});
 const blob=new Blob([JSON.stringify({format:'commons-contributions-text-v1',exportedAt:now(),note:'仅文字及附件名称，不包含附件文件。模拟状态不代表发布。',items:rows},null,2)],{type:'application/json'}),href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download='先锋社区-我的投稿-文字稿.json';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);C().toast('已导出文字稿。附件文件未包含在导出中。');return rows;
}
async function remove(id,version){
 if(state.mode==='server'){await removeLive(id,version);return;}
 if(isLive()){closed();return;}
 // The confirmation carries the editor revision; workspace reads may refresh records meanwhile.
 if(state.busy)return;if(!Number.isInteger(version)||version<1){C().toast('删除确认已失效，请重新打开这份投稿后再确认。');return;}const row=state.records.find(item=>item.id===id);if(!row)return;busy(true);
 try{
  if(state.mode==='files')await new Promise((resolve,reject)=>{
   let conflict=false;try{const tx=state.db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get(id);request.onsuccess=()=>{if(request.result&&request.result.version!==version){conflict=true;tx.abort();return;}store.delete(id);};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('Delete failed'));tx.onabort=()=>reject(new Error(conflict?'VERSION_CONFLICT':'Delete aborted'));}catch(error){reject(error);}
  });
  else{const latest=textRows(),target=latest.find(item=>item.id===id);if(target&&target.version!==version)throw new Error('VERSION_CONFLICT');const remaining=latest.filter(item=>item.id!==id);if(!C().write(FALLBACK_KEY,remaining))throw new Error('Delete failed');state.records=remaining;}
  state.records=state.records.filter(item=>item.id!==id);if(state.editor?.id===id){state.editor=null;state.dirty=false;}showingEditor=false;document.querySelector('#dialog')?.addEventListener('close',()=>document.querySelector('[data-action="contribution-new"]')?.focus({preventScroll:true}),{once:true});C().closeModal();render();if(routeId())C().go?.('contribute');C().toast('这份本机草稿与附件已删除。');
 }catch(error){C().toast(error.message==='VERSION_CONFLICT'?'另一页面已更新这份投稿，本次没有删除。请刷新确认新版。':'删除未完成，草稿与附件已保留。');}finally{busy(false);}
}
function handle(action,el){
 if(!action.startsWith('contribution-'))return false;
 if(action==='contribution-retry'){state.ready=false;state.loading=null;state.mode='loading';state.message='';void initialize();return true;}
 if(state.busy){C().toast(state.mode==='server'?'正在保存，请稍候。':'正在保存本机内容，请稍候。');return true;}
 if(isLive()&&state.mode!=='server'&&['contribution-new','contribution-from-case','contribution-submit-review','contribution-withdraw','contribution-confirm-delete'].includes(action)){closed();return true;}
 if(action==='contribution-new'){choose(null);return true;}
 if(action==='contribution-from-case'){
  const item=window.COMMONS_FIELDWORK?.items?.find(row=>row.id===el.dataset.id);if(!item){C().toast('这份参考案例暂时无法读取。');return true;}
  if(state.dirty&&state.editor){state.message='你还有一份未保存的编辑，请先保存后再开始新的尝试。';showingEditor=true;C().toast(state.message);navigateToEditor();return true;}
  choose(null);state.editor.kind='实践案例';state.editor.summary=('参考群友实践《'+item.title+'》，记录我自己的实际尝试。').slice(0,240);state.editor.body='参考：群友实践《'+item.title+'》\n\n以下由我补充：\n\n问题：\n\n我的做法：\n\n实际结果：\n\n不足：';change();state.message='已留下参考标题。请写下你自己的做法和结果，再保存草稿。';navigateToEditor();return true;
 }
 if(action==='contribution-edit'){if(state.mode==='server'){void openLive(el.dataset.id).then(row=>{if(choose(row))navigateToEditor();}).catch(error=>C().toast(liveError(error)));return true;}if(!state.ready||!current()){void openById(el.dataset.id);return true;}const row=state.records.find(item=>item.id===el.dataset.id);if(row){choose(row);navigateToEditor();}else C().toast('这份投稿不在本机，可能已被删除。');return true;}
 if(action==='contribution-resume'){showingEditor=true;render('#contribution-title');return true;}
 if(action==='contribution-list'){capture();showingEditor=false;render('[data-action="contribution-new"]');if(routeId())C().go?.('contribute');return true;}
 if(action==='contribution-filter'){state.filter=['all','draft','review'].includes(el.dataset.value)?el.dataset.value:'all';render(`[data-action="contribution-filter"][data-value="${state.filter}"]`);return true;}
 if(action==='contribution-preview'){if(el.dataset.id)void previewById(el.dataset.id);else preview();return true;}
 if(action==='contribution-submit-review'){void save('review');return true;}
 if(action==='contribution-withdraw'){
  if(state.mode==='server'){void withdrawLive();return true;}
  if(state.editor?.status!=='review')return true;const row={...clone(state.editor),status:'draft',updatedAt:now(),version:state.editor.version+1};row.history=[...row.history,{...snapshot(row),event:'撤回为草稿'}].slice(-12);busy(true);
  void persist(row).then(()=>{state.editor=clone(row);state.dirty=false;state.message='已撤回为本机草稿，可以继续编辑。';render('#contribution-title');}).catch(error=>{state.message=error.message==='VERSION_CONFLICT'?'另一页面已修改这份投稿，未覆盖其内容。请刷新后再撤回。':'撤回未完成，原内容已保留。';notice();}).finally(()=>busy(false));return true;
 }
 if(action==='contribution-remove-file'){if(edited()){capture();state.editor.files.splice(Number(el.dataset.value),1);change();render('[data-contribution-file-input]');}return true;}
 if(action==='contribution-file'){void showFile(Number(el.dataset.value)).catch(()=>C().toast('附件读取失败，原文件仍保存在本机。'));return true;}
 if(action==='contribution-download-file'){downloadFile((state.previewRecord||state.editor)?.files[Number(el.dataset.value)]);return true;}
 if(action==='contribution-export'){exportAll();return true;}
 if(action==='contribution-version'){
  const version=state.editor?.history.find(item=>String(item.version)===el.dataset.value);if(version)C().modal('保存记录 · v'+version.version,`<article class="contribution-preview"><div class="contribution-preview-meta">${stamp(version.at)} · ${esc(version.event)} · 只读记录</div><h2>${esc(version.title||'未命名草稿')}</h2><p class="contribution-preview-summary">${esc(version.summary)}</p><div class="contribution-preview-body">${esc(version.body)}</div><p class="contribution-field-note">当时的附件：${version.files?.length?version.files.map(esc).join('、'):'无'}。历史记录只保留附件名称。</p></article>`);focusDialog();return true;
 }
 if(action==='contribution-delete'){const row=state.editor;if(row)C().modal(state.mode==='server'?'删除这份投稿？':'删除这份本机投稿？',`<div class="contribution-delete-confirm"><p>「${esc(title(row))}」${state.mode==='server'?'会从你的投稿里删掉。删除后无法恢复。':'的正文、保存记录和附件会从本机移除。删除后无法恢复。'}</p><div><button class="button" data-action="close-dialog">不删除</button><button class="button danger" data-action="contribution-confirm-delete" data-id="${esc(row.id)}" data-version="${esc(row.version)}">确认删除</button></div></div>`);return true;}
 if(action==='contribution-confirm-delete'){void remove(el.dataset.id,Number(el.dataset.version));return true;}
 return false;
}
function submit(name,form){if(name!=='contribution')return false;capture(form);void save();return true;}
function input(event){if(!event.target.closest('[data-form="contribution"]')||event.target.type==='file')return false;if(edited()){capture();change();}return true;}
function routeId(){const parts=String(globalThis.location?.hash||'').replace(/^#\/?/,'').split('/');if(parts[0]!=='contribute')return '';try{return decodeURIComponent(parts[1]||'');}catch{return '';}}
function navigateToEditor(){
 if(!state.editor||!globalThis.location)return;
 const persisted=state.records.some(row=>row.id===state.editor.id),target=persisted?'contribute/'+encodeURIComponent(state.editor.id):'contribute';
 if(!persisted)state.pendingEditorId=state.editor.id;
 if(globalThis.location.hash!=='#/'+target)C().go?.(target);
 else if(!persisted){state.pendingEditorId=null;showingEditor=true;render('#contribution-title');}
}
async function listSummary(){
 await initialize();
 if(state.mode==='server')return state.records.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).map(row=>({id:row.id,title:title(row),kind:row.kind,summary:row.summary,status:row.status,updatedAt:row.updatedAt,version:row.version,fileCount:0}));
 if(state.mode==='files')state.records=(await transaction('readonly',store=>store.getAll())).map(normalize).filter(Boolean);
 else state.records=textRows();
 return state.records.slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(row=>({id:row.id,title:title(row),kind:row.kind,summary:row.summary,status:row.status,updatedAt:row.updatedAt,version:row.version,fileCount:row.files.length}));
}
async function openById(id){
 const requestedHash=globalThis.location?.hash;
 if(isLive()){try{await initialize();if(globalThis.location?.hash!==requestedHash)return false;if(state.mode!=='server'){closed();return false;}const row=await openLive(id);if(globalThis.location?.hash!==requestedHash)return false;const selected=choose(row);navigateToEditor();return selected;}catch(error){C().toast(liveError(error));return false;}}
 try{await listSummary();if(globalThis.location?.hash!==requestedHash)return false;const row=state.records.find(item=>item.id===id);if(!row){C().toast('这份投稿不在本机，可能已被删除。');return false;}const selected=choose(row);navigateToEditor();return selected;}
 catch{C().toast('投稿没有读出来。刷新后再试；先不要重复新建。');return false;}
}
async function previewById(id){
 const requestedHash=globalThis.location?.hash;
 if(isLive()){try{await initialize();if(globalThis.location?.hash!==requestedHash)return false;if(state.mode!=='server'){closed();return false;}const row=await openLive(id);if(globalThis.location?.hash!==requestedHash)return false;preview(row,'投稿预览');return true;}catch(error){C().toast(liveError(error));return false;}}
 try{await listSummary();if(globalThis.location?.hash!==requestedHash)return false;const row=state.records.find(item=>item.id===id);if(!row){C().toast('这份投稿不在本机，可能已被删除。');return false;}preview(row,'本机作品预览 · 未公开');return true;}
 catch{C().toast('投稿没有读出来。刷新后再试；先不要重复新建。');return false;}
}
let mountEpoch=0,lastMountedRoute=null;
function mount(){
 const epoch=++mountEpoch;if(!current()){lastMountedRoute=null;return;}
 const hash=globalThis.location?.hash||'#/contribute';
 void initialize().then(()=>{
  if(epoch!==mountEpoch||!current()||(globalThis.location?.hash&&globalThis.location.hash!==hash))return;
  const id=routeId();
  if(id&&state.mode==='server'){lastMountedRoute=hash;void openLive(id).then(row=>{if(epoch!==mountEpoch||!current())return;choose(row);navigateToEditor();}).catch(()=>{if(epoch!==mountEpoch||!current())return;showingEditor=false;render();C().toast('这份投稿没有读出来。');});return;}
  if(id){const row=state.records.find(item=>item.id===id);if(row){choose(row);navigateToEditor();}else{showingEditor=false;render();C().toast('这份投稿不在本机，可能已被删除。');}}
  else if(state.pendingEditorId&&state.editor?.id===state.pendingEditorId){state.pendingEditorId=null;showingEditor=true;render('#contribution-title');}
  else if(lastMountedRoute!==hash){showingEditor=false;render();}
  lastMountedRoute=hash;
 });
}
document.addEventListener('change',event=>{if(event.target.matches('[data-contribution-file-input]'))void addFiles(event.target);else if(event.target.matches('#contribution-kind'))input(event);});
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
document.addEventListener('close',event=>{if(event.target.id==='dialog'){revoke();state.previewRecord=null;}},true);
window.CommonsContributions={hub:['contribute'],view,handle,submit,input,mount,listSummary,openById,previewById,count:()=>state.records.length,exportAll,storage:{database:DB_NAME,store:STORE,fallback:FALLBACK_KEY}};
})();

/** Runs the emitted next-workspace runtime with synthetic fixtures; no live providers. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Script, createContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
const built = await build({entryPoints:['src/workspace-ui.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {workspaceHtml} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const html=workspaceHtml('QA <script>',{}),source=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
new Script(source);
const testFilter=process.env.WORKSPACE_UI_TEST_MATCH?new RegExp(process.env.WORKSPACE_UI_TEST_MATCH):null;
let passed=0;const check=async(name,fn)=>{if(testFilter&&!testFilter.test(name))return;await fn();console.log('ok '+(++passed)+' - '+name);};
function documentDouble(){const doc={activeElement:null,hidden:false};class Node{constructor(tag='',text=''){this.nodeType=tag?1:3;this.tagName=tag.toUpperCase();this.childNodes=[];this.attrs={};this.dataset={};this.events={};this.style={};this.scrollHeight=240;this._text=text;this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.open=false;this.parentNode=null;}get id(){return this.attrs.id||'';}set id(v){this.attrs.id=v;}get className(){return this.attrs.class||'';}set className(v){this.attrs.class=v;}get disabled(){return this.attrs.disabled!==undefined;}set disabled(v){if(v)this.attrs.disabled='';else delete this.attrs.disabled;}get hidden(){return this.attrs.hidden!==undefined;}set hidden(v){if(v)this.attrs.hidden='';else delete this.attrs.hidden;}get open(){return this.attrs.open!==undefined;}set open(v){if(v)this.attrs.open='';else delete this.attrs.open;}get children(){return this.childNodes.filter(n=>n.nodeType===1);}get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}get textContent(){return this.nodeType===3?this._text:this.childNodes.map(n=>n.textContent).join('');}set textContent(t){this.replaceChildren(new Node('',String(t)));}setAttribute(k,v){this.attrs[k]=String(v);if(k==='value')this.value=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}append(...nodes){for(const n of nodes){const item=n?.nodeType?n:new Node('',String(n));item.parentNode=this;this.childNodes.push(item);}if(this.tagName==='SELECT')this.value=(this.children.find(n=>n.attrs.selected!==undefined)||this.children[0])?.value||'';}prepend(...nodes){const old=this.childNodes;this.childNodes=[];this.append(...nodes,...old);}replaceChildren(...nodes){this.childNodes.forEach(n=>n.parentNode=null);this.childNodes=[];this.append(...nodes);}replaceWith(...nodes){if(!this.parentNode)return;const parent=this.parentNode,index=parent.childNodes.indexOf(this),items=nodes.map(n=>n?.nodeType?n:new Node('',String(n)));for(const item of items)item.parentNode=parent;parent.childNodes.splice(index,1,...items);this.parentNode=null;}remove(){if(!this.parentNode)return;this.parentNode.childNodes=this.parentNode.childNodes.filter(n=>n!==this);this.parentNode=null;}matches(q){const tag=q.match(/^[a-z0-9]+/)?.[0],id=q.match(/#([\w-]+)/)?.[1],cls=q.match(/\.([\w-]+)/)?.[1];return (!tag||this.tagName===tag.toUpperCase())&&(!id||this.id===id)&&(!cls||this.className.split(' ').includes(cls))&&this.nodeType===1;}querySelectorAll(q){return this.children.flatMap(n=>[...(n.matches(q)?[n]:[]),...n.querySelectorAll(q)]);}querySelector(q){return this.querySelectorAll(q)[0]||null;}addEventListener(e,fn){(this.events[e]||=[]).push(fn);}async dispatch(e){for(const f of this.events[e]||[])await f({target:this,currentTarget:this,preventDefault(){}});}async click(){if(!this.disabled)await this.dispatch('click');}focus(){doc.activeElement=this;}select(){this.selected=true;}reportValidity(){if(this.tagName==='FORM')return this.querySelectorAll('input').concat(this.querySelectorAll('textarea')).every(n=>n.reportValidity());return this.attrs.required===undefined||!!this.value;}get outerHTML(){throw new Error('No HTML parsing permitted');}}
 doc.body=new Node('body');doc.createElement=tag=>new Node(tag);doc.createElementNS=(ns,tag)=>{const n=new Node(tag);n.namespaceURI=ns;return n;};doc.createTextNode=t=>new Node('',String(t));doc.querySelector=s=>doc.body.querySelector(s);doc.querySelectorAll=s=>doc.body.querySelectorAll(s);doc.events={};doc.addEventListener=(event,handler)=>{(doc.events[event]||=[]).push(handler);};doc.dispatch=async event=>{for(const handler of doc.events[event]||[])await handler({type:event,target:doc,preventDefault(){}});};doc.createRange=()=>({selectNodeContents(){}});for(const[,tag,attrs]of html.matchAll(/<([a-z]+)\b([^>]*\bid="[^"]+"[^>]*)>/g)){const node=new Node(tag);for(const[,k,v]of attrs.matchAll(/([\w-]+)="([^"]*)"/g))node.setAttribute(k,v);doc.body.append(node);}doc.body.dataset={hosted:'false',assets:'{}'};return doc;}
const now=new Date().toISOString();
const agent={id:'claude',handle:'claude',name:'Claude',platform:'claude',platform_label:'Claude',connects:'mcp',can_work:true,can_request:true,last_seen_at:null};
const settings={purpose:'',initiative:false,permitted_collaborators:['*'],allowed_request_categories:['task'],allowed_work_categories:['task'],sharing:{instructions:'Relevant supplied context only.',approved_sources:[],recipient_rules:[]},standing_responsibilities:[],authorization_boundaries:[],background:{method:'manual',interval_minutes:null},instructions:{profile:'judgment',custom_prompt:null},setup_background:null};
const config={agent_id:'claude',version:0,settings,onboarding:{surface:'chat',step:'connect',provider:'claude'},readiness:{access:{verified:false,last_seen_at:null},collaboration:{verified:false},peer_collaboration:{verified:false},background:{verified:false,observed_runs:0}},release:{enabled:true},roster:[]};
const overview={agents:[agent],jobs:[],platforms:[{id:'claude',label:'Claude',blurb:'Chat',defaults:{work_types:['task'],poll_minutes:null}}]};
const guide={surface:'chat',surfaces:[{id:'chat',label:'Claude chat',prerequisites:['Use desktop if connector settings are missing.'],steps:[{title:'Add custom connector',text:'Open Claude settings.',copy:'https://api.example.test/mcp'}],recovery:['Check your account.'],sources:[]}],accessPrompt:'Confirm connection claude without sending work.',collaborationPrompt:'Refresh configuration; send relevant context only.',backgroundPrompt:'Verify a provider schedule.'};
// Optional deterministic time drives the actual browser timeout and event callbacks.
function mockClock(start=Date.parse('2026-10-03T12:00:00Z')){
  let current=start,nextId=0;const pending=new Map();
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[current]));}static now(){return current;}}
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {Date:ClockDate,get now(){return current;},get pending(){return [...pending.values()].map(timer=>({id:timer.id,at:timer.at}));},
    setTimeout:(callback,delay=0,...args)=>{const id=++nextId;pending.set(id,{id,at:current+Math.max(0,Number(delay)||0),callback,args});return id;},
    clearTimeout:id=>pending.delete(id),flush,
    async advance(ms){const until=current+ms;assert.ok(ms>=0);let count=0;await flush();
      while(true){const next=[...pending.values()].filter(timer=>timer.at<=until).sort((a,b)=>a.at-b.at||a.id-b.id)[0];if(!next)break;
        assert.ok(++count<10000,'Unexpected timer loop');current=next.at;pending.delete(next.id);await next.callback(...next.args);await flush();
      }current=until;await flush();
    }
  };
}
function runtime(fixtures={},options={}){const clock=options.clock,doc=documentDouble(),calls=[],copied=[],storage=new Map(),location={hash:'#/agents',pathname:'/beta',search:'',origin:'https://example.test'},window={events:{},addEventListener(event,handler){(this.events[event]||=[]).push(handler);},async dispatch(event){for(const handler of this.events[event]||[])await handler({type:event,target:this,preventDefault(){}});},scrollTo(){},getSelection:()=>({removeAllRanges(){},addRange(){}})};doc.body.dataset.hosted=options.hosted?'true':'false';const responses={'/v1/admin/overview':overview,'/v1/workspace/release':{enabled:true},'/v1/agents/claude/collaboration':config,'/v1/agents/claude/activation':{activation:null},'/v1/admin/agents/claude/setup?surface=chat':{guide},'/v1/admin/agents/claude/setup?surface=cloud':{guide},...fixtures};const context=createContext({document:doc,window,location,history:{replaceState(_state,_title,href){if(typeof href!=='string')return;const hash=href.indexOf('#'),search=href.indexOf('?');if(href.startsWith('#')){location.hash=href;return;}location.search=search>=0?href.slice(search,hash>=0?hash:undefined):'';location.hash=hash>=0?href.slice(hash):'';}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},navigator:{clipboard:{writeText:async text=>{copied.push(text);}}},URL,URLSearchParams,AbortController,Blob,crypto:{randomUUID},Date:clock?.Date||Date,setTimeout:clock?.setTimeout||(()=>1),clearTimeout:clock?.clearTimeout||(()=>{}),confirm:()=>true,fetch:async(path,opts)=>{calls.push({path,opts,at:clock?.now??Date.now()});const body=responses[path],value=typeof body==='function'?await body(opts):body||{};return {ok:!value.__status||(value.__status>=200&&value.__status<300),status:value.__status||200,headers:{get:name=>Object.entries(value.__headers||{}).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1]??null},json:async()=>JSON.parse(JSON.stringify(value.__body||value))};}});const injected=source.replace('  boot();','  window.test={el,sharedContext,requestControls,conversationState,homePage,chooserPage,connectIntent,createConnection,setupPage,assistantPage,assistantStatus,nextStop,pasteLine,watchConnection,checkConnection,updateSetupStatus,adoptIntent,signOut,clearLegacyDrafts,fetchOverview,refresh,schedule,boot,setSession:s=>session=s,activityPage,conversationPage,settingsPage,copybox,parseRoute,openWorkspace,setState:(o,c)=>{overview=o;configs=new Map(c);signedIn=true;},render,api};');new Script(injected).runInContext(context);window.test.setState(JSON.parse(JSON.stringify(overview)),[['claude',JSON.parse(JSON.stringify(config))]]);return {doc,context,api:window.test,calls,copied,storage,location,clock};}
const collaborationPath='/v1/agents/claude/collaboration';
const query=(nodes,selector)=>[nodes].flat().flatMap(node=>node.querySelectorAll(selector));
const content=nodes=>[nodes].flat().map(node=>node.textContent).join('');
const button=(nodes,label)=>{const found=query(nodes,'button').find(node=>node.textContent===label);assert.ok(found,'Missing button: '+label);return found;};
const writes=r=>r.calls.filter(call=>call.opts.method!=='GET');
const settle=async(rounds=6)=>{for(let i=0;i<rounds;i++)await new Promise(resolve=>setImmediate(resolve));};
const phone=r=>{r.context.window.matchMedia=()=>({matches:true,addEventListener(){}});};
const minutesAgo=minutes=>new Date(Date.now()-minutes*60000).toISOString();
const routineAgent=(id,name)=>({...agent,id,name,platform:id,platform_label:name,connects:'routine'});
// A tap on a chooser row is what allows a create; links only ask.
const tap=async(r,id)=>{await r.api.chooserPage(true).querySelectorAll('a').find(a=>a.getAttribute('href')==='#/connect/'+id).click();};

await check('shell escapes names, keeps a labeled settings route, readable sizes and only self-hosted fonts',()=>{
  assert.match(html,/QA &lt;script&gt;/);assert.match(html,/viewport-fit=cover/);assert.match(html,/aria-label="Workspace settings"/);assert.doesNotMatch(html,/<dialog|aria-modal/);
  assert.match(html,/min-height:44px/);assert.match(html,/font-size:16px/);assert.doesNotMatch(html,/fonts\.googleapis|fonts\.gstatic/);
  const fonted=workspaceHtml('QA',{assets:{'assets/fonts/Inter-Regular.woff2':'/_hitchhike-assets/Inter-Regular.0123abcd.woff2','assets/fonts/InterDisplay-SemiBold.woff2':'javascript:alert(1)'}});
  assert.match(fonted,/@font-face\{font-family:"Inter";src:url\("\/_hitchhike-assets\/Inter-Regular\.0123abcd\.woff2"\)/);
  assert.doesNotMatch(fonted,/url\("javascript|href="javascript/);
  assert.match(fonted,/rel="preload" href="\/_hitchhike-assets\/Inter-Regular\.0123abcd\.woff2" as="font"/);
});
await check('untrusted agent content stays text and does not become HTML',()=>{const r=runtime();const data=structuredClone(overview);data.agents[0].name='<img src=x onerror=alert(1)>';r.api.setState(data,[['claude',config]]);const node=r.api.homePage();assert.ok(node.textContent.includes('<img src=x onerror=alert(1)>'));assert.equal(node.querySelectorAll('img').some(img=>img.getAttribute('src')==='x'),false);});
await check('core text and control colors meet WCAG AA contrast targets',()=>{
  const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;};
  const ratio=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(values[0]+0.05)/(values[1]+0.05);};
  const token=name=>html.match(new RegExp('--'+name+':(#[a-f0-9]{6})','i'))[1];
  for(const name of ['ink','ink-soft','muted','action','green-text','warn-text','danger'])assert.ok(ratio(token(name),'#ffffff')>=4.5,name);
  assert.ok(ratio(token('muted'),token('mist'))>=4.5,'muted on mist');assert.ok(ratio(token('ink'),token('orange'))>=4.5,'ink on orange buttons');
  assert.ok(ratio(token('amber'),token('night'))>=4.5,'amber status text');assert.ok(ratio(token('strong'),'#ffffff')>=3,'checkbox borders');
});

await check('an empty workspace opens on the assistant chooser with one choice per account',async()=>{
  const r=runtime({'/v1/admin/overview':{...overview,agents:[]}});await r.api.openWorkspace();
  const main=r.doc.querySelector('#main'),text=main.textContent;
  assert.match(text,/Which assistant do you use\?/);assert.match(text,/Pick one to start/);
  assert.deepEqual(main.querySelectorAll('a').map(a=>a.getAttribute('href')).filter(href=>href.startsWith('#/connect/')).slice(0,5),['#/connect/claude','#/connect/chatgpt','#/connect/claude-code','#/connect/grok-bot','#/connect/muse']);
  assert.match(text,/Also covers Claude Duet/);assert.match(text,/Also covers Dots and Codex/);assert.match(text,/Send it one message/);
  for(const removed of ['Connect your first agent','Connect an agent','Check now','Status updated','doesn’t wake','Dots (OpenAI)','Experimental'])assert.ok(!text.includes(removed),removed);
  const more=main.querySelectorAll('button').find(node=>node.textContent.includes('More assistants'));
  assert.equal(more.getAttribute('aria-expanded'),'false');assert.equal(main.querySelector('#more-assistants').hidden,true);
  await more.click();assert.equal(more.getAttribute('aria-expanded'),'true');assert.equal(main.querySelector('#more-assistants').hidden,false);
  assert.deepEqual(main.querySelector('#more-assistants').querySelectorAll('a').map(a=>a.getAttribute('href')),['#/connect/grok','#/connect/openclaw','#/connect/other']);
  assert.equal(writes(r).length,0);
});
await check('on a phone the chooser groups assistants by where they can be added',()=>{
  const r=runtime();phone(r);r.api.setState({...overview,agents:[]},[]);
  const node=r.api.chooserPage(false),text=node.textContent;
  assert.ok(text.indexOf('Works from this phone')<text.indexOf('Claude')&&text.indexOf('Muse')<text.indexOf('Add once from a computer')&&text.indexOf('Add once from a computer')<text.indexOf('ChatGPT'));
  assert.deepEqual(node.querySelectorAll('a').map(a=>a.getAttribute('href')).slice(0,5),['#/connect/claude','#/connect/grok-bot','#/connect/muse','#/connect/chatgpt','#/connect/claude-code']);
});
await check('one tap adds an assistant with the existing defaults and opens its setup without a naming step',async()=>{
  let data={...overview,agents:[]};const created={...agent};
  const r=runtime({'/v1/admin/overview':()=>data,'/v1/admin/agents':()=>{data={...data,agents:[created]};return {agent:created,token:'never-shown'};},'/v1/agents/claude/onboarding':config,
    [collaborationPath]:opts=>opts.method==='PUT'?{...config,version:1,settings:{...config.settings,purpose:JSON.parse(opts.body).purpose}}:config});
  r.api.setState(data,[]);await tap(r,'claude');r.location.hash='#/connect/claude';await r.api.render();await settle();
  assert.deepEqual(writes(r).map(call=>[call.path,call.opts.method]),[['/v1/admin/agents','POST'],['/v1/agents/claude/onboarding','PATCH'],[collaborationPath,'PUT']]);
  assert.deepEqual(JSON.parse(writes(r)[0].opts.body),{id:'claude',name:'Claude',platform:'claude',work_types:['task'],poll_minutes:null,can_request:true,can_work:true});
  assert.deepEqual(JSON.parse(writes(r)[1].opts.body),{provider:'claude',step:'connect'});
  assert.deepEqual(JSON.parse(writes(r)[2].opts.body),{expected_version:0,purpose:'Writing, research and planning',setup_background:{enabled:true,interval_minutes:60}});
  assert.equal(r.location.hash,'#/setup/claude');
  const main=r.doc.querySelector('#main');assert.match(main.textContent,/Add Hitchhike to Claude/);assert.equal(main.querySelectorAll('input').length,0);
  assert.equal([...r.storage.keys()].some(key=>key.includes('new-connection')),false);
});
await check('choosing an assistant you already added reopens it instead of creating another',async()=>{
  for(const [platform,existing,target] of [['claude',{...agent},'#/setup/claude'],['claude',{...agent,last_seen_at:now},'#/agents/claude'],['chatgpt',{...agent,id:'cleo',name:'Cleo',platform:'dot'},'#/setup/cleo']]){
    const c={...structuredClone(config),agent_id:existing.id};
    const r=runtime({['/v1/agents/'+existing.id+'/collaboration']:c,'/v1/admin/overview':{...overview,agents:[existing]}});r.api.setState({...overview,agents:[existing]},[[existing.id,c]]);
    r.location.hash='#/connect/'+platform;await r.api.render();await settle();
    assert.equal(r.location.hash,target,platform);assert.equal(writes(r).length,0);
  }
  const r=runtime();r.api.setState(overview,[]);r.location.hash='#/connect/not-a-platform';await r.api.render();await settle();assert.equal(r.location.hash,'#/add');assert.equal(writes(r).length,0);
});
await check('a link or sign-in intent asks before adding, and only an in-app tap creates',async()=>{
  let data={...overview,agents:[]};
  const r=runtime({'/v1/admin/overview':()=>data,'/v1/admin/agents':()=>{data={...data,agents:[{...agent}]};return {agent:{...agent}};}});
  r.api.setState(data,[]);r.location.hash='#/connect/claude';await r.api.render();await settle();
  const main=r.doc.querySelector('#main');assert.match(main.textContent,/Add Claude to Hitchhike/);assert.equal(writes(r).length,0,'Arriving from a link creates nothing');
  await r.api.render();await settle();assert.equal(writes(r).length,0,'Reloading the link still creates nothing');
  await button(main,'Add Claude').click();await settle();
  assert.equal(writes(r).filter(call=>call.path==='/v1/admin/agents').length,1);assert.equal(r.location.hash,'#/setup/claude');
  await tap(r,'muse');r.location.hash='#/connect/grok-bot';await r.api.render();await settle();
  assert.equal(writes(r).filter(call=>call.path==='/v1/admin/agents').length,1,'A tap on one assistant does not arm another');
  assert.match(r.doc.querySelector('#main').textContent,/Add Grok Bot to Hitchhike/);
  r.location.hash='#/connect/muse';await r.api.render();await settle();
  assert.equal(writes(r).filter(call=>call.path==='/v1/admin/agents').length,1,'An armed tap is used once, then forgotten');
});
await check('a lost create response reopens the saved connection, and a real failure offers a retry',async()=>{
  let data={...overview,agents:[]},attempts=0;
  const r=runtime({'/v1/admin/overview':()=>data,'/v1/admin/agents':()=>{attempts++;data={...data,agents:[{...agent}]};return {__status:502,__body:{error:{code:'bad_gateway',message:'Upstream reset.'}}};}});
  r.api.setState(data,[]);await tap(r,'claude');r.location.hash='#/connect/claude';await r.api.render();await settle();
  assert.equal(attempts,1);assert.equal(r.location.hash,'#/setup/claude');assert.match(r.doc.querySelector('#main').textContent,/Add Hitchhike to Claude/);
  const failed=runtime({'/v1/admin/overview':{...overview,agents:[]},'/v1/admin/agents':{__status:403,__body:{error:{code:'connection_limit',message:'Connection limit reached.'}}}});
  failed.api.setState({...overview,agents:[]},[]);await tap(failed,'claude');failed.location.hash='#/connect/claude';await failed.api.render();await settle();
  const text=failed.doc.querySelector('#main').textContent;assert.match(text,/Couldn’t add Claude/);assert.match(text,/Connection limit reached/);
  assert.ok(button(failed.doc.querySelector('#main'),'Try again'));assert.equal(failed.location.hash,'#/connect/claude');
});

const claudeGuide={...guide,surfaces:[{...guide.surfaces[0],steps:[{title:'Add a custom connector',text:'Open Claude settings.',copy:'https://api.example.test/mcp/connections/claude'}]}]};
await check('Claude setup puts its link first, then three stations and a live status, with nothing to paste or finish',async()=>{
  const r=runtime({'/v1/admin/agents/claude/setup?surface=chat':{guide:claudeGuide}},{hosted:true});
  for(const step of ['connect','exchange','instructions']){
    const node=await r.api.setupPage('claude',step),text=node.textContent;
    assert.match(text,/Add Hitchhike to Claude/);assert.ok(text.indexOf('api.example.test')<text.indexOf('Open Settings → Connectors'),'link above the steps');
    assert.deepEqual(node.querySelectorAll('li').filter(li=>li.className==='stop').map(li=>li.textContent),['1Open Settings → Connectors','2Tap Add custom connector and paste the link','3Sign in and tap Connect Claude','Say “Set up Hitchhike” in any Claude chatIt works in Claude Duet too.']);
    for(const removed of ['Finish setup','Continue','Ready when you are','Give this to','Working preferences','Introduction','Save and finish later','connection_status','Background'])assert.ok(!text.includes(removed),removed);
    assert.match(node.querySelector('#setup-led').textContent,/Waiting for Claude to connect…/);
    const help=button(node,'Don’t see Add custom connector?');assert.equal(node.querySelector('#setup-help').hidden,true);await help.click();assert.equal(node.querySelector('#setup-help').hidden,false);
    await button(node,'Copy').click();assert.equal(r.copied.at(-1),'https://api.example.test/mcp/connections/claude');
  }
  assert.equal(writes(r).length,0);
});
await check('the setup status turns connected on first contact, pauses while hidden and then stops checking',async()=>{
  const clock=mockClock();let seen=null;
  const r=runtime({'/v1/admin/overview':()=>({...overview,agents:[{...agent,last_seen_at:seen}]}),'/v1/admin/agents':()=>({agents:[{...agent,last_seen_at:seen}]}),'/v1/admin/agents/claude/setup?surface=chat':{guide:claudeGuide}},{clock});
  r.location.hash='#/setup/claude';await r.api.openWorkspace();await clock.flush();await settle();
  const checks=()=>r.calls.filter(call=>call.path==='/v1/admin/agents').length,led=()=>r.doc.querySelector('#setup-led');
  await clock.advance(4000);assert.equal(checks(),1);assert.match(led().textContent,/Waiting for Claude/);
  r.doc.hidden=true;await clock.advance(4000);assert.equal(checks(),1,'A hidden page does not check');
  seen=new Date(clock.now).toISOString();r.doc.hidden=false;await r.doc.dispatch('visibilitychange');await clock.advance(400);
  assert.equal(checks(),2);assert.match(led().textContent,/Claude is connected/);assert.equal(led().getAttribute('data-on'),'true');
  assert.equal(led().querySelector('a').getAttribute('href'),'#/agents');
  await clock.advance(10*60000);assert.equal(checks(),2,'No more checks once contact is observed');
  assert.equal(writes(r).length,0);
});
await check('Grok Bot pairing shows one fresh code, renews it only after it expires, and stops once connected',async()=>{
  const clock=mockClock();let issued=0,seen=null;const bot=routineAgent('grok-bot','Grok Bot');
  const botConfig={...structuredClone(config),agent_id:'grok-bot',onboarding:{surface:'chat',step:'connect',provider:'grok-bot'}};
  const current=()=>[{...bot,last_seen_at:seen}];
  const r=runtime({'/v1/admin/overview':()=>({...overview,agents:current()}),'/v1/admin/agents':()=>({agents:current()}),'/v1/agents/grok-bot/collaboration':botConfig,
    '/v1/admin/agents/grok-bot/setup?surface=chat':{guide:{steps:[{title:'Pair this agent',text:'Create a code.'}]}},
    '/v1/admin/agents/grok-bot/pairing':()=>{issued++;return {code:'pair_fixture',expires_at:new Date(clock.now+600000).toISOString(),instructions:'PAIRING MESSAGE '+issued};}},{clock,hosted:true});
  r.location.hash='#/setup/grok-bot';await r.api.openWorkspace();await clock.flush();await settle();
  const main=()=>r.doc.querySelector('#main');
  assert.equal(issued,1);assert.equal(main().querySelector('#pair-message').textContent,'PAIRING MESSAGE 1');
  assert.match(main().textContent,/Send Grok Bot this message\. It connects itself and checks for requests every 10 minutes\./);
  assert.match(main().textContent,/One-time code/);assert.match(main().textContent,/Checks every 10 minutes/);assert.match(main().textContent,/renews while this page is open/);
  await button(main(),'Copy message').click();assert.equal(r.copied.at(-1),'PAIRING MESSAGE 1');
  await clock.advance(599000);assert.equal(issued,1,'A code is not replaced while it can still be used');
  await clock.advance(2000);assert.equal(issued,2);assert.equal(main().querySelector('#pair-message').textContent,'PAIRING MESSAGE 2');
  seen=new Date(clock.now).toISOString();await clock.advance(120000);
  assert.match(r.doc.querySelector('#setup-led').textContent,/Grok Bot is connected/);
  await clock.advance(900000);assert.equal(issued,2,'No new codes after Grok Bot connects');
  assert.deepEqual(writes(r).map(call=>call.path),['/v1/admin/agents/grok-bot/pairing','/v1/admin/agents/grok-bot/pairing']);
});
await check('a reload does not silently replace a pairing code someone may have just sent',async()=>{
  const bot=routineAgent('grok-bot','Grok Bot'),tab=new Map();let issued=0;
  const fixtures={'/v1/agents/grok-bot/collaboration':{...structuredClone(config),agent_id:'grok-bot'},'/v1/admin/agents/grok-bot/setup?surface=chat':{guide:{steps:[]}},'/v1/admin/agents/grok-bot/pairing':()=>{issued++;return {code:'pair_fixture',expires_at:new Date(Date.now()+600000).toISOString(),instructions:'MESSAGE '+issued};}};
  const tabStorage={getItem:key=>tab.get(key)??null,setItem:(key,value)=>tab.set(key,value)};
  const first=runtime(fixtures,{hosted:true});first.context.sessionStorage=tabStorage;first.api.setState({...overview,agents:[bot]},[]);
  await first.api.setupPage('grok-bot');await settle();assert.equal(issued,1);
  const reloaded=runtime(fixtures,{hosted:true});reloaded.context.sessionStorage=tabStorage;reloaded.api.setState({...overview,agents:[bot]},[]);
  const node=await reloaded.api.setupPage('grok-bot');await settle();assert.equal(issued,1,'Reloading keeps the code that may be in flight');
  assert.match(node.textContent,/still works/);await button(node,'Make a new message').click();await settle();assert.equal(issued,2);
  assert.equal(node.querySelector('#pair-message').textContent,'MESSAGE 2');
  assert.equal([...tab.values()].some(value=>/pair_|MESSAGE/.test(value)),false,'Only expiry times are kept in the tab');
});
await check('changing how often a paired assistant checks saves it and issues a matching message',async()=>{
  let version=0,issued=0,saved=null;const muse=routineAgent('muse','Muse');
  const museConfig=()=>({...structuredClone(config),agent_id:'muse',version,onboarding:{surface:'chat',step:'connect',provider:'muse'},settings:{...config.settings,setup_background:saved}});
  const r=runtime({'/v1/agents/muse/collaboration':opts=>{if(opts.method==='PUT'){const body=JSON.parse(opts.body);assert.equal(body.expected_version,version);saved=body.setup_background;version++;}return museConfig();},
    '/v1/admin/agents/muse/setup?surface=chat':{guide:{steps:[]}},'/v1/admin/agents/muse/pairing':()=>{issued++;return {code:'pair_x',expires_at:new Date(Date.now()+600000).toISOString(),instructions:'MUSE MESSAGE '+issued};}},{hosted:true});
  r.api.setState({...overview,agents:[muse]},[]);
  const node=await r.api.setupPage('muse');await settle();
  assert.equal(issued,1);const select=node.querySelector('select');assert.equal(select.value,'10');
  select.value='30';await select.dispatch('change');await settle();
  assert.deepEqual(saved,{enabled:true,interval_minutes:30});assert.equal(issued,2);
  assert.match(node.textContent,/Checks every 30 minutes/);assert.match(node.textContent,/checks for requests every 30 minutes\./);
  assert.equal(node.querySelector('#pair-message').textContent,'MUSE MESSAGE 2');
  select.value='off';await select.dispatch('change');await settle();
  assert.deepEqual(saved,{enabled:false,interval_minutes:null});assert.match(node.textContent,/Checks when you ask/);
});
await check('self-hosted pairing shows the private message from the guide without minting codes',async()=>{
  const bot=routineAgent('grok-bot','Grok Bot');
  const r=runtime({'/v1/agents/grok-bot/collaboration':{...structuredClone(config),agent_id:'grok-bot'},'/v1/admin/agents/grok-bot/setup?surface=chat':{guide:{steps:[{title:'Pair this agent',text:'Paste it.',copy:'PRIVATE KEY MESSAGE'}]}}});
  r.api.setState({...overview,agents:[bot]},[]);
  const node=await r.api.setupPage('grok-bot');assert.equal(node.querySelector('#pair-message').textContent,'PRIVATE KEY MESSAGE');
  assert.match(node.textContent,/Private key/);assert.match(node.textContent,/Send it only to Grok Bot/);assert.equal(writes(r).length,0);
});
await check('Claude Code and Codex get one paste-in line built from their exact command',async()=>{
  const code={...agent,id:'claude-code',name:'Claude Code',platform:'claude-code',platform_label:'Claude Code',can_work:false};
  const command="claude mcp add --scope user --transport http hitchhike 'https://api.example.test/mcp/connections/claude-code'";
  const r=runtime({'/v1/agents/claude-code/collaboration':{...structuredClone(config),agent_id:'claude-code',onboarding:{surface:'terminal',step:'connect',provider:'claude-code'}},
    '/v1/admin/agents/claude-code/setup?surface=terminal':{guide:{surface:'terminal',surfaces:[{id:'terminal',steps:[{title:'Add the server',text:'Run this.',copy:command}]}]}}},{hosted:true});
  r.api.setState({...overview,agents:[code]},[]);
  const node=await r.api.setupPage('claude-code');
  await button(node,'Copy line').click();
  assert.equal(r.copied.at(-1),'Add Hitchhike for me: run '+command+', then tell me to type /mcp and choose Hitchhike to sign in.');
  assert.deepEqual(node.querySelector('nav').querySelectorAll('a').map(a=>a.getAttribute('href')),['#/connect/claude-code','#/connect/codex']);
  assert.match(node.querySelector('#setup-led').textContent,/Waiting for Claude Code…/);
  assert.equal(r.api.pasteLine('codex',"codex mcp add hitchhike --url 'https://x.test/mcp/connections/codex'\ncodex mcp login hitchhike").text,"Add Hitchhike for me: run codex mcp add hitchhike --url 'https://x.test/mcp/connections/codex', then tell me to run codex mcp login hitchhike and sign in.");
  assert.equal(writes(r).length,0);
});
await check('on a phone, assistants that need a computer offer to send their setup there',async()=>{
  const chat={...agent,id:'chatgpt',name:'ChatGPT',platform:'chatgpt',platform_label:'ChatGPT'};
  const r=runtime({'/v1/agents/chatgpt/collaboration':{...structuredClone(config),agent_id:'chatgpt'},'/v1/admin/agents/chatgpt/setup?surface=chat':{guide}});phone(r);
  r.api.setState({...overview,agents:[chat]},[]);
  const node=await r.api.setupPage('chatgpt');assert.match(node.textContent,/ChatGPT needs a computer once/);assert.match(node.textContent,/This phone/);
  await button(node,'Send to my computer').click();
  assert.equal(r.copied.at(-1),'Add Hitchhike to ChatGPT from a computer: open this link, sign in, and follow the three steps.\nhttps://example.test/beta#/setup/chatgpt');
  assert.equal(writes(r).length,0);
});

await check('home shows one plain status per assistant from what Hitchhike observed',()=>{
  const r=runtime();const agents=[{...agent,last_seen_at:minutesAgo(3)},{...routineAgent('grok-bot','Grok Bot'),last_seen_at:minutesAgo(4)},{...routineAgent('muse','Muse'),last_seen_at:minutesAgo(240)},{...agent,id:'codex',name:'Codex',platform:'codex'},{...agent,id:'grok',name:'Grok',platform:'grok'}];
  r.api.setState({...overview,agents},[]);
  assert.deepEqual(agents.map(a=>r.api.assistantStatus(a).text),['Active 3 min ago','Checks every 10 minutes','Last checked 4 h ago','Finish on your computer','Not connected yet']);
  const home=r.api.homePage();assert.match(home.textContent,/Your assistants/);
  const links=home.querySelectorAll('a');
  const row=name=>links.find(a=>a.querySelector('b')?.textContent===name);
  assert.equal(row('Add an assistant').getAttribute('href'),'#/add');
  assert.equal(row('Codex').getAttribute('href'),'#/setup/codex');
  assert.equal(row('Claude').getAttribute('href'),'#/agents/claude');
  for(const removed of ['Exchange verified','Access observed','Waiting for contact','Background not verified','Readiness not loaded','Check now'])assert.ok(!home.textContent.includes(removed),removed);
});
await check('the next stop suggests a first handoff only until two assistants have exchanged work',async()=>{
  const r=runtime(),claude={...agent,last_seen_at:minutesAgo(1)},bot={...routineAgent('grok-bot','Grok Bot'),last_seen_at:minutesAgo(2)};
  const roster=[['claude',{...structuredClone(config),roster:[{id:'grok-bot',name:'Grok Bot',provider:'grok-bot',work_categories:['task','review'],last_seen_at:bot.last_seen_at}]}]];
  r.api.setState({...overview,agents:[claude,bot],jobs:[]},roster);
  const board=r.api.nextStop();assert.match(board.textContent,/Try your first handoff/);assert.match(board.textContent,/In Claude, say:/);assert.match(board.textContent,/Grok Bot checks every 10 minutes/);
  await button(board,'Copy').click();assert.equal(r.copied.at(-1),'Ask Grok Bot for a second opinion on this and bring back its answer.');
  r.api.setState({...overview,agents:[claude,bot],jobs:[{id:'j1',from:'claude',to:'grok-bot',status:'completed'}]},roster);assert.equal(r.api.nextStop(),null);
  r.api.setState({...overview,agents:[claude],jobs:[]},[]);assert.match(r.api.nextStop().textContent,/Add a second assistant/);
  r.api.setState({...overview,agents:[{...agent}],jobs:[]},[]);assert.equal(r.api.nextStop(),null);
  assert.equal(writes(r).length,0);
});

await check('the first-handoff card pairs only assistants the relay lets work together',async()=>{
  const claude={...agent,last_seen_at:minutesAgo(1)},bot={...routineAgent('grok-bot','Grok Bot'),last_seen_at:minutesAgo(2)},muse={...routineAgent('muse','Muse'),last_seen_at:minutesAgo(3)};
  const agents=[claude,bot,muse],withRoster=roster=>({...structuredClone(config),roster});
  const peer=(a,work_categories)=>({id:a.id,name:a.name,provider:a.platform,work_categories,last_seen_at:a.last_seen_at});
  const r=runtime();
  r.api.setState({...overview,agents,jobs:[]},[]);assert.equal(r.api.nextStop(),null,'No card until a sender roster is loaded');
  r.api.setState({...overview,agents,jobs:[]},[['claude',withRoster([])]]);assert.equal(r.api.nextStop(),null,'A sender allowed to reach no one gets no card');
  r.api.setState({...overview,agents,jobs:[]},[['claude',withRoster([peer(muse,[])])]]);assert.equal(r.api.nextStop(),null,'No shared work category, no card');
  r.api.setState({...overview,agents,jobs:[]},[['claude',withRoster([peer(muse,['review'])])]]);
  const board=r.api.nextStop();assert.match(board.textContent,/Ask Muse for a second opinion/);assert.doesNotMatch(board.textContent,/Grok Bot/);
  r.api.setState({...overview,agents:[claude,bot,{...muse,last_seen_at:null}],jobs:[]},[['claude',withRoster([peer(muse,['review'])])]]);assert.equal(r.api.nextStop(),null,'The permitted peer must be connected');
  // On home, the overview fetch loads the likely sender's settings first so the card can appear.
  let data={...overview,agents:[claude,bot],jobs:[]};
  const home=runtime({'/v1/admin/overview':()=>data,[collaborationPath]:withRoster([peer(bot,['task'])]),'/v1/agents/grok-bot/collaboration':{...withRoster([]),agent_id:'grok-bot'}});
  await home.api.openWorkspace();
  assert.ok(home.calls.some(call=>call.path===collaborationPath),'The sender configuration is read with the overview');
  assert.match(home.doc.querySelector('#main').textContent,/Ask Grok Bot for a second opinion/);
});
function assistantFixture(){
  const c=structuredClone(config);c.version=3;c.settings.purpose='Writing, research and planning';c.settings.standing_responsibilities=['PRIVATE RESPONSIBILITY'];c.settings.sharing.instructions='PRIVATE SHARING';c.settings.sharing.approved_sources=['https://private.example.test'];c.settings.authorization_boundaries=['PRIVATE BOUNDARY'];
  const server={current:c,puts:[],posts:[]};
  server.fixtures={[collaborationPath]:opts=>{if(opts.method==='PUT'){const body=JSON.parse(opts.body);server.puts.push(body);if(body.expected_version!==server.current.version)return {__status:409,__body:{error:{code:'configuration_changed',message:'Changed elsewhere.'}}};const {expected_version,...patch}=body;server.current={...server.current,version:server.current.version+1,settings:{...server.current.settings,...patch}};}return server.current;},
    '/v1/admin/agents':opts=>{const body=JSON.parse(opts.body);server.posts.push(body);return {agent:{...agent,...body}};}};
  return server;
}
await check('the assistant page leads with what it is good at and two switches that save on their own',async()=>{
  const server=assistantFixture(),r=runtime(server.fixtures);r.api.setState({...overview,agents:[{...agent,last_seen_at:now},routineAgent('muse','Muse')]},[['claude',server.current]]);
  const node=await r.api.assistantPage('claude'),text=node.textContent;
  assert.equal(node.querySelector('#good-at').value,'Writing, research and planning');assert.match(text,/Connected · checks when you ask/);assert.match(text,/Saved/);
  const switches=node.querySelectorAll('button').filter(b=>b.getAttribute('role')==='switch');assert.equal(switches.length,2);assert.deepEqual(switches.map(s=>s.getAttribute('aria-checked')),['true','true']);
  for(const hidden of ['PRIVATE','private.example','Standing responsibilities','Approved sources','Actions requiring further authorization','Sharing instructions','Working instructions','Background behavior','Save preferences'])assert.ok(!text.includes(hidden),hidden);
  assert.equal(node.querySelector('#advanced').hidden,true);assert.equal(r.calls.some(call=>call.path.includes('/setup')),false);
  await switches[0].click();await settle();assert.deepEqual(server.posts.at(-1),{id:'claude',can_request:false});assert.equal(switches[0].getAttribute('aria-checked'),'false');
  const goodAt=node.querySelector('#good-at');goodAt.value='Long-form writing';await goodAt.dispatch('change');await settle();
  assert.deepEqual(server.puts.at(-1),{expected_version:3,purpose:'Long-form writing'});
  server.current={...server.current,version:9};goodAt.value='Editing and research';await goodAt.dispatch('change');await settle();
  assert.deepEqual(server.puts.slice(-2).map(put=>put.expected_version),[4,9],'A concurrent change retries once on the latest version');
  assert.equal(server.current.settings.purpose,'Editing and research');assert.deepEqual(server.current.settings.standing_responsibilities,['PRIVATE RESPONSIBILITY'],'Notes saved earlier stay untouched');
});
await check('a failed Good at save says so and the same text is sent again on the next blur',async()=>{
  const server=assistantFixture();let failures=1;
  const fixtures={...server.fixtures,[collaborationPath]:opts=>{if(opts.method==='PUT'&&failures>0){failures--;server.puts.push(JSON.parse(opts.body));return {__status:503,__body:{error:{code:'unavailable',message:'Hitchhike is busy. Try again.'}}};}return server.fixtures[collaborationPath](opts);}};
  const r=runtime(fixtures);r.api.setState({...overview,agents:[{...agent,last_seen_at:now}]},[['claude',server.current]]);
  const node=await r.api.assistantPage('claude'),goodAt=node.querySelector('#good-at'),indicator=()=>node.querySelector('.saved').textContent;
  goodAt.value='Long-form writing';await goodAt.dispatch('change');await settle();
  assert.equal(indicator(),'Couldn’t save');assert.match(node.textContent,/Hitchhike is busy\. Try again\./);
  assert.equal(server.current.settings.purpose,'Writing, research and planning');
  const switches=node.querySelectorAll('button').filter(b=>b.getAttribute('role')==='switch');await switches[1].click();await settle();
  assert.equal(indicator(),'Couldn’t save','Another field saving does not hide the unsaved description');
  await goodAt.dispatch('blur');await settle();
  assert.deepEqual(server.puts.map(put=>put.purpose),['Long-form writing','Long-form writing'],'The same text is retried');
  assert.equal(server.current.settings.purpose,'Long-form writing');assert.equal(indicator(),'Saved');
  await goodAt.dispatch('blur');await settle();assert.equal(server.puts.length,2,'Nothing is resent once saved');
});
await check('failed category and collaborator saves put the controls back to what is saved',async()=>{
  const server=assistantFixture();let failing=true;
  const fixtures={...server.fixtures,[collaborationPath]:opts=>opts.method==='PUT'&&failing?{__status:503,__body:{error:{code:'unavailable',message:'Try again.'}}}:server.fixtures[collaborationPath](opts)};
  const r=runtime(fixtures);r.api.setState({...overview,agents:[{...agent,last_seen_at:now},routineAgent('muse','Muse')]},[['claude',server.current]]);
  const node=await r.api.assistantPage('claude');
  await query(node,'button').find(b=>b.getAttribute('aria-controls')==='advanced').click();await settle();
  const advanced=node.querySelector('#advanced'),[all,museBox]=advanced.querySelectorAll('input');
  all.checked=false;await all.dispatch('change');await settle();
  assert.equal(all.checked,true);assert.equal(museBox.checked,true);assert.equal(museBox.disabled,true);
  const task=advanced.querySelectorAll('.chips')[0].querySelectorAll('button').find(chip=>chip.dataset.type==='task');
  await task.click();await settle();assert.equal(task.getAttribute('aria-pressed'),'true');
  assert.equal(node.querySelector('.saved').textContent,'Couldn’t save');
});
await check('Advanced holds who it works with, kinds of work and removal',async()=>{
  const server=assistantFixture();let removed=false;
  const r=runtime({...server.fixtures,'/v1/admin/agents/claude':()=>{removed=true;return {ok:true};}});r.api.setState({...overview,agents:[{...agent,last_seen_at:now},routineAgent('muse','Muse')]},[['claude',server.current]]);
  const node=await r.api.assistantPage('claude');
  await query(node,'button').find(b=>b.getAttribute('aria-controls')==='advanced').click();await settle();
  const advanced=node.querySelector('#advanced'),text=advanced.textContent;assert.equal(advanced.hidden,false);
  for(const visible of ['Who it works with','All your assistants','Muse','Kinds of work','It can ask for','It can take on','Replace credentials','Remove Claude','Connection ID claude'])assert.ok(text.includes(visible),visible);
  for(const hidden of ['PRIVATE','Approved sources','Routine API URL'])assert.ok(!text.includes(hidden),hidden);
  const [all,museBox]=advanced.querySelectorAll('input');assert.equal(all.checked,true);assert.equal(museBox.disabled,true);
  all.checked=false;await all.dispatch('change');await settle();assert.deepEqual(server.puts.at(-1),{expected_version:3,permitted_collaborators:['muse']});
  const takeOn=advanced.querySelectorAll('.chips')[1],task=takeOn.querySelectorAll('button').find(chip=>chip.dataset.type==='task');
  assert.equal(task.getAttribute('aria-pressed'),'true');await task.click();await settle();
  assert.deepEqual(server.puts.at(-1),{expected_version:4,allowed_work_categories:[]});assert.deepEqual(server.posts.at(-1),{id:'claude',work_types:[]});
  await button(advanced,'Remove Claude').click();await settle();assert.equal(removed,true);assert.equal(r.location.hash,'#/agents');
});
await check('Claude Code cloud keeps its routine adapter under Advanced; other connections only see an existing one',async()=>{
  for(const surface of ['terminal','cloud']){
    const c=structuredClone(config);c.onboarding={provider:'claude-code',surface,step:'connect'};
    const code={...agent,platform:'claude-code',platform_label:'Claude Code',last_seen_at:now};
    const r=runtime({[collaborationPath]:c,'/v1/admin/agents/claude/setup?surface=cloud':{guide:{...guide,routinePrompt:'Directed API payload: keep the current request.'}}});r.api.setState({...overview,agents:[code]},[['claude',c]]);
    const node=await r.api.assistantPage('claude');await query(node,'button').find(b=>b.getAttribute('aria-controls')==='advanced').click();await settle();
    assert.equal(node.querySelector('#advanced').textContent.includes('Routine API URL'),surface==='cloud',surface);
    if(surface==='cloud')assert.match(node.querySelector('#advanced').textContent,/Directed API payload/);
    assert.equal(writes(r).length,0);
  }
  const c=structuredClone(config),activationPath='/v1/agents/claude/activation';let activation={configured:true,enabled:true,routine_hint:'existing-routine',latest_dispatch:{status:'pending'}};
  const r=runtime({[collaborationPath]:c,[activationPath]:opts=>{if(opts.method==='DELETE'){activation={configured:false,enabled:false};return {ok:true};}return {activation};}});r.api.setState({...overview,agents:[{...agent,last_seen_at:now}]},[['claude',c]]);
  const node=await r.api.assistantPage('claude');await query(node,'button').find(b=>b.getAttribute('aria-controls')==='advanced').click();await settle();
  assert.doesNotMatch(node.querySelector('#advanced').textContent,/Routine API URL|Scoped routine token|Save routine connection/);assert.equal(r.calls.some(call=>call.path.endsWith('surface=cloud')),false);
  await button(node,'Disable and remove saved routine credentials').click();
  assert.deepEqual(writes(r).map(call=>[call.path,call.opts.method]),[[activationPath,'DELETE']]);assert.equal(activation.configured,false);
});
await check('refresh keeps the assistant page someone is editing',async()=>{
  let currentOverview={...overview,agents:[{...agent,last_seen_at:now}]};
  const r=runtime({'/v1/admin/overview':()=>currentOverview});r.api.setState(currentOverview,[['claude',config]]);r.location.hash='#/agents/claude';await r.api.render();
  const input=r.doc.querySelector('#good-at');input.value='Unsaved description';currentOverview={...currentOverview,agents:[{...agent,name:'Different saved name',last_seen_at:now}]};
  await r.api.refresh();assert.ok(r.doc.querySelector('#good-at')===input,'Refresh must keep the mounted page');assert.equal(input.value,'Unsaved description');
});
await check('a chosen assistant survives sign-in as the add-assistant route',()=>{
  const r=runtime({},{hosted:true}),link=r.doc.createElement('a');link.id='gate-sign-in';link.setAttribute('href','/sign-in?return_to=%2Fapp-next');r.doc.body.append(link);
  r.location.search='?assistant=claude';r.location.hash='';r.api.adoptIntent();
  assert.equal(r.location.hash,'#/connect/claude');assert.equal(r.location.search,'');assert.equal(link.getAttribute('href'),'/sign-in?return_to='+encodeURIComponent('/app-next?assistant=claude'));
  for(const value of ['?assistant=%3Cscript%3E','?assistant=evil-unknown']){const other=runtime({},{hosted:true});other.location.search=value;other.location.hash='#/agents';other.api.adoptIntent();assert.equal(other.location.hash,'#/agents');assert.equal(other.location.search,'');}
});
await check('reply fields retain visible associated labels',()=>{const r=runtime();for(const [status,label] of [['input_required','Your answer'],['completed','Specific revision feedback']]){const nodes=r.api.requestControls({id:'label-test',status,from:'cleo'},r.doc.createElement('p'));const area=nodes.querySelector('textarea'),visible=nodes.querySelector('label');assert.equal(visible.textContent,label);assert.equal(visible.getAttribute('for'),area.id);assert.ok(area.id);}});
await check('obsolete unscoped connection drafts are removed on open',()=>{const r=runtime();r.storage.set('hitchhike:new-connection:claude','old leaked draft');r.api.clearLegacyDrafts();assert.equal(r.storage.has('hitchhike:new-connection:claude'),false);});
await check('off-page shared-context drafts do not freeze home or Activity refreshes',async()=>{
  let currentOverview=structuredClone(overview),conversations=[];
  const r=runtime({'/v1/admin/overview':()=>currentOverview,'/v1/conversations?limit=100':()=>({conversations})});
  const context=r.api.sharedContext({id:'draft-context',pinned_context:'Saved context',context_version:0});
  context.querySelector('textarea').value='Keep this off-page context';await context.querySelector('textarea').dispatch('input');
  r.location.hash='#/agents';await r.api.render();currentOverview={...currentOverview,agents:[{...agent,name:'Freshly renamed assistant'}]};
  await r.api.refresh();assert.match(r.doc.querySelector('#main').textContent,/Freshly renamed assistant/);
  r.location.hash='#/activity';await r.api.render();
  conversations=[{id:'fresh-conversation',title:'Fresh activity after polling',participants:['owner','claude'],last_message_at:now,outstanding_requests:0,requests_used:1,request_limit:10,retention_days:30,expires_at:now,latest_request:{status:'completed'}}];
  await r.api.refresh();assert.match(r.doc.querySelector('#main').textContent,/Fresh activity after polling/);
  assert.equal(r.api.sharedContext({id:'draft-context',pinned_context:'Saved context',context_version:0}).querySelector('textarea').value,'Keep this off-page context');
  assert.equal(writes(r).length,0);
});
await check('expired hosted sessions restore drafts only for the same verified owner and workspace',async()=>{
  const original={authenticated:true,user:{id:'owner-A',email:'shared-address@example.test'},workspace:{id:'workspace-A'},csrfToken:'initial-csrf'};
  for(const mode of ['same','different-owner','different-workspace','explicit-signout']){
    let auth=structuredClone(original);
    const r=runtime({'/auth/session':()=>auth,'/fixture/expired-session':{__status:401,__body:{error:{code:'unauthorized',message:'Session expired.'}}}},{hosted:true});
    r.location.hash='#/agents';await r.api.boot();
    const shared=r.api.sharedContext({id:'held-context',pinned_context:'Saved shared context',context_version:2});
    shared.querySelector('textarea').value='PRIVATE CONTEXT '+mode;await shared.querySelector('textarea').dispatch('input');
    await assert.rejects(r.api.api('/fixture/expired-session'),error=>error.status===401);
    assert.equal(r.doc.querySelector('#main').childNodes.length,0);assert.equal(r.doc.querySelector('#workspace').hidden,true);
    assert.equal([...r.storage.values()].some(value=>value.includes('PRIVATE')),false);
    if(mode==='different-owner')auth={...auth,user:{id:'owner-B',email:original.user.email}};
    if(mode==='different-workspace')auth={...auth,workspace:{id:'workspace-B'}};
    if(mode==='same')auth={...auth,user:{...auth.user,email:'updated-address@example.test'}};
    if(mode==='explicit-signout')r.api.signOut();
    await r.api.boot();
    assert.equal(r.api.sharedContext({id:'held-context',pinned_context:'Saved shared context',context_version:2}).querySelector('textarea').value,mode==='same'?'PRIVATE CONTEXT '+mode:'Saved shared context');
    assert.equal([...r.storage.values()].some(value=>value.includes('PRIVATE')),false);
  }
});
await check('expired self-hosted sessions restore drafts only with the same owner key and workspace',async()=>{
  for(const mode of ['same','different-key','different-workspace','explicit-signout']){
    let currentOverview={...overview,workspace:{id:'selfhost-A'}};
    const r=runtime({'/v1/admin/overview':()=>currentOverview,'/fixture/expired-session':{__status:401,__body:{error:{code:'unauthorized',message:'Session expired.'}}}});
    const signIn=async key=>{r.doc.querySelector('#owner-key').value=key;await r.doc.querySelector('#gate-form').dispatch('submit');};
    r.location.hash='#/agents';await signIn('fixture-owner-A');
    const held=()=>r.api.sharedContext({id:'held-context',pinned_context:'Saved shared context',context_version:1});
    const area=held().querySelector('textarea');area.value='PRIVATE SELFHOST '+mode;await area.dispatch('input');
    await assert.rejects(r.api.api('/fixture/expired-session'),error=>error.status===401);
    assert.equal(r.doc.querySelector('#workspace').hidden,true);assert.equal(r.doc.querySelector('#main').childNodes.length,0);
    if(mode==='different-workspace')currentOverview={...currentOverview,workspace:{id:'selfhost-B'}};
    if(mode==='explicit-signout')r.api.signOut();
    await signIn(mode==='different-key'?'fixture-owner-B':'fixture-owner-A');
    assert.equal(held().querySelector('textarea').value,mode==='same'?'PRIVATE SELFHOST '+mode:'Saved shared context');
    assert.equal([...r.storage.values()].some(value=>value.includes('PRIVATE')),false);
  }
});
await check('settings name the signed-in account and sign out from the page',async()=>{
  const r=runtime({'/v1/admin/workspace':{workspace:{paused:false,retention_days:30},usage:{},limits:{}}},{hosted:true});
  r.api.setSession({authenticated:true,user:{id:'owner',email:'dana@example.test'},workspace:{id:'workspace'}});r.api.setState(overview,[['claude',config]]);
  const node=await r.api.settingsPage();assert.match(node.textContent,/Signed in as dana@example\.test\./);assert.ok(button(node,'Sign out'));
});

async function pollingRuntime(route='#/agents',overrides={}){
  const clock=mockClock(),agents=[agent,...Array.from({length:5},(_,index)=>({...agent,id:'peer-'+index,name:'Peer '+index}))];
  const fixtures={'/v1/admin/overview':{...overview,agents},'/v1/conversations?limit=100':{conversations:[]}};
  for(const a of agents)fixtures['/v1/agents/'+a.id+'/collaboration']={...structuredClone(config),agent_id:a.id};
  const r=runtime({...fixtures,...overrides},{clock});r.location.hash=route;
  await r.api.openWorkspace();await clock.flush();r.calls.length=0;return r;
}
const pollingRounds=r=>r.calls.filter(call=>call.path==='/v1/admin/overview');
function assertBoundedPolling(r){
  const rounds=new Map();for(const call of r.calls){assert.equal(call.opts.method,'GET');const round=rounds.get(call.at)||[];round.push(call);rounds.set(call.at,round);}
  for(const calls of rounds.values()){
    assert.ok(calls.length<=3,'An automatic round used '+calls.length+' reads: '+calls.map(call=>call.path).join(', '));
    assert.ok(calls.filter(call=>call.path.endsWith('/collaboration')).length<=1,'Automatic polling fanned out across configurations');
  }
}

await check('beta requires explicit enabling and does not mutate just by opening',async()=>{const r=runtime({'/v1/workspace/release':{enabled:false}});await r.api.openWorkspace();assert.ok(r.doc.querySelector('#boot').textContent.includes('Try the new workspace'));assert.equal(r.calls.some(c=>c.opts.method!=='GET'),false);});
await check('conversation pagination appends full messages and reading does not acknowledge another consumer',async()=>{const first={conversation:{id:'conv',title:'Review',participants:['owner','claude'],last_message_at:now,outstanding_requests:0,requests_used:1,request_limit:10,retention_days:30,expires_at:now},messages:[{id:1,from:'owner',kind:'request',text:'Original question',created_at:now}],requests:[],has_more:true,next_cursor:1},second={...first,messages:[{id:2,from:'claude',kind:'answer',text:'Full earlier answer',created_at:now}],has_more:false,next_cursor:2};const r=runtime({'/v1/conversations/conv?limit=20':first,'/v1/conversations/conv?limit=20&after=1':second});const nodes=await r.api.conversationPage('conv');const more=nodes.flatMap(n=>n.querySelectorAll('button')).find(n=>n.textContent==='Load more history');await more.click();const text=nodes.map(n=>n.textContent).join('');assert.match(text,/Original question/);assert.match(text,/Full earlier answer/);assert.equal(r.calls.some(c=>c.path.includes('acknowledge')),false);});
await check('sign out removes private forms and secrets from the document',()=>{const r=runtime();const secret=r.doc.createElement('input');secret.value='secret-token';r.doc.querySelector('#main').append(secret);r.api.signOut();assert.equal(r.doc.querySelector('#main').childNodes.length,0);assert.equal(r.doc.querySelector('#workspace').hidden,true);});
await check('activity uses actual queued, claimed, failed and retrieved request states',()=>{const r=runtime();for(const [status,label] of [['queued','Waiting for pickup'],['claimed','Picked up'],['failed','Failed'],['expired','Expired'],['input_required','Needs clarification']])assert.equal(r.api.conversationState({id:'old',latest_request:{status}}).label,label);assert.equal(r.api.conversationState({id:'old',latest_request:{status:'completed',retrieved_at:now}}).label,'Retrieved');});
await check('render omits absent sections instead of inserting literal null text',async()=>{const r=runtime({'/v1/conversations?limit=100':{conversations:[]}});r.location.hash='#/activity';await r.api.render();assert.doesNotMatch(r.doc.querySelector('#main').textContent,/null|undefined/);});
await check('completed conversation loads full request for revision without impersonating requester acknowledgement',async()=>{const conversation={id:'done',title:'Review',participants:['cleo','claude'],last_message_at:now,outstanding_requests:0,requests_used:1,request_limit:10,retention_days:30,expires_at:now};const summary={id:'job1',from:'cleo',to:'claude',status:'completed',title:'Review',created_at:now};const r=runtime({'/v1/conversations/done?limit=20':{conversation,messages:[],requests:[summary],has_more:false,next_cursor:0},'/v1/jobs/job1?full=1':{job:{...summary,result:{summary:'Full answer',body:'Complete body',validation:{ok:true}}}}});const nodes=await r.api.conversationPage('done'),text=nodes.map(n=>n.textContent).join('');assert.match(text,/Request a revision/);assert.doesNotMatch(text,/Acknowledge result/);assert.ok(r.calls.some(c=>c.path==='/v1/jobs/job1?full=1'));});
await check('shared text context saves its version and never persists private drafts in browser storage',async()=>{const r=runtime({'/v1/conversations/shared/context':{conversation:{id:'shared',pinned_context:'Approved https://example.test/reference',context_version:4},message:{kind:'context'}}});const node=r.api.sharedContext({id:'shared',pinned_context:'Earlier brief',context_version:3}),area=node.querySelector('textarea');area.value='Approved https://example.test/reference';await area.dispatch('input');await node.querySelectorAll('button').find(n=>n.textContent==='Save shared context').click();const call=r.calls.find(c=>c.path==='/v1/conversations/shared/context');assert.equal(call.opts.method,'PATCH');assert.deepEqual(JSON.parse(call.opts.body),{pinned_context:'Approved https://example.test/reference',expected_version:3});assert.equal([...r.storage.values()].some(v=>v.includes('Approved https://')),false);assert.match(node.textContent,/deliberately approve/);});
await check('shared-context conflicts preserve draft and original version across re-render until explicit discard',async()=>{const r=runtime({'/v1/conversations/shared/context':{__status:409,__body:{error:{code:'context_changed',message:'Changed elsewhere.'}}}});let node=r.api.sharedContext({id:'shared',pinned_context:'Original',context_version:3}),area=node.querySelector('textarea');area.value='My pending draft';await area.dispatch('input');await node.querySelectorAll('button').find(n=>n.textContent==='Save shared context').click();assert.match(node.textContent,/Your draft is kept here/);node=r.api.sharedContext({id:'shared',pinned_context:'Changed remotely',context_version:4});assert.equal(node.querySelector('textarea').value,'My pending draft');await node.querySelectorAll('button').find(n=>n.textContent==='Save shared context').click();assert.equal(JSON.parse(r.calls.at(-1).opts.body).expected_version,3);r.api.signOut();assert.equal(r.api.sharedContext({id:'shared',pinned_context:'Changed remotely',context_version:4}).querySelector('textarea').value,'Changed remotely');});
await check('automatic polling backs off over 30 minutes without per-agent read fanout',async()=>{
  for(const route of ['#/agents','#/activity','#/setup/claude/exchange']){
    const r=await pollingRuntime(route),started=r.clock.now;
    await r.clock.advance(30*60000);
    assert.deepEqual(pollingRounds(r).map(call=>(call.at-started)/1000),[15,45,105,225,525,1425]);
    assertBoundedPolling(r);
    if(route.includes('/setup/'))assert.ok(r.calls.filter(call=>call.path.endsWith('/collaboration')).every(call=>call.path===collaborationPath));
    else{const fetched=new Map();for(const call of r.calls.filter(call=>call.path.endsWith('/collaboration'))){if(fetched.has(call.path))assert.ok(call.at-fetched.get(call.path)>=300000,'Fresh configurations should be reused for five minutes');fetched.set(call.path,call.at);}}
    if(route==='#/activity')assert.equal(r.calls.filter(call=>call.path==='/v1/conversations?limit=100').length,6);
  }
});
await check('automatic polling stays within 100 rounds in each rolling 24 hours',async()=>{
  const day=24*60*60000,r=await pollingRuntime('#/activity');
  await r.clock.advance(day);
  assert.ok(pollingRounds(r).length>90,'The poller stopped instead of continuing at the idle cadence');
  assert.ok(pollingRounds(r).length<=100);assert.ok(r.calls.length<=300);assertBoundedPolling(r);
  await r.clock.advance(day);
  const rounds=pollingRounds(r);assert.ok(rounds.length>100,'Polling did not resume as the rolling budget became available');
  for(const round of rounds)assert.ok(rounds.filter(other=>other.at<=round.at&&other.at>round.at-day).length<=100,'More than 100 rounds in a rolling day');
  assertBoundedPolling(r);
});
await check('429 Retry-After seconds and dates suspend automatic reads for the full 13 hours',async()=>{
  for(const headerType of ['seconds','date'])for(const endpoint of ['overview','configuration','activity']){
    let limited=false,blockedAt=null,blockedCalls=0,r;
    const path={overview:'/v1/admin/overview',configuration:collaborationPath,activity:'/v1/conversations?limit=100'}[endpoint];
    const normal={overview:{...overview,agents:[agent,...Array.from({length:5},(_,index)=>({...agent,id:'peer-'+index,name:'Peer '+index}))]},configuration:config,activity:{conversations:[]}}[endpoint];
    r=await pollingRuntime(endpoint==='configuration'?'#/setup/claude/exchange':'#/activity',{[path]:()=>{
      if(limited){limited=false;blockedAt=r.clock.now;blockedCalls=r.calls.length;return {__status:429,__headers:{'rEtRy-AfTeR':headerType==='seconds'?'46800':new Date(blockedAt+13*3600000).toUTCString()},__body:{error:{code:'rate_limited',message:'Read budget exhausted.'}}};}
      return normal;
    }});
    limited=true;await r.clock.advance(15000);assert.equal(blockedAt,r.clock.now);assert.equal(r.calls.length,blockedCalls,'An automatic round continued reading after 429');
    const count=r.calls.length,deadline=blockedAt+13*3600000;
    for(let i=0;i<40;i++){await r.context.window.dispatch('focus');r.doc.hidden=true;await r.doc.dispatch('visibilitychange');r.doc.hidden=false;await r.doc.dispatch('visibilitychange');}
    await r.clock.advance(deadline-r.clock.now-1);assert.equal(r.calls.length,count,'Automatic reads resumed before Retry-After');
    await r.clock.advance(15*60000+1);assert.ok(r.calls.length>count,'Automatic polling did not recover after Retry-After');
    assert.ok(r.calls.slice(count).every(call=>call.at>=deadline));assertBoundedPolling(r);
  }
});
await check('new-work POST quota errors do not pause dashboard reads or automatic polling',async()=>{
  for(const path of ['/v1/jobs','/v1/conversations']){
    const r=await pollingRuntime('#/activity',{[path]:{__status:429,__headers:{'Retry-After':'46800'},__body:{error:{code:'quota_exceeded',message:'New-work quota exhausted.'}}}});
    await assert.rejects(r.api.api(path,{method:'POST',body:{to:'peer-0',type:'task',...(path==='/v1/jobs'?{title:'Fixture task',goal:'Fixture only'}:{message:'Fixture only',response_requested:true})}}),error=>error.status===429&&error.code==='quota_exceeded');
    assert.equal(writes(r).length,1);
    const fresh=await r.api.api('/v1/admin/overview');assert.equal(fresh.agents.length,6);
    r.calls.length=0;await r.clock.advance(15000);
    assert.equal(pollingRounds(r).length,1);assert.ok(r.calls.some(call=>call.path==='/v1/conversations?limit=100'));
    assertBoundedPolling(r);assert.equal(writes(r).length,0);
  }
});
await check('focus and visibility storms are debounced and hidden tabs stop automatic polling',async()=>{
  const r=await pollingRuntime();
  r.doc.hidden=true;await r.doc.dispatch('visibilitychange');await r.clock.advance(61000);assert.equal(r.calls.length,0);
  const storm=async()=>{for(let i=0;i<80;i++){r.doc.hidden=false;await r.doc.dispatch('visibilitychange');await r.context.window.dispatch('focus');r.doc.hidden=true;await r.doc.dispatch('visibilitychange');}r.doc.hidden=false;await r.doc.dispatch('visibilitychange');await r.clock.advance(200);r.doc.hidden=true;await r.doc.dispatch('visibilitychange');};
  await storm();assert.equal(pollingRounds(r).length,1);
  await r.clock.advance(59000);await storm();assert.equal(pollingRounds(r).length,1);
  await r.clock.advance(1000);await storm();assert.equal(pollingRounds(r).length,2);
  assert.ok(pollingRounds(r)[1].at-pollingRounds(r)[0].at>=60000);assertBoundedPolling(r);
  await r.clock.advance(24*60*60000);assert.equal(pollingRounds(r).length,2);
});
await check('read pauses stay with the same verified identity and reset on account change or signout',async()=>{
  const original={user:{id:'owner-A',email:'original@example.test'},workspace:{id:'workspace-A'}};
  for(const mode of ['same','different-owner','different-workspace','signout']){
    const clock=mockClock(),r=runtime({'/v1/fixture-rate-limit':{__status:429,__headers:{'Retry-After':'46800'},__body:{error:{code:'rate_limited',message:'Read budget exhausted.'}}}},{clock,hosted:true});
    r.api.setSession(structuredClone(original));await r.api.openWorkspace();await clock.flush();
    await assert.rejects(r.api.api('/v1/fixture-rate-limit'),error=>error.status===429);const count=r.calls.length;
    if(mode==='signout')r.api.signOut();
    r.api.setSession({...original,user:{id:mode==='different-owner'?'owner-B':'owner-A',email:'changed@example.test'},workspace:{id:mode==='different-workspace'?'workspace-B':'workspace-A'}});
    if(mode==='same'){
      await assert.rejects(r.api.api('/v1/admin/overview'),error=>error.status===429);assert.equal(r.calls.length,count);
      await clock.advance(60*60000);assert.equal(r.calls.length,count);
    }else{
      await r.api.openWorkspace();await clock.flush();r.calls.length=0;
      await clock.advance(15000);assert.equal(pollingRounds(r).length,1,'A previous identity pause must not block the fresh polling cycle');
    }
  }
});

console.log('\n'+passed+' workspace UI tests passed. Layout and physical Safari remain separate checks.');

import {revealEditorControl} from './cuts-ui-tabs.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright-core';

// Long caption lists reproduce modal scrolling without a real source or account.
const root=resolve('public'),diagnostic=process.env.SCROLL_DIAGNOSTIC==='1';
const captions=Array.from({length:40},(_,index)=>({start:1+index*.15,end:1.1+index*.15,text:'Legenda '+(index+1)}));
const clip={id:'22222222-2222-4222-8222-222222222222',job_id:'11111111-1111-4111-8111-111111111111',title:'Teste de rolagem',start_seconds:1,end_seconds:8,captions,revision:1,framing:'fit',framing_options:{mode:'fit',focusX:.5,focusY:.5,zoom:1},caption_style:{},excluded_ranges:[]};
const timelineClip={...clip,title:'Relógio da montagem',start_seconds:10,end_seconds:40,captions:[
  {start:10.001,end:13,text:'A fala do corte.',words:[{start:10.001,end:11,text:'A'},{start:11,end:12,text:'fala'},{start:12,end:13,text:'do corte.'}]},
  {start:14,end:17,text:'Outra frase.',words:[{start:14,end:15,text:'Outra'},{start:15,end:17,text:'frase.'}]},
  {start:17.5,end:23,text:'Antes depois agora.',words:[{start:17.5,end:18,text:'Antes'},{start:21,end:22,text:'depois'},{start:22,end:23,text:'agora.'}]},
  {start:25,end:27,text:'Linha sem alinhamento.'}
]};
const transcriptEdges=[
  {start:8,end:9.5,text:'Prefixo falado completo.',words:[{start:8,end:8.5,text:'Prefixo'},{start:8.5,end:9,text:'falado'},{start:9,end:9.5,text:'completo.'}]},
  {start:41,end:43,text:'Final falado.',words:[{start:41,end:42,text:'Final'},{start:42,end:43,text:'falado.'}]}
];
const job={id:clip.job_id,duration:10,title:'Fonte sintética',replay_data:{status:'unavailable',points:[]}};
const fixtureHtml='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/cuts-editor.css"><link rel="stylesheet" href="/fixture.css"><body><main><h1>Página sob o modal</h1><div id="background-long"></div></main><dialog id="cuts-dialog" class="cuts-dialog" data-mode="edit" aria-labelledby="cuts-dialog-title"><div class="dialog-head"><div><span class="eyebrow">GERADOR DE CORTES</span><h2 id="cuts-dialog-title">Editar corte para YouTube</h2></div><button type="button" aria-label="Fechar revisão do corte">×</button></div><form id="cuts-dialog-form"></form></dialog><script type="module" src="/fixture.js"></script></body></html>';
const fixtureJs=`import {createCutEditor} from '/cuts-editor.js';
const clip=${JSON.stringify(clip)},job=${JSON.stringify(job)};
const params=new URL(location.href).searchParams;
if(params.has('timeline')||params.has('edge')){Object.assign(clip,${JSON.stringify(timelineClip)});job.duration=60;}
const sourceCaptions=params.has('edge')?[${JSON.stringify(transcriptEdges[0])},...clip.captions,${JSON.stringify(transcriptEdges[1])}]:clip.captions;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
window.__transcriptMode=new URL(location.href).searchParams.get('transcript')||'ok';window.__transcriptCalls=0;
window.editor=createCutEditor({clip,job,esc,api:async()=>{
  window.__transcriptCalls++;
  if(window.__transcriptMode==='fail')throw new Error('Transcrição indisponível no teste.');
  if(window.__transcriptMode==='hold')return new Promise(resolve=>{window.__releaseTranscript=()=>resolve({captions:sourceCaptions,duration:job.duration});});
  return {captions:sourceCaptions,duration:job.duration};
}});
document.querySelector('#cuts-dialog-form').addEventListener('submit',event=>event.preventDefault());
document.querySelector('#cuts-dialog').showModal();
document.querySelector('[aria-label="Fechar revisão do corte"]').onclick=()=>document.querySelector('#cuts-dialog').close();
`;
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/'){res.setHeader('Content-Type','text/html');res.end(diagnostic?fixtureHtml.replace('<link rel="stylesheet" href="/cuts-editor.css">',''):fixtureHtml);return;}
    if(path==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end('#background-long{min-height:4000px}');return;}
    if(path==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fixtureJs);return;}
    // A rejected local source keeps this check focused on layout and controls.
    if(path.startsWith('/api/')){res.statusCode=404;res.end();return;}
    const file=resolve(root,'.'+path);if(!file.startsWith(root+'/'))throw new Error('not found');
    res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'})[extname(file)]||'text/plain');res.end(await readFile(file));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage();page.setDefaultTimeout(10_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('heading',{name:'Editar corte para YouTube',exact:true}).waitFor();
  if(!diagnostic){
    await page.getByLabel('Título do corte',{exact:true}).fill('Rascunho da edição');
    await revealEditorControl(page,'#cuts-cues');
    await page.getByLabel('Texto da legenda 1',{exact:true}).fill('Palavra revisada sem perder o rascunho.');
    await page.locator('#cut-source-player').evaluate(video=>{video.dataset.preserved='yes';});
  }
  await mkdir('artifacts',{recursive:true});
  for(const viewport of [{width:1440,height:1050},{width:1366,height:768},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
    await page.setViewportSize(viewport);
    await revealEditorControl(page,'#cuts-cues');
    await page.locator('#cuts-dialog-form').evaluate(form=>{form.scrollTop=0;});
    await page.locator('#cuts-dialog').evaluate(dialog=>{dialog.scrollTop=0;});
    const initial=await page.evaluate(()=>{
      const dialog=document.querySelector('#cuts-dialog'),form=document.querySelector('#cuts-dialog-form'),cues=document.querySelector('#cuts-cues'),head=dialog.querySelector('.dialog-head');
      const box=element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};
      return {dialog:{...box(dialog),scroll:dialog.scrollHeight-dialog.clientHeight,overflow:getComputedStyle(dialog).overflowY},form:{...box(form),scroll:form.scrollHeight-form.clientHeight,width:form.scrollWidth-form.clientWidth},cues:{scroll:cues.scrollHeight-cues.clientHeight},head:box(head),bodyWidth:document.documentElement.scrollWidth-innerWidth,background:window.scrollY};
    });
    await page.screenshot({path:`artifacts/cuts-scroll-${diagnostic?'before':'after'}-${viewport.width}x${viewport.height}.png`});
    if(diagnostic)console.log(JSON.stringify({viewport,initial}));
    else{
      assert(initial.dialog.top>=-1&&initial.dialog.bottom<=viewport.height+1,'the whole modal fits the viewport '+JSON.stringify({viewport,initial}));
      assert(['hidden','clip'].includes(initial.dialog.overflow),'the dialog shell does not expose a second scrollbar '+JSON.stringify({viewport,initial}));
      assert(initial.form.scroll>100,'the editor form owns its long content');
      assert(initial.cues.scroll<=1,'caption rows must not add a nested scrollbar '+JSON.stringify({viewport,initial}));
      assert(initial.form.width<=1&&initial.bodyWidth<=1,'no horizontal overflow '+JSON.stringify({viewport,initial}));
    }
    if(!diagnostic){
      const nav=page.getByRole('navigation',{name:'Etapas da edição'});
      for(const id of ['cut-editor-timing','cut-editor-framing','cut-overlays','cut-editor-captions']){
        const shortcut=nav.locator('[aria-controls="'+id+'"]');await shortcut.click();
        assert.equal(await shortcut.getAttribute('aria-selected'),'true','the chosen editor tab is selected');
        assert.equal(await page.locator('#'+id).isVisible(),true);
        assert.equal(await page.locator('[data-editor-panel="primary"]:not([hidden])').count(),1,'only the chosen group of editing controls is visible');
      }
      const selectedSubtab=page.getByRole('tab',{name:'Texto e tempos',exact:true});
      assert.equal(await selectedSubtab.getAttribute('aria-selected'),'true','returning to captions remembers its last subtab');
      await nav.getByRole('tab',{name:/Trecho/,exact:false}).click();await nav.getByRole('tab',{name:/Trecho/,exact:false}).press('ArrowRight');
      assert.equal(await nav.getByRole('tab',{name:/Formato/,exact:false}).getAttribute('aria-selected'),'true','arrow keys switch primary tabs');
      const proportions=page.getByRole('tab',{name:'Proporção',exact:true});await proportions.focus();await proportions.press('End');
      assert.equal(await page.getByRole('tab',{name:'Enquadrar imagem',exact:true}).getAttribute('aria-selected'),'true','keyboard navigation also works within subtabs');
      await revealEditorControl(page,'#cuts-cues');
      assert.equal(await page.getByLabel('Título do corte',{exact:true}).inputValue(),'Rascunho da edição');
      assert.equal(await page.getByLabel('Texto da legenda 1',{exact:true}).inputValue(),'Palavra revisada sem perder o rascunho.');
      assert.equal(await page.locator('#cut-source-player').getAttribute('data-preserved'),'yes','navigation keeps the source player alive');
      await nav.getByRole('button',{name:'Prévia',exact:true}).click();
      assert.equal(await page.locator('#cut-editor-preview').evaluate(section=>document.activeElement===section),true);
      assert(await page.locator('.cuts-phone').evaluate(phone=>{const screen=phone.querySelector('.cuts-phone-screen').getBoundingClientRect(),controls=phone.querySelector('.cuts-phone-controls').getBoundingClientRect();return controls.top>=screen.bottom-1&&Math.abs(screen.width/screen.height-9/16)<.002;}),'the phone keeps its portrait screen with playback controls below it');
      await page.locator('.cuts-cue').first().scrollIntoViewIfNeeded();
      const first=await page.locator('.cuts-cue').first().boundingBox(),before=await page.locator('#cuts-dialog-form').evaluate(form=>form.scrollTop);
      await page.mouse.move(first.x+first.width*.5,Math.min(viewport.height-80,first.y+first.height*.5));
      await page.mouse.wheel(0,180);
      await page.waitForFunction(before=>document.querySelector('#cuts-dialog-form').scrollTop>before,before);
      assert.equal(await page.locator('#cuts-cues').evaluate(cues=>cues.scrollTop),0,'wheel over captions scrolls the editor, not a nested list');
    }
    await page.locator('#cuts-dialog-form').evaluate(form=>{form.scrollTop=form.scrollHeight;});
    const bottom=await page.evaluate(()=>{
      const dialog=document.querySelector('#cuts-dialog'),form=document.querySelector('#cuts-dialog-form'),footer=form.querySelector('.dialog-footer'),button=footer.querySelector('[type=submit]');
      const f=form.getBoundingClientRect(),r=footer.getBoundingClientRect(),b=button.getBoundingClientRect();
      return {form:{top:f.top,bottom:f.bottom},footer:{top:r.top,bottom:r.bottom},button:{top:b.top,bottom:b.bottom},dialogScroll:dialog.scrollTop,background:window.scrollY,headerTop:dialog.querySelector('.dialog-head').getBoundingClientRect().top,lastCueBottom:form.querySelector('.cuts-cue:last-child').getBoundingClientRect().bottom};
    });
    await page.screenshot({path:`artifacts/cuts-scroll-${diagnostic?'before':'after'}-end-${viewport.width}x${viewport.height}.png`});
    if(diagnostic)console.log(JSON.stringify({viewport,bottom}));
    else{
      assert(bottom.button.top>=bottom.form.top-1&&bottom.button.bottom<=Math.min(bottom.form.bottom,viewport.height)+1,'save remains reachable inside the editor scroll area '+JSON.stringify({viewport,bottom}));
      assert.equal(bottom.dialogScroll,0,'scrolling the form does not scroll the modal');
      assert.equal(bottom.background,initial.background,'scrolling the modal does not move the background');
      assert(Math.abs(bottom.headerTop-initial.head.top)<1,'modal header remains fixed while editing');
      assert(bottom.lastCueBottom<=bottom.footer.top+1,'the last caption is reachable above the save footer '+JSON.stringify({viewport,bottom}));
      const save=await page.getByRole('button',{name:'Salvar e gerar prévia',exact:true}).boundingBox();
      await page.mouse.move(save.x+save.width*.5,save.y+save.height*.5);await page.mouse.wheel(0,1500);await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>window.scrollY),initial.background,'wheel at the end cannot scroll the underlying page');
      assert.equal(await page.locator('#cuts-dialog').evaluate(dialog=>dialog.scrollTop),0,'wheel at the end cannot move the modal header');
    }
  }
  if(!diagnostic){
    await revealEditorControl(page,'#cuts-cues');await page.getByLabel('Texto da legenda 1',{exact:true}).fill('');
    await revealEditorControl(page,'#cut-edit-start');await page.getByRole('button',{name:'Salvar e gerar prévia',exact:true}).click();
    assert.equal(await page.getByRole('tab',{name:'Texto e tempos',exact:true}).getAttribute('aria-selected'),'true','saving reveals the subtab with a required field');
    assert(await page.getByLabel('Texto da legenda 1',{exact:true}).evaluate(field=>document.activeElement===field),'the invalid field receives focus');
    await page.getByLabel('Texto da legenda 1',{exact:true}).fill('Palavra revisada sem perder o rascunho.');
    const read=()=>page.evaluate(()=>{try{return {body:window.editor.read()};}catch(error){return {error:error.message};}});
    const setWindow=async(start,end)=>{
      await revealEditorControl(page,'#cut-edit-start');
      await page.getByLabel('Começo do corte',{exact:true}).fill(start);await page.getByLabel('Fim do corte',{exact:true}).fill(end);await page.getByLabel('Título do corte',{exact:true}).focus();
    };
    await page.goto('http://127.0.0.1:'+server.address().port+'/?transcript=fail');
    await page.getByRole('heading',{name:'Editar corte para YouTube',exact:true}).waitFor();
    assert((await read()).body,'an unchanged window can use existing captions after transcript failure');
    await setWindow('00:02','00:07');assert((await read()).body,'trimming within existing bounds needs no transcript fetch');
    await setWindow('00:00','00:08');assert.match((await read()).error,/transcri/i,'new bounds cannot silently lose source captions after fetch failure');
    await page.getByLabel('Título do corte',{exact:true}).fill('Rascunho mantido');
    await revealEditorControl(page,'#cuts-cues');
    await page.getByLabel('Texto da legenda 1',{exact:true}).fill('Texto corrigido no rascunho');
    await page.evaluate(()=>{window.__transcriptMode='ok';});
    await page.getByRole('button',{name:'Tentar carregar transcrição',exact:true}).click();
    await page.waitForFunction(()=>{try{return !!window.editor.read().captions;}catch{return false;}});
    assert.equal(await page.getByLabel('Título do corte',{exact:true}).inputValue(),'Rascunho mantido');
    assert.equal(await page.getByLabel('Texto da legenda 1',{exact:true}).inputValue(),'Texto corrigido no rascunho');
    assert.equal(await page.getByLabel('Começo do corte',{exact:true}).inputValue(),'00:00');
    assert.equal((await read()).body.captions[0].text,'Texto corrigido no rascunho');
    assert.equal(await page.evaluate(()=>window.__transcriptCalls),2,'retry performs exactly one new transcript request');

    await page.goto('http://127.0.0.1:'+server.address().port+'/?transcript=hold');
    await page.getByRole('heading',{name:'Editar corte para YouTube',exact:true}).waitFor();
    assert((await read()).body,'the original window remains editable while transcript loads');
    await setWindow('00:02','00:07');assert((await read()).body,'a local trim remains editable while transcript loads');
    await setWindow('00:00','00:08');assert.match((await read()).error,/aguarde|carreg/i,'expansion waits for the source transcript');
    await page.evaluate(()=>window.__releaseTranscript());
    await page.waitForFunction(()=>{try{return !!window.editor.read();}catch{return false;}});
    assert.equal((await read()).body.start,0,'loading completion preserves the selected window');

    await page.goto('http://127.0.0.1:'+server.address().port+'/?timeline=1');
    await page.getByRole('heading',{name:'Editar corte para YouTube',exact:true}).waitFor();
    const rowFor=async text=>{
      const index=await page.locator('.cuts-cue textarea').evaluateAll((areas,text)=>areas.findIndex(area=>area.value===text),text);
      assert(index>=0,'caption is visible: '+text);const row=page.locator('.cuts-cue').nth(index);await revealEditorControl(page,row);return row;
    };
    const assertTimes=async(text,start,end)=>{
      const row=await rowFor(text);
      assert.equal(await row.locator('[name=cueStart]').inputValue(),start,text+' starts on the phone clock');
      assert.equal(await row.locator('[name=cueEnd]').inputValue(),end,text+' ends on the phone clock');
    };
    const remove=async(start,end)=>{
      await revealEditorControl(page,'#cut-remove-start');
      await page.getByLabel('Remover a partir de',{exact:true}).fill(start);await page.getByLabel('Remover até',{exact:true}).fill(end);
      await page.getByRole('button',{name:'Remover este trecho',exact:true}).click();
    };
    await assertTimes('A fala do corte.','00:00,001','00:03');
    await assertTimes('Antes depois agora.','00:07,500','00:13');
    await assertTimes('Linha sem alinhamento.','00:15','00:17');
    await (await rowFor('Linha sem alinhamento.')).locator('[name=cueText]').fill('Linha corrigida sem alinhamento.');
    await remove('00:18','00:20');
    await assertTimes('Antes','00:07,500','00:08');
    await assertTimes('depois agora.','00:09','00:11');
    await assertTimes('Linha corrigida sem alinhamento.','00:13','00:15');
    let body=(await read()).body;assert(body,'valid split captions remain saveable');
    assert.equal(body.captions.find(cue=>cue.text==='A fala do corte.').start,10.001);
    assert.deepEqual(body.captions.find(cue=>cue.text==='A fala do corte.').words,timelineClip.captions[0].words,'millisecond-aligned words stay exact through the phone projection');
    assert.deepEqual(body.captions.find(cue=>cue.text==='Outra frase.').words,timelineClip.captions[1].words,'untouched word alignment survives projection');
    assert.deepEqual(body.captions.find(cue=>cue.text==='Antes depois agora.'),timelineClip.captions[2],'split UI rows keep the canonical source group and exact words until edited');
    await revealEditorControl(page,'#cut-removed-ranges');await page.getByRole('button',{name:'Restaurar trecho 1',exact:true}).click();
    await assertTimes('Antes depois agora.','00:07,500','00:13');
    await assertTimes('Linha corrigida sem alinhamento.','00:15','00:17');
    await (await rowFor('A fala do corte.')).locator('[name=cueText]').fill('Fala corrigida preservada.');
    await setWindow('00:14','00:40');
    assert.equal(await page.locator('.cuts-cue textarea').evaluateAll(areas=>areas.some(area=>area.value==='Fala corrigida preservada.')),false,'captions outside the clip are not shown with negative phone times');
    await setWindow('00:10','00:40');await assertTimes('Fala corrigida preservada.','00:00,001','00:03');
    await setWindow('00:09','00:40');await assertTimes('Fala corrigida preservada.','00:01,001','00:04');
    assert.equal((await read()).body.captions.find(cue=>cue.text==='Fala corrigida preservada.').start,10.001,'changing the cut start reprojects fields without moving speech');
    await setWindow('00:10','00:40');
    await (await rowFor('Fala corrigida preservada.')).locator('[name=cueEnd]').fill('00:31');
    assert((await read()).error,'caption times beyond the phone duration must fail instead of silently clamping');
    assert.equal(await (await rowFor('Fala corrigida preservada.')).locator('[name=cueEnd]').inputValue(),'00:31','invalid edits stay available for correction');
    await (await rowFor('Fala corrigida preservada.')).locator('[name=cueEnd]').fill('00:03');
    await remove('00:18','00:20');
    await (await rowFor('depois agora.')).locator('[name=cueStart]').fill('00:08');
    body=(await read()).body;assert(body);
    assert.equal(body.captions.find(cue=>cue.text==='Antes').end,18,'a caption end on a junction uses the previous retained segment');
    assert.equal(body.captions.find(cue=>cue.text==='depois agora.').start,20,'a caption start on a junction uses the next retained segment');
    await revealEditorControl(page,'#cut-removed-ranges');await page.getByRole('button',{name:'Restaurar trecho 1',exact:true}).click();
    await remove('00:25,500','00:26');
    assert(await (await rowFor('Linha corrigida sem alinhamento.')).isVisible(),'a conflict must not silently remove corrected text');
    assert.match((await read()).error,/legenda|alinhamento|remoç|remov/i,'a removal through unaligned corrected text cannot be saved silently');
    await revealEditorControl(page,'#cut-removed-ranges');await page.getByRole('button',{name:'Restaurar trecho 1',exact:true}).click();
    assert((await read()).body,'restoring the conflicting removal recovers the preserved draft');
    await revealEditorControl(page,'#cuts-cues');await page.getByRole('button',{name:'Remover legenda 2',exact:true}).click();
    await page.getByRole('button',{name:'Adicionar linha',exact:true}).click();
    const count=await page.locator('.cuts-cue').count();
    for(let number=1;number<=count;number++){
      assert.equal(await page.getByLabel('Início da legenda '+number,{exact:true}).count(),1,'caption start labels stay unique after removing and adding a row');
      assert.equal(await page.getByLabel('Fim da legenda '+number,{exact:true}).count(),1,'caption end labels stay unique after removing and adding a row');
      assert.equal(await page.getByLabel('Texto da legenda '+number,{exact:true}).count(),1,'caption text labels stay unique after removing and adding a row');
    }

    await page.goto('http://127.0.0.1:'+server.address().port+'/?edge=1');
    await page.getByRole('heading',{name:'Editar corte para YouTube',exact:true}).waitFor();
    await setWindow('00:08','00:44');
    await assertTimes('Prefixo falado completo.','00:00','00:01,500');
    await assertTimes('Final falado.','00:33','00:35');
    await (await rowFor('Prefixo falado completo.')).locator('[name=cueText]').fill('Prefixo corrigido.');
    body=(await read()).body;assert(body,'newly revealed source edges remain editable and saveable');
    assert.deepEqual(body.captions.filter(cue=>['Prefixo corrigido.','Final falado.'].includes(cue.text)).map(cue=>[cue.start,cue.end]),[[8,9.5],[41,43]],'editing revealed edges sends absolute source times');
    assert.deepEqual(body.captions.find(cue=>cue.text==='Final falado.').words,transcriptEdges[1].words,'source edge word alignment stays exact');
    await (await rowFor('Prefixo corrigido.')).getByRole('button',{name:/Remover legenda/}).click();
    await setWindow('00:10','00:40');await setWindow('00:08','00:44');
    assert.equal(await page.locator('.cuts-cue textarea').evaluateAll(areas=>areas.some(area=>/Prefixo/.test(area.value))),false,'an explicitly removed edge is not resurrected after shrinking and expanding the cut');
    assert.equal((await read()).body.captions.some(cue=>/Prefixo/.test(cue.text)),false);
    await assertTimes('Final falado.','00:33','00:35');

    await page.goto('http://127.0.0.1:'+server.address().port+'/?edge=1&transcript=hold');
    await page.getByRole('heading',{name:'Editar corte para YouTube',exact:true}).waitFor();
    await setWindow('00:08','00:44');
    await page.locator('#cut-phone-seek').evaluate(range=>{range.value='0.5';range.dispatchEvent(new Event('input',{bubbles:true}));});
    await revealEditorControl(page,'#cuts-cues');
    await page.getByRole('button',{name:'Adicionar linha',exact:true}).click();
    const manual=page.locator('.cuts-cue').last();
    await manual.locator('[name=cueEnd]').fill('00:01');
    await manual.locator('[name=cueText]').fill('Trecho manual.');
    await page.evaluate(()=>window.__releaseTranscript());
    await page.waitForFunction(()=>{try{return !!window.editor.read().captions;}catch{return false;}});
    await assertTimes('Trecho manual.','00:00,500','00:01');
    await assertTimes('Prefixo','00:00','00:00,500');
    await assertTimes('completo.','00:01','00:01,500');
    body=(await read()).body;
    assert.deepEqual(body.captions.filter(cue=>['Prefixo','Trecho manual.','completo.'].includes(cue.text)).map(cue=>[cue.start,cue.end]),[[8,8.5],[8.5,9],[9,9.5]],'a manual edit before transcript arrival replaces only its own source interval');
  }
  assert.deepEqual(errors,[]);
  console.log(diagnostic?'Scroll diagnostic captured.':'Editor: single scroll, transcript retry, phone-relative caption clocks, gaps/junctions, source payloads and draft preservation validated.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

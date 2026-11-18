import {tiktokCaption} from './tiktok-caption.js';
export {tiktokCaption} from './tiktok-caption.js';
import type { Locator, Page } from 'playwright-core';
import { mkdir, open, readFile, readdir, rename, rm, writeFile, chmod } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { PackSource } from './pack-source.js';
import {AppError} from './config.js';
import { LocalFiles } from './local.js';
import { metadataSchema, type Metadata } from './domain.js';
import { sha256, stripVideoMetadata, validateVideo } from './media.js';
import { DateTime } from 'luxon';

export const TIKTOK_UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload';
export type BrowserJobStatus = 'preparing' | 'review' | 'scheduled' | 'published' | 'unknown';
export interface BrowserJob {
  hash: string;
  status: BrowserJobStatus;
  file: string;
  createdAt: string;
  updatedAt: string;
  madeWithAI: boolean;
  publishAt?:string;
  sourceId?:string;
  caption?:string;
}
export class BrowserActionRequired extends Error {
  constructor(public code: 'login_required' | 'security_check' | 'page_changed' | 'upload_unconfirmed' | 'platform_limit', message: string) { super(message); }
}

/** A claim remains after uncertain results: never repeat an upload automatically. */
export class BrowserJournal {
  constructor(public directory: string) {}
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
  }
  private path(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Hash inválido.');
    return join(this.directory, hash + '.json');
  }
  async get(hash: string): Promise<BrowserJob | undefined> {
    try {
      const job: BrowserJob = JSON.parse(await readFile(this.path(hash), 'utf8'));
      if (job.hash !== hash || !['preparing', 'review', 'scheduled', 'published', 'unknown'].includes(job.status)) throw new Error('Histórico do navegador inválido.');
      return job;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  async list() {
    const files = await readdir(this.directory);
    const jobs: BrowserJob[] = [];
    for (const file of files.filter(f => /^[a-f0-9]{64}\.json$/.test(f))) jobs.push((await this.get(file.slice(0, -5)))!);
    return jobs;
  }
  async claim(hash: string, file: string, madeWithAI: boolean, sourceId?:string,caption?:string) {
    const now = new Date().toISOString();
    const job: BrowserJob = { hash, file, madeWithAI, ...(sourceId?{sourceId}:{}),...(caption?{caption}:{}), status: 'preparing', createdAt: now, updatedAt: now };
    try {
      const handle = await open(this.path(hash), 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(job, null, 2)); await handle.sync(); } finally { await handle.close(); }
      return job;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return; throw error; }
  }
  async update(job: BrowserJob, status: BrowserJobStatus, publishAt?:string) {
    const next = { ...job, status, ...(publishAt?{publishAt}:{}), updatedAt: new Date().toISOString() };
    const temporary = this.path(job.hash) + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(temporary, this.path(job.hash));
    return next;
  }
  async releaseBeforeUpload(hash: string) { await rm(this.path(hash), { force: true }); }
  async rememberSource(sourceId:string,hash:string) {
    await this.saveSource(sourceId,{hash});
  }
  async rejectSource(sourceId:string,reason:string) {await this.saveSource(sourceId,{rejected:true,reason});}
  private async saveSource(sourceId:string,value:unknown) {
    const directory=join(this.directory,'sources');await mkdir(directory,{recursive:true,mode:0o700});
    const path=join(directory,createHash('sha256').update(sourceId).digest('hex')+'.json');
    const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);
  }
  async sourceSeen(sourceId:string) {
    try {
      const path=join(this.directory,'sources',createHash('sha256').update(sourceId).digest('hex')+'.json');
      const saved=JSON.parse(await readFile(path,'utf8'));return saved.rejected===true||!!await this.get(saved.hash);
    } catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
  }
}



/** Uses the existing filesystem adapter, stability checks and media preparation. */
export async function nextBrowserVideo(mediaDirectory: string, workDirectory: string, journal: BrowserJournal, stripMetadata = true) {
  const local = new LocalFiles(mediaDirectory, mediaDirectory);
  const root = await local.folder('.');
  const files = await local.tree(root.id, true);
  const now = Date.now();
  const videos = files.filter(file => file.mimeType === 'video/mp4' && now - Date.parse(file.modifiedTime || '') >= 30_000)
    .sort((a, b) => (a.modifiedTime || '').localeCompare(b.modifiedTime || '') || a.name.localeCompare(b.name));
  for (const video of videos) {
    const sidecars = files.filter(file => file.mimeType === 'application/json' && file.parents?.[0] === video.parents?.[0]
      && file.name.toLowerCase() === video.name.replace(/\.mp4$/i, '.json').toLowerCase());
    if (sidecars.length > 1) throw new Error('Mais de um JSON corresponde ao vídeo. Use nomes únicos.');
    const sidecar = sidecars[0];
    if (sidecar && now - Date.parse(sidecar.modifiedTime || '') < 30_000) continue;
    const metadata = metadataSchema.parse(sidecar ? await local.json(sidecar.id) : { title: video.name.replace(/\.mp4$/i, '') });
    if (!metadata.ready || (metadata.targets && !metadata.targets.includes('tiktok'))) continue;
    const caption = tiktokCaption(metadata);
    const directory = join(workDirectory, randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const original = join(directory, 'original.mp4'), clean = join(directory, 'video.mp4');
    try {
      await local.download(video.id, original, 1024 * 1024 * 1024);
      if ((await local.file(video.id)).version !== video.version || (sidecar && (await local.file(sidecar.id)).version !== sidecar.version)) {
        await rm(directory, { recursive: true, force: true });
        continue;
      }
      const hash = await sha256(original);
      if (await journal.get(hash)) { await rm(directory, { recursive: true, force: true }); continue; }
      await validateVideo(original);
      if (stripMetadata) await stripVideoMetadata(original, clean);
      return { hash, name: video.name, metadata, caption, path: stripMetadata ? clean : original, directory };
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
}

export async function nextPackVideo(workDirectory:string,journal:BrowserJournal,defaults:unknown={},stripMetadata=true) {
  const source=new PackSource(defaults),seen=new Set((await journal.list()).map(job=>job.sourceId).filter(Boolean));
  let rejected=0;
  for(const video of await source.catalog()) {
    const sourceId='gta6-pack:'+video.drive;
    if(seen.has(sourceId)||await journal.sourceSeen(sourceId))continue;
    const metadata=metadataSchema.parse(await source.json(sourceId+':json'));
    const caption=tiktokCaption(metadata),directory=join(workDirectory,randomUUID());
    await mkdir(directory,{recursive:true,mode:0o700});
    const original=join(directory,'original.mp4'),clean=join(directory,'video.mp4');
    try {
      await source.download(sourceId,original,1024*1024*1024);
      const hash=await sha256(original);
      if(await journal.get(hash)) {await journal.rememberSource(sourceId,hash);await rm(directory,{recursive:true,force:true});continue;}
      await validateVideo(original);
      if(stripMetadata)await stripVideoMetadata(original,clean);
      return {sourceId,hash,name:metadata.title+'.mp4',metadata,caption,path:stripMetadata?clean:original,directory};
    } catch(error) {
      await rm(directory,{recursive:true,force:true});
      if(error instanceof AppError&&[400,404].includes(error.status)) {
        await journal.rejectSource(sourceId,error.message);
        if(++rejected>=3)return;
        continue;
      }
      throw error;
    }
  }
}

export async function checkBrowserGate(page: Page) {
  if (page.isClosed()) throw new BrowserActionRequired('page_changed', 'O navegador foi fechado.');
  if(await page.getByText(/too many scheduled|maximum number of scheduled|daily upload limit|too many uploading attempts|reached (?:the |your )?.*(?:upload|schedul).*limit|reached (?:the |your )?limit (?:for|of) (?:scheduled|uploads)|limite de (?:vídeos|videos|uploads|agendamentos).*(?:atingido|alcançado)|muitos vídeos agendados/i).first().isVisible().catch(()=>false))
    throw new BrowserActionRequired('platform_limit','O TikTok atingiu um limite de envios ou de vídeos agendados. Interrompa o lote e confira a conta.');
  const googleLogin = page.context().pages().some(tab => {
    try { return new URL(tab.url()).hostname === 'accounts.google.com'; } catch { return false; }
  });
  if (googleLogin || await page.getByText(/This browser or app may not be secure|navegador ou app pode não ser seguro/i).first().isVisible().catch(() => false))
    throw new BrowserActionRequired('login_required', 'O login Google não deve ser feito na janela automatizada. Feche as janelas desse perfil e execute scripts/tiktok-browser.sh --login para entrar manualmente no Chrome; você também pode usar o QR code do TikTok.');
  const captchaFrames = page.locator('iframe[src*="captcha"], iframe[title*="captcha" i], [id*="captcha-verify"], .captcha_verify_container');
  for (const frame of await captchaFrames.all()) if (await frame.isVisible())
    throw new BrowserActionRequired('security_check', 'Verificação de segurança detectada. Resolva manualmente no navegador; a automação foi interrompida.');
  if (await page.getByText(/^(Verify to continue|Complete the puzzle|Verify your identity|Verifique sua identidade|Verifique para continuar|Arraste o controle deslizante|Drag the slider)/i).first().isVisible().catch(() => false))
    throw new BrowserActionRequired('security_check', 'Verificação de segurança detectada. A automação não resolve CAPTCHA.');
  if (/\/login(?:[/?#]|$)/.test(page.url()) || await page.getByRole('dialog').getByText(/^(Log in to TikTok|Entrar no TikTok|Faça login no TikTok)$/i).first().isVisible().catch(() => false))
    throw new BrowserActionRequired('login_required', 'Faça login manualmente no perfil do navegador da automação.');
}

async function waitForElement(page: Page, find: () => Locator, timeout: number, enabled = false,onWait?:()=>Promise<void>) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    await checkBrowserGate(page);
    await dismissTikTokNotices(page);
    await onWait?.();
    const locator = find();
    if (await locator.count() === 1 && await locator.isVisible() && (!enabled || await locator.isEnabled())) return locator;
    await page.waitForTimeout(300);
  }
  throw new BrowserActionRequired('page_changed', 'O controle esperado do TikTok não ficou disponível. Confira a página manualmente.');
}

/** Only remove an editing copy whose complete caption belongs to this agent's journal. */
export async function clearKnownTikTokDraft(page:Page,knownCaptions:string[]) {
  const notice=page.getByText(/A video you were editing wasn[’']t saved\. Continue editing\?/i);
  if(!await notice.isVisible().catch(()=>false))return false;
  const proceed=page.getByRole('button',{name:/^(Continue|Continuar)$/i});
  if(await proceed.count()!==1)throw new BrowserActionRequired('page_changed','Confira o rascunho não salvo no TikTok.');
  await proceed.click({timeout:5000});
  const editor=await waitForElement(page,()=>page.locator('[contenteditable="true"],textarea[placeholder*="caption" i]'),10000);
  const caption=await editor.evaluate(element=>'value' in element?String(element.value):(element as HTMLElement).innerText);
  const normalize=(text:string)=>text.replace(/\s+/g,' ').trim();
  if(!knownCaptions.some(known=>normalize(known)===normalize(caption)))throw new BrowserActionRequired('page_changed','Este rascunho não está no histórico da automação. Confira-o no Chrome antes de continuar.');
  await page.getByRole('button',{name:/^(Discard|Descartar)$/i}).click({timeout:5000});
  const confirmation=page.getByText(/^(Discard this post\?|Descartar esta publicação\?)$/i);
  await confirmation.waitFor({state:'visible',timeout:5000});
  await page.getByRole('button',{name:/^(Discard|Descartar)$/i}).click({timeout:5000});
  await editor.waitFor({state:'hidden',timeout:10000});
  return true;
}

async function dismissTikTokNotices(page:Page) {
  if(await page.getByText(/^(Turn on automatic content checks\?|Ativar verificações automáticas de conteúdo\?)$/i).isVisible().catch(()=>false)) {
    await page.keyboard.press('Escape');
    const cancel=page.getByRole('button',{name:/^(Cancel|Cancelar)$/i});
    if(await cancel.count()===1)await cancel.click({timeout:5000});
  }
  if(await page.getByText(/^(New editing features added|Novos recursos de edição adicionados)$/i).isVisible().catch(()=>false)) {
    const understood=page.getByRole('button',{name:/^(Got it|Entendi)$/i});
    if(await understood.count()===1)await understood.click({timeout:5000});
  }
}

/** Only observed native UI controls; no private endpoints or final publishing click. */
export async function prepareTikTokUpload(page: Page, video: string, caption: string, options: {
  timeout?: number;
  onBeforeUpload: () => Promise<void>;
  onUploadStarted: () => void;
  knownDraftCaptions?:string[];
}) {
  const timeout = options.timeout ?? 600_000;
  await checkBrowserGate(page);
  const until = Date.now() + Math.min(timeout, 30_000);
  const input = page.locator('input[type="file"][accept*="video"]');
  while (await input.count() !== 1 && Date.now() < until) {
    await checkBrowserGate(page); await page.waitForTimeout(300);
  }
  if (await input.count() !== 1) throw new BrowserActionRequired('page_changed', 'Não foi encontrado um seletor único de vídeo. Faça login e confira o TikTok Studio.');
  let draftHandled=await clearKnownTikTokDraft(page,options.knownDraftCaptions||[]);
  await options.onBeforeUpload();
  // Persist uncertainty before this action: selecting the file starts a real transfer.
  options.onUploadStarted();
  await input.setInputFiles(video);
  const editor = await waitForElement(page, () => page.locator('[contenteditable="true"][role="textbox"], .public-DraftEditor-content[contenteditable="true"], textarea[placeholder*="caption" i], textarea[placeholder*="descrição" i]'), timeout,false,async()=>{
    if(await page.getByText(/A video you were editing wasn[’']t saved\. Continue editing\?/i).isVisible().catch(()=>false)) {
      if(draftHandled)throw new BrowserActionRequired('page_changed','O aviso de rascunho reapareceu. Confira o editor antes de continuar.');
      draftHandled=await clearKnownTikTokDraft(page,options.knownDraftCaptions||[]);
      if(draftHandled)await input.setInputFiles(video);
    }
  });
  await checkBrowserGate(page);
  await waitForElement(page, () => page.getByRole('button', { name: /^(Post|Publish|Publicar|Postar)$/i }), timeout, true);
  // Studio can insert the filename while processing. Replace the complete
  // DraftJS selection after processing and verify the final visible caption.
  await setTikTokCaption(page,editor,caption);
  await waitForElement(page, () => page.getByRole('button', { name: /^(Post|Publish|Publicar|Postar)$/i }), timeout, true);
  await checkBrowserGate(page);
  await dismissTikTokNotices(page);
  return { status: 'review' as const };
}

export async function setTikTokCaption(page:Page,editor:Locator,caption:string) {
  const normalize=(value:string)=>value.replace(/\s+/g,' ').trim();
  for(let attempt=0;attempt<3;attempt++) {
    await editor.click({timeout:5000});
    await editor.press('ControlOrMeta+A');await editor.press('Backspace');
    await page.keyboard.insertText(caption);await editor.press('Escape');
    await page.waitForTimeout(150);
    const visible=await editor.evaluate(element=>'value' in element?String(element.value):(element as HTMLElement).innerText);
    if(normalize(visible)===normalize(caption))return;
  }
  throw new BrowserActionRequired('page_changed','O TikTok não preservou o título e a legenda revisados.');
}

async function configureTikTokPublication(page:Page,metadata:Metadata) {
  if(metadata.tiktok.privacyLevel!=='PUBLIC_TO_EVERYONE'||metadata.tiktok.commercialContent||metadata.tiktok.ownBrand)
    throw new BrowserActionRequired('page_changed','A publicação automática exige privacidade pública explícita e declarações comerciais conferidas.');
  await checkBrowserGate(page);
  const privacy=page.getByRole('combobox',{name:/who can watch|quem pode assistir|privacidade|privacy/i});
  const publicLabel=/^(Everyone|Todos|Público)$/i;
  if(await privacy.count()===1) {
    const options=await privacy.locator('option').all();
    const names=await Promise.all(options.map(option=>option.textContent()));
    const index=names.findIndex(name=>publicLabel.test(name?.trim()||''));
    if(index<0)throw new BrowserActionRequired('page_changed','A privacidade pública não está disponível no TikTok.');
    await privacy.selectOption({index});
  } else {
    const name=/^(Everyone|Friends|Only me|Todos|Amigos|Somente eu|Apenas eu|Público)$/i;
    const control=page.getByRole('button',{name}).or(page.getByRole('combobox').filter({hasText:name}));
    if(await control.count()!==1)throw new BrowserActionRequired('page_changed','Confira a privacidade pública no TikTok antes de agendar.');
    if(!publicLabel.test((await control.innerText()).trim())) {
      await control.click();
      const option=page.getByRole('option',{name:publicLabel});
      if(await option.count()!==1)throw new BrowserActionRequired('page_changed','A opção pública do TikTok não foi identificada.');
      await option.click();
    }
  }
  await configureTikTokPermissions(page,metadata);
}

async function configureTikTokPermissions(page:Page,metadata:Metadata) {
  const more=page.getByText(/^(Show more|Mostrar mais)$/i,{exact:true});
  if(await more.count()===1&&await more.isVisible())await more.click();
  const reuse=page.getByRole('checkbox',{name:/^(Reuse of content|Reutilização de conteúdo)$/i});
  for(const [name,allowed] of [
    [/^(?:Allow )?comments?$|^(?:Permitir )?comentários$/i,metadata.tiktok.allowComment],
    [/^(?:Allow )?duet$|^(?:Permitir )?dueto$/i,metadata.tiktok.allowDuet],
    [/^(?:Allow )?stitch$|^(?:Permitir )?costura$/i,metadata.tiktok.allowStitch]
  ] as const) {
    const control=page.getByRole('checkbox',{name}).or(page.getByRole('switch',{name}));
    if(await control.count()===0&&await reuse.count()===1&&!/comments?/i.test(name.source)) {
      if(allowed)throw new BrowserActionRequired('page_changed','A interface de reutilização não permite conferir dueto e costura separadamente.');
      if(await reuse.isChecked())await setTikTokChecked(reuse,false);
      if(await reuse.isChecked())throw new BrowserActionRequired('page_changed','O TikTok não desativou a reutilização deste vídeo.');
      continue;
    }
    if(await control.count()!==1)throw new BrowserActionRequired('page_changed','Confira as permissões de comentários, dueto e costura no TikTok.');
    await setTikTokChecked(control,allowed);
  }
  const name=/AI.generated|conteúdo gerado por IA|gerado por inteligência artificial/i;
  const ai=page.getByRole('checkbox',{name}).or(page.getByRole('switch',{name})).or(page.locator('[data-e2e="aigc_container"]').filter({has:page.getByText(/^AI-generated content$/i,{exact:true})}).locator('input[type="checkbox"][role="switch"]'));
  if(await ai.count()!==1)throw new BrowserActionRequired('page_changed','A declaração de IA do TikTok precisa ser conferida antes da publicação.');
  if(await ai.isChecked()!==metadata.tiktok.madeWithAI) {
    if(await ai.getAttribute('aria-hidden')==='true')await ai.locator('..').click();
    else await ai.setChecked(metadata.tiktok.madeWithAI);
  }
  if(await ai.isChecked()!==metadata.tiktok.madeWithAI)throw new BrowserActionRequired('page_changed','O TikTok não preservou a declaração de IA escolhida.');
  const commercial=page.locator('[data-e2e="disclose_content_container"] input[type="checkbox"][role="switch"]');
  if(await commercial.count()===1&&await commercial.isChecked()) {
    await commercial.locator('..').click();
    if(await commercial.isChecked())throw new BrowserActionRequired('page_changed','Confira a declaração comercial do vídeo.');
  }
}

async function setTikTokChecked(control:Locator,checked:boolean) {
  if(await control.isChecked()===checked)return;
  const label=control.locator('xpath=ancestor::label[1]');
  if(await label.count()===1)await label.click({timeout:5000});
  else await control.setChecked(checked,{timeout:5000});
  if(checked&&await control.getAttribute('type')==='radio'&&await control.inputValue()==='schedule') {
    const page=control.page();
    if(await page.getByText('Allow your video to be saved for scheduled posting?',{exact:true}).isVisible().catch(()=>false)) {
      const allow=page.getByRole('button',{name:'Allow',exact:true});
      if(await allow.count()===1)await allow.click({timeout:5000});
    }
  }
  const until=Date.now()+5000;
  while(await control.isChecked()!==checked&&Date.now()<until)await control.page().waitForTimeout(100);
  if(await control.isChecked()!==checked)throw new BrowserActionRequired('page_changed','O TikTok não preservou a opção selecionada.');
}

/** One explicitly authorized immediate publication, with a fresh acknowledgement. */
export async function publishTikTokUpload(page:Page,metadata:Metadata,timeout=180_000) {
  await configureTikTokPublication(page,metadata);
  const now=page.getByRole('radio',{name:/^(Now|Agora|Publicar agora|Post now)$/i});
  if(await now.count()===1)await setTikTokChecked(now,true);
  const scheduled=page.getByRole('switch',{name:/^(Schedule|Agendar|Programar)$/i}).or(page.getByRole('checkbox',{name:/^(Schedule|Agendar|Programar)$/i}));
  if(await scheduled.count()===1)await setTikTokChecked(scheduled,false);
  await checkBrowserGate(page);
  const submit=await waitForElement(page,()=>page.getByRole('button',{name:/^(Post|Publish|Publicar|Postar)$/i}),timeout,true);
  const success=page.getByText(/^(?:(?:Your )?(?:video|post) (?:has been )?(?:published|uploaded)(?: successfully)?[.!]?|Vídeo (?:publicado|enviado)(?: com sucesso)?[.!]?|Publicado com sucesso[.!]?)$/i);
  if(await success.first().isVisible().catch(()=>false))throw new BrowserActionRequired('page_changed','A página já exibia uma confirmação antiga. Confira o vídeo.');
  await submit.click();
  const until=Date.now()+timeout;
  while(Date.now()<until) {
    await checkBrowserGate(page);
    if(await success.first().isVisible())return {status:'published' as const};
    await page.waitForTimeout(300);
  }
  throw new BrowserActionRequired('upload_unconfirmed','O TikTok não confirmou a publicação. Confira o Studio antes de repetir.');
}

async function setTikTokScheduleDate(page:Page,date:DateTime) {
  let dateInput=page.locator('input[type="date"]').or(page.getByRole('textbox',{name:/^(Date|Data|Schedule date|Data de agendamento)$/i}));
  let timeInput=page.locator('input[type="time"]').or(page.getByRole('textbox',{name:/^(Time|Horário|Hora|Schedule time|Horário de agendamento)$/i}));
  if(await dateInput.count()===0&&await timeInput.count()===0) {
    const dates:Locator[]=[],times:Locator[]=[];
    for(const input of await page.locator('input[type="text"][readonly]').all()) {
      if(!await input.isVisible())continue;
      const value=await input.inputValue();
      if(/^\d{4}-\d{2}-\d{2}$/.test(value))dates.push(input);
      if(/^\d{2}:\d{2}$/.test(value))times.push(input);
    }
    if(dates.length!==1||times.length!==1)throw new BrowserActionRequired('page_changed','Os seletores de data e hora do TikTok não são únicos.');
    [dateInput]=dates;[timeInput]=times;
    if(await dateInput.inputValue()!==date.toISODate()) {
      await dateInput.click();
      const calendar=page.locator('.calendar-wrapper');
      if(await calendar.count()!==1||!await calendar.isVisible())throw new BrowserActionRequired('page_changed','O calendário nativo do TikTok não abriu.');
      for(let step=0;step<3;step++) {
        const month=(await calendar.locator('.month-title').innerText()).trim(),year=(await calendar.locator('.year-title').innerText()).trim();
        let shown=DateTime.fromFormat(month+' '+year,'LLLL yyyy',{locale:'en-US'});
        if(!shown.isValid)shown=DateTime.fromFormat(month+' '+year,'LLLL yyyy',{locale:'pt-BR'});
        if(!shown.isValid)throw new BrowserActionRequired('page_changed','O mês do calendário não foi identificado.');
        if(shown.year===date.year&&shown.month===date.month)break;
        const arrows=calendar.locator('.month-header-wrapper .arrow');
        if(step===2||await arrows.count()!==2)throw new BrowserActionRequired('page_changed','O calendário não alcançou o mês autorizado.');
        await arrows.nth(shown.toMillis()<date.startOf('month').toMillis()?1:0).click();
        await page.waitForTimeout(100);
      }
      const days=calendar.locator('.days-wrapper .day'),labels=await days.allTextContents();
      const first=labels.findIndex(label=>label.trim()==='1'),index=first+date.day-1;
      const day=days.nth(index);
      if(first<0||(await day.innerText()).trim()!==String(date.day)||!(await day.getAttribute('class'))?.split(/\s+/).includes('valid'))throw new BrowserActionRequired('page_changed','O dia escolhido não está disponível no calendário.');
      await day.click();
    }
    if(date.minute%5)throw new BrowserActionRequired('page_changed','O seletor atual do TikTok exige horários em intervalos de cinco minutos.');
    const picker=page.locator('.tiktok-timepicker-time-picker-container:not(.tiktok-timepicker-invisible)');
    for(const [side,value] of [['left',date.toFormat('HH')],['right',date.toFormat('mm')]]) {
      if(await picker.count()!==1||!await picker.isVisible())await timeInput.click();
      await picker.waitFor({state:'visible',timeout:5000});
      const option=picker.locator('.tiktok-timepicker-'+side).filter({hasText:new RegExp('^'+value+'$')});
      if(await option.count()!==1)throw new BrowserActionRequired('page_changed','O horário escolhido não está disponível no TikTok.');
      await option.click();
      await page.waitForTimeout(500);
      if((await timeInput.inputValue()).split(':')[side==='left'?0:1]!==value) {
        // Studio's scrolling columns can still be animating after selection.
        await option.click();await page.waitForTimeout(500);
      }
      if((await timeInput.inputValue()).split(':')[side==='left'?0:1]!==value)throw new BrowserActionRequired('page_changed','O seletor de horário ainda não preservou a opção escolhida.');
    }
    const below=page.getByText(/^(Who can see this post|Quem pode ver esta publicação)$/i,{exact:true});
    if(await below.count()===1)await below.click({timeout:5000});
    else if(await picker.count()===1&&await picker.isVisible())await timeInput.click({timeout:5000});
    await picker.waitFor({state:'hidden',timeout:5000});
  } else {
    if(await dateInput.count()!==1||await timeInput.count()!==1)throw new BrowserActionRequired('page_changed','Os campos de data e horário do TikTok não estão disponíveis.');
    try {
      await dateInput.fill(date.toISODate()!,{timeout:5000});await dateInput.press('Tab');
      await timeInput.fill(date.toFormat('HH:mm'),{timeout:5000});await timeInput.press('Tab');
    }catch{throw new BrowserActionRequired('page_changed','O seletor de datas desta versão do TikTok precisa de revisão manual.');}
  }
  if(await dateInput.inputValue()!==date.toISODate()||await timeInput.inputValue()!==date.toFormat('HH:mm'))throw new BrowserActionRequired('page_changed','O TikTok não preservou a data e o horário reservados.');
}

/** Studio sometimes redirects directly to its content table without a toast. */
export async function confirmTikTokSchedule(page:Page,publishAt:Date,metadata:Metadata) {
  const url=new URL(page.url());
  if(url.origin!=='https://www.tiktok.com'||url.pathname!=='/tiktokstudio/content')return;
  const caption=tiktokCaption(metadata).replace(/\s+/g,' ').trim();
  const link=page.locator('a[data-tt="components_PostInfoCell_a"]').filter({hasText:new RegExp('^'+caption.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+')+'$')});
  if(await link.count()!==1||!await link.isVisible())return;
  const href=await link.getAttribute('href'),match=/^\/@[\w.]+\/video\/(\d+)$/.exec(href||'');
  if(!match)return;
  const row=link.locator('xpath=ancestor::*[@data-tt="components_RowLayout_FlexRow"][1]');
  if(await row.count()!==1||await row.locator('[data-icon="Alarm"]').count()!==1)return;
  const label=row.locator('.icon-label').filter({has:page.locator('[data-icon="Alarm"]')});
  if(await label.count()!==1)return;
  const observed=(await label.innerText()).replace(/\s+/g,' ').trim();
  const expected=DateTime.fromJSDate(publishAt).setZone('America/Sao_Paulo').setLocale('en-US').toFormat('MMM d, h:mm a')+' (GMT-3) Sao Paulo';
  if(observed!==expected||await row.getByRole('button',{name:/^(Everyone|Todos|Público)$/i}).count()!==1)return;
  return {status:'scheduled' as const,publishAt:publishAt.toISOString(),postId:match[1],releaseUrl:url.origin+href};
}

/** Fail closed if Studio changes its controls or does not acknowledge the exact submission. */
export async function scheduleTikTokUpload(page:Page,publishAt:Date,metadata:Metadata,timeout=180_000) {
  const valid=()=>Number.isFinite(publishAt.getTime())&&publishAt.getSeconds()===0&&publishAt.getMilliseconds()===0&&publishAt.getTime()>=Date.now()+15*60_000&&publishAt.getTime()<=Date.now()+10*86400_000;
  if(!valid())throw new BrowserActionRequired('page_changed','A data saiu da janela de 15 minutos a 10 dias do TikTok.');
  await configureTikTokPublication(page,metadata);
  const label=/^(Schedule|Schedule video|Schedule post|Agendar|Agendar vídeo|Programar)$/i;
  const choice=page.getByRole('radio',{name:label}).or(page.getByRole('switch',{name:label})).or(page.getByRole('checkbox',{name:label}));
  if(await choice.count()===1)await setTikTokChecked(choice,true);
  else {
    const control=page.getByText(label,{exact:true});
    if(await control.count()!==1)throw new BrowserActionRequired('page_changed','O controle de agendamento do TikTok não foi identificado com segurança.');
    await control.click();
  }
  const date=DateTime.fromJSDate(publishAt).setZone('America/Sao_Paulo');
  await setTikTokScheduleDate(page,date);
  await configureTikTokPermissions(page,metadata);
  await checkBrowserGate(page);
  const submit=await waitForElement(page,()=>page.getByRole('button',{name:/^(Schedule|Agendar|Programar)$/i}),timeout,true);
  if(!valid())throw new BrowserActionRequired('page_changed','O tempo do upload ultrapassou a antecedência mínima do TikTok.');
  const success=page.getByText(/^(?:Your (?:video|post) (?:has been|is) scheduled(?: successfully)?[.!]?|Video scheduled(?: successfully)?[.!]?|Post scheduled(?: successfully)?[.!]?|Vídeo agendado(?: com sucesso)?[.!]?|Agendado com sucesso[.!]?)$/i);
  if(await success.isVisible().catch(()=>false))throw new BrowserActionRequired('page_changed','A página já exibia uma confirmação antiga. Confira o agendamento.');
  await submit.click();
  const until=Date.now()+timeout;
  while(Date.now()<until) {
    await checkBrowserGate(page);
    if(await success.first().isVisible())return {status:'scheduled' as const,publishAt:publishAt.toISOString()};
    const confirmed=await confirmTikTokSchedule(page,publishAt,metadata);
    if(confirmed)return confirmed;
    await page.waitForTimeout(300);
  }
  throw new BrowserActionRequired('upload_unconfirmed','O TikTok não confirmou o agendamento. Confira o Studio antes de repetir.');
}

export function browserJobLabel(job: BrowserJob) {
  return { hash: job.hash, file: basename(job.file), status: job.status, madeWithAI: job.madeWithAI, publishAt:job.publishAt, updatedAt: job.updatedAt };
}

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
export type BrowserJobStatus = 'preparing' | 'review' | 'scheduled' | 'unknown';
export interface BrowserJob {
  hash: string;
  status: BrowserJobStatus;
  file: string;
  createdAt: string;
  updatedAt: string;
  madeWithAI: boolean;
  publishAt?:string;
  sourceId?:string;
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
      if (job.hash !== hash || !['preparing', 'review', 'scheduled', 'unknown'].includes(job.status)) throw new Error('Histórico do navegador inválido.');
      return job;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  async list() {
    const files = await readdir(this.directory);
    const jobs: BrowserJob[] = [];
    for (const file of files.filter(f => /^[a-f0-9]{64}\.json$/.test(f))) jobs.push((await this.get(file.slice(0, -5)))!);
    return jobs;
  }
  async claim(hash: string, file: string, madeWithAI: boolean, sourceId?:string) {
    const now = new Date().toISOString();
    const job: BrowserJob = { hash, file, madeWithAI, ...(sourceId?{sourceId}:{}), status: 'preparing', createdAt: now, updatedAt: now };
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

export function tiktokCaption(metadata: Metadata) {
  const caption = [metadata.title, metadata.description,
    metadata.hashtags.map(tag => '#' + tag.replace(/^#+/, '').replace(/\s+/g, '')).join(' ')]
    .filter(Boolean).join('\n\n');
  if ([...caption].length > 2200) throw new Error('Legenda excede 2.200 caracteres. Ajuste o JSON antes do upload.');
  return caption;
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

async function waitForElement(page: Page, find: () => Locator, timeout: number, enabled = false) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    await checkBrowserGate(page);
    const locator = find();
    if (await locator.count() === 1 && await locator.isVisible() && (!enabled || await locator.isEnabled())) return locator;
    await page.waitForTimeout(300);
  }
  throw new BrowserActionRequired('page_changed', 'O controle esperado do TikTok não ficou disponível. Confira a página manualmente.');
}

/** Only observed native UI controls; no private endpoints or final publishing click. */
export async function prepareTikTokUpload(page: Page, video: string, caption: string, options: {
  timeout?: number;
  onBeforeUpload: () => Promise<void>;
  onUploadStarted: () => void;
}) {
  const timeout = options.timeout ?? 180_000;
  await checkBrowserGate(page);
  const until = Date.now() + Math.min(timeout, 30_000);
  const input = page.locator('input[type="file"][accept*="video"]');
  while (await input.count() !== 1 && Date.now() < until) {
    await checkBrowserGate(page); await page.waitForTimeout(300);
  }
  if (await input.count() !== 1) throw new BrowserActionRequired('page_changed', 'Não foi encontrado um seletor único de vídeo. Faça login e confira o TikTok Studio.');
  await options.onBeforeUpload();
  // Persist uncertainty before this action: selecting the file starts a real transfer.
  options.onUploadStarted();
  await input.setInputFiles(video);
  const editor = await waitForElement(page, () => page.locator('[contenteditable="true"][role="textbox"], .public-DraftEditor-content[contenteditable="true"], textarea[placeholder*="caption" i], textarea[placeholder*="descrição" i]'), timeout);
  await checkBrowserGate(page);
  await editor.fill(caption);
  await waitForElement(page, () => page.getByRole('button', { name: /^(Post|Publish|Publicar|Postar)$/i }), timeout, true);
  await checkBrowserGate(page);
  return { status: 'review' as const };
}

/** Fail closed if Studio changes its controls or does not acknowledge the exact submission. */
export async function scheduleTikTokUpload(page:Page,publishAt:Date,metadata:Metadata,timeout=180_000) {
  const valid=()=>Number.isFinite(publishAt.getTime())&&publishAt.getSeconds()===0&&publishAt.getMilliseconds()===0&&publishAt.getTime()>=Date.now()+15*60_000&&publishAt.getTime()<=Date.now()+10*86400_000;
  if(!valid())throw new BrowserActionRequired('page_changed','A data saiu da janela de 15 minutos a 10 dias do TikTok.');
  if(metadata.tiktok.privacyLevel!=='PUBLIC_TO_EVERYONE'||metadata.tiktok.commercialContent||metadata.tiktok.ownBrand)
    throw new BrowserActionRequired('page_changed','O agendamento automático exige privacidade pública explícita e conteúdo sem declarações comerciais pendentes. Use revisão manual para este vídeo.');
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
    const control=page.getByRole('button',{name:/^(Everyone|Friends|Only me|Todos|Amigos|Somente eu|Apenas eu|Público)$/i});
    if(await control.count()!==1)throw new BrowserActionRequired('page_changed','Confira a privacidade pública no TikTok antes de agendar.');
    if(!publicLabel.test((await control.innerText()).trim())) {
      await control.click();
      const option=page.getByRole('option',{name:publicLabel});
      if(await option.count()!==1)throw new BrowserActionRequired('page_changed','A opção pública do TikTok não foi identificada.');
      await option.click();
    }
  }
  const label=/^(Schedule|Schedule video|Schedule post|Agendar|Agendar vídeo|Programar)$/i;
  const choice=page.getByRole('radio',{name:label}).or(page.getByRole('switch',{name:label})).or(page.getByRole('checkbox',{name:label}));
  if(await choice.count()===1)await choice.setChecked(true);
  else {
    const control=page.getByText(label,{exact:true});
    if(await control.count()!==1)throw new BrowserActionRequired('page_changed','O controle de agendamento do TikTok não foi identificado com segurança.');
    await control.click();
  }
  const date=DateTime.fromJSDate(publishAt).setZone('America/Sao_Paulo');
  const dateInput=page.locator('input[type="date"]').or(page.getByRole('textbox',{name:/^(Date|Data|Schedule date|Data de agendamento)$/i}));
  const timeInput=page.locator('input[type="time"]').or(page.getByRole('textbox',{name:/^(Time|Horário|Hora|Schedule time|Horário de agendamento)$/i}));
  if(await dateInput.count()!==1||await timeInput.count()!==1)throw new BrowserActionRequired('page_changed','Os campos de data e horário do TikTok não estão disponíveis. Confira a interface.');
  try {
    await dateInput.fill(date.toISODate()!,{timeout:5000});await dateInput.press('Tab');
    await timeInput.fill(date.toFormat('HH:mm'),{timeout:5000});await timeInput.press('Tab');
  } catch {throw new BrowserActionRequired('page_changed','O seletor de datas desta versão do TikTok precisa de revisão manual.');}
  if(await dateInput.inputValue()!==date.toISODate()||!(await timeInput.inputValue()).startsWith(date.toFormat('HH:mm')))
    throw new BrowserActionRequired('page_changed','O TikTok não preservou a data e o horário reservados.');
  for(const [name,allowed] of [
    [/^(?:Allow )?comments$|^(?:Permitir )?comentários$/i,metadata.tiktok.allowComment],
    [/^(?:Allow )?duet$|^(?:Permitir )?dueto$/i,metadata.tiktok.allowDuet],
    [/^(?:Allow )?stitch$|^(?:Permitir )?costura$/i,metadata.tiktok.allowStitch]
  ] as const) {
    const control=page.getByRole('checkbox',{name}).or(page.getByRole('switch',{name}));
    if(await control.count()!==1)throw new BrowserActionRequired('page_changed','Confira as permissões de comentários, dueto e costura no TikTok antes de agendar.');
    await control.setChecked(allowed);
  }
  if(metadata.tiktok.madeWithAI) {
    const ai=page.getByRole('checkbox',{name:/AI.generated|conteúdo gerado por IA|gerado por inteligência artificial/i}).or(page.getByRole('switch',{name:/AI.generated|conteúdo gerado por IA|gerado por inteligência artificial/i}));
    if(await ai.count()!==1)throw new BrowserActionRequired('page_changed','Confira a declaração de IA no TikTok antes de agendar este vídeo.');
    await ai.setChecked(true);
  }
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
    await page.waitForTimeout(300);
  }
  throw new BrowserActionRequired('upload_unconfirmed','O TikTok não confirmou o agendamento. Confira o Studio antes de repetir.');
}

export function browserJobLabel(job: BrowserJob) {
  return { hash: job.hash, file: basename(job.file), status: job.status, madeWithAI: job.madeWithAI, publishAt:job.publishAt, updatedAt: job.updatedAt };
}

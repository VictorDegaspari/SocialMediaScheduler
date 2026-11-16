import { DateTime } from 'luxon';
import { z } from 'zod';
import { packDefaultsSchema } from './pack-config.js';
import { nativeScheduleSchema } from './native-schedule.js';

export function folderId(input: string): string {
  const text = input.trim();
  if (/^[a-zA-Z0-9_-]{10,200}$/.test(text)) return text;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('Informe o link de uma pasta do Google Drive ou o ID dela.'); }
  if (url.hostname !== 'drive.google.com' || url.protocol !== 'https:') throw new Error('Use um link https://drive.google.com/drive/folders/...');
  const id = url.pathname.match(/\/folders\/([\w-]+)/)?.[1] || url.searchParams.get('id');
  if (!id || !/^[\w-]{10,200}$/.test(id)) throw new Error('O link não contém um ID de pasta válido.');
  return id;
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const watchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sourceType: z.enum(['google_drive','local','gta6_pack']).default('google_drive'),
  folderUrl: z.string().trim().max(1000).default(''),
  packDefaults:packDefaultsSchema.prefault({}),
  localPath: z.string().trim().max(4096).default(''),
  recursive: z.boolean().default(true), enabled: z.boolean().default(true),
  scanMinutes: z.number().int().min(1).max(1440).default(5),
  cadence: z.enum(['interval', 'daily']).default('interval'),
  intervalMinutes: z.number().int().min(1).max(43200).default(720),
  times: z.array(time).min(1).max(24).default(['08:00','20:00']),
  timezone: z.string().refine(v => DateTime.now().setZone(v).isValid, 'Fuso horário inválido').default('America/Sao_Paulo'),
  mode: z.enum(['draft','schedule','native_schedule']).default('draft'),
  nativeSchedule:nativeScheduleSchema.prefault({}),
  integrationIds: z.array(z.string().min(1).max(200)).max(10).default([]),
  importExisting: z.boolean().default(false), requireMetadata: z.boolean().default(true),
  stripMetadata: z.boolean().default(true)
}).superRefine((input,ctx)=>{
  if(input.sourceType==='google_drive' && input.folderUrl.length<10)
    ctx.addIssue({code:'custom',path:['folderUrl'],message:'Informe o link ou ID da pasta do Google Drive.'});
});

export { nextRun } from './cadence.js';

export const metadataSchema = z.object({
  schemaVersion: z.literal(1).default(1), videoFileId: z.string().optional(), ready: z.boolean().default(true),
  title: z.string().min(1).max(100), description: z.string().max(4900).default(''),
  hashtags: z.array(z.string().max(100)).max(50).default([]),
  targets: z.array(z.enum(['youtube','tiktok','tiktok-business'])).optional(),
  youtube: z.object({visibility:z.enum(['private','unlisted','public']).default('private'), madeForKids:z.boolean().default(false),containsSyntheticMedia:z.boolean().default(false),tags:z.array(z.string().max(100)).default([])}).prefault({}),
  tiktok: z.object({contentPostingMethod:z.enum(['DIRECT_POST','UPLOAD']).default('DIRECT_POST'),privacyLevel:z.enum(['SELF_ONLY','PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR']).nullable().default(null),allowComment:z.boolean().default(false),allowDuet:z.boolean().default(false),allowStitch:z.boolean().default(false),commercialContent:z.boolean().default(false),ownBrand:z.boolean().default(false),madeWithAI:z.boolean().default(false)}).prefault({})
}).strict();
export type Metadata = z.infer<typeof metadataSchema>;
export interface Integration { id: string; name: string; identifier: string; disabled: boolean; profile?: string; }

export function buildPost(meta: Metadata, channel: Integration, media: {id:string;path:string}, mode: string, date: Date) {
  const content = [meta.description, meta.hashtags.map(t=>'#'+t.replace(/^#+/,'').replace(/\s+/g,'')).join(' ')].filter(Boolean).join('\n\n');
  let settings: Record<string,unknown>;
  if (channel.identifier === 'youtube') {
    settings = {__type:'youtube',title:meta.title,type:meta.youtube.visibility,selfDeclaredMadeForKids:meta.youtube.madeForKids?'yes':'no',tags:meta.youtube.tags.map(t=>({value:t,label:t}))};
    if (content.length > 5000) throw new Error('Descrição YouTube excede 5.000 caracteres.');
    if (meta.youtube.tags.reduce((n,t)=>n+t.length+(/\s/.test(t)?2:0),0)>500) throw new Error('Tags YouTube excedem 500 caracteres.');
  } else if (['tiktok','tiktok-business'].includes(channel.identifier)) {
    if (mode !== 'draft') throw new Error('TikTok disponível como rascunho. Conclua a revisão e publicação no Postiz.');
    settings = {__type:channel.identifier,title:meta.title.slice(0,90),privacy_level:meta.tiktok.privacyLevel || 'SELF_ONLY',duet:meta.tiktok.allowDuet,stitch:meta.tiktok.allowStitch,comment:meta.tiktok.allowComment,autoAddMusic:'no',brand_content_toggle:meta.tiktok.commercialContent,brand_organic_toggle:meta.tiktok.ownBrand,video_made_with_ai:meta.tiktok.madeWithAI,content_posting_method:meta.tiktok.contentPostingMethod};
    if (content.length > (channel.identifier==='tiktok'?2000:2200)) throw new Error('Legenda TikTok excede o limite do canal.');
  } else throw new Error('Selecione um canal YouTube ou TikTok.');
  return { type:mode, date:date.toISOString(),shortLink:false,tags:[],posts:[{integration:{id:channel.id},value:[{content:content || meta.title,image:[media]}],settings}] };
}

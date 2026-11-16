import {z} from 'zod';

export const PACK_URL='https://monetizecomgta6.netlify.app/';
export const PACK_CATALOG_URL=new URL('x7k9c4f2e8b1/videos.json',PACK_URL).href;
export const PACK_ROOT='gta6-pack:catalog';
export const packDefaultsSchema=z.object({
  titlePrefix:z.string().trim().max(60).default('GTA 6 —'),
  description:z.string().max(4000).default(''),
  hashtags:z.array(z.string().trim().min(1).max(80)).max(15).default(['gta6','gtavi','shorts']),
  madeWithAI:z.boolean().default(true),madeForKids:z.boolean().default(false),
  youtubeContainsSyntheticMedia:z.boolean().optional(),
  youtubeVisibility:z.enum(['public','private','unlisted']).default('public')
}).strict().refine(value=>100+value.description.length+value.hashtags.map(tag=>'#'+tag.replace(/^#+/,'').replace(/\s+/g,'')).join(' ').length+4<=2200,
  {message:'Reduza a descrição ou as hashtags para respeitar o limite de legenda do TikTok.',path:['description']});
export type PackDefaults=z.infer<typeof packDefaultsSchema>;
// Preserve legacy declarations unless YouTube is configured independently.
export const packYoutubeSynthetic=(defaults:PackDefaults)=>defaults.youtubeContainsSyntheticMedia??defaults.madeWithAI;

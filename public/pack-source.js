import {readEditorialOptions} from './build/editorial-view.js';

export function readPackDefaults(form) {
  const f=new FormData(form);
  return {titlePrefix:String(f.get('packTitlePrefix')||''),description:String(f.get('packDescription')||''),
    hashtags:String(f.get('packHashtags')||'').split(',').map(t=>t.trim().replace(/^#+/,'')).filter(Boolean),
    madeWithAI:f.has('packMadeWithAI'),youtubeContainsSyntheticMedia:f.has('packYoutubeSynthetic'),madeForKids:f.has('packMadeForKids'),youtubeVisibility:String(f.get('packYoutubeVisibility')||'public'),editorial:readEditorialOptions(f,'pack')};
}

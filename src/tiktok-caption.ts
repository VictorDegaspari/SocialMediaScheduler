import type {Metadata} from './domain.js';

export function tiktokCaption(metadata:Metadata){
  const caption=[metadata.title,metadata.description,metadata.hashtags.map(tag=>'#'+tag.replace(/^#+/,'').replace(/\s+/g,'')).join(' ')].filter(Boolean).join('\n\n');
  if(caption.length>2200)throw new Error('Legenda excede 2.200 caracteres. Ajuste a legenda antes do upload.');
  return caption;
}

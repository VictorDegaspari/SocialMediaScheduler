export function readTiktokFields(form){
  const f=new FormData(form);
  return {privacyLevel:'PUBLIC_TO_EVERYONE',contentPostingMethod:'DIRECT_POST',madeWithAI:f.has('tiktokMadeWithAI'),allowComment:f.has('allowComment'),allowDuet:f.has('allowDuet'),allowStitch:f.has('allowStitch'),commercialContent:f.has('commercialContent'),ownBrand:f.has('ownBrand')};
}

export function cutDestinationOptions(clip,channels,platform){
  const provider=platform==='tiktok'?'tiktok-browser':'youtube';
  const used=new Set((clip.publications||[]).map(delivery=>delivery.integration_id));
  return channels.filter(channel=>!channel.disabled&&channel.identifier===provider).map(channel=>({
      value:channel.id,disabled:used.has(channel.id),
      label:channel.name+(used.has(channel.id)?' · envio no histórico':''),
  }));
}

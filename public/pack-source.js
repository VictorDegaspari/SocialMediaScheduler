export function packDefaultsFields(value={},esc,prefix) {
  const p={titlePrefix:'GTA 6 —',description:'',hashtags:['gta6','gtavi','shorts'],madeWithAI:true,youtubeContainsSyntheticMedia:false,madeForKids:false,youtubeVisibility:'public',...value};
  return `<div class="notice"><strong>Pack GTA 6 conectado ao catálogo do site.</strong> O sistema encontra os vídeos no Drive e baixa somente os necessários para a fila. Você não precisa salvar arquivos nem criar JSONs.</div>
    <div class="form-field"><label for="${prefix}-pack-title">Prefixo do título</label><input id="${prefix}-pack-title" name="packTitlePrefix" maxlength="60" value="${esc(p.titlePrefix)}"><small>Combinado com o título disponível no site, por exemplo: GTA 6 — Vídeo 0001.</small></div>
    <div class="form-field"><label for="${prefix}-pack-description">Descrição dos vídeos importados</label><textarea id="${prefix}-pack-description" name="packDescription" maxlength="4000">${esc(p.description)}</textarea></div>
    <div class="form-field"><label for="${prefix}-pack-tags">Hashtags do pack</label><input id="${prefix}-pack-tags" name="packHashtags" value="${esc(p.hashtags.join(', '))}"><small>Separe por vírgula.</small></div>
    <div class="form-field"><label for="${prefix}-pack-visibility">Visibilidade dos vídeos do pack no YouTube</label><select id="${prefix}-pack-visibility" name="packYoutubeVisibility">${[['public','Público na data agendada'],['private','Privado'],['unlisted','Não listado']].map(([v,label])=>`<option value="${v}" ${p.youtubeVisibility===v?'selected':''}>${label}</option>`).join('')}</select></div>
    <label class="checkbox"><input name="packYoutubeSynthetic" type="checkbox" ${p.youtubeContainsSyntheticMedia?'checked':''}><span>YouTube: conteúdo realista alterado ou sintético<small>Desmarcado por padrão. Ative quando o conteúdo exigir essa declaração. A limpeza das tags do arquivo é independente.</small></span></label>
    <label class="checkbox"><input name="packMadeWithAI" type="checkbox" ${p.madeWithAI?'checked':''}><span>TikTok: declarar conteúdo gerado ou alterado por IA</span></label>
    <label class="checkbox"><input name="packMadeForKids" type="checkbox" ${p.madeForKids?'checked':''}><span>Conteúdo produzido especificamente para crianças</span></label>
    <p class="tip">As imagens do pack são ignoradas. Vídeos repetidos são bloqueados pelo histórico. O arquivo precisa passar pela validação de MP4 vertical ou quadrado, com até 3 minutos.</p>`;
}
export function readPackDefaults(form) {
  const f=new FormData(form);
  return {titlePrefix:String(f.get('packTitlePrefix')||''),description:String(f.get('packDescription')||''),
    hashtags:String(f.get('packHashtags')||'').split(',').map(t=>t.trim().replace(/^#+/,'')).filter(Boolean),
    madeWithAI:f.has('packMadeWithAI'),youtubeContainsSyntheticMedia:f.has('packYoutubeSynthetic'),madeForKids:f.has('packMadeForKids'),youtubeVisibility:String(f.get('packYoutubeVisibility')||'public')};
}

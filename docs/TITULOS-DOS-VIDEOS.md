# Títulos baseados no conteúdo

Os nomes `Vídeo 0060` do catálogo identificam arquivos; não descrevem seu assunto. O pack também contém outros jogos, montagens, rumores e notícias antigas. O título precisa refletir o vídeo selecionado, sem presumir que tudo é GTA 6 ou que um suposto vazamento seja oficial.

Antes de um lote, o assistente confere as cenas e, quando necessária para identificar o assunto, a narração. Um título fornecido pelo usuário ou por metadados descritivos confiáveis também pode orientar a revisão. Rumores e registros antigos devem ser identificados como tais. Não há um serviço de IA pago configurado para analisar vídeos fora da sessão do assistente.

Uma revisão aprovada é armazenada por vídeo, versão da origem e SHA-256 dos **bytes originais**, junto com a evidência que motivou o título. O publisher confere o hash novamente antes de preparar o envio. A tabela `video_title_reviews` preserva a decisão mesmo quando a varredura relê os nomes genéricos do catálogo. Mudança de versão ou de conteúdo exige uma nova revisão.

```bash
./scripts/node-local.sh scripts/assistant.mjs titles <<'JSON'
{
  "reviews": [{
    "videoId": "UUID_DO_VIDEO",
    "title": "Days Gone: hordas de zumbis e a história de Deacon",
    "sha256": "SHA256_DOS_BYTES_ORIGINAIS_COM_64_CARACTERES_HEXADECIMAIS",
    "evidence": "As cenas e a narração identificam Days Gone, as hordas e a busca de Deacon pela esposa."
  }]
}
JSON
```

O endpoint `POST /api/assistant/titles` aceita de uma a cem revisões por chamada. Ele salva os títulos desejados; uma resposta bem-sucedida não comprova que o título de um vídeo já enviado foi alterado no YouTube.

No motor local e nos pedidos finitos que usam o pack, um nome numérico genérico sem revisão bloqueia a preparação e sinaliza a ação `title_review`. Salvar a revisão libera esse pedido. Nos próximos vídeos, o novo título entra nos metadados do upload, mantendo limites, hashes e deduplicação. O fluxo legado do CLI TikTok independente não lê essa tabela; use pedidos finitos para a revisão persistida do pack.

## Vídeos que já estão no YouTube

Editar um vídeo existente requer uma permissão adicional: `youtube.force-ssl` (ou outro escopo de edição aceito pelo Google). A autorização de upload e leitura continua válida enquanto a autorização de edição está pendente; ela não é apagada nem ampliada silenciosamente.

A ação `youtube_titles` em **Pedidos e contas** abre `/auth/youtube?edit=1&channel=ID_DO_CANAL`. O usuário escolhe a conta correta e conclui o consentimento do Google. O retorno OAuth verifica o canal solicitado, PKCE, state e os escopos concedidos, preservando a autorização de envio automático daquela conta. Escolher outro canal não substitui os tokens existentes.

O worker aplica automaticamente as revisões pendentes após o consentimento, consultando o vídeo na conta correta. A edição usa exclusivamente `part=snippet`, preserva descrição, categoria, tags e idiomas, e verifica o título retornado. Não inclui `status`, não altera `publishAt` ou privacidade e não cria novos uploads. Se uma resposta se perder, a próxima tentativa lê o título atual antes de editar novamente. A pendência só é resolvida quando os títulos locais e confirmados no YouTube coincidem.

[Requisitos e comportamento de videos.update](https://developers.google.com/youtube/data/reference/rest/v3/videos/update).

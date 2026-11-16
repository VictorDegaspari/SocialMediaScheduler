# Pedidos pela conversa e múltiplas contas

O painel **Pedidos e contas** reúne perfis de conteúdo (por exemplo, Bíblicos e GTA 6), origens de vídeos, canais YouTube e perfis separados do Chrome para TikTok. Cada conta YouTube mantém seus próprios tokens cifrados e autorização de envio automático. Adicionar uma conta não remove as anteriores.

O assistente transforma um pedido da conversa em uma chamada à API local. Exemplo: “Agende 20 vídeos do perfil GTA 6 no YouTube e no TikTok às 08:00 e 20:00, em São Paulo”. Isso cria dois pedidos de 20 vídeos: um por plataforma. A quantidade confirmada encerra o pedido; não vira uma rotina ilimitada.

O total solicitado pode exceder o teto de vídeos agendados ou a janela da plataforma. O excedente permanece no PostgreSQL sem precisar ser baixado inteiro, e o worker avança conforme vagas, datas e orçamento de uploads são liberados. O calendário e os limites são compartilhados por conta entre pedidos e rotinas. Agendamentos já confirmados continuam na plataforma ao cancelar o restante de um pedido.

## Integração do assistente

O helper `scripts/assistant.mjs` usa somente o endereço loopback do painel. É possível consultar o estado e executar pedidos sem acessar os tokens das contas. A skill local `drive-watcher` orienta o Codex a consultar os perfis, resolver ambiguidades de conta, usar quantidades e horários explícitos, reaproveitar a chave do pedido em uma retomada e informar pendências.

```bash
./scripts/node-local.sh scripts/assistant.mjs context

./scripts/node-local.sh scripts/assistant.mjs request <<'JSON'
{
  "profileId": "UUID_DO_PERFIL",
  "platforms": ["youtube", "tiktok"],
  "quantity": 20,
  "times": ["08:00", "20:00"],
  "timezone": "America/Sao_Paulo",
  "requestKey": "UUID_UNICO_DESTA_SOLICITACAO",
  "policy": {"maxScheduled": 10, "uploadsPer24h": 10, "postsPerDay": 2, "horizonDays": 10}
}
JSON
```

A mesma chave com os mesmos parâmetros retorna o pedido existente; a mesma chave com parâmetros diferentes é recusada. Uma nova solicitação intencional recebe outra chave. O backend valida campos, contas, fontes, horários e limites; a interpretação do texto é feita pelo assistente da conversa.

A integração funciona nas sessões do assistente que têm acesso a este projeto e ao serviço local. O worker continua executando os pedidos enquanto o serviço/PC estiver ativo. O processo não abre uma conversa nem envia mensagens espontâneas fora da sessão: as pendências ficam no painel e são informadas quando o assistente consulta o estado. Não exige uma chave da API OpenAI para esse fluxo.

## Títulos dos vídeos

Antes de enviar um pack com nomes genéricos, o assistente revisa o conteúdo e salva títulos pelo comando `titles`. As revisões persistem por arquivo, versão e hash. Vídeos já enviados recebem a correção pelo worker após a autorização de edição do YouTube. Veja [o fluxo de revisão e os limites](TITULOS-DOS-VIDEOS.md).

## Ações manuais

As pendências indicam o perfil, plataforma, motivo e local para resolver. Exemplos:

- Criar o canal bíblico e conectá-lo por OAuth no painel.
- Autorizar a leitura do Google Drive e garantir acesso às pastas fornecidas.
- Fazer login em cada perfil TikTok pelo Chrome comum, conferir a conta e fechar a janela.
- Resolver CAPTCHA, autenticação expirada ou alteração de interface.
- Conferir um upload sem confirmação antes de continuar.

O sistema não repete automaticamente um upload de resultado desconhecido. No YouTube, o ID pode ser vinculado no histórico e verificado na API. No TikTok, uma conferência manual explícita pode registrar que o agendamento existe ou que o envio deve ser descartado; essa confirmação é identificada no payload como `manualConfirmed`. Descartar um envio não devolve o orçamento de upload já consumido nas últimas 24 horas.

Para TikTok em pedidos finitos, o backend prepara a mídia da origem escolhida e o agente baixa essa cópia pelo endpoint local autenticado. Assim, o TikTok também pode receber vídeos das pastas do Drive, sem colocá-los manualmente na pasta local. O arquivo, o histórico e a sessão de Chrome são separados por perfil TikTok. A confirmação do agendamento depende dos controles disponíveis na conta real do Studio.

## API local

- `GET /api/assistant/context`: perfis, contas sem segredos, pedidos, contadores e pendências.
- `POST /api/assistant/titles`: títulos revisados por vídeo, hash original e evidência do conteúdo.
- `POST /api/assistant/profiles`, `PUT /api/assistant/profiles/:id`: origem e vínculos do perfil.
- `POST /api/assistant/requests`: quantidade, plataformas, horários, limites e chave de idempotência.
- `POST /api/assistant/requests/:id/cancel` e `/resume`: cancelar o restante ou rever pré-requisitos.
- `POST /api/assistant/actions/:id/resolve`: registrar uma conferência manual explícita.
- `POST /api/browser/profiles` e `/api/browser/profiles/:id/login`: criar um perfil de Chrome isolado e abrir seu login.

As três pastas bíblicas podem ser cadastradas juntas. O adaptador reúne os arquivos recursivamente e elimina IDs repetidos, inclusive quando uma das pastas já está dentro de outra. A autorização Drive é necessária para confirmar acesso e ler os arquivos; cadastrar os links não comprova acesso.

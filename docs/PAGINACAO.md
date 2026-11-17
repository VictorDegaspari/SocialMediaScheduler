# Paginação das listas

As listas de projetos, pastas, vídeos, eventos, pedidos, pendências e atividades do navegador usam paginação por cursor no PostgreSQL. A API retorna apenas a página solicitada, com `pagination: {limit, hasMore, nextCursor}`. Não há consulta de todo o histórico para paginar no navegador.

| Endpoint | Lista | Padrão |
| --- | --- | --- |
| `GET /api/cuts?limit=10` | `jobs` | 10 projetos |
| `GET /api/watches?limit=20` | `items` | 20 pastas |
| `GET /api/videos?limit=20` | `items` | 20 vídeos |
| `GET /api/events?limit=20` | `items` | 20 eventos |
| `GET /api/browser/jobs?limit=20` | `items` | 20 atividades |

Para avançar, envie o `nextCursor` recebido como parâmetro `cursor`, preservando o `limit`. O cursor é opaco e pertence somente à coleção que o emitiu. Limites fora de 1–100, cursores inválidos ou de outra coleção retornam HTTP 400. `hasMore: false` e `nextCursor: null` indicam o fim da lista.

```text
GET /api/cuts?limit=10
GET /api/cuts?limit=10&cursor=<nextCursor recebido>
```

`GET /api/assistant/context` mantém as listas `requests` e `actions`, com metadados em `pagination.requests` e `pagination.actions`. Os parâmetros são `requestsLimit`, `requestsCursor`, `actionsLimit` e `actionsCursor`.

`GET /api/state` mantém o formato das listas do painel e aceita parâmetros independentes para cada coleção:

| Coleção | Limite | Cursor | Metadados na resposta |
| --- | --- | --- | --- |
| Pastas | `watchesLimit` | `watchesCursor` | `pagination.watches` |
| Eventos | `eventsLimit` | `eventsCursor` | `pagination.events` |
| Vídeos | `videosLimit` | `videosCursor` | `pagination.videos` |
| Projetos de cortes | `cutsLimit` | `cutsCursor` | `cuts.pagination` |
| Pedidos | `requestsLimit` | `requestsCursor` | `publishing.pagination.requests` |
| Pendências | `actionsLimit` | `actionsCursor` | `publishing.pagination.actions` |
| Navegador | `browserLimit` | `browserCursor` | `browser.pagination` |

Os botões **Anterior** e **Próxima** mantêm o histórico de cursores de cada lista na sessão da página. Atualizações automáticas preservam a página aberta. Se as exclusões ou resoluções esvaziarem uma página antiga, o painel retorna à primeira página. Criar um projeto, pasta, pedido ou tarefa manual do navegador também retorna sua lista à primeira página para mostrar o novo item.

A ordenação usa data e ID, ambos em ordem decrescente; vídeos usam a data de atualização e as outras coleções usam a data de criação. Os cursores preservam microssegundos e IDs grandes de eventos. Novas entradas anteriores ao cursor não deslocam a próxima página. O histórico continua refletindo mudanças de situação em tempo real, sem snapshot permanente.

Os totais `stats.watches`, `stats.active_watches` e `publishing.summary.actionCount` independem da página. A tarefa ativa do navegador é consultada separadamente do histórico. Contas conectadas e perfis de configuração continuam completos para os seletores; cortes de cada projeto têm o limite próprio de até 50 sugestões. Filas internas de processamento continuam processando o trabalho pendente independentemente da página aberta.

## Descarte de projetos

Projetos com `status: "discarded"` ficam fora da consulta e não ocupam posições nas páginas. O registro de auditoria permanece no banco.

Antes do descarte, o painel mostra o nome do projeto ou corte e permite **Cancelar** ou confirmar explicitamente. Cancelar ou pressionar Escape não envia requisição nem remove arquivos. O envio bloqueia cliques repetidos enquanto aguarda a resposta.

Os dois endpoints exigem corpo JSON `{ "confirm": true }`, além da proteção de origem já exigida nas alterações da API:

```text
POST /api/cuts/jobs/:id/discard
POST /api/cuts/:id/discard
```

Sem confirmação, a API retorna HTTP 400 antes de alterar o banco ou remover arquivos. Depois da confirmação de descarte do projeto, ele sai da visualização. As publicações já feitas e seus registros continuam preservados.

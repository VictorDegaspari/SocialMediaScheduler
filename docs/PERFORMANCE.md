# Melhorias de performance — 16/11/2026

As prioridades do mapeamento foram aplicadas e validadas com PostgreSQL/Redis reais, catálogos sintéticos e respostas de plataforma simuladas. Nenhum teste publicou vídeos nas contas reais. O mapeamento original está preservado abaixo para comparação.

| Cenário | Antes | Depois |
|---|---:|---:|
| Contexto com 100 pedidos / 100 mil entregas | 848,01 ms; 113 SQL | **28,41 ms; 9 SQL** |
| Varredura inalterada: 1.130 vídeos | 1.853,20 ms; 2.263 SQL | **78,32 ms; 4 SQL** |
| Varredura inalterada: 5.000 vídeos | 13.020,16 ms; 10.003 SQL | **142,85 ms; 4 SQL** |
| Primeira varredura: 5.000 vídeos | 12.764,25 ms; 10.003 SQL | **574,02 ms; 24 SQL** |
| Planejador com 50 mil reservas históricas | 726,06 ms | **5,89 ms** |
| Planejador com 150 mil reservas históricas | `RangeError` | **8,32 ms**, sem erro |
| Calendário SQL com 100 mil entregas antigas | Carregava todo o histórico elegível | **1 reserva retornada; 0,91 ms** |
| Lote com 100 envios em cooldown e outro elegível | Elegível ficava fora do lote | **Elegível selecionado; nenhum bloqueado no lote** |

Resultados de uma execução local, com medianas de três amostras para contexto/calendário e uma amostra por varredura. Os valores variam com a carga da máquina e não representam SLA. As medições de contexto e varredura não incluem rede externa nem publicação real. Resultados brutos: [antes](../artifacts/performance-baseline.jsonl) e [depois](../artifacts/performance-optimized.jsonl), em arquivos ignorados pelo Git. O script reproduzível continua em [benchmark-performance.mjs](../scripts/benchmark-performance.mjs).

**Mudanças aplicadas.**

- Índice `deliveries(request_id,status)` e contadores agrupados por todos os pedidos selecionados, no contexto e no ciclo de pedidos. Leitura das contas e configurações em lote, sem cache de autorizações entre requisições. O upload continua verificando novamente a autorização da conta.
- Varredura com uma leitura dos vídeos existentes, mapas para associação dos JSONs e UPSERTs de até 250 vídeos. Arquivos inalterados preservam `updated_at`, estabilidade e backoff; mudança de versão libera a nova tentativa após a estabilização. As três escritas de controle da varredura continuam: remoções, estado da origem e evento. Nenhum vídeo inalterado é regravado. O cache de JSONs usa chave por perfil/arquivo/versão, expira em uma hora e tem teto de 10 mil entradas e 32 MiB de conteúdo serializado; erros não são armazenados.
- Cooldowns excluídos antes do `LIMIT`; seleção alternada entre contas. Novo orçamento, pausa, estado do pedido e autorização continuam sendo conferidos no processamento.
- Calendário carrega reservas das últimas 48 horas e futuras, uploads das últimas 24 horas e o último horário anterior necessário à cadência. A exclusão da entrega replanejada ocorre antes dessa seleção. Tentativas canceladas recentes continuam consumindo o orçamento de uploads. Índices cobrem o calendário por conta e os comandos legados do navegador. O planejador acumula máximo, dias e horários ocupados sem expansão de grandes arrays nem conversões repetidas de datas antigas.
- Filas distintas para coordenação e transferências. Coordenação tem concorrência global um; uploads, dois. Locks por conta e por entrega mantêm um upload por conta, impedem duplicações e permitem que a recuperação pule transferências ativas. Trabalhos persistidos na fila anterior são encaminhados automaticamente. O estado da fila mostra totais e os dois componentes.
- Reaproveitamento de mídia entre destinos enquanto outra entrega ainda retém sua cópia: hash, versão da origem, versão do JSON e opção de limpeza precisam coincidir. Cópia alterada ou ausente causa download pela origem; cada destino mantém seu próprio arquivo e claim. Cópias usam CoW quando suportado, com fallback comum. Não há retenção extra após a limpeza das entregas. O teste de um vídeo para YouTube e TikTok comprovou **um download, duas entregas e dois claims**, incluindo preservação do arquivo restante após cancelar um destino.
- Raízes sobrepostas do Drive compartilham o conjunto de pastas visitadas. Pendências e mensagens sem mudança não regravam os registros. Abas ocultas suspendem o polling e atualizam ao voltar.

**Validação.** TypeScript e `git diff --check`; 42 testes unitários, 63 de integração e 13 de navegador. As regressões cobrem 150 mil reservas, fuso/horário de verão, timestamps de varredura, retry, remoções, fila com mais de 100 bloqueados, intercalação por conta, recuperação durante upload, orçamento móvel, coordenação durante transferências e reutilização de mídia íntegra/alterada.

O serviço local foi reconstruído e atualizado, com os quatro índices novos presentes, aplicação/PostgreSQL/Redis saudáveis e agente do navegador ativo. Os painéis de pedidos, navegador e motor local passaram nas verificações com APIs simuladas. A base principal continua sem vídeos, entregas, pedidos ativos ou tarefas de navegador pendentes. Após a atualização, `/api/state` em repouso, nas mesmas 30 amostras após cinco aquecimentos, teve mediana **4,33 ms**, p95 **6,51 ms** e máximo **7,17 ms**. O banco temporário do benchmark foi removido.

**Limites que continuam relevantes.** A descoberta e a preparação ainda são sequenciais no coordenador; um download de origem lento pode alongar esse ciclo, embora os uploads prontos estejam em outra fila. O reaproveitamento se limita ao mesmo vídeo/versionamento enquanto existe uma cópia retida, sem cache persistente entre perfis ou após todos os envios. Ainda faltam medições de banda, disco e Chrome com vídeos reais e várias contas, além de métricas contínuas por etapa e de espera pelo pool. O heartbeat continua indicando a existência de um ciclo anterior. Esses pontos não são resolvidos pelos tempos sintéticos acima.

---

## Mapeamento inicial, antes das mudanças

O sistema está leve no estado atual, mas há gargalos confirmados para catálogos maiores, histórico acumulado e várias contas. A prioridade é reduzir consultas e trabalho repetido, limitar o histórico carregado pelo planejador e evitar que uploads longos ou contas bloqueadas atrasem as demais.

A análise preservou o comportamento da aplicação. O índice experimental e os dados sintéticos foram criados exclusivamente em um banco temporário `watcher_perf_<UUID>`, removido ao final. Não houve publicação de vídeos nem alteração dos índices do banco principal.

**Condição atual medida.** Dois perfis cadastrados, nenhum vídeo importado, nenhuma entrega e nenhum pedido na base principal. Em 30 requisições sequenciais a `/api/state`, após cinco aquecimentos, a mediana foi **4,33 ms**, o p95 **6,95 ms** e o máximo **8,11 ms**; resposta de 4.821 bytes. Snapshot dos containers em repouso: aplicação **52,89 MiB**, PostgreSQL **65,43 MiB**, Redis **5,31 MiB**. Esses números não medem o Chrome no host, uploads reais nem pico de memória sob carga. Não há evidência de que adicionar RAM seja a primeira melhoria necessária.

| Prioridade | Melhoria | Evidência / efeito |
|---|---|---|
| Alta | Indexar entregas por pedido e agregar os contadores em lote | 100 pedidos / 100 mil entregas: contexto passou de **848,01 ms para 56,37 ms** só com índice no banco isolado. Ainda faz 113 consultas. |
| Alta | Tornar a varredura incremental e eliminar consultas individuais por vídeo | Catálogo inalterado de 1.130 vídeos: **2.263 SQL / 1,85 s**. Com 5.000: **10.003 SQL / 13,02 s**. |
| Alta | Filtrar contas em cooldown antes de montar o lote de envio | Em um lote com 100 itens bloqueados e um elegível, o elegível ficou de fora; processar um item bloqueado devolveu o mesmo lote. |
| Alta | Restringir os dados usados pelo calendário e remover operações sobre todo o histórico | 50 mil reservas históricas: **726 ms por planejamento**; 150 mil: **RangeError**. |
| Alta, mudança estrutural | Separar coordenação da fila das transferências demoradas | Um único consumidor e o mesmo lock global cobrem varredura, preparação e upload; uma operação longa adia os demais ciclos. |
| Média | Reaproveitar mídia preparada entre destinos, com cache limitado e referência de uso | YouTube e TikTok podem baixar e preparar o mesmo vídeo separadamente. Ganho de rede/disco ainda precisa de medição com mídia real. |
| Média | Evitar atualizações sem mudança e consultas completas periódicas | Pedidos aguardando ação manual regravam o mesmo estado a cada ciclo; o painel solicita todo o estado a cada cinco segundos. |
| Média | Deduplicar pastas antes de percorrer o Drive e acrescentar métricas por etapa | As três raízes bíblicas podem provocar leituras repetidas de subpastas; faltam tempos de varredura, upload, fila e espera pelo pool. |

**1. Banco e contadores: ganho imediato com baixo risco.**

`PublicationRequests.context()` consulta os contadores de cada pedido separadamente. `counts()` filtra `deliveries.request_id`, que atualmente não tem índice. Com 100 pedidos visíveis, isso repete a leitura das entregas 100 vezes a cada consulta de contexto, inclusive para pedidos históricos.

No experimento de 100 mil entregas, um contador leu 1.000 registros e descartou 99.000, tocando 2.128 blocos em um `Seq Scan`. Com o índice abaixo, passou a `Index Only Scan`, sem registros descartados e com três blocos. O tempo desse contador foi de **7,868 ms para 0,180 ms**. O ganho do contexto completo foi de aproximadamente **15× neste cenário**, sem eliminar o padrão de consultas individuais.

```sql
-- Índice avaliado somente no banco temporário.
CREATE INDEX perf_delivery_request_status ON deliveries(request_id, status);
```

A implementação recomendada combina um índice equivalente com **uma agregação por todos os IDs de pedidos selecionados**, usando `GROUP BY request_id`. Buscar o estado das contas uma vez por requisição também evita reler e decifrar os mesmos registros em `nativeChannels()`, `youtubeAutoApproved()` e `nativeConnectionState()`.

Outros índices candidatos, sujeitos a `EXPLAIN` com dados representativos: `publication_requests(created_at)` para o histórico, `videos(updated_at)` para os últimos 50 vídeos, e índices parciais/combinados para entregas pendentes e reconciliação. O ganho desses índices adicionais **não foi medido** nesta análise. Não é recomendável acrescentar todos automaticamente.

Referências: [contadores e contexto](../src/publication-requests.ts#L34), [leitura de contas](../src/native-auth.ts#L98), [índices existentes](../src/db.ts#L65), [estado completo do painel](../src/server.ts#L51).

**2. Varredura: o custo continua alto quando nada mudou.**

| Catálogo sintético | Primeira leitura | Leitura seguinte, sem alterações | SQL por leitura | Comandos de escrita |
|---|---:|---:|---:|---:|
| 1.130 vídeos + metadados | 2.010,99 ms | 1.853,20 ms | 2.263 | 1.133 |
| 5.000 vídeos + metadados | 12.764,25 ms | 13.020,16 ms | 10.003 | 5.003 |

São medições de uma execução por caso, com catálogo sintético em memória e PostgreSQL real. Não incluem latência do site ou do Drive. A segunda leitura usa o estado inicializado e os mesmos arquivos. Mesmo assim, cada vídeo elegível faz um `SELECT` e um `UPSERT`; `updated_at` é regravado. A associação de JSONs usa duas filtragens de toda a coleção para cada vídeo, e o adaptador do pack repete buscas lineares e geração/validação de metadados.

Recomendação: carregar os vídeos existentes em uma consulta por origem, montar mapas por ID/nome/pasta, comparar versões antes de gravar e fazer inserções/atualizações em lotes limitados. JSONs do Drive devem ser reaproveitados por versão quando possível. Preservar a estabilidade de 30 segundos, a detecção de remoções e as regras de `ready=false`/baseline. A varredura de 5.000 vídeos já excedeu o intervalo nominal de dez segundos do coordenador.

Referências: [varredura](../src/worker.ts#L80), [buscas e metadados do pack](../src/pack-source.ts#L59).

**3. Fila: uma conta em espera pode ocupar a seleção inteira.**

`ready()` retorna os 100 envios pendentes mais antigos. O cooldown da conta é verificado posteriormente em `process()`, que retorna sem atualizar `retry_at` dos outros envios dessa conta. O próximo ciclo pode selecionar os mesmos 100 itens novamente.

Reprodução no banco temporário: 101 entregas locais aprovadas; as 100 mais antigas pertenciam a uma conta com cooldown, e a última a outra conta elegível. `ready()` retornou os 100 bloqueados e excluiu o elegível. Após processar um item bloqueado, a seleção permaneceu idêntica. Não houve transferência nem chamada às plataformas.

Recomendação: persistir a elegibilidade da conta em campo consultável e excluir/deferir esses itens **antes do `LIMIT`**, ou selecionar com justiça entre contas. Evitar que verificações sem trabalho consumam repetidamente toda a janela de seleção. Manter os orçamentos de uploads e os limites por conta.

Referências: [seleção limitada](../src/local-publisher.ts#L105), [verificação tardia do cooldown](../src/local-publisher.ts#L149).

**4. Calendário: histórico antigo consome CPU e pode interromper o planejamento.**

O calendário carrega entregas de toda a vida da conta quando `planned_at` não é nulo. O planejador e a validação de capacidade percorrem esse histórico e convertem datas repetidamente com Luxon, inclusive datas antigas sem utilidade para a janela atual. O dia do candidato também é recalculado dentro do filtro de cada reserva.

| Reservas, todas anteriores à janela atual | Mediana de três execuções do planejador |
|---|---:|
| 1.000 | 16,95 ms |
| 10.000 | 146,04 ms |
| 50.000 | 726,06 ms |
| 150.000 | `RangeError: Maximum call stack size exceeded` |

O erro foi reproduzido na expansão de uma grande lista para `Math.max`. O trabalho de datas ocorre no processo Node e pode atrasar outras requisições enquanto executa.

Recomendação: consultar os totais futuros, uploads das últimas 24 horas, contagem por dia e último horário relevante com agregações SQL; carregar somente reservas necessárias à janela atual. Pré-calcular os dias em um mapa e usar redução iterativa para o máximo. Preservar o último horário necessário à cadência de intervalo e os claims históricos — a melhoria não exige apagar a deduplicação.

Referências: [carregamento do calendário](../src/calendar.ts#L3), [planejador](../src/native-schedule.ts#L41), [capacidade reservada](../src/native-schedule.ts#L33).

**5. Coordenação e upload: a serialização é global.**

O BullMQ usa concorrência global e local igual a um para `tick` e `publish`. Além disso, o coordenador e o upload compartilham o mesmo advisory lock. A preparação dentro do ciclo também inclui download, hash e FFmpeg. Portanto, um upload lento ou uma grande varredura atrasa verificações de outras contas, criação de trabalhos TikTok e atualização de pendências. O tick é programado a cada dez segundos, mas isso não garante execução nesse intervalo sob trabalho demorado.

Recomendação estrutural: separar fila de coordenação e filas de transferência, com concorrência limitada e exclusão por conta/entrega. Reduzir o trecho protegido por lock à reivindicação e reserva transacional de capacidade. Apenas aumentar a concorrência ou remover o lock atual não resolve com segurança: nomes de arquivos temporários e a preparação também dependem dessa exclusão global.

Referências: [consumidor único](../src/scheduler.ts#L16), [lock do ciclo](../src/worker.ts#L28), [lock durante o processamento](../src/local-publisher.ts#L113).

**6. Rede, disco e consultas periódicas: segunda etapa.**

- Pedidos por plataforma podem repetir download, hash, validação e limpeza da mesma origem. Um cache imutável por conteúdo e opções de transformação pode servir os dois destinos. Deve ter limite de bytes, referências e expiração, preservando validação de integridade e claims separados por conta. O ganho não foi cronometrado com mídia nesta análise.
- O FFmpeg já usa `-c copy`, sem recodificação. Não há evidência para priorizar GPU ou trocar codecs. O caminho atual faz várias leituras completas para hash; calcular hash durante a transferência pode economizar uma leitura, desde que preserve as verificações necessárias.
- `DriveCollection` percorre cada raiz separadamente e só elimina arquivos repetidos depois. Se uma raiz contém outra, a mesma subárvore pode ser listada novamente. Usar um conjunto de pastas visitadas compartilhado entre todas as raízes reduz chamadas sem mudar os resultados. A estrutura das pastas bíblicas ainda não foi validada por OAuth.
- Pedidos bloqueados regravam mensagem/estado/pendência a cada ciclo. Aplicar atualizações condicionais a diferenças e reconsiderar somente quando a dependência mudar ou vencer um prazo evita escrita repetitiva.
- O painel faz `/api/state` completo a cada cinco segundos. Com 100 pedidos, somente os contadores acrescentam 1.200 consultas por minuto por aba. Agregação em lote, endpoints menores e polling reduzido em aba oculta são melhorias anteriores à adoção de WebSocket/SSE.
- O agente consulta todos os perfis e verifica arquivos a cada dois segundos. Separar o heartbeat leve da atualização completa dos perfis pode reduzir trabalho com muitas contas. Manter as garantias da lease e a interrupção em caso de perda de controle.

Referências: [preparação de mídia](../src/local-publisher.ts#L50), [FFmpeg e hash](../src/media.ts#L9), [raízes do Drive](../src/sources.ts#L5), [estados repetidos](../src/publication-requests.ts#L28), [polling do agente](../scripts/browser-agent.mjs#L101), [polling do painel](../public/app.js).

**Ordem sugerida para implementação.** Primeiro, índice por pedido, agregação dos contadores e correção da seleção de contas em cooldown. Depois, varredura incremental e calendário restrito à janela útil. Em seguida, separar coordenação/transferência e avaliar cache de mídia com arquivos reais. Otimizações de exibição podem usar cache curto; reservas, autorizações e limites de plataforma precisam continuar sendo verificados no backend.

**Medições que ainda faltam.** Upload real com duas contas, tempo de abertura/processamento do TikTok Studio, uso do Chrome no host, throughput/latência de rede, pico do volume `spool` e espera por conexão do pool. O pool atual tem oito conexões; não há evidência para aumentá-lo antes de reduzir consultas. Convém instrumentar duração de varredura, preparação, download/upload, atraso do tick, idade da fila, espera pelo pool e atraso do event loop. `/api/health` comprova processo/Redis e existência de um ciclo anterior; não mede se a fila está em dia.

**Reprodução do benchmark isolado.** Requer as dependências locais de desenvolvimento, PostgreSQL/Redis do Compose e permissão para criar/remover o banco temporário. O script bloqueia chamadas HTTP externas e não inicia o scheduler.

```bash
mkdir -p artifacts
docker compose run --rm --no-deps -e LOG_LEVEL=silent -v "$PWD:/app" \
  app node --import tsx scripts/benchmark-performance.mjs \
  > artifacts/performance-benchmark.jsonl
```

Resultados brutos desta execução: [performance-benchmark.jsonl](../artifacts/performance-benchmark.jsonl). Os tempos são locais, com dados sintéticos e cache aquecido nos casos de contexto/calendário; não constituem SLA nem medição de publicação real.

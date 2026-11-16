# Exclusão de dados: procedimento do operador

Este é um procedimento administrativo para a versão atual, que não possui botão de exclusão completa nem rotina geral de retenção por conta. Não foi executada exclusão de dados nesta entrega.

## Solicitações

Contato público de Victor Degaspari: **eshoputilities@gmail.com**. Registrar recebimento, escopo do pedido, instalação administrada, conta/canal relacionado e conclusão. Confirmar a identidade sem pedir senhas ou tokens. Se a instalação for administrada pelo próprio solicitante ou por terceiro, direcionar a execução ao operador que controla os dados.

Dados armazenados recebidos da YouTube API devem ser excluídos o quanto antes e em até 7 dias corridos quando o usuário pedir a exclusão. A política também exige tratamento após revogação e atualização ou remoção de categorias de dados armazenados em até 30 dias. Enquanto a automação não existir, o operador precisa controlar esses prazos manualmente; para uso público essa pendência deve ser resolvida. [Políticas oficiais YouTube](https://developers.google.com/youtube/terms/developer-policies).

## Levantamento e execução

1. Identificar a conta e o período relacionado. O banco pode conter histórico de contas antigas além da conta atualmente conectada. Levantar as rotinas, vídeos, entregas, eventos e identificadores retornados pelo provedor. Não publicar o levantamento em logs ou tickets públicos.
2. Pausar as rotinas e impedir novos trabalhos relacionados. Um worker em execução pode recriar registros ou continuar um upload: interromper ou concluir conscientemente os trabalhos em curso antes de remover dados. O simples bloqueio do navegador não para o worker.
3. Desconectar a integração e remover os tokens e a identificação da conta na instalação. Se o pedido abranger toda a configuração, remover também as credenciais do cliente e demais configurações pertinentes. A interface de desconexão não faz essa remoção completa.
4. Revogar a autorização no provedor conforme a vontade do titular. A exclusão local e a revogação são ações distintas. Não alterar outras contas ou autorizações compartilhadas sem identificar o alcance.
5. Remover registros e payloads relacionados em PostgreSQL, respeitando relacionamentos: entregas, claims de conteúdo, vídeos, eventos, estados OAuth e configurações pertinentes. Não basta remover somente `youtubeAccount` ou somente o nome exibido. Uma análise direcionada deve preceder comandos destrutivos.
6. Remover trabalhos correspondentes, inclusive payloads e registros de trabalhos concluídos/falhos no Redis. Não apagar toda a fila se houver outras rotinas fora do pedido.
7. Remover cópias temporárias, prévias e arquivos pendentes no volume de trabalho, incluindo os arquivos de revisão identificados pela entrega. Não apagar o original do computador ou Drive como efeito colateral de desconexão.
8. Considerar logs, exportações e backups que contenham dados da conta. Identificar se são apagáveis por titular e como impedir restauração dos registros excluídos. Não prometer um prazo de backup que o ambiente não pratica. Ajustar a retenção para atender aos requisitos aplicáveis.
9. Conferir que a conta e seus dados não reaparecem após um ciclo do worker, sem efetuar novos envios. Documentar a conclusão com o mínimo de dados necessário e responder ao solicitante.

Em uma remoção completa da instalação, volumes PostgreSQL, Redis e spool podem precisar de remoção. Não use comandos globais como `docker compose down -v` para um pedido referente a uma única conta: a ação apaga dados de toda a instalação.

## Dados mantidos nas plataformas

Apagar dados deste aplicativo não remove vídeos do YouTube, rascunhos do TikTok, arquivos originais do Drive ou dados mantidos pelos provedores. Orientar o titular a usar os controles de cada plataforma. O aplicativo atual não implementa exclusão remota de vídeos.

## Retenção atual que não deve ser confundida com exclusão por titular

- Eventos com mais de 90 dias são removidos durante ciclos ativos do worker; isso não remove todo o histórico ou dados derivados das APIs.
- Logs Docker têm rotação por tamanho, não uma garantia de retenção por dias.
- Cópias aguardando revisão e falhas recuperáveis podem permanecer até ação do operador.
- Histórico, payloads e identificadores de deduplicação não possuem prazo geral automático.

Antes de operação pública, transformar os procedimentos necessários em funções testadas, com rastreabilidade de solicitação, controle de escopo e tratamento de backups. As páginas públicas descrevem a limitação atual; elas não implementam a exclusão.

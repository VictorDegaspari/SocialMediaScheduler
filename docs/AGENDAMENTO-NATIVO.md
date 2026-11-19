# Agendar lotes dentro do YouTube e do TikTok

O modo **agendamento nativo** transfere os vídeos antecipadamente e registra a data de publicação na plataforma. Depois da confirmação, o computador pode ser desligado: a plataforma controla a publicação. O modo anterior de preparar vídeos para revisão continua disponível e é o padrão.

## YouTube

Em **Minhas pastas → Adicionar pasta/Editar → Como processar o vídeo?**, escolha **Agendar lote dentro do YouTube**. Use o motor local, selecione seu canal YouTube e autorize os envios automáticos em Conexões. A origem pode ser local ou Google Drive.

Configure os horários diários ou o intervalo entre publicações. No JSON de cada vídeo, informe `youtube.visibility: "public"`: isso autoriza a publicação futura. O upload usa `privacyStatus: "private"` e `publishAt` com a data reservada. Um JSON privado ou não listado não é transformado silenciosamente em público. [Contrato oficial de status.publishAt](https://developers.google.com/youtube/v3/docs/videos#status.publishAt).

Os uploads são sequenciais por conta, com até duas contas transferindo em paralelo. Cada ciclo pode preparar outro vídeo, até preencher o teto de reservas; não é necessário esperar a primeira data de publicação. O histórico mostra a data reservada e só informa **Agendado** quando o YouTube retorna um agendamento futuro. A consulta continua até a plataforma mudar o estado.

## TikTok Studio

Em **TikTok navegador → Como processar os vídeos?**, escolha **Agendar lote dentro do TikTok Studio**, configure os horários e ative os envios automáticos. **Agendar próximo agora** solicita apenas um vídeo; com a rotina ativa, o scheduler continua preenchendo o lote até o teto.

Faça o login manual no Chrome antes de iniciar. Cada JSON precisa declarar `tiktok.privacyLevel: "PUBLIC_TO_EVERYONE"`. A rotina seleciona a opção de agendamento, confere os campos de data/hora e clica em **Agendar**. O contexto do navegador usa America/Sao_Paulo. O histórico só informa **Agendado no TikTok** depois de uma confirmação nova da interface; o Chrome é fechado automaticamente para permitir o próximo vídeo.

O TikTok documenta antecedência de **15 minutos a 10 dias**. O sistema reserva ao menos 20 minutos para dar margem ao upload e limita qualquer horizonte maior a 10 dias. A disponibilidade depende da conta. [Orientação oficial do TikTok](https://ads.tiktok.com/business/es-LA/blog/introducing-video-scheduler-now-you-can-plan-tiktoks-in-advance).

A interface do Studio pode variar. Somente controles identificados e datas preservadas são aceitos. Se o seletor de datas não puder ser preenchido, houver login/CAPTCHA, faltar a indicação de IA necessária ou não houver confirmação, o lote para para conferência. Conteúdo com declarações comerciais usa revisão manual. Uma transferência sem confirmação fica **Conferir envio** e não é repetida automaticamente. Os seletores foram validados com páginas de teste locais; isso não substitui a verificação na conta real.

Para solicitar uma quantidade exata por conta e deixar o excedente aguardando vagas, use [Pedidos e contas e a integração do assistente](ASSISTENTE-E-CONTAS.md).

## Limites e datas

Os dois formulários oferecem:

- **Máximo de vídeos agendados:** inclui reservas locais ainda não enviadas e agendamentos com data futura, além da capacidade externa informada. O padrão de 10 é um teto conservador do sistema, não um limite universal anunciado pelas plataformas.
- **Agendados fora deste sistema:** reserva capacidade para vídeos programados manualmente ou por outras ferramentas. Atualize esse valor ao alterar a agenda externa: o aplicativo não sincroniza esse inventário automaticamente.
- **Máximo de uploads em 24 horas:** janela móvel, sem zerar à meia-noite. No YouTube, os registros são compartilhados por canal entre as rotinas; no navegador, pelo perfil TikTok desta instalação. Tentativas iniciadas e resultados desconhecidos também consomem orçamento.
- **Máximo de publicações por dia:** usa a data no fuso da rotina e todas as reservas deste sistema para o mesmo destino. Os horários externos não estão nesse calendário; ajuste o orçamento para acomodá-los.
- **Preparar quantos dias à frente:** restringe a janela de preenchimento, sem ampliar o máximo permitido pela plataforma.
- **Publicar a partir de / até:** limites inclusivos para as datas, em America/Sao_Paulo no painel. A data final nunca é prorrogada automaticamente. Não há upload imediato para compensar uma data vencida.

O YouTube informa que o limite de uploads depende do canal e da elegibilidade de recursos; não há um único número aplicável a todos. Ajuste os tetos à sua conta e à cota da API. Ao receber `uploadLimitExceeded`, `quotaExceeded` ou `dailyLimitExceeded`, o sistema bloqueia novos envios do canal por pelo menos 24 horas, preservando as sessões. [Limites oficiais de upload](https://support.google.com/youtube/answer/57407?hl=pt-BR).

Se o TikTok informar limite de uploads/agendamentos, o lote é pausado e novos uploads ficam bloqueados por 24 horas. Salvar outra configuração não remove esse bloqueio. O estado desconhecido deve ser conferido no Studio antes de retomar.

Reservas e limites persistem em PostgreSQL. Locks impedem que dois ciclos reservem a mesma capacidade simultaneamente. Antes de iniciar um upload, o sistema verifica novamente o período permitido e o orçamento. Alterar uma configuração cancela comandos TikTok ainda não iniciados; reduzir limites do YouTube pode exigir cancelar reservas excedentes no histórico.

Em **Minhas pastas → Agendamentos por vídeo**, a lista mostra a data, a hora de Brasília, o destino e o estado de cada envio. **Cancelar agendamentos da pasta** libera as reservas locais que ainda podem ser retiradas e remove os próximos agendamentos nativos do YouTube. Vídeos já enviados ficam privados no canal. A conta precisa da permissão de editar vídeos para cancelar no YouTube. Resultados que exigem conferência aparecem por vídeo.

Pausar ou editar uma rotina afeta novos envios. Agendamentos em outros motores podem ser gerenciados pelo serviço correspondente. Uma data passada não comprova publicação do TikTok.

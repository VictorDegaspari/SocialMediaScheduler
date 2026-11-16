# Origem automática: Pack GTA 6

O sistema consulta o catálogo de [monetizecomgta6.netlify.app](https://monetizecomgta6.netlify.app/) e busca os arquivos públicos de vídeo no Google Drive. Não é necessário baixar arquivos manualmente, escolher uma pasta de destino ou criar um JSON por vídeo.

Na verificação de 16/11/2026, o catálogo tinha 2.243 registros de vídeo, correspondentes a 1.130 IDs únicos do Drive. O conector elimina IDs repetidos e ignora os registros de imagem. Foi validado um download real de 11.511.549 bytes: MP4 vertical, 576×1024, com 63,368 segundos. A verificação do download não publicou conteúdo nas redes.

## YouTube

1. Em **Minhas pastas → Adicionar pasta**, escolha **Origem dos vídeos → Site · Pack GTA 6**.
2. Ajuste prefixo do título, descrição, hashtags e declarações de IA e público infantil. O título inicial usa o disponível no site, como `GTA 6 — Vídeo 0001`; o conector não inventa um assunto para o vídeo.
3. Escolha o canal e **Agendar lote dentro do YouTube**, ou o modo de processamento desejado. A opção de incluir os vídeos já existentes é marcada ao selecionar o pack.
4. Configure os horários e os limites da rotina. A autorização de envios automáticos do YouTube continua em Conexões.

O sistema armazena o catálogo na fila, mas baixa os vídeos somente quando há capacidade para preparar um envio. O tamanho é verificado durante o download e o conteúdo passa pela mesma validação de mídia e deduplicação das outras origens. Não exige autorização OAuth do Drive para arquivos públicos; a conexão YouTube continua necessária para publicar.

## TikTok

Em **TikTok navegador**, selecione **Origem dos vídeos do TikTok → Site · Pack GTA 6**. Ajuste os metadados, escolha **Agendar lote dentro do TikTok Studio** e configure os horários, limites e ativação da rotina. O perfil do Chrome precisa estar autenticado no TikTok.

O agente busca somente o próximo vídeo necessário em uma área temporária privada, prepara a cópia e usa o fluxo existente do TikTok. Depois remove o arquivo de trabalho. A origem e as configurações são salvas no painel; não é necessário movimentar arquivos na pasta local.

O histórico conserva o ID da origem e o hash do conteúdo. Reinícios não provocam novos downloads de IDs já enviados. IDs diferentes com conteúdo idêntico são identificados na primeira leitura e ficam registrados para não serem baixados novamente. Vídeos inválidos ou removidos são ignorados; no máximo três rejeições são processadas por tentativa antes de aguardar outro ciclo. Resultados desconhecidos de upload não são repetidos automaticamente.

## Comportamento e limites

- O catálogo é atualizado nas verificações da rotina; uma consulta pode reaproveitar o catálogo em memória por até um minuto.
- A origem aceita somente os IDs de Drive listados no catálogo deste pack. Não aceita endereços arbitrários para download.
- Limites de tamanho são aplicados mesmo quando o Drive não informa Content-Length. Páginas de login, confirmações de download, respostas parciais e redirecionamentos fora dos hosts de download permitidos não são tratados como MP4.
- Se o arquivo deixar de ser público ou o site mudar de formato/endereço, o sistema registra o erro. Não tenta contornar autenticação ou restrições do Drive.
- O formato atual do fluxo é MP4 vertical ou quadrado, com até 3 minutos e 1 GiB. Um arquivo fora desse formato não é convertido automaticamente.
- As declarações de IA do YouTube e TikTok são configuradas separadamente. `youtubeContainsSyntheticMedia` controla o YouTube; `madeWithAI` controla o TikTok. Configurações antigas sem o campo do YouTube preservam a declaração anterior até serem ajustadas. A limpeza de tags do arquivo é independente dessas declarações.
- Os tetos de vídeos agendados, uploads em 24h, publicações por dia e período permitido continuam sendo verificados pelo [agendamento nativo](AGENDAMENTO-NATIVO.md).
- O PC precisa estar ligado para consultar a origem e transferir os vídeos. Depois de confirmado o agendamento nativo, a plataforma controla a publicação.

O botão “Postar” do site mantém um histórico próprio no navegador. A integração não altera esse marcador: o histórico de envios e agendamentos fica no Drive Watcher.

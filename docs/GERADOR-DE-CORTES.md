# Gerador de cortes do YouTube

A aba **Gerador de cortes** recebe um link de vídeo do YouTube, baixa a origem na melhor qualidade disponível de imagem e áudio, transcreve o áudio e prepara sugestões de trechos. O resultado é um MP4 H.264/AAC, com ou sem legendas: vertical a partir de 1080 × 1920 para Shorts ou horizontal a partir de 1920 × 1080 para vídeo comum. Fontes com o menor lado acima de 1080 pixels mantêm essa resolução na orientação escolhida; uma origem 4K gera 2160 × 3840 ou 3840 × 2160. A publicação depende da escolha do canal e do clique do usuário em **Postar**.

Os arquivos prontos aparecem automaticamente em **Minhas pastas → Cortes do aplicativo**, inclusive antes da primeira publicação. Ali você pode assistir, baixar, ajustar e escolher **Postar** para YouTube ou **Postar no TikTok** para publicação imediata. Cada conta tem seu próprio envio e sua confirmação; publicar em uma plataforma mantém o corte disponível para a outra. No TikTok, escolha o perfil, confira a prévia, a legenda e as declarações e clique em **Autorizar e postar agora**. Os arquivos permanecem guardados até a exclusão manual. A biblioteca usa cartões compactos com prévia, duração e formato. **YouTube**, **TikTok**, **Ajustar** e **Baixar MP4** ficam visíveis; descrições, avisos, publicações e exclusão ficam em **Detalhes e publicações**. As configurações das pastas de vídeos também podem ser expandidas, e os atalhos do topo levam diretamente a cada seção.

Use o preview para conferir o contexto, o início/fim do trecho e cada palavra da legenda. A transcrição reconhece a fala no áudio; não traduz, resume, reescreve ou usa títulos do YouTube como legenda. Reconhecimento de voz pode errar nomes próprios, sobreposição de vozes, ruído e música: a interface permite corrigir o texto e renderizar um novo preview antes de enviar. Não há garantia de transcrição perfeita sem essa revisão.

## Componentes open source avaliados

| Componente | Uso e decisão |
| --- | --- |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Download de um vídeo específico e leitura de sua duração/título. Código principal sob Unlicense; os componentes distribuídos têm suas próprias licenças. O runtime Node do container resolve os desafios JavaScript suportados pelo projeto. |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Reconhecimento multilíngue com timestamps de palavras, VAD e quantização int8 em CPU; licença MIT. Evita exigir GPU ou serviço pago. |
| [FFmpeg](https://ffmpeg.org/documentation.html) + libass | Recorte, enquadramento 9:16, áudio AAC e legenda ASS gravada na imagem. Licença depende das opções de compilação; o container usa os pacotes Debian. |
| [WhisperX](https://github.com/m-bain/whisperX) | Alternativa avaliada para alinhamento forçado e identificação de falantes. Não instalada neste fluxo: adiciona modelos/dependências e os timestamps do faster-whisper atendem ao preview editável. Pode ser integrado em uma etapa posterior se o alinhamento de palavra precisar de maior precisão. |

As dependências Python principais estão fixadas em `requirements-cuts.txt`; o Docker instala um ambiente virtual separado em `/opt/cuts`. O arquivo permite reproduzir as versões principais avaliadas. Dependências transitivas ainda seguem as restrições publicadas por esses projetos.

## Seleção pelos momentos mais repetidos

Quando o vídeo expõe o mapa público **Most Replayed / Mais repetidos**, o yt-dlp fornece intervalos com valores normalizados de interesse. O gerador guarda esse mapa junto da fonte e usa a cobertura e os picos de replay para pontuar as sugestões, mantendo continuidade da fala e encerramento de frases. Chamadas de inscrição, pedidos de like e publicidade reduzem a pontuação para evitar selecionar apenas uma chamada promocional. Os cortes sugeridos também evitam repetir os mesmos intervalos.

Esse mapa representa **interesse relativo**, sem informar a quantidade exata de cliques, o CTR ou o total de pessoas que assistiu a cada momento. Nem todo vídeo disponibiliza esses dados. Quando o YouTube não retorna o mapa ou a consulta falha, a interface informa isso e a seleção continua com a fala e os limites de frases. Não são criados valores substitutos de audiência. Uma fonte curta ou com pouca fala pode produzir menos cortes do que a quantidade pedida.

Em projetos já baixados, **Atualizar momentos do YouTube** consulta os metadados novamente e permite gerar uma sugestão com os dados atuais, sem apagar os cortes que você já revisou. A consulta baixa apenas metadados; não baixa a fonte nem transcreve o áudio outra vez.

Os relatórios privados de retenção do YouTube Analytics são um recurso diferente, restrito ao proprietário do canal e a uma autorização OAuth específica. O gerador usa somente o mapa público disponível e não solicita acesso adicional às contas.

Fontes: [extração de heatmap no yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_video.py), [retenção de audiência na YouTube Analytics API](https://developers.google.com/youtube/analytics/channel_reports#audience-retention), [métrica audienceWatchRatio](https://developers.google.com/youtube/analytics/metrics#audienceWatchRatio).

## Operação

### Formato, legendas e prévia

Clique em **Ajustar** para abrir o vídeo original e a prévia. Em **Formato no YouTube**, escolha **Shorts · vertical (9:16)** ou **Vídeo · horizontal (16:9)**. A prévia acompanha a proporção selecionada; salve para gerar o MP4 correspondente. Cortes anteriores continuam em Shorts até uma mudança explícita. Ambos os formatos mantêm o limite de três minutos do gerador.

Cortes já enviados, em envio ou com tentativa de publicação também oferecem **Ajustar**. Se a fonte de um projeto antigo tiver sido removida, o app recupera o vídeo original na melhor qualidade disponível antes de abrir o editor; o processamento continua mesmo com a página fechada. É possível cancelar a espera e tentar novamente se o vídeo não puder ser baixado. Ao salvar, o app cria uma **Versão ajustada** separada para revisão, preservando o corte anterior, os arquivos usados no envio e seu histórico. A nova versão mantém formato, enquadramento (incluindo webcam), legendas e trechos removidos até você alterá-los. Depois de gerar a prévia, revise e autorize a publicação desejada; salvar ajustes não inicia outro envio. Se houver falha de conexão ao salvar, tentar novamente no mesmo editor reutiliza a versão criada.

Em **Postar**, o campo **Publicar como** mostra o formato da prévia pronta. Trocar a seleção exige clicar em **Ajustar formato**, gerar e revisar a nova prévia antes de autorizar o envio. A API valida a proporção real do arquivo e a versão revisada; não converte o vídeo durante o upload. Vídeos horizontais não recebem `#Shorts` automaticamente. O YouTube classifica vídeos verticais ou quadrados de até três minutos como Shorts; para vídeo comum, orienta usar uma proporção mais ampla, como 16:9. [Ajuda oficial](https://support.google.com/youtube/answer/15424877?hl=pt-BR).

Desmarque **Exibir legendas no vídeo** para gerar a prévia e o MP4 sem legendas; o texto corrigido e o estilo ficam salvos para reativar depois. Escolha cor do texto, cor de destaque, contorno, tamanho, posição e fundo da legenda. As animações disponíveis são texto estático, fade, entrada com escala e destaque da palavra falada. O destaque usa timestamps reais de palavras; grupos corrigidos sem esse alinhamento ficam estáticos e geram um aviso, preservando o texto revisado.

Para enquadrar o vídeo, escolha imagem completa, fundo desfocado ou preencher o quadro. O preenchimento permite deslocar o foco horizontal/vertical e aproximar ou afastar a imagem com zoom de 0,25× a 3×. Em 1×, a imagem preenche a tela; abaixo disso, mais da origem aparece e as áreas livres ficam pretas. A prévia responde aos ajustes; ao salvar, o FFmpeg gera o arquivo final com as opções escolhidas. Revise a nova versão antes de postar.

Para montar uma reação, selecione **Webcam em cima + vídeo embaixo** em **Enquadramento**. Em **Webcam · cima**, arraste uma área do vídeo original para selecionar a câmera do streamer; em **Vídeo · baixo**, escolha a região do jogo ou conteúdo. Arraste o retângulo para mover e os cantos para redimensionar, ou informe as coordenadas em porcentagem. Cada parte permite preencher ou encaixar a imagem, aproximar/afastar e ajustar a posição de forma independente. A divisão começa em 50% e pode ser movida na prévia ou pelo controle **Espaço da webcam** (20% a 70%). As setas movem a seleção; Shift + setas altera o tamanho. As duas partes usam o mesmo instante e áudio da origem e respeitam os trechos removidos. A exportação mantém a resolução e taxa de quadros do fluxo de qualidade máxima.

O celular tem seus próprios controles: toque na imagem ou no botão de reprodução para reproduzir/pausar, use **−5 s / +5 s** para voltar/avançar e arraste a barra para navegar. Essa barra acompanha a montagem já descontando os trechos removidos. O indicador **Original** mostra a posição correspondente no vídeo de origem. Uma seleção no gráfico ou uma alteração confirmada nos campos de início/fim busca o mesmo instante na imagem; enquanto o quadro é carregado, a prévia indica a busca para não mostrar uma imagem antiga como se fosse a seleção atual.

### Textos e imagens sobre o vídeo

Em **Ajustar → Elementos**, use **Adicionar texto**, **Adicionar imagem** ou cole uma imagem copiada com **Ctrl+V**. Texto e imagem podem aparecer juntos, em até 20 elementos. São aceitos PNG, JPEG e WebP de até 20 MB. Arraste o elemento na prévia ou use os controles de posição e tamanho. Textos permitem escolher cor, tamanho, fundo e alinhamento à esquerda, ao centro, à direita ou justificado.

Em **Adicionar marca-d’água**, selecione o arquivo da logo do canal. A logo começa no canto superior direito e aparece durante todo o corte. Em **Posição e tamanho**, ajuste a opacidade de 0% a 100%. A transparência do arquivo é preservada, inclusive quando o controle está em 100%.

Mantenha **Durante todo o vídeo** marcado para um elemento fixo. Desmarque para definir **Aparece em** e **Some em**, em segundos do vídeo final, já descontando os trechos removidos. **Ver na prévia** busca o começo do elemento; **Trazer para frente** muda a sobreposição. Salve e confira o MP4 gerado antes de postar. Os elementos permanecem editáveis ao reabrir e acompanham novas versões, preservando a versão anterior.

### Remover trechos internos

Marque início/fim no player ou informe os tempos do vídeo original para excluir uma parte. A lista aceita até 20 remoções sem sobreposição e permite desfazer cada uma. A duração mostrada corresponde à soma das partes mantidas: o resultado deve ter de 0,5 a 180 segundos. O intervalo na origem pode ser maior quando as remoções deixam o resultado dentro desse limite.

Os campos de tempo usam **minutos:segundos**, como `09:11`. Para ajuste fino, informe `09:11,720` (a vírgula ou o ponto são aceitos). Pause o player e use **Marcar início aqui / Marcar fim aqui**, ou ajuste pelos botões **−1 s / +1 s**. Os campos das legendas e das remoções usam o mesmo formato, preservando os milissegundos.

Em **Consultar momentos mais revistos**, clique ou arraste sobre a linha do gráfico para definir diretamente o começo do corte. O marcador mostra o instante escolhido e o player busca essa mesma posição, sem centralizar uma janela ao redor do ponto. O ajuste fino permite precisão de milissegundos; o botão de 60 segundos conta a partir desse início. Se necessário, o fim é ampliado para manter um intervalo válido. A seleção é um rascunho até clicar em **Salvar e gerar prévia**.

Áudio, imagem e legendas são concatenados na mesma ordem. Os campos **Começa em** e **Termina em** das legendas usam o relógio do corte no celular, começando em `00:00` e descontando as remoções. Uma legenda com palavras dos dois lados de uma remoção aparece em linhas separadas para os trechos mantidos. Palavras removidas não reaparecem na prévia. Se uma remoção atravessar uma legenda corrigida sem timestamps de palavras, a linha permanece visível com aviso: ajuste seus tempos/texto ou escolha explicitamente restaurar a transcrição original. Mudanças de estilo ou de intervalo preservam as correções existentes; ampliar o intervalo acrescenta a fala original apenas nas novas bordas.

As novas sugestões de momentos mais revistos são acrescentadas ao projeto. Cortes já ajustados permanecem disponíveis, e o seletor evita repetir intervalos que já estejam representados. Quando os candidatos se esgotam, o painel informa que não há novas sugestões para aquela duração.

Recrie o serviço após atualizar o código:

```bash
./scripts/start.sh
```

Na primeira transcrição, o modelo de fala é baixado para `DATA_DIR/speech-models`, no volume persistente. A conexão com a internet é necessária nesse primeiro uso; nas execuções seguintes o modelo é reutilizado. O padrão é o modelo multilíngue `small`, em CPU int8. O processamento de vídeos longos pode levar bastante tempo em computadores com poucos recursos. A aplicação mantém a tarefa no banco e processa fora da requisição HTTP.

Para desenvolvimento fora do Docker:

```bash
python3 -m venv .venv-cuts
.venv-cuts/bin/pip install -r requirements-cuts.txt
export CUTS_PYTHON="$PWD/.venv-cuts/bin/python"
```

Instale também FFmpeg com libass, FFprobe e a fonte DejaVu Sans. `CUTS_WHISPER_MODEL` escolhe outro modelo compatível e `CUTS_CPU_THREADS` limita as threads de reconhecimento (padrão 4, máximo 8). `CUTS_PYTHON` deve apontar para o Python com as dependências instaladas. Em Docker, salve `CUTS_WHISPER_MODEL` e `CUTS_CPU_THREADS` no `.env` e recrie o serviço para aplicar.

## Limites e arquivos

- Um vídeo público gravado por tarefa; playlists, transmissões em andamento e vídeos futuros são recusados.
- Vídeo integral com até 2 horas. Para lives encerradas em **Canais do YouTube**, use **Escolher trecho** e marque até 30 minutos pelos horários da transmissão. Quando o YouTube oferece um mapa de replay, **Buscar momentos mais revistos** sugere intervalos. A transcrição, a análise e a recuperação da fonte usam o trecho escolhido.
- Cada arquivo de origem tem limite de 2 GiB. O download escolhe o melhor vídeo e o melhor áudio disponíveis, sem teto de resolução ou preferência por H.264; a montagem do MP4 preserva os fluxos originais, sem recodificação. O tamanho é monitorado e o excesso interrompe a tarefa, sem trocar silenciosamente para uma qualidade inferior.
- A exportação prioriza qualidade: H.264 com CRF 16 e preset `slow`, redimensionamento Lanczos e áudio AAC de 320 kb/s. A taxa de quadros segue a origem, inclusive 60 fps e taxas fracionárias como 59,94; 30 fps só é usado quando a origem não informa uma taxa válida. Renderizar pode demorar mais e gerar arquivos maiores. O envio usa os mesmos bytes do MP4 revisado.
- Trecho final com no máximo 3 minutos. **Manter imagem inteira** adiciona barras para preservar o conteúdo; **Preencher vertical** recorta as laterais no centro.
- Os campos das legendas usam o tempo da montagem. Os limites do corte e das remoções mostram os tempos do vídeo ou da live original. A API mantém as legendas no relógio do arquivo baixado, e o editor converte os tempos sem perder o alinhamento das palavras. Na junção, o fim de uma legenda pertence ao trecho anterior e o início ao seguinte.
- Subprocessos têm tempo máximo e são executados com argumentos separados, sem shell. Controles ASS recebidos no texto são tratados como caracteres visíveis, impedindo comandos de estilo injetados.
- A origem e os cortes ficam disponíveis até a exclusão manual, inclusive após postar. Use **Baixar MP4** para reutilizar o corte em outras plataformas e **Excluir arquivo** para removê-lo depois. Arquivos de render temporários são removidos após sucesso ou falha; um ajuste que falhe preserva o último preview completo.
- Apenas as cópias temporárias de upload são removidas após a confirmação do envio. A fonte e os arquivos finais do gerador são mantidos até a exclusão manual. Os originais das pastas monitoradas não são apagados.
- Até 10 projetos com arquivos guardados por vez, incluindo projetos já enviados. Exclua manualmente um projeto anterior, ou todos os seus cortes, para liberar a vaga antes de criar outro projeto.

Bloqueios do YouTube, vídeos privados, regiões ou exigência de login podem impedir o download. A mensagem da tarefa informa a falha; o aplicativo não importa cookies do navegador. Atualize a versão fixada do yt-dlp e reconstrua a imagem quando mudanças no YouTube exigirem suporte do projeto.

## Verificações

Os testes de seleção verificam diversidade, limites e uso das palavras originais. Os testes de mídia geram um MP4 sintético e comprovam o render H.264/AAC, 9:16, legendas incorporadas com deslocamento temporal correto e preservação do preview anterior quando um ajuste falha. Não dependem de baixar vídeos externos, modelos grandes nem publicar em canais reais.

```bash
./scripts/node-local.sh --test tests/cuts-media.test.ts tests/cuts-media.integration.ts
./scripts/test-integration.sh
./scripts/node-local.sh scripts/check-cuts-ui.mjs
```

A integração cobre a fila persistente, edição literal das legendas, revisão por versão, escolha de conta, upload idempotente e descarte/limpeza. As APIs de publicação são simuladas; os testes não enviam vídeos a canais reais. Um smoke adicional validou a transcrição com o modelo `tiny` real sobre fala sintética e a renderização final com FFmpeg.

## Editor e rolagem

O modal mantém o cabeçalho e os botões dentro da tela. As opções e legendas usam uma única rolagem, inclusive em celular e modo paisagem, sem mover a página ao fundo. Erros de gravação aparecem junto ao botão Salvar e preservam os ajustes. Uma resposta atrasada não fecha outro corte aberto depois.

Se a transcrição original falhar, use **Tentar carregar transcrição** sem fechar o editor. Ajustes dentro do intervalo existente continuam disponíveis; ampliar o intervalo exige carregar as legendas das novas bordas. Ao salvar grupos aparados, o alinhamento das palavras reconhecidas é preservado para o destaque e as próximas remoções.

Alterar os limites ou restaurar uma remoção recalcula os tempos exibidos sem descartar legendas corrigidas que estejam temporariamente fora da montagem. Tempos fora da duração do corte são recusados. Ao salvar pela API, omitir `excludedRanges` preserva as remoções existentes; envie `[]` para removê-las explicitamente. Uma análise sem novas sugestões continua processando os ajustes que já aguardavam geração.

## Listagem e descarte

Os projetos são listados em páginas de 10, com controles **Anterior** e **Próxima**. O projeto descartado sai da visualização e deixa de ocupar uma posição na página. Antes de descartar um projeto ou corte, a confirmação mostra seu nome e permite cancelar sem alterar arquivos. O registro de auditoria e as publicações existentes são preservados. Projetos concluídos também podem ser descartados para limpar a visualização.

Consulte os [parâmetros de paginação da API e o corpo de confirmação](PAGINACAO.md).

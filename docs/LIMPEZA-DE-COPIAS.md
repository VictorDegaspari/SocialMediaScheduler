# Limpeza das cópias de publicação

O aplicativo remove a cópia temporária de upload (`UUID.native.mp4`) em `DATA_DIR` assim que a API confirma o upload ou o TikTok Studio confirma o agendamento/publicação. O histórico, os IDs remotos, as declarações e a deduplicação são preservados. Um upload confirmado pode continuar em processamento na plataforma; ele já não precisa dos bytes locais para ser retomado.

Uma varredura a cada minuto também procura arquivos `UUID.native.mp4` deixados por reinícios ou falhas de remoção. Ela funciona inclusive com as rotinas pausadas e exige confirmação persistida antes de apagar. Quando a remoção falha, a referência local continua disponível para outra tentativa. Uma falha de limpeza não transforma a publicação confirmada em um novo upload.

Revisões, uploads pendentes, sessões interrompidas e resultados incertos são preservados. Arquivos compartilhados são mantidos enquanto algum destino ainda precisar deles. Descartes explícitos anteriores ao upload ou confirmados manualmente também permitem remover a cópia. Links simbólicos, diretórios inesperados e nomes fora do padrão do aplicativo são ignorados.

As fontes e os arquivos finais do gerador de cortes são preservados após postar, para permitir reutilização no TikTok, YouTube ou outro destino. A remoção depende de **Excluir arquivo** ou **Descartar projeto e liberar arquivos**, com confirmação. O histórico e as publicações remotas continuam disponíveis.

No gerador de cortes, `DATA_DIR/cuts-publish-manifests` guarda a prova de origem e a cópia parcial de cada preparação de upload. Se o processo cair antes de confirmar a entrega no banco, a recuperação confere o lock do job, a ausência da entrega e o hash antes de apagar a cópia nativa órfã. Esses manifestos ficam separados das prévias e da fonte; descartar o vídeo não remove a prova necessária para a recuperação.

Esta limpeza alcança somente os downloads/cópias gerenciados pelo aplicativo em `DATA_DIR`. Não remove os originais do Google Drive, das pastas monitoradas nem a pasta pessoal `~/Downloads` do computador, que não é montada para escrita no serviço.

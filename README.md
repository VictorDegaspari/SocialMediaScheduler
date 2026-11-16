# Drive Watcher

Painel local para monitorar pastas do computador e do Google Drive e publicar vídeos pelas APIs oficiais do YouTube e TikTok. O motor padrão usa Node.js, BullMQ e Redis locais; o Postiz é uma integração opcional. Funciona em segundo plano enquanto o computador e os containers estiverem ligados; não é necessário deixar o navegador aberto.

## Pedidos pela conversa e múltiplas contas

Use **Pedidos e contas** para organizar perfis de conteúdo, conectar vários canais e pedir uma quantidade finita de vídeos com horários definidos. A integração local do assistente usa a mesma fila e mostra pendências manuais. [Guia de integração](docs/ASSISTENTE-E-CONTAS.md).

## Agendamento nativo em lote

O painel permite enviar vários vídeos antecipadamente ao agendador do YouTube e ao TikTok Studio, com teto de agendados, limite móvel de uploads, máximo diário, horizonte e período de publicação. Veja [como configurar o agendamento nativo](docs/AGENDAMENTO-NATIVO.md).

O [Pack GTA 6 pode ser usado como origem automática](docs/PACK-GTA6.md): o sistema lê o catálogo do site, busca o próximo vídeo no Drive e prepara os metadados, sem downloads ou arquivos JSON manuais.

## Publicação futura na nuvem

O site público estático está em [`website/`](website/README.md), separado do painel local. Inclui apresentação, privacidade, termos, suporte e exclusão de dados. O guia [Informações para publicação](docs/INFORMACOES-PUBLICACAO.md) traz campos para os portais, URLs, ícone, configuração Vercel e as limitações do uso pessoal no TikTok. O site ainda não foi publicado.

O guia [Publicação fora do ambiente local](docs/DEPLOY-EXTERNO.md) registra a arquitetura recomendada para Railway, a opção de frontend na Vercel, variáveis, volumes, OAuth e o roteiro de migração. A versão atual ainda precisa de autenticação e ajustes de domínio/proxy antes de ser exposta na internet. As pendências estão identificadas no documento.

## Iniciar

Requisitos: Ubuntu, Docker Engine com Compose e OpenSSL. Não é necessário instalar Node.js no computador para usar os containers.

```bash
cd /home/victor/Desktop/projects/drive-watcher
./scripts/start.sh
```

Abra **http://localhost:4317**. O script cria `.env` com segredos aleatórios, constrói a aplicação e inicia PostgreSQL, Redis e o serviço. O painel fica acessível somente no computador local.

### Experimento TikTok pelo navegador

Abra **TikTok navegador** no menu do painel ou pelo atalho em Conexões. Você pode abrir o login, escolher uma pasta local, salvar horários diários ou intervalo, enviar o próximo vídeo agora, pausar a rotina e interromper uma tarefa. O scheduler Redis/Node do aplicativo controla os horários e persiste as configurações e tarefas em PostgreSQL. Um agente no Ubuntu abre o Chrome; `scripts/start.sh` configura seu início com a sessão gráfica do usuário. **Publicar exige sua revisão e clique no navegador**. O perfil e a proteção contra duplicados ficam fora do Git em `.browser-data/`. A pasta local padrão é `media/`; o JSON é opcional. Instruções, recuperação e comandos avançados em [TikTok pelo navegador](docs/TIKTOK-NAVEGADOR.md).

```bash
./scripts/stop.sh                  # Parar, preservando os dados
docker compose logs -f app         # Acompanhar a rotina
docker compose ps                 # Verificar os serviços
node scripts/run-now.mjs           # Solicitar leitura das pastas ativas (Node 22+)
```

O Docker usa `restart: unless-stopped`: se o Docker iniciar com o computador, os containers ativos retornam após um reboot. Uma parada explícita exige iniciar novamente. Para iniciar também no login do usuário, há o script opcional `./scripts/install-autostart.sh`; ele cria um serviço systemd do usuário. O instalador não é executado automaticamente.

## Usar uma pasta local

O script de inicialização cria a pasta **`media/` dentro deste projeto**. Você pode copiar seus vídeos e arquivos JSON para ela ou para subpastas:

```text
drive-watcher/media/
  meu-canal/
    video-001.mp4
    video-001.json
```

No painel, abra **Minhas pastas → Adicionar pasta**, selecione **Pasta local no computador** em **Origem dos vídeos** e informe o caminho exibido no formulário ou uma subpasta, como `meu-canal`. Clique em **Verificar acesso**, escolha os canais e configure os horários. Para enviar vídeos que já estão na pasta ao criar a rotina, marque **Incluir os vídeos que já existem na primeira verificação**. A conexão com o Google Drive é opcional; para publicar, conecte os canais YouTube/TikTok diretamente na aba Conexões.

Para usar outro diretório, configure um **caminho absoluto existente** em `.env`, por exemplo:

```dotenv
LOCAL_MEDIA_DIR=/home/victor/Videos
```

Execute `./scripts/start.sh` novamente para recriar o container com o novo volume. A aba **Conexões** e o formulário mostram o caminho disponível no computador. Somente essa pasta e suas subpastas ficam acessíveis ao serviço, em um volume de **somente leitura**; os originais não são modificados ou apagados. O usuário do container precisa ter permissão de leitura dos arquivos e acesso às pastas. Links simbólicos são ignorados e não podem ser escolhidos como pastas.

Use uma raiz comum para monitorar várias pastas locais. Se mudar a raiz, pause as rotinas antigas e crie novas rotinas para os novos caminhos; o serviço bloqueia o reapontamento silencioso de rotinas existentes. Drive e disco usam a mesma fila persistente e deduplicação por SHA-256 e canal: uma cópia idêntica não gera outra publicação, mesmo vindo de outra origem.

## Conectar o Google Drive (opcional)

1. No Google Cloud, habilite a **Google Drive API**, configure a tela de consentimento e crie um cliente OAuth do tipo **Aplicativo da Web**.
2. Cadastre `http://localhost:4317/auth/google/callback` como URI de redirecionamento autorizada. Se alterar a porta, use o endereço exibido no painel.
3. Na aba **Conexões**, salve Client ID e Client Secret e clique em **Autorizar Google**.
4. Entre com a conta que possui acesso às pastas desejadas. O aplicativo solicita `drive.readonly`, incluindo download dos vídeos.

O escopo de leitura alcança os arquivos acessíveis à conta; o filtro de pasta é aplicado pelo Watcher. Uma conta dedicada com acesso apenas às pastas necessárias reduz o alcance dessa autorização. Em aplicativo externo com consentimento em Testing, o refresh token pode expirar após sete dias. Será necessário reconectar a conta quando a autorização deixar de valer. [OAuth oficial](https://developers.google.com/identity/protocols/oauth2#expiration).

## Publicar com o motor local

O **Motor local** é o padrão. O Redis agenda e distribui os trabalhos; os conectores OAuth enviam os arquivos às APIs oficiais. Você não precisa da chave do Postiz nesse modo. A aplicação mantém uma conta YouTube e uma conta TikTok conectadas por instalação.

### YouTube

1. Habilite **YouTube Data API v3** no Google Cloud e crie um cliente OAuth do tipo **Aplicativo da Web**. Pode usar o mesmo cliente do Drive.
2. Adicione `http://localhost:4317/auth/youtube/callback` às URIs de redirecionamento autorizadas.
3. Em **Conexões → YouTube direto**, salve Client ID e Client Secret e clique em **Autorizar YouTube**.
4. Autorize `youtube.upload` e `youtube.readonly`. O aplicativo verifica as permissões concedidas e identifica o canal; salvar somente as credenciais não conecta o canal.
5. Para automatizar, marque a autorização de envios automáticos em Conexões, selecione o canal na rotina e escolha **YouTube automático**. Sem essa autorização, o vídeo fica em revisão local.

O scheduler inicia o upload no horário da rotina. `youtube.visibility` no JSON controla `private`, `unlisted` ou `public`, com padrão **privado**. O upload usa uma sessão retomável persistida e blocos de 8 MiB; reiniciar o PC não inicia outro vídeo para a mesma sessão. Processamento do YouTube pode atrasar a disponibilidade. O código envia `youtube.containsSyntheticMedia` à declaração oficial de conteúdo alterado/IA e preserva `madeForKids`. [Upload oficial](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert), [protocolo retomável](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol).

### TikTok

1. Cadastre um aplicativo no TikTok for Developers com Login Kit e Content Posting API e obtenha aprovação para **video.upload**. Para este aplicativo local, adicione a plataforma **Desktop** nos detalhes do aplicativo.
2. Em **Login Kit → Desktop** no portal, cadastre o callback **`http://localhost:4317/auth/tiktok/callback`**. O Login Kit Desktop permite HTTP no localhost com porta e usa PKCE; a aplicação já implementa esse fluxo. Não é necessário alterar `APP_URL` nem expor o painel para autorizar o aplicativo local.
3. Em **Conexões → TikTok direto**, escolha **Desktop · aplicativo neste computador**, salve Client Key e Client Secret e clique em **Autorizar TikTok**. O aplicativo confere `user.info.basic`, `video.upload` e a identidade retornada. O tipo selecionado precisa estar cadastrado no portal TikTok.
4. Escolha o canal na rotina. Cada vídeo fica em **Revisão local**, inclusive nas rotinas automáticas. No histórico, revise a prévia e confirme **Autorizar e enviar**.
5. Após o envio, abra a notificação na caixa de entrada do TikTok, revise a legenda e a indicação de IA e conclua a publicação. O JSON continua disponível na revisão para copiar a legenda; o endpoint de caixa de entrada transfere o arquivo, sem publicar automaticamente o texto.

Para um futuro servidor com domínio público, selecione **Web · domínio HTTPS** e cadastre o callback HTTPS correspondente no Login Kit Web. A troca de tipo pede uma nova autorização TikTok. Configurações antigas sem tipo explícito preservam Web; novas configurações em localhost preferem Desktop. Os requisitos de site, termos e política de privacidade do portal para revisão do aplicativo continuam aplicáveis, mesmo quando o callback Desktop é HTTP. [Login Kit Desktop oficial](https://developers.tiktok.com/docs/en/login-kit-desktop).

Esta instalação pessoal não implementa Direct Post automático: as diretrizes dessa API rejeitam ferramentas limitadas às contas do próprio usuário ou equipe. O fluxo implementado é **Upload to Inbox**, sujeito à aprovação do aplicativo e à autorização do usuário para o escopo. [Upload oficial](https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content), [regras de Direct Post](https://developers.tiktok.com/docs/en/content-sharing-guidelines), [callback HTTPS](https://developers.tiktok.com/docs/en/login-kit-web).

Detalhes de arquitetura, estados e recuperação em [docs/MOTOR-LOCAL.md](docs/MOTOR-LOCAL.md).

## Postiz (integração opcional)

Para usar uma instalação Postiz existente, selecione **Postiz** no campo **Quem gerencia as publicações?** e salve. Depois, informe a URL completa da API pública e a chave de sua organização. A aplicação testa a chave e carrega os canais YouTube/TikTok disponíveis.

- Cloud: `https://api.postiz.com/public/v1`.
- Postiz rodando no host pela porta 4007: `http://host.docker.internal:4007/api/public/v1`.
- Outro container/rede: use um endereço que seja alcançável **a partir do container Watcher**. `localhost` dentro dele não é o Postiz.

Nesse modo opcional, a aplicação se conecta a uma instalação Postiz existente. O modo **Motor local** funciona sem Postiz ou chave Postiz. Ao trocar de motor, edite as rotinas e selecione os canais do motor escolhido; o histórico anterior é preservado.

**No modo Postiz, YouTube:** pode receber rascunhos ou envios para agendamento. Para habilitar a segunda opção, confirme no painel que verificou e autorizou o canal. O Postiz continua responsável pelo OAuth social, upload final e publicação. O agendamento é criado com pequena antecedência após a importação; processamento e moderação podem atrasar a exibição.

**No modo Postiz, TikTok:** sempre recebe **rascunhos**, mesmo quando a rotina está em modo de agendamento. Conclua a revisão, as escolhas exigidas e a publicação no Postiz. A aprovação de um app e o consentimento não podem ser presumidos a partir de uma chave API. Consulte as [diretrizes do TikTok](https://developers.tiktok.com/docs/en/content-sharing-guidelines).

## Criar uma rotina

Em **Minhas pastas → Adicionar pasta**, escolha:

- Origem: **Google Drive** (link ou ID da pasta) ou **Pasta local** (caminho da pasta), e se deve incluir subpastas.
- Frequência de **verificação**: quando procurar arquivos novos, por exemplo a cada 5 minutos.
- Frequência de **envio**: um vídeo por oportunidade, em intervalo de minutos/horas/dias ou em horários diários como `08:00, 20:00`.
- Canais, modo de envio e exigência de JSON de metadados. No motor local, **Preparar para revisão** guarda o vídeo no PC; **YouTube automático** autoriza o envio nos horários, se a autorização de automação estiver marcada em Conexões. TikTok sempre passa por revisão.
- **Remover metadados do vídeo**, ativado por padrão, inclusive nas rotinas já cadastradas. Pode ser desmarcado por rotina.
- Se deve incluir os arquivos que já existem na primeira leitura. Por padrão eles são registrados e ficam fora dos envios, mesmo se seu conteúdo mudar depois. Em pastas locais, renomear cria uma nova entrada; conteúdos já enviados continuam protegidos pela deduplicação.

Horários fixos usam `America/Sao_Paulo`. Nos intervalos, a primeira oportunidade ocorre assim que houver um vídeo pronto; depois o intervalo conta a partir do envio concluído. Ao ligar o PC depois de uma oportunidade perdida, a rotina processa no máximo um vídeo e calcula o próximo horário futuro. Não há execução enquanto o PC estiver desligado ou suspenso.

O envio automático exige um canal autorizado e selecionado. No modo local, configure OAuth do canal em Conexões; no modo Postiz, configure a chave da organização. Para pastas do Drive, também exige Google autorizado; para pastas locais, exige acesso de leitura ao diretório montado. Você pode cadastrar pastas antes e completar as conexões depois. **Verificar agora** antecipa a leitura da origem; não altera a frequência de envio. As rotinas do Drive já existentes preservam sua origem e seu histórico.

## Vídeos e metadados

O fluxo aceita **MP4 vertical ou quadrado, até 3 minutos e 1 GiB**. O arquivo é validado com ffprobe antes do envio. A classificação final como Shorts depende do YouTube.

Na mesma pasta do vídeo, adicione `video-001.mp4` e `video-001.json`. Há um exemplo completo em [examples/video-001.json](examples/video-001.json). O formato mínimo é:

```json
{
  "title": "Título do vídeo",
  "description": "Descrição do vídeo.",
  "hashtags": ["dicas"],
  "ready": true,
  "youtube": { "visibility": "private", "madeForKids": false }
}
```

`visibility` também aceita `unlisted` e `public`. Sem esse campo, a visibilidade padrão é privada. A exigência de JSON pode ser desabilitada na rotina; nesse caso o nome do arquivo será usado como título. Se usar nomes repetidos, informe `videoFileId` no JSON; associações ambíguas são bloqueadas. `ready=false` mantém o vídeo em espera.

Cada JSON deve ter no máximo 64 KiB. Limites por verificação: 5.000 arquivos e 200 subpastas. Atalhos e documentos nativos Google não são tratados como vídeos. A descoberta usa varreduras periódicas da origem; esta versão não depende de webhooks nem de um endpoint público de entrada. Na pasta local, o caminho relativo identifica o arquivo, e tamanho, inode e datas de modificação verificam sua versão. Arquivos precisam permanecer estáveis por pelo menos 30 segundos; alterações no vídeo ou JSON reiniciam essa espera. Cópias ainda em andamento não devem ter seu nome final `.mp4` antes de serem concluídas; prefira escrever como `.part` e renomear no fim.

Com **Remover metadados do vídeo** marcado, a aplicação cria uma cópia local sem as tags descritivas do contêiner e das faixas e sem capítulos antes do upload. Usa FFmpeg sem recodificar áudio/vídeo, preserva a orientação e não altera o arquivo original, local ou do Drive. O JSON com título/descrição e `tiktok.madeWithAI` são preservados. Campos estruturais necessários ao MP4 continuam presentes. Uma cópia já enviada sem limpeza não é reutilizada como se estivesse limpa, e a opção não republica posts existentes. Se a limpeza falhar, o envio é interrompido.

**A limpeza não garante que o TikTok deixe de identificar conteúdo de IA nem substitui a rotulagem exigida.** O TikTok pode usar sinais além das tags do arquivo. [Informações oficiais sobre conteúdo gerado por IA](https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content).

## Histórico e recuperação

- Estado, frequências, configurações, aprovações e sessões de upload ficam no PostgreSQL. Redis com AOF mantém o scheduler e os trabalhos BullMQ. Um scheduler único produz ciclos a cada 10 segundos; um worker processa as publicações com concorrência global igual a um. O intervalo entre uploads automáticos conta a partir da confirmação do envio anterior.
- Eventos repetidos e cópias com o mesmo SHA-256 não criam uma segunda entrega para o mesmo canal do mesmo motor. IDs de conta do motor local e do Postiz são distintos; trocar o motor não deduplica automaticamente um histórico publicado pelo outro serviço.
- No modo Postiz, depois de aceito no Postiz, o Watcher acompanha o ID existente e não recria posts excluídos ou editados manualmente.
- No modo Postiz, se uma criação ficar sem resposta ou um reinício ocorrer durante ela, o envio entra como **Conferir no Postiz**. Não há retry automático desse caso. Confira o calendário e use **Vincular post** para informar o ID encontrado; a aplicação verifica canal e intervalo antes de vincular.
- No motor local, **Revisar e aprovar** permite assistir à cópia preparada, editar título/descrição, escolher a visibilidade do YouTube e confirmar o envio. **Descartar envio** remove a cópia local de um vídeo ainda sem sessão externa e preserva o original. A cópia de revisão usa espaço em disco até ser enviada ou descartada.
- Uploads locais interrompidos consultam a sessão antes de enviar novos bytes. **Retomar sessão** usa a mesma sessão; uma sessão expirada ou ambígua não inicia outro vídeo automaticamente. No YouTube, **Vincular vídeo existente** verifica o canal antes de reconciliar um ID informado manualmente. A aprovação não é transferida para uma conta diferente.
- Falhas confirmadas podem receber nova tentativa pelo histórico. Erros de processamento de um vídeo já aceito devem ser corrigidos na plataforma correspondente.
- A publicação no TikTok é finalizada pelo usuário no aplicativo. No modo local, o arquivo vai à caixa de entrada com video.upload após a aprovação individual. `PUBLISHED` no Postiz também não comprova que um vídeo está publicamente visível.

Tokens e segredos salvos na interface são cifrados com AES-256-GCM. A chave está no `.env`; mantenha backup protegido dela e dos volumes. Não remova os volumes com `docker compose down -v` se quiser preservar o histórico. O painel não devolve os segredos salvos para o navegador.

## Desenvolvimento e verificações

Use Node.js 22 ou superior. A execução Docker usa Node 22 e não depende da versão padrão do host.

```bash
npm ci
npm run check
npm test
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres redis
npm run dev
```

O arquivo `compose.dev.yaml` expõe PostgreSQL/Redis somente em loopback para desenvolvimento. O Compose principal mantém os bancos sem portas no host. Evite iniciar o servidor de desenvolvimento na mesma porta da aplicação Docker.

```bash
./scripts/test-integration.sh
./scripts/test-ui.sh
```

Os testes de integração usam bancos `watcher_test` e `watcher_native_test`, Redis DBs 13–15 e diretórios temporários, com APIs simuladas, arquivos MP4 reais e testes de fila no Redis real. Eles não publicam em contas reais. O teste de interface usa o Chrome instalado e cria uma rotina temporária identificada como QA, removida pelo script ao encerrar. As imagens e os artefatos ficam ignorados pelo Git.

A [análise técnica inicial](docs/ANALISE-POSTIZ-DRIVE.md) foi preservada como referência. A implementação desta versão prioriza polling de pastas, frequência de importação configurável e execução local; não implementa o feed incremental de mudanças nem backfill posterior de baseline. O agendamento automático TikTok está disponível pelo navegador conforme o guia de agendamento nativo.

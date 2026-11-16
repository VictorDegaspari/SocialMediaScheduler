# Publicação fora do ambiente local

Status: **planejamento para um deploy futuro; há ajustes de código pendentes antes de expor o aplicativo na internet**. Este guia documenta a instalação atual e a preparação para Railway, com Vercel opcional para o frontend. Não representa um deploy já realizado.

Referência: código e documentação dos provedores consultados em **15/11/2026**. Revalidar as condições dos serviços na data da publicação.

## 1. Arquitetura recomendada para o primeiro deploy

Começar com o frontend e o backend no mesmo serviço Railway. O Express já serve a pasta `public/`, e o mesmo processo inicia o scheduler e o worker. Isso mantém painel, API e OAuth na mesma origem.

| Componente | Destino inicial | Observação |
| --- | --- | --- |
| Frontend, API Express, BullMQ e worker | Um serviço Railway usando o `Dockerfile` existente | Processo contínuo, com FFmpeg e ffprobe |
| PostgreSQL | Serviço de banco em rede privada | Histórico, horários, aprovações, claims, tokens e sessões cifradas |
| Redis | Serviço em rede privada, com persistência | Scheduler e trabalhos BullMQ; configurar `noeviction` |
| Cópias de vídeo e revisões | Volume persistente em `/app/data` | Necessário para retomar uploads e exibir prévias após deploys |
| Frontend separado, se desejado | Vercel servindo `public/` | Depende dos ajustes de proxy, autenticação e OAuth descritos abaixo |

Na nuvem, as rotinas do Drive podem funcionar com o PC desligado, desde que aplicação, banco, Redis e autorizações estejam disponíveis. A origem de arquivos do PC precisa de uma solução própria, descrita na seção 7.

## 2. Pendências do código antes de liberar acesso público

| Item | Situação atual | Trabalho necessário |
| --- | --- | --- |
| Login e autorização | Não existe login de administrador | Proteger painel, API, vídeos de revisão e alterações de configuração; para uso pessoal, restringir ao proprietário |
| Host, Origin e proteção de requisições | Existem verificações locais em `src/server.ts` | Adaptar para os domínios escolhidos e proxy confiável; essas verificações e `X-Watcher-Request` não autenticam usuários |
| Healthcheck Railway | `/api/health` verifica banco, Redis e início do worker | Aceitar o Host do healthcheck somente nessa rota e validar pela porta real do serviço |
| Frontend na Vercel | Usa `/api/...`, `/auth/...` e prévias na mesma origem | Configurar encaminhamento e revisar cookies, redirects, CSP e política de cache |
| Volume com usuário não root | Imagem executa como usuário `node` | Garantir escrita no volume montado durante a execução; permissões criadas no build não garantem acesso ao volume |
| Banco e inicialização | `initDb()` aplica alterações aditivas ao iniciar | Revisar a migração da versão a publicar, ter backup e verificar inicialização com dependências disponíveis |
| Origem de vídeos na nuvem | Drive e diretório acessível ao processo | Escolher Drive, diretório do servidor, upload ou agente local; os dois últimos ainda precisam ser implementados |
| Textos do painel | Referem-se a execução no PC | Adaptar a apresentação para distinguir arquivos do servidor, arquivos do PC e execução na nuvem |

Proteger apenas o frontend não protege uma API Railway acessível diretamente. A autenticação precisa ser validada no backend ou em uma entrada que ele aceite exclusivamente. Tratar as rotas OAuth e o healthcheck com exceções estritas, preservando a validação de state e dos cookies.

## 3. Configuração do serviço Railway

Usar o `Dockerfile` da raiz para preservar Node.js, FFmpeg e ffprobe. O comando de execução atual é `node dist/server.js`.

O servidor deve escutar em `0.0.0.0` e na variável `PORT` fornecida pelo ambiente. Esses parâmetros já são lidos pelo aplicativo; conferir o roteamento e qualquer verificação que ainda use a porta local 4317.

| Variável | Configuração esperada no servidor |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | Porta atribuída/configurada no Railway |
| `APP_URL` | Origem pública HTTPS estável, por exemplo `https://scheduler.example.com`, sem caminho de API |
| `DATABASE_URL` | Conexão privada do PostgreSQL de produção |
| `REDIS_URL` | Conexão privada do Redis de produção; respeitar autenticação e TLS do serviço escolhido |
| `ENCRYPTION_KEY` | Chave de 32 bytes em 64 caracteres hexadecimais; preservar a existente se migrar os dados cifrados |
| `DATA_DIR` | `/app/data`, dentro do volume persistente |
| `LOCAL_MEDIA_DIR` | Se usar origem em disco no servidor, um diretório separado, como `/app/data/entrada`, previamente criado e acessível |
| `LOCAL_MEDIA_HOST_DIR` | Caminho exibido no painel; na nuvem pode acompanhar `/app/data/entrada` |
| `LOG_LEVEL` | `info`, ajustável conforme a operação |

Os exemplos de domínio e diretório são ilustrativos. `DATABASE_URL`, `REDIS_URL` e `ENCRYPTION_KEY` devem ser cadastrados como segredos do serviço. Client ID/Secret do Google e Client Key/Secret do TikTok são salvos pela tela **Conexões** e cifrados no banco; não há variáveis OAuth correspondentes implementadas para provisionamento automático.

No Compose local, `LOCAL_MEDIA_DIR` no `.env` representa a pasta do host que será montada no container. No processo hospedado diretamente no Railway, a variável representa um caminho que existe dentro do servidor. Não copiar um caminho `/home/victor/...` para produção esperando acesso ao PC.

### Execução contínua e encerramento

- Manter o serviço do worker ativo e desabilitar **Serverless/App Sleeping**. Os horários dependem do processo que consome a fila. [Funcionamento da suspensão Railway](https://docs.railway.com/deployments/serverless).
- Começar com uma instância da aplicação. O código usa bloqueios PostgreSQL e concorrência global BullMQ igual a um, mas as cópias de vídeo também precisam estar acessíveis ao processo que recebe cada trabalho.
- Configurar tempo de encerramento para o tratamento existente de `SIGTERM`. No Railway, verificar `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`; 90 segundos é uma referência inicial coerente com o Compose local, não uma garantia de concluir um upload grande. [Encerramento de deploys](https://docs.railway.com/deployments/reference).
- Um upload interrompido deve retomar pela sessão salva. Não remover entregas, claims ou sessões para liberar um trabalho sem confirmação.

### Healthcheck

Configurar `/api/health` na porta efetiva do serviço. A lista atual de Hosts não inclui `healthcheck.railway.app`, usado pelo Railway; esse é um ajuste de código pendente. Não ampliar essa exceção para rotas de configuração ou publicação. [Host e porta do healthcheck](https://docs.railway.com/deployments/healthchecks).

O endpoint atual indica banco acessível, Redis conectado e ao menos um ciclo iniciado. Ele não confirma aprovação das APIs sociais nem detecta sozinho todos os casos de worker travado; verificar também a evolução do heartbeat e das entregas.

## 4. Persistência, permissões e backups

Os arquivos `<uuid>.native.mp4` em `DATA_DIR` são cópias associadas a entregas, não apenas arquivos temporários descartáveis. Vídeos em revisão e uploads interrompidos podem depender deles. Não usar somente o disco efêmero do deploy.

Separar a origem em disco do spool: por exemplo, `/app/data/entrada` para arquivos de entrada e `/app/data` para as cópias geradas. Não cadastrar o próprio spool como pasta recursiva de origem, pois isso faria a descoberta encontrar cópias produzidas pelo aplicativo.

A imagem usa `USER node`; preparar e validar as permissões do volume montado antes de ativar as rotinas. A documentação Railway descreve restrições para volumes e imagens não root. A configuração atual de volume também exige uma única instância e pode ter uma breve indisponibilidade no redeploy. [Referência de volumes](https://docs.railway.com/volumes/reference).

Para backup e restauração, preservar em conjunto:

- PostgreSQL: histórico, configurações cifradas, aprovações, claims e sessões.
- `ENCRYPTION_KEY`: sem ela, os dados cifrados do banco não podem ser lidos.
- Volume `DATA_DIR`: cópias necessárias às entregas em revisão ou pendentes.
- Redis persistente: scheduler e fila. Em uma substituição/esvaziamento do Redis, reiniciar a aplicação para recriar o Job Scheduler e redescobrir os trabalhos pendentes no PostgreSQL.

Não manter a mesma fila/banco de produção sendo consumidos simultaneamente pelo PC e pelo servidor. O bloqueio de concorrência não compartilha os arquivos entre máquinas. Se, futuramente, API e worker forem serviços distintos ou tiverem réplicas, implementar armazenamento compartilhado e referências de mídia adequadas antes de separá-los.

Dimensionar disco para revisões acumuladas, cópias por destino e preparação do vídeo. Monitorar espaço, memória, processamento FFmpeg e tráfego de envio; remover uma revisão pelo painel não deve remover o original.

## 5. Caso o frontend seja publicado na Vercel

O frontend atual é estático em `public/`. O processo Node contínuo, BullMQ e o processamento de vídeo permanecem no Railway nessa arquitetura.

Preferir uma origem pública estável para o navegador, com encaminhamento preservando os caminhos:

| Caminho público | Destino no backend Railway |
| --- | --- |
| `/api/*` | `/api/*`, incluindo as prévias de vídeo |
| `/auth/*` | `/auth/*`, incluindo início e retorno do OAuth |

A Vercel oferece [rewrites para origens externas](https://vercel.com/docs/routing/rewrites). Criar apenas o rewrite não resolve a integração: o backend atual compara o Host recebido com `APP_URL` e pode responder 403 ou redirecionar o início do OAuth repetidamente. Definir Hosts aceitos e encaminhamento confiável de domínio/protocolo; não confiar em headers de proxy enviados por qualquer cliente.

Verificar estes pontos durante a adaptação:

- Login válido na API mesmo quando o domínio direto Railway é acessado.
- Cookies HttpOnly/Secure e SameSite compatíveis com o fluxo OAuth, preservando state de uso único.
- Redirects retornando ao frontend correto e callback cadastrado na mesma origem escolhida para o fluxo.
- Requisições e respostas privadas sem cache de CDN; o backend já envia `Cache-Control: no-store` na API, que precisa ser preservado pelo proxy.
- Prévia de MP4 com encaminhamento de `Range` e respostas parciais, sem incluir vídeos privados nos arquivos estáticos da Vercel.
- Se forem usadas origens distintas sem proxy, implementar a URL da API no frontend e ajustar CORS, CSP, cookies e proteção das mutações. Esse modo ainda não está implementado.
- Nenhum segredo de banco, Redis, OAuth ou criptografia no JavaScript entregue ao navegador. Se o proxy precisar de segredo de origem, ele deve ficar apenas na configuração do servidor/proxy.

Um futuro upload de vídeos do navegador deve enviar os bytes diretamente ao backend ou ao armazenamento adequado. Não encaminhar arquivos grandes por uma Vercel Function convencional sem rever os limites; a documentação atual informa limite de 4,5 MB para o corpo de requisição de Functions. Rewrites externos têm regras próprias e devem ser avaliados separadamente. [Limites de Functions](https://vercel.com/docs/functions/limitations).

Não há `vercel.json` nem configuração Railway de produção entregues como parte deste guia. Prepará-los depois de resolver os bloqueios da seção 2 e definir o domínio.

## 6. Domínio e OAuth de produção

Com `APP_URL=https://scheduler.example.com`, cadastrar os callbacks correspondentes nos portais das plataformas:

```text
https://scheduler.example.com/auth/youtube/callback
https://scheduler.example.com/auth/google/callback
https://scheduler.example.com/auth/tiktok/callback
```

Manter o domínio fixo; URLs de preview de cada deploy não devem ser usadas como origem OAuth de produção. Os callbacks localhost podem continuar no cliente Google usado para desenvolvimento, conforme as regras do provedor. Se separar clientes/aplicativos por ambiente, cada ambiente precisará de sua própria autorização.

| Plataforma | Preparação |
| --- | --- |
| YouTube | YouTube Data API v3 habilitada, cliente OAuth Web, permissões `youtube.upload` e `youtube.readonly` e canal verificado pela conexão do aplicativo |
| Google Drive, opcional | Drive API habilitada, cliente OAuth Web e autorização `drive.readonly` para a conta com acesso aos arquivos |
| TikTok | Login Kit Web, Content Posting API, callback HTTPS e autorização real de `user.info.basic` e `video.upload`; atender à revisão e às exigências do portal |

O modo de testes do consentimento Google pode exigir usuários cadastrados e reconexões periódicas. Publicar o site não altera automaticamente o status de verificação dos aplicativos OAuth. [OAuth Google](https://developers.google.com/identity/protocols/oauth2/web-server).

O aplicativo local também oferece **Login Kit Desktop**, que aceita callback HTTP em localhost com porta e PKCE. Esse modo não é o callback do servidor público: ao migrar para um domínio, selecionar **Web** em Conexões e autorizar novamente o TikTok após cadastrar o callback HTTPS. [Contrato Desktop](https://developers.tiktok.com/docs/en/login-kit-desktop).

O TikTok mantém o fluxo de envio para caixa de entrada, com aprovação por vídeo e conclusão no aplicativo. HTTPS, hospedagem e credenciais não concedem por si só a permissão de upload ou Direct Post. [Login Kit Web](https://developers.tiktok.com/docs/en/login-kit-web), [requisitos do upload](https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content).

## 7. Vídeos que estão no computador

O servidor Railway não acessa automaticamente a pasta `media/` do PC. Na nuvem, **Pasta local** se refere ao disco do servidor.

| Opção | Situação |
| --- | --- |
| Sincronizar os vídeos e JSONs com Google Drive | Origem já implementada; opção inicial mais simples para o serviço hospedado |
| Ler uma pasta existente no servidor | Adaptador já implementado; provisionamento e alimentação dessa pasta precisam ser definidos |
| Enviar vídeos por upload no painel | Ainda não implementado; definir armazenamento, limites e autorização |
| Manter agente no PC para encaminhar arquivos ao servidor | Ainda não implementado; precisa de autenticação, fila de transferência e tratamento de desconexões |

Não expor pastas do PC diretamente na internet. Se a exigência continuar sendo ler o disco local sem sincronização, manter o processamento local até implementar o agente ou outro transporte apropriado.

## 8. Roteiro de migração

1. Concluir os ajustes de autenticação, domínio, proxy e healthcheck e validar em ambiente separado.
2. Pausar as rotinas locais e conferir as entregas em revisão, pendentes e sem confirmação. Impedir consumo concorrente na origem e no destino durante a transferência.
3. Fazer backup consistente do banco, da chave de criptografia e das cópias persistentes de mídia. Guardar os segredos fora do Git.
4. Criar os serviços, rede privada, volume e domínio HTTPS no Railway. Restaurar os dados ainda com o scheduler pausado.
5. Preservar a `ENCRYPTION_KEY` se restaurar os dados cifrados. Configurar as conexões de produção e validar escrita/leitura do volume com o usuário da aplicação.
6. Ajustar e testar os callbacks OAuth; revisar a identidade dos canais. Não presumir que uma conta diferente pode consumir entregas já aprovadas.
7. Revisar as rotinas de pasta local: IDs incorporam a raiz configurada e não são reapontados silenciosamente. Pausar as rotinas antigas e criar as origens apropriadas no destino, conferindo baseline e deduplicação.
8. Validar uma rotina controlada, com YouTube privado ou revisão local. Confirmar prévia, metadados, sessão de upload, status e horário de São Paulo.
9. Simular um reinício/redeploy com uma entrega pendente e confirmar retomada sem criar outro vídeo. Verificar também uma restauração de backup antes de depender dela.
10. Retomar a operação somente no destino escolhido e acompanhar heartbeat, fila, erros e espaço em disco.

## 9. Critérios para considerar o deploy pronto

- [ ] Painel, API e prévias exigem autenticação; o domínio direto do backend não contorna a proteção.
- [ ] Domínio HTTPS, Hosts, Origin, cookies, CSP e encaminhamento OAuth foram validados.
- [ ] Serviço escuta na porta do provedor e passa no healthcheck Railway.
- [ ] Scheduler permanece ativo sem navegador aberto e com o PC desligado para origens em nuvem.
- [ ] Redis e PostgreSQL são acessíveis pela rede privada e têm recuperação definida.
- [ ] `DATA_DIR` persiste no redeploy e tem permissões adequadas; a origem não inclui o spool.
- [ ] Banco, chave e mídia foram restaurados em teste com sucesso.
- [ ] Upload interrompido retoma pela mesma sessão; resultado ambíguo continua bloqueado contra criação cega.
- [ ] Canais, permissões, visibilidade YouTube e consentimento TikTok foram conferidos.
- [ ] A origem dos vídeos do PC foi definida; não há dependência de um caminho local inacessível ao servidor.
- [ ] Ambiente local/testes não consome as mesmas entregas da produção.

As marcações acima permanecem pendentes até o deploy ser implementado e verificado. Para o funcionamento atual das filas, consultar [MOTOR-LOCAL.md](MOTOR-LOCAL.md); para iniciar o ambiente local, consultar o [README](../README.md).


## TikTok pelo navegador

A tela TikTok navegador depende do agente Ubuntu e de uma sessão gráfica local. O agente usa somente o endereço loopback do painel e autentica comandos com `BROWSER_AGENT_TOKEN`, gerado privadamente no `.env`. Perfil, cookies e journal de conteúdo ficam em `.browser-data/` no computador. Não copie esses dados para o frontend ou para uma imagem Docker.

A implantação do site estático na Vercel não fornece esse agente. A implantação do backend na Railway também não abre uma janela no PC do usuário. Para usar o navegador com backend externo, seria necessário desenvolver e revisar uma conexão de agente remoto com autenticação e isolamento adequados; o agente desta versão recusa endereços fora do computador. O painel público continua exigindo autenticação antes de disponibilizar comandos.

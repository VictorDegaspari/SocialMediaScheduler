# TikTok Studio pelo navegador — experimental

Esta opção usa Playwright e uma janela real do Google Chrome no computador. No modo padrão de revisão, seleciona um vídeo local, aguarda o editor e preenche a legenda, sem clicar em Publicar. O painel também oferece **Agendar lote dentro do TikTok Studio**, que reserva datas, preenche o agendador nativo e confirma pelo botão Agendar. Veja [Agendamento nativo: configuração, limites e datas](AGENDAMENTO-NATIVO.md). As instruções seguintes descrevem o modo de revisão, salvo indicação explícita. O modo padrão da aplicação continua sendo a integração por API.

O script não precisa de client key ou aprovação de escopo OAuth TikTok: usa uma sessão de login no site. Isso não representa aprovação do TikTok para automação do navegador, não equivale a Direct Post e não remove restrições da plataforma. A interface pode mudar ou apresentar verificações. CAPTCHA e pedidos de autenticação interrompem a automação; precisam ser resolvidos por você, sem mecanismos de evasão.

Ao clicar em **Autorizar e postar agora**, tanto em um corte quanto em um vídeo das pastas, o painel abre **TikTok pelo navegador** para acompanhar o andamento. O agente abre o Chrome visível controlado pelo Playwright, preserva o perfil escolhido e publica a cópia revisada. As escolhas de **parceria paga**, **minha marca**, permissões e IA são conferidas nos controles do Studio; marcar conteúdo comercial não bloqueia mais o formulário. Se os controles esperados não estiverem disponíveis, a janela permanece aberta para revisão e o app não registra uma publicação sem confirmação.

## Usar pelo painel local

Para publicar um vídeo específico sem agendar, use **Postar agora no TikTok**. Escolha **Cortes do aplicativo** ou **Vídeos das minhas pastas**, selecione o perfil e abra a prévia. Um MP4 já encontrado em Minhas pastas pode ser revisado mesmo sem JSON: preencha o título e a legenda nessa etapa. Confira também permissões e declarações antes de **Autorizar e postar agora**. A preparação da prévia não inicia upload. Esse envio é individual e não altera os horários da rotina; a publicação pública só é registrada após uma confirmação nova do TikTok Studio. Login, limites da conta ou uma confirmação incerta ficam visíveis no painel e no histórico.

Os cortes também ficam em **Minhas pastas → Cortes do aplicativo**, com reprodução, download e o botão **Postar no TikTok**. O arquivo revisado é copiado para o envio sem reduzir a qualidade. Um corte pode ter envios independentes para YouTube e TikTok; a repetição para a mesma conta reutiliza o envio existente.

Abra **http://localhost:4317/#browser**, pela opção **TikTok navegador** do menu ou pelo atalho em Conexões. Todos os controles desta rotina ficam nessa tela:

1. **Abrir login do TikTok:** o agente abre um Chrome comum no Ubuntu. Entre manualmente, preferencialmente por QR code, confira a conta e feche as janelas desse perfil.
2. **Pasta dos vídeos:** escolha a raiz local exibida ou uma subpasta. Coloque MP4 e JSON opcional nessa origem. O padrão é a raiz montada no aplicativo, normalmente `media/`.
3. **Pasta e horários:** escolha horários diários, inicialmente `08:00, 20:00`, ou intervalo em minutos. Marque a ativação da rotina automática e clique em **Salvar rotina do navegador**. O fuso é America/Sao_Paulo.
4. **Enviar próximo agora:** salva os campos da tela e solicita uma tentativa imediata, mesmo com a rotina automática desativada. A pausa global do aplicativo impede envios até ser retomada.
5. **Pausar rotina do navegador:** impede novas oportunidades e cancela tarefas automáticas ainda não iniciadas. **Interromper tarefa** também pede que o agente encerre a tarefa atual; um arquivo já transferido precisa ser conferido no TikTok.
6. **Atividades do navegador:** acompanhe fila, andamento, falta de vídeo, login solicitado e erros. “Preparado no Chrome” não significa publicado. Confira e clique em Publicar na janela do TikTok.

O agente mostra se está conectado, se o computador tem sessão gráfica e se o perfil já está ocupado por outra janela ou rotina. A presença do perfil não comprova autenticação válida. Conclua e feche janelas anteriores para liberar os controles; a tela atualiza o estado periodicamente.

A configuração e as tarefas do painel persistem em PostgreSQL. O worker existente, acionado por BullMQ/Redis, calcula as oportunidades; o agente não cria outro scheduler. Ele consulta comandos pelo endereço local do aplicativo com uma chave privada gerada em `.env`, sem abrir porta de controle no computador nem expor a chave ao frontend. Pastas são validadas no backend e no agente contra a raiz local configurada.

Se não houver vídeo novo, a oportunidade aguarda e a pasta é consultada novamente após pelo menos 30 segundos. Enquanto uma tarefa estiver aberta, outra não é iniciada. Ao perder o controle do agente durante uma transferência, o backend registra resultado desconhecido e não repete aquela tarefa automaticamente. O histórico por hash do script também evita reenviar o mesmo conteúdo.

## Agente no Ubuntu

`./scripts/start.sh` gera a chave local, inicia os containers e instala/atualiza **drive-watcher-browser-agent.service** no systemd do usuário quando há sessão gráfica, Google Chrome e dependências locais disponíveis. O agente inicia com a sessão gráfica e encerra com ela. Não recebe sua senha nem usa o perfil habitual do Chrome.

Se o agente estiver desconectado, execute na pasta do projeto:

```bash
./scripts/start-browser-agent.sh
systemctl --user status drive-watcher-browser-agent.service
```

O serviço precisa de Node 22+, `node_modules` com as dependências de desenvolvimento e Chrome no Ubuntu. O wrapper encontra um Node compatível no NVM. Para acompanhar os logs, use `journalctl --user -u drive-watcher-browser-agent.service -f`. `./scripts/stop.sh` também para o agente. Alterações em `.env` passam a valer após reiniciar o aplicativo/agente.

Esta integração é local: o agente aceita somente o endereço loopback do painel. Uma implantação em Railway/Vercel não abre o Chrome do usuário e exige uma arquitetura de agente/autenticação própria antes de habilitar esses comandos remotamente.

## Token da extensão Playwright MCP

Em **Conexões → TikTok → Token de automação do TikTok**, cole o valor de **PLAYWRIGHT_MCP_EXTENSION_TOKEN** mostrado pela extensão do seu navegador e clique em **Salvar token**. O valor é criptografado no PostgreSQL e o painel exibe somente se está configurado. Deixar o campo vazio mantém o token; **Remover token salvo** permite voltar ao valor opcional do ambiente. O valor do painel tem prioridade sobre `PLAYWRIGHT_MCP_EXTENSION_TOKEN` no `.env`. O token é obrigatório para adicionar perfis TikTok, abrir login, salvar rotinas e iniciar novos envios, incluindo cortes e vídeos das pastas. Sem ele, tarefas pendentes aguardam; pausas e cancelamentos continuam disponíveis. O agente lê o token salvo antes de iniciar cada tarefa e o transmite ao processo do navegador somente pelo ambiente, sem incluí-lo em comandos ou respostas públicas.

O agente de publicação do TikTok autentica seu acesso ao painel com `BROWSER_AGENT_TOKEN`. O token da extensão pertence à conexão entre o servidor MCP e seu perfil do Chrome, conforme a [documentação oficial do Playwright](https://github.com/microsoft/playwright/blob/main/packages/extension/README.md).

Para iniciar o MCP usando o token do painel:

```bash
./scripts/node-local.sh scripts/playwright-mcp.mjs
```

O inicializador consulta a configuração atual com a chave do agente e passa o token somente pelo ambiente do processo Playwright MCP. Ele usa `@playwright/mcp@0.0.85 --extension`; o primeiro uso pode baixar esse pacote pelo npx. Para um cliente MCP com transporte stdio, configure o caminho absoluto de `scripts/node-local.sh` como comando e `["scripts/playwright-mcp.mjs"]` como argumentos. Reinicie a conexão MCP após trocar o token no painel. O `.env` continua opcional para esse token; novos valores podem ser cadastrados pela interface.

Para os comandos diretos abaixo, forneça `PLAYWRIGHT_MCP_EXTENSION_TOKEN` no ambiente. O uso pelo painel carrega automaticamente o valor criptografado no banco.

## Comandos diretos para diagnóstico

O uso normal é pelo painel. Os comandos abaixo continuam disponíveis para diagnóstico e uso avançado. Eles compartilham o perfil e o histórico de conteúdo com o agente; não execute duas rotinas simultâneas nesse perfil.

## Preparação

Execute no Ubuntu com sessão gráfica aberta, Google Chrome, FFmpeg/ffprobe, dependências do projeto instaladas e Node 22+. A instalação local deve ter sido iniciada ao menos uma vez com `./scripts/start.sh`, para criar o ambiente local. O wrapper encontra um Node compatível instalado pelo NVM, inclusive quando o `node` padrão do terminal é antigo. Ele não instala programas nem altera sua configuração do Node.

Na pasta `/home/victor/Desktop/projects/drive-watcher`:

```bash
./scripts/tiktok-browser.sh --login
```

O comando abre o Chrome como um processo comum, **sem controle do Playwright e sem porta de depuração**. Faça login manualmente, confira a conta e feche **todas as janelas desse perfil** antes de iniciar o upload. O Playwright só abre o perfil na etapa de preparação do vídeo e preserva o uso do chaveiro do sistema para ler a sessão salva pelo Chrome. A sessão fica em um perfil exclusivo, sem ler nem copiar cookies do seu Chrome habitual. O programa não pede sua senha no terminal.

### Google: “This browser or app may not be secure”

O Google pode impedir login em navegadores controlados por software. Esse erro durante “Continuar com Google” não se resolve trocando as chaves OAuth do painel. O modo `--login` abre agora o Chrome sem controle da automação para a autenticação manual. Isso não garante aceitação pelo provedor: a decisão continua sendo dele. [Orientação oficial do Google](https://support.google.com/accounts/answer/7675428?hl=pt-BR).

No TikTok, você pode escolher **Usar código QR / Use QR code** e confirmar com sua conta no aplicativo do celular, ou usar o acesso por telefone/e-mail/usuário quando disponível. Prefira o QR code se não precisar do login Google. Nenhuma senha deve ser informada ao script.

Se o erro aparecer na etapa de upload, a rotina interrompe a preparação antes de selecionar o arquivo e orienta a refazer o login manual. Não tenta autenticar automaticamente, alterar a identificação do navegador ou desativar verificações de segurança. Se o provedor continuar recusando o acesso manual, utilize as opções oficiais de login e recuperação da conta.

Perfil, histórico e arquivos de trabalho ficam em **`.browser-data/tiktok/`**, protegidos por diretório com modo 0700 e excluídos do Git e do contexto Docker. Cookies são credenciais de sessão: não compartilhe essa pasta nem a envie em backups públicos. Tokens OAuth do painel e cookies do navegador são mecanismos separados.

## Vídeos escolhidos automaticamente

Salve vídeos em `media/` ou suas subpastas. O padrão é a pasta `media/` deste repositório, independentemente de outra raiz configurada no painel. Para escolher outra raiz explicitamente, use `--folder /caminho/desejado`.

```text
media/
  meu-canal/
    video-001.mp4
    video-001.json
```

Não é necessário decidir um nome no código: a rotina escolhe o MP4 estável mais antigo, pela data de modificação, que ainda não tenha registro de transferência. Arquivos e JSON precisam permanecer sem modificação por pelo menos 30 segundos. Links simbólicos são ignorados. Pastas como `artifacts/`, que contêm amostras técnicas, ficam fora da origem padrão.

O fluxo reaproveita o adaptador de arquivos, a validação de MP4 e a preparação de mídia da aplicação: vídeos verticais ou quadrados, até 3 minutos e 1 GiB. Não altera os originais. A cópia é conferida contra a versão da origem antes da preparação.

O JSON usa o mesmo formato de `examples/video-001.json`. Sem JSON, o nome do arquivo vira o título. A legenda reúne título, descrição e hashtags; acima de 2.200 caracteres, a rotina pede correção em vez de truncar. `ready=false` e uma lista `targets` sem `tiktok` mantêm o arquivo fora dos envios.

A limpeza de tags descritivas está ativa por padrão; `--keep-metadata` a desativa. Ela não é uma forma de evitar detecção de IA. O JSON é preservado e `tiktok.madeWithAI` aparece no registro da preparação para orientar a revisão. O script não marca rótulos de IA automaticamente no site: você precisa conferir a opção real no TikTok antes de publicar.

## Enviar o próximo vídeo agora

```bash
./scripts/tiktok-browser.sh --once
```

O horário desse comando é o início da tentativa; o processamento e o upload levam o tempo necessário. Se não houver MP4 novo e estável, ele informa isso e termina sem abrir uma janela ou selecionar uma amostra de teste.

Ao encontrar um vídeo, a rotina abre o TikTok Studio com o perfil salvo, seleciona o arquivo, preenche a legenda e aguarda o botão de publicação ficar disponível. A janela fica aberta para revisão e publicação manual. Feche-a ao concluir para liberar o processo. Não confunda `review` com vídeo publicado: o programa não confirma publicação final nem registra uma URL remota.

## Manter uma rotina enquanto o PC estiver ligado

```bash
# Procura um vídeo imediatamente; depois, oportunidades às 08:00 e 20:00.
./scripts/tiktok-browser.sh --watch --run-now

# Ou um vídeo a cada duas horas, começando agora.
./scripts/tiktok-browser.sh --watch --run-now --every-minutes 120

# Horários diários diferentes, sempre em America/Sao_Paulo.
./scripts/tiktok-browser.sh --watch --at 09:00,18:00
```

Escolha **um comando**, sem iniciar várias rotinas com o mesmo perfil. Por padrão, `--watch` espera a próxima oportunidade. Com `--run-now`, a primeira oportunidade fica aberta até chegar um vídeo estável. A pasta vazia é verificada a cada 30 segundos. Após uma tentativa, o próximo horário é calculado a partir do momento em que a janela foi fechada, evitando uma sequência de envios acumulados.

O processo precisa continuar ativo, com a sessão gráfica disponível. Não basta deixar o container Docker ligado: esse script roda no **host** para usar a janela do Chrome. Ctrl+C encerra a rotina. Enquanto houver uma janela de revisão aberta, o processo não seleciona outro vídeo.

O comando avançado `--watch` conserva seu scheduler próprio para execução direta no terminal. Ao usar o painel, utilize somente o agente: os horários passam a ser controlados pelo scheduler Redis/Node existente. A rotina desta tela usa uma pasta local ou o pack do site. Os [pedidos finitos por perfil](ASSISTENTE-E-CONTAS.md) também recebem vídeos do Drive pela cópia preparada no backend. Não configure dois fluxos para enviar os mesmos vídeos TikTok ao mesmo tempo; a proteção por conteúdo do navegador não é compartilhada com as entregas das APIs.

## Histórico, falhas e repetição

```bash
./scripts/tiktok-browser.sh --status
```

O painel mantém configurações, comandos, prazos de execução e atividades no PostgreSQL. Tarefas vazias, canceladas ou de login encerrado podem ser removidas após 7 dias durante ciclos ativos; os demais resultados permanecem para conferência, sem prazo geral de expurgo automático. Esses dados não contêm cookies. Os logs do agente são JSON estruturado no journal do usuário.

Independentemente desse histórico de tarefas, os registros privados de `.browser-data/tiktok/jobs/` usam o SHA-256 do conteúdo original, com estados:

| Estado | Significado |
| --- | --- |
| `preparing` | Registro criado imediatamente antes da seleção do arquivo. |
| `review` | Editor preparado e botão disponível; exige conferência e publicação manual. |
| `unknown` | A seleção pode ter começado, mas o resultado não foi confirmado. Confira no TikTok. |

Uma interrupção durante a transferência vira `unknown` no próximo início. A rotina não reenvia automaticamente conteúdos já registrados, inclusive se o arquivo foi renomeado. O perfil tem trava de processo para impedir dois comandos simultâneos. Erros anteriores à transferência não consomem definitivamente o arquivo.

Não apague registros para repetir um envio sem antes conferir o TikTok Studio. Apagar o histórico elimina a proteção contra duplicados; apagar o perfil exige novo login. O script mantém resultados de revisão e falha para conferência, sem prometer eliminação automática por prazo. Cópias de trabalho são removidas ao encerrar a tentativa normalmente; uma parada abrupta do sistema pode exigir limpar cópias órfãs de `work/` após conferir que não há tarefa ativa.

## Validação desta entrega

- Campo de arquivo observado na página real `https://www.tiktok.com/tiktokstudio/upload`.
- Testes com Chrome e arquivos locais: seleção do vídeo, legenda, botão disponível, ausência de clique em Publicar, bloqueio por login/CAPTCHA e falha quando o editor muda.
- Testes de persistência, claims concorrentes, deduplicação, estabilidade do arquivo e preservação das declarações no JSON.
- Testes do painel: pasta, horários, intervalo, pausa, login, envio imediato, interrupção e estados offline/ocupado. Comandos de interface simulados para não acionar contas reais.
- Integração do agente com fila autenticada, pausa global, concorrência, perda de conexão, interrupção e rejeição de origem fora da pasta local autorizada.
- Teste local de continuidade de sessão entre Chrome comum e Playwright, sem exportação de cookies; teste de interrupção diante do bloqueio Google, inclusive em uma janela de login separada. O teste usa um servidor local e não comprova aceitação de login pelo Google/TikTok.
- Nenhum vídeo pessoal enviado ou publicado na implementação: `media/` estava vazia. A amostra técnica fica restrita aos testes locais.

Fontes: [Playwright — upload de arquivos](https://playwright.dev/docs/input#upload-files), [Playwright — perfil persistente](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context), [segurança do estado autenticado](https://playwright.dev/docs/auth).

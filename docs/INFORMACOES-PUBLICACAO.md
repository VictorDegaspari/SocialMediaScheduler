# Informações para publicar o site e cadastrar o aplicativo

Preparado em **15/11/2026**. Responsável e contato autorizados pelo proprietário: **Victor Degaspari — eshoputilities@gmail.com**.

## O que está pronto e qual é o limite do uso pessoal

O pacote `website/` contém sete páginas estáticas: apresentação, funcionamento, integrações, privacidade, termos, exclusão de dados e suporte. Inclui identidade visual, ícone PNG e configuração para Vercel. O site pode ser publicado independentemente do aplicativo local e não precisa de credenciais.

**O aplicativo é de uso pessoal, conforme confirmado pelo proprietário. As diretrizes atuais do TikTok não aprovam aplicativos destinados apenas a uso pessoal/privado em produção.** As regras específicas de Direct Post também excluem utilitários limitados às contas do desenvolvedor ou da equipe. Publicar um site e preencher os campos não remove esse impedimento. Não declare público, disponibilidade comercial ou usuários que o produto não tem. [Critérios de revisão](https://developers.tiktok.com/docs/en/app-review-guidelines), [regras de Direct Post](https://developers.tiktok.com/docs/en/content-sharing-guidelines).

Para o objetivo pessoal:

- **YouTube:** o aplicativo já tem envio pela API oficial, com OAuth e autorização de automação. Visibilidade padrão da aplicação: privada; configure o JSON conscientemente. Cotas, processamento e limitações da conta/projeto continuam aplicáveis.
- **TikTok atual:** revisão individual, upload à caixa de entrada e conclusão no aplicativo, quando o ambiente e os escopos estiverem disponíveis para a conta.
- **TikTok Direct Post sem auditoria:** existe um modo de testes restrito a conteúdo privado, contas privadas e demais limites do provedor. Não está implementado neste projeto e não resolve publicação pública sem intervenção. Exige produto/escopo e consentimento compatíveis; não basta um client secret.
- **TikTok público por agendamento:** avaliar um serviço cuja integração já esteja aprovada e que permita publicação direta para a conta desejada. Verifique o modo real, as permissões e as exigências de revisão desse serviço. Instalar Postiz ou possuir uma chave API, isoladamente, não comprova aprovação.

Existe também uma [rotina experimental pelo navegador](TIKTOK-NAVEGADOR.md), controlada pela tela TikTok navegador do painel local. Ela seleciona vídeos locais e prepara a legenda, com revisão e clique final em Publicar pelo usuário. O scheduler Node/Redis e o PostgreSQL mantêm os horários e tarefas; um agente autenticado no Ubuntu abre o Chrome. Essa opção não representa aprovação do TikTok para automação nem substitui requisitos de uma integração oficial. Redis e scheduler organizam a fila, mas não substituem a permissão de publicação das plataformas.

## Publicar somente o site na Vercel

Quando estes arquivos estiverem no GitHub, importe `VictorDegaspari/SocialMediaScheduler` na Vercel. Este trabalho não executa commit, push ou deploy.

| Configuração | Valor |
| --- | --- |
| Root Directory | `website` |
| Framework Preset | `Other` |
| Build Command | vazio, override habilitado |
| Install Command | vazio, override habilitado |
| Output Directory | `.` |
| Variáveis de ambiente | nenhuma |

O `website/vercel.json` também fixa build vazio, ausência de instalação e saída estática. Não inclua arquivos fora da Root Directory. Use um deploy de produção acessível publicamente, sem proteção por login para as páginas de apresentação e políticas. A Vercel documenta o modo estático em [Configuring a Build](https://vercel.com/docs/builds/configure-a-build).

Alternativa por CLI, executada pelo proprietário:

```bash
cd /home/victor/Desktop/projects/drive-watcher/website
npx vercel deploy --prod
```

Se usar o ZIP extraído, execute na pasta que contém `index.html` e `vercel.json`; ela será a raiz do projeto estático. Não configure um subdiretório inexistente. O ZIP não é um formato de importação pelo painel da Vercel: extraia antes de usar a CLI ou envie os arquivos ao repositório.

Copie a URL HTTPS de produção retornada pela Vercel. Abaixo, **`<URL_PUBLICADA>` é um marcador a substituir**, sem barra final. Nenhum endereço de deploy foi inventado ou reservado nesta entrega.

| Campo do portal | Valor após publicar |
| --- | --- |
| Web/Desktop URL / Official website | `<URL_PUBLICADA>/` |
| Privacy Policy URL | `<URL_PUBLICADA>/privacidade/` |
| Terms of Service URL | `<URL_PUBLICADA>/termos/` |
| Data deletion instructions, se solicitado | `<URL_PUBLICADA>/exclusao-de-dados/` |
| Support URL, se solicitado | `<URL_PUBLICADA>/suporte/` |
| App icon | `website/assets/app-icon.png` |

As páginas usam links internos no mesmo domínio e não precisam de alteração de código para o primeiro endereço Vercel. Depois de escolher um domínio definitivo, mantenha as URLs do cadastro consistentes com ele. Links de políticas estão visíveis no rodapé sem abrir o menu, inclusive no celular.

## Campos de identificação prontos para copiar

| Campo | Conteúdo |
| --- | --- |
| App name | `SocialMediaScheduler` |
| Nome do painel local | `Drive Watcher` — interface da mesma aplicação |
| Developer / Owner | `Victor Degaspari` |
| Contact / Support email | `eshoputilities@gmail.com` |
| Categoria, se houver opção correspondente | Produtividade / ferramentas de organização de conteúdo |
| Plataforma da instalação atual | Desktop |
| Produtos TikTok usados pelo código | Login Kit e Content Posting API — Upload to Inbox |
| Escopos TikTok usados pelo código | `user.info.basic`, `video.upload` |

Não selecionar Android/iOS: não há aplicativo móvel. Selecionar Web somente quando houver uma versão Web operacional com o callback correspondente. A existência de um site de apresentação não transforma a instalação local em serviço Web de publicação.

Descrição curta em português:

> Organize vídeos de pastas locais ou do Google Drive e configure rotinas de envio. YouTube com autorização; TikTok com revisão e conclusão no aplicativo.

Descrição curta em inglês:

> Organize videos from local folders or Google Drive. Schedule authorized YouTube uploads and review TikTok inbox uploads before completing posts in TikTok.

Descrição detalhada, fiel à versão atual:

> SocialMediaScheduler é uma aplicação de instalação própria para organizar meus vídeos e executar rotinas de envio. O painel local Drive Watcher monitora pastas locais ou do Google Drive, lê metadados JSON, evita duplicações e registra o processamento. O YouTube recebe vídeos por OAuth, com autorização explícita para automação e visibilidade privada como padrão. O fluxo TikTok exige prévia e consentimento para cada vídeo, envia o arquivo à caixa de entrada e pede que eu conclua a publicação no aplicativo TikTok. Não há Direct Post automático nem cadastro público de usuários na versão atual.

Essa descrição declara uso pessoal e, portanto, evidencia a restrição de aprovação em produção. Use-a para documentar a realidade; não a substitua por alegações de um produto público inexistente para tentar obter aprovação.

## Website HTTPS e callback Desktop são campos diferentes

O portal exige uma URL pública oficial tanto para Web quanto para Desktop. O Login Kit Desktop admite callback local com porta. A instalação implementa PKCE para esse modo. [Registro do aplicativo](https://developers.tiktok.com/docs/en/getting-started-create-an-app), [Login Kit Desktop](https://developers.tiktok.com/docs/en/login-kit-desktop).

| Serviço local | URI exata de retorno |
| --- | --- |
| TikTok Login Kit Desktop | `http://localhost:4317/auth/tiktok/callback` |
| Google Drive, cliente OAuth Web | `http://localhost:4317/auth/google/callback` |
| YouTube, cliente OAuth Web | `http://localhost:4317/auth/youtube/callback` |

Mantenha `APP_URL` da instalação local em `http://localhost:4317`. **Não use a URL do site estático como callback OAuth**: esse deploy não tem as rotas de autorização nem acesso ao banco. Não configure o callback Desktop na seção Login Kit Web. Se mudar host ou porta, use o endereço exato exibido pelo painel.

Para hospedar o próprio aplicativo no futuro, siga [DEPLOY-EXTERNO.md](DEPLOY-EXTERNO.md): autenticação, domínio, proxies, volumes e worker sempre ativo ainda precisam de tratamento. O futuro callback TikTok Web será HTTPS no backend e exigirá trocar o modo de login e reconectar a conta.

## Verificar propriedade das URLs no TikTok

O portal exige verificação das URLs de site, privacidade e termos para aplicativos novos em produção. Em **URL properties**, verifique o domínio ou o prefixo completo do site. Para um endereço Vercel, a opção por prefixo pode ser usada quando disponibilizada pelo portal. [Procedimento oficial](https://developers.tiktok.com/docs/en/getting-started-create-an-app#verify-url-ownership).

1. Informe o prefixo HTTPS público correto no portal.
2. Baixe o arquivo de assinatura fornecido pelo TikTok.
3. Copie esse arquivo para a raiz `website/`, mantendo **nome e conteúdo originais**.
4. Publique novamente e confira se o endereço indicado pelo portal entrega o arquivo sem login e sem reescrever seu conteúdo para HTML.
5. Conclua a verificação no portal. Verifique outras propriedades se forem solicitadas; não presuma que todas ficaram cobertas.

O arquivo de assinatura depende da sua conta/propriedade e só pode ser obtido no portal. Não foi criado um arquivo fictício nesta entrega. O código atual transfere vídeos por `FILE_UPLOAD`; não usa URLs públicas para buscar mídia.

## Justificativa dos produtos e escopos TikTok

Texto de referência em inglês, para documentação ou futura revisão de um produto que realmente atenda aos critérios:

**Login Kit / `user.info.basic`:**

> Login Kit lets the account owner authorize the installed application. The application checks the granted scopes and account identity, displays the connected account name, and binds uploads to that account. It does not request the account password.

**Content Posting API / `video.upload`:**

> The account owner previews each prepared video and explicitly confirms that individual upload. The application transfers the confirmed video file to the authorized TikTok account's inbox using FILE_UPLOAD. The account owner then opens the TikTok notification, reviews the caption, privacy and required disclosures, and completes the post in TikTok. The application does not use video.publish or automatic Direct Post.

O uso em Sandbox depende dos produtos, escopos e usuários de teste efetivamente disponibilizados pelo portal. Criar Sandbox não garante que todo o fluxo de publicação estará habilitado. Confira a configuração antes de conectar uma conta. [Sandbox oficial](https://developers.tiktok.com/docs/en/add-a-sandbox), [Upload to Inbox](https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content).

## Demonstração real para eventual revisão

O TikTok solicita demonstração de ponta a ponta dos produtos e escopos utilizados; para aplicativo ainda não aprovado, as diretrizes indicam demonstrar no Sandbox. Atualmente admite até cinco vídeos de até 50 MB cada. A captura ilustrativa incluída no site não substitui essa demonstração. [Requisitos de revisão](https://developers.tiktok.com/docs/en/app-review-guidelines).

Roteiro, quando o uso e o ambiente forem elegíveis:

1. Abra o site público e mostre funcionamento, políticas e contato.
2. Abra a instalação real; explique que o painel Drive Watcher pertence ao SocialMediaScheduler.
3. Demonstre o Login Kit real com usuário de teste permitido e a conta identificada após o retorno. Não grave client secrets ou tokens.
4. Adicione uma pasta de teste e um vídeo próprio, com metadados sem dados sensíveis.
5. Abra a revisão do vídeo, mostre a prévia, a conta de destino e o consentimento individual.
6. Confirme o upload e demonstre a notificação e a conclusão real no aplicativo TikTok, incluindo legenda e declarações necessárias.
7. Mostre como pausar e desconectar; identifique claramente o que aconteceu no ambiente de teste.

Não simule uma publicação bem-sucedida em gravação destinada a aprovação. Se o escopo ou endpoint não estiver disponível, registre a limitação e resolva no portal. Este trabalho não realizou publicação em conta social nem produziu vídeo de demonstração real.

## Google e YouTube

O site pode fornecer homepage e política pública para a tela de consentimento Google. Cadastre as URLs reais e mantenha os callbacks locais acima. A escolha de domínio autorizado e sua comprovação devem seguir as instruções do Google; para eventual verificação de domínio, use um domínio cujo controle você possa provar.

| Integração | Permissões efetivamente usadas |
| --- | --- |
| Google Drive | `https://www.googleapis.com/auth/drive.readonly` |
| YouTube | `https://www.googleapis.com/auth/youtube.upload` e `https://www.googleapis.com/auth/youtube.readonly` |

No Google Cloud, configure público Externo quando for uma conta pessoal e adicione a conta à lista de usuários de teste enquanto o projeto estiver em Testing. Salvar credenciais não concede autorização. A autorização Google em testes pode expirar e exigir reconexão.

O escopo Drive tem alcance de leitura amplo; o filtro por pasta é da aplicação. O YouTube identifica o canal conectado e envia vídeos. Não configure escopos extras para analytics, comentários ou contatos. Referências: [Google OAuth](https://developers.google.com/identity/protocols/oauth2), [upload YouTube](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert).

## Pendências antes de oferecer o aplicativo a outras pessoas

Publicar as páginas informativas é independente de tornar o aplicativo disponível ao público. A versão local ainda precisa de:

- Uso e produto elegíveis às regras dos provedores, sem presumir aprovação.
- Autenticação, isolamento de dados, controle de acesso e domínio/HTTPS para um backend público.
- Aceite informado de termos e política antes de conectar contas; os links públicos por si só não implementam esse fluxo no painel.
- Rotina de atualização/remoção de dados obtidos da API YouTube nos prazos aplicáveis, além de remoção mediante solicitação ou revogação. O worker atual não faz expurgo geral automático por conta. [Políticas YouTube](https://developers.google.com/youtube/terms/developer-policies).
- Processo operacional de exclusão e tratamento de backups. Veja [PROCEDIMENTO-EXCLUSAO.md](PROCEDIMENTO-EXCLUSAO.md).
- Credenciais e usuários de teste válidos, aprovação dos escopos necessários e demonstração real, conforme o provedor exigir.

O site não contém segredos ou IDs de clientes OAuth. A publicação do site não publica o painel nem altera o scheduler que roda no computador.

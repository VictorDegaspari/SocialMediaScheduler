# Site público do SocialMediaScheduler

Site estático, independente do painel local. Inclui apresentação, funcionamento, integrações, privacidade, termos, suporte e instruções de exclusão de dados.

Responsável e contato público autorizados: **Victor Degaspari**, **eshoputilities@gmail.com**.

## Publicar na Vercel

Importe o repositório `VictorDegaspari/SocialMediaScheduler` quando os arquivos estiverem enviados ao GitHub. Configure:

| Campo | Valor |
| --- | --- |
| Root Directory | `website` |
| Framework Preset | `Other` |
| Build Command | vazio, com override habilitado |
| Install Command | vazio, com override habilitado |
| Output Directory | `.` |
| Environment Variables | nenhuma |

O `vercel.json` já fixa esses parâmetros e adiciona cabeçalhos de segurança. Não use a raiz do repositório como raiz deste deploy. A pasta `public/` do projeto contém o painel da aplicação e não é este site.

Para publicar esta pasta por CLI, execute de dentro dela `npx vercel deploy --prod`, autentique-se e selecione o projeto correto. Se publicar um ZIP extraído sem a estrutura do repositório, a raiz é a pasta que contém este `index.html`; nesse caso não configure outro subdiretório `website`.

O site não usa segredos, backend ou conexão com o painel local. Não copie `.env`, volumes, tokens ou o banco para este deploy.

## Prévia local

Na raiz do projeto:

```bash
python3 -m http.server 4318 --bind 127.0.0.1 --directory website
```

Abra `http://127.0.0.1:4318`. Pare com Ctrl+C. Os cabeçalhos de `vercel.json` são aplicados pela Vercel; o servidor Python é apenas uma prévia estática.

## Arquivos e manutenção

- Edite os arquivos `index.html` das páginas e `assets/site.css` diretamente. Não há etapa de build.
- `assets/app-icon.png`: ícone próprio, PNG de 1024 × 1024 para cadastro de aplicativo.
- `assets/preview.png`: captura do painel com dados simulados, identificada como ilustrativa. Não serve como demonstração real para revisão de APIs.
- Cabeçalho e rodapé estão em cada HTML: mantenha navegação e políticas consistentes entre as páginas.
- O site não inclui analytics, scripts externos ou fontes remotas.

O guia completo de campos, URLs, verificação de propriedade e demonstração fica em `../docs/INFORMACOES-PUBLICACAO.md` no repositório.

**A publicação do site não libera a API TikTok.** O uso pessoal informado pelo proprietário não atende ao critério atual de aprovação para produção do TikTok. Use os ambientes de teste permitidos e não apresente o aplicativo como um serviço público que ainda não existe.

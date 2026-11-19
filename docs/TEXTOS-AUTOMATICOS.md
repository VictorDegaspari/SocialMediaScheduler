# Títulos, descrições, hashtags e tags

Em **Pedidos e contas → Perfis → Editar perfil → Títulos, descrição e hashtags**, configure o tema, as palavras-chave e o contexto editorial. A geração local fica habilitada por padrão e não usa serviços externos. Ela combina as informações do vídeo com a descrição padrão do perfil, normaliza hashtags e prepara tags próprias do YouTube. JSONs próprios e títulos já revisados continuam sendo a referência. Desative a opção para manter os metadados originais.

O título e o resumo vêm de nomes descritivos e de legendas disponíveis. O tema do perfil orienta palavras-chave, mas não comprova o que aparece em um vídeo. Arquivos como “Vídeo 0001” continuam exigindo revisão quando não há informações sobre seu conteúdo. Títulos revisados continuam vinculados à versão e ao hash do vídeo.

Use **Testar títulos, descrições e tags** para visualizar as duas plataformas antes de salvar. A prévia também fornece um prompt com contexto e contrato JSON para usar manualmente com uma IA. Ela não cria pedidos nem publica vídeos.

No gerador de cortes, o formulário de publicação já recebe sugestões locais a partir das legendas mantidas. Confira e edite título, descrição, hashtags e tags antes de autorizar. O botão **Gerar título, descrição e tags** permite refazer a sugestão; respostas atrasadas não substituem campos alterados enquanto a geração estava em andamento.

## Plataformas

- YouTube: título de até 100 unidades UTF-16; descrição com hashtags dentro de 5.000 bytes UTF-8; tags dentro de 500 caracteres, incluindo separadores e aspas nas expressões. As sugestões usam até cinco hashtags relevantes. [Referência oficial](https://developers.google.com/youtube/data/reference/rest/v3/videos).
- TikTok: título, descrição e hashtags são unidos em uma legenda dentro de 2.200 unidades UTF-16. As tags privadas do YouTube não entram nessa legenda. [Referência oficial](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post).

Textos gerados são ajustados aos limites. Privacidade, datas, identidade da conta, consentimento, declaração de conteúdo infantil e declarações de IA do vídeo continuam sendo decisões separadas.

## IA opcional

No servidor, defina em `.env` um endpoint compatível com `chat/completions`:

```dotenv
TEXT_AI_BASE_URL=http://host.docker.internal:11434/v1
TEXT_AI_MODEL=nome-do-modelo-disponivel
TEXT_AI_API_KEY=
```

O endereço acima é um exemplo para um serviço local acessível a partir do Docker; o serviço e o modelo precisam estar disponíveis. Também é possível configurar um provedor remoto compatível. A chave permanece no servidor. Recrie o contêiner após configurar o ambiente.

Marque a opção de IA apenas quando quiser enviar título, legendas e contexto ao provedor configurado. O áudio e o arquivo de vídeo não são enviados. Respostas inválidas, falhas e indisponibilidade retornam à geração local; a chamada tem tempo e tamanho limitados. A IA só sugere texto e não recebe controles de publicação. Seu resultado deve ser revisado, pois um modelo pode acrescentar afirmações incorretas.

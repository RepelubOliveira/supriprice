# SupriPrice — portal de inteligência do mercado de combustíveis

Site: **https://www.supriprice.com.br**

Todos os dias, três vezes por dia, um robô **no seu computador** busca dados e
notícias, monta o portal e o jornal do dia, e publica. **Você não precisa abrir nada.**

```
   07:00, 12:00 e 17:00 (Brasília), todos os dias — Tarefa Agendada do Windows
        │
        ├── Abicom/StoneX ──► defasagem do diesel e da gasolina, faixa por polo
        ├── Banco Central ──► dólar PTAX
        ├── Yahoo Finance ──► faixa de mercado: Ibovespa, dólar, euro, Brent, WTI
        ├── ANP           ──► preço na bomba em ~5.000 postos, por região e estado
        └── 13 feeds RSS  ──► manchetes de mundo, Brasil, transporte e agro
                 │
                 ├── gera portal/assets/js/dados.js        (o painel)
                 ├── gera portal/relatorios/jornal-AAAA-MM-DD.html  (o jornal)
                 ├── publica os dois no HTMLy (merge: o resto fica intacto)
                 └── grava o que aconteceu em logs\AAAA-MM-DD_HHMM.txt
```

### Por que no seu computador e não no GitHub

Começou no GitHub Actions e não funcionou: o Cloudflare da Abicom recusa
pedidos vindos de servidores (erro 403) e apresenta uma verificação anti-robô.
Contornar essa verificação está fora de questão. Da internet comum do
escritório a página abre normalmente — é o uso que o site permite (o
`robots.txt` dela libera `/ppi/`). Por isso a coleta roda aqui.

**A contrapartida: o computador precisa estar ligado.** Se estiver em
suspensão (tampa fechada, modo economia), o Windows o acorda para rodar. Se
estiver DESLIGADO, a tarefa roda assim que ele ligar — e o portal fica parado
na última atualização até lá (o selo do topo avisa o leitor da data).
**Para atualizar no fim de semana, deixe o computador ligado ou em suspensão,
na tomada, de sexta para segunda.**

**Sábado e domingo:** a Abicom não publica. O robô roda do mesmo jeito em modo
PARCIAL: mantém a defasagem de sexta (com a data dela à mostra) e renova
notícias, preço na bomba da ANP, market share e o selo do dia. O jornal do dia
só sai com boletim novo da Abicom, então o de sexta segue até segunda.

O workflow do GitHub continua no repositório com a agenda **desligada**. Ele
serve só de backup do código e para execução manual.

---

## O que entra sozinho

| Bloco | Fonte | Atualização |
|---|---|---|
| Defasagem do diesel e da gasolina | Abicom, análise com a StoneX | diária |
| Faixa por polo, dias de janela fechada | Abicom | diária |
| Dólar PTAX (painel e jornal) | Banco Central, PTAX de venda | diária |
| **Faixa de mercado: Ibovespa, dólar, euro, Brent, WTI** | **Yahoo Finance** | **ao vivo, a cada minuto** |
| Preço na bomba, média nacional | ANP, dados abertos | semanal |
| Preço por região e por estado | ANP | semanal |
| Variação semanal do S10 | ANP | semanal |
| Notícias: mundo, Brasil, transporte, agro | 13 veículos, via RSS | diária |
| Gráfico de 30 dias | Histórico acumulado | diária |
| Jornal do dia (página A4) | Gerado dos dados + manchetes | diária |
| Arquivo de edições | Gerado | diária |
| **Mercado de distribuição: volume total, mix por produto e canal, top 5 distribuidoras, top 5 TRRs, por estado, ranking completo em CSV** | **ANP, SIMP (liquidos.zip e trr.zip)** | **confere 1x por dia; a ANP muda dia 1 e dia 20** |

O `conteudo/editorial.json` guarda só o que nenhuma fonte publica em formato
aberto: o preço da Petrobras nas refinarias (muda poucas vezes por ano) e a
agenda. **Dá para nunca mais abrir esse arquivo** — o portal funciona sozinho.

### Sobre a faixa de mercado

**É ao vivo.** Com a página aberta, a faixa busca as cotações **a cada minuto**
e troca os números sem parar o letreiro; o ponto verde "Ao vivo" aparece ao lado
da hora. Bolsas e futuros (Ibovespa, Brent, WTI) vêm com o atraso de até 15 min
que o Yahoo aplica, o mesmo de portais como o InfoMoney. Às 07:00 a B3 ainda não
abriu: o Ibovespa aparece com **"fech. DD/MM"**, o fechamento do pregão anterior.

**Como funciona.** O Yahoo não deixa o navegador consultá-lo direto, então há
um intermediário: a função **`cotacoes`** no Supabase, projeto
**radar-precos-risel** (plano gratuito). Ela consulta o Yahoo no máximo uma vez
por minuto, seja quantos forem os visitantes, e só responde ao domínio do
portal. Código em `supabase/functions/cotacoes/index.ts`.
- Se a função cair, a faixa continua com os números que o robô gravou às
  07:00/12:00/17:00, com a hora de cada um. Nada quebra.
- **Não apague o projeto radar-precos-risel** nem a função `cotacoes` no
  Supabase: é deles que vem o "ao vivo".

**A variação é sobre o fechamento anterior do mesmo ativo**, o critério dos
portais econômicos. Pequenas diferenças no dólar entre sites são normais: cada
um usa um horário de referência.

**Cores ao contrário do painel, de propósito.** Na faixa, alta é verde e queda
é vermelha (convenção de bolsa). No painel de combustível, alta é vermelha,
porque preço subindo é a notícia ruim para quem compra diesel.

**O Brent aparece uma vez só.** Quando a faixa traz o Brent, ele sai do painel
do topo e do quadro de números do jornal — são números de momentos diferentes
(cotação atual x fechamento), e dois Brents na mesma tela só confundiriam.

### Sobre o mercado de distribuição e o market share

Vem das **mesmas bases dos Painéis Dinâmicos da ANP** (o Power BI), que a ANP
publica como planilhas abertas; o robô lê as planilhas, não o Power BI:

| Arquivo | Painel da ANP | O que dá |
|---|---|---|
| `liquidos.zip` (21 MB) | Mercado Brasileiro de Combustíveis Líquidos | tudo o que as distribuidoras venderam: produto, estado de destino e canal |
| `trr.zip` (5 MB) | Mercado Brasileiro de TRR | o que cada distribuidora vendeu aos TRRs e o que cada TRR vendeu |

Conferido em 02/10/2026 contra o painel de TRR: somando de 2017 em diante, o
robô chega a 91.159 mil m³ e Vibra 25,5%, Raízen 15,1%, Ipiranga 14,6% — os
mesmos números do painel. E os totais por ano batem centavo a centavo.

Onde aparece:
- **Aba "Market share"** (`market-share.html`, no menu do topo): a página
  própria do mercado de distribuição. Tudo segue dois filtros, que ficam
  fixos no topo:
  - **Período:** qualquer mês desde jan/2024, ou um intervalo "de/até", com
    atalhos (último mês, 3, 6, 12 meses, cada ano). Clicar num mês do gráfico
    de barras também seleciona o mês.
  - **Recorte:** Brasil ou um dos estados em destaque (MG, SP, MS, RJ, DF, GO,
    BA, SC, PR) — vendas dentro do estado, de empresas de qualquer origem.
  - O filtro vai para o endereço (`#de=2026-06&ate=2026-08&uf=MG`): um link
    copiado abre exatamente a mesma visão.
  - Conteúdo: números do mercado (com comparação ao período anterior e ao
    mesmo período um ano antes), volume mensal em barras, rankings Top
    5/10/20 de distribuidoras, fornecedoras de TRR e TRRs (com ganho ou perda
    de participação em p.p.), evolução mês a mês da participação das 5
    maiores (também em tabela), volume por produto e por canal, e o botão do
    ranking completo em CSV.
  - A fornecedora de TRR só existe para o Brasil: a ANP não abre esse dado por
    estado (a página avisa).
- **Página inicial:** uma chamada com o último mês (volume total, canal TRR e
  as 3 maiores) e o botão para a aba. Fica com a etiqueta "NOVO" por uma
  semana depois que a ANP divulga.
- **Jornal do dia:** **sempre que a ANP divulga números novos** (base com
  data nova, dia 1 ou dia 20), o jornal daquele dia ganha o bloco "Market
  share: ANP divulga <mês>" — volume total, canal TRR e Top 5 distribuidoras
  e TRRs com a variação em p.p. Nas reedições do mesmo dia o bloco continua;
  no dia seguinte sai. Se no dia não houver jornal (sem boletim da Abicom), o
  bloco entra no próximo. O controle fica em `conteudo/share-trr.json`
  (`jornalBase`, `jornalData`).
- **Ranking completo em CSV**: todas as empresas, posição a posição, no Brasil
  e nos 27 estados, mês e 12 meses (~6 mil linhas, ~700 KB). Abre direto no
  Excel.

Arquivos que o robô gera (sobem uma vez por base da ANP):
- `dados/share-serie-AAAA-MM-DD.json` (~230 KB): a série mensal da aba. Por
  mês e recorte, o total exato e as 25 maiores empresas — dá o ranking certo
  de qualquer período até o Top 20.
- `dados/market-share-AAAA-MM-DD.csv`: o ranking completo.

Detalhes:
- Volumes em mil m³; GLP, QAV e lubrificantes não entram (são outros painéis).
- Empresas do mesmo grupo com CNPJ próprio aparecem separadas, como a ANP as
  registra (ex.: "Raízen" e "Raizen Mime" em SC).
- **Quando muda:** a ANP atualiza dia 1 (mês retrasado, consolidado) e dia 20
  (mês anterior, preliminar — o site marca "prévia"). A primeira rodada de cada
  dia baixa os dois arquivos (~10 s); as outras reaproveitam
  `conteudo/share-trr.json`. Se a ANP não responder, fica o último resultado,
  com o mês de referência à mostra.
- Para mudar os estados destacados: lista `ESTADOS` em `automacao/share.mjs`.
- Teste isolado: `node automacao/share.mjs` mostra tudo no terminal.

### Proteção dos números e visibilidade em buscadores e IAs

**Proteção = autoria, não bloqueio.** Nada que aparece num navegador pode ser
impedido de ser copiado (print, código-fonte, outro navegador), e bloquear
seleção ou botão direito só atrapalharia leitores de tela e quem quer citar
o site. Por isso o portal protege a AUTORIA:
- **Cópia com crédito:** quem copia um trecho do site leva junto
  "Fonte: SupriPrice — endereço" (na aba de market share, com o filtro).
- **Marca em tudo que sai:** os gráficos da aba têm "supriprice.com.br" no
  canto; o jornal (PDF, PNG, JPEG) traz o endereço no topo e no rodapé; o CSV
  termina com a linha de crédito.
- **Termos no rodapé:** conteúdo protegido pela Lei 9.610/98, reprodução
  permitida citando a fonte com link.

**Ser encontrado e citado.** Ninguém consegue "mandar" o Claude, o ChatGPT ou
o Google recomendarem um site: eles indicam o que encontram na web e julgam
útil. O que está ao nosso alcance é ser fácil de achar e de ler:
- O robô escreve **em texto, direto no HTML**, os números do dia (resumo no
  topo da página inicial e da aba, líderes por estado). Antes, quem lia a
  página sem rodar JavaScript — o caso de muitos robôs de IA — via só
  "Este painel precisa de JavaScript".
- **Dados estruturados (schema.org):** Organização e Site na página inicial;
  Dataset na aba de market share (período, fonte, CSV), atualizados pelo robô.
- **`llms.txt`** na raiz (www.supriprice.com.br/llms.txt): a ficha do site no
  formato que IAs procuram, com os números do dia, refeita a cada rodada.
- `robots.txt` libera todos os robôs, inclusive os de IA, e aponta o sitemap,
  que já inclui a aba de market share.
- **Falta você fazer (exige login seu):** cadastrar o site no Google Search
  Console e no Bing Webmaster Tools e enviar o sitemap. Os dois pedem para
  confirmar a posse com uma meta tag ou arquivo — me passe o código que eles
  derem e eu coloco no site.

### Sobre o jornal do dia

- **Sai todo dia**, inclusive sábado e domingo, refeito a cada rodada.
- **Formato fixo de Stories: 1080 x 1920** (9:16), pronto para o Status do
  WhatsApp e os Stories do Instagram. Cada bloco tem espaço reservado e cada
  texto tem limite de linhas; notícia que não cabe inteira sai da folha.
- **Manchete:** com boletim novo da Abicom, a defasagem. Sem boletim (fim de
  semana, ou de manhã antes de ela publicar), o fato do dia, nesta ordem: a
  manchete da análise da semana, o market share recém-divulgado pela ANP, a
  variação do diesel na bomba. A defasagem segue a do último boletim, sempre
  com a data dele.
- **Análise da semana** (`conteudo/editorial.json` → `analise`): o único texto
  escrito à mão, num quadro assinado "Análise SupriPrice", com datas de
  início e fim. Hoje: eleições (até 26/10). Para mudar o tema, peça ao
  Claude ou edite os textos.
- **Radar:** a análise pode ter uma busca no Google Notícias (`analise.radar`)
  que traz as manchetes do tema, priorizando veículos conhecidos e sem
  repetir a mesma notícia.
- **Imagem pronta:** a cada rodada o robô abre o jornal no Edge do computador,
  em modo invisível, e grava `relatorios/jornal-AAAA-MM-DD.png`. É esse o
  arquivo do botão "Baixar PNG"; JPEG e PDF saem dele. (O método antigo, o
  html2canvas, desenhava o texto deslocado; ele só vale para edições antigas.)
  As imagens com mais de 30 edições são apagadas do site.

### Selo "Atualizado hoje"

O selo do topo mostra quando o SITE foi atualizado. A data do boletim da Abicom
fica na linha da fonte logo abaixo ("boletim de 02/10/2026 — a Abicom publica
em dias úteis"). Antes, o selo dizia "Defasagem de 02/10" e passava a ideia de
site parado no fim de semana.

### Pendente

- **Atualização pela nuvem (GitHub Actions)**, combinada para o fim de semana:
  roda meia hora depois do computador e só atualiza se ele não tiver
  atualizado (computador desligado). Sem custo. Precisa do `git push` e da
  chave do HTMLy cadastrada como "secret" no GitHub.

---

## Três coisas que você precisa saber

**1. As notícias são agregadas, não copiadas.** O portal publica manchete,
um resumo de até 200 caracteres e o **link para a matéria original**, sempre com
o nome do veículo. É o modelo de um agregador. Copiar o texto integral seria
violação de direito autoral — não mude isso.

**2. O jornal do dia é um boletim de dados, não jornalismo escrito.** As frases
são construídas a partir dos próprios números ("A defasagem média do diesel
fechou em R$ 2,97 por litro, 88% abaixo da paridade"). Não há análise escrita
por pessoa. É honesto e útil, mas é diferente das edições que você fazia à mão.

**3. Sem curadoria humana, entra o que o feed trouxer.** Há filtro por
relevância — palavra-chave no título vale 4 pontos, termo central soma mais 3,
e há lista de bloqueio para vaga de emprego, evento e aviso institucional. Ainda
assim, uma hora vai passar algo fora de tom. É o preço de não colocar a mão.

---

## Instalação (uma vez só, ou ao trocar/formatar o computador)

Tudo no terminal, dentro da pasta do projeto.

**1. Instalar o Node.js**
```bash
winget install OpenJS.NodeJS.LTS
```

**2. Cadastrar a chave do HTMLy.** Em `htmly.com.br` → **Perfil** → copie a
**API key** (Ctrl+C). Depois rode — não há nada para editar no comando:
```bash
powershell -ExecutionPolicy Bypass -File "automacao\cadastrar-chave.ps1"
```
Ele lê a chave da área de transferência, mostra mascarada para você conferir,
guarda no seu usuário do Windows (fora do projeto e do GitHub) e limpa a área
de transferência. **Nunca cole a chave em chat, e-mail ou arquivo.** Se isso
acontecer, gere uma nova no HTMLy — a antiga fica sem valor.

**3. Criar a tarefa automática**
```bash
powershell -ExecutionPolicy Bypass -File "automacao\instalar-tarefa.ps1"
```
Cria a tarefa "SupriPrice - atualizar portal" (07:00, 12:00 e 17:00, seg a sex).
Não precisa de administrador. Confere o Node e a chave antes de criar.

**4. Testar na hora**
```bash
powershell -Command "Start-ScheduledTask -TaskName 'SupriPrice - atualizar portal'"
```
Em 1–2 minutos o site está atualizado. O resultado fica em `logs\`.

---

## Quando falhar

O robô **nunca publica número que não conseguiu confirmar**.

| Situação | O que acontece |
|---|---|
| Fim de semana | Sai sem publicar. |
| **Abicom ainda não publicou** (comum às 07:00 — ela publica entre ~6h30 e ~9h) | **Atualização parcial:** mercado, ANP e notícias de hoje; a defasagem fica a do último boletim (`conteudo/abicom-ultimo.json`), e o selo diz "Defasagem de DD/MM · mercado e notícias de hoje". Jornal e gráfico só andam com boletim novo. |
| **ANP fora do ar ou lenta** | Tenta duas vezes. Se falhar, usa a **última leitura válida** (`conteudo/anp-ultima.json`), que mostra o próprio período — nunca números fixos. Sem leitura guardada, os blocos da bomba saem. |
| **Um indicador de mercado falhou** | A faixa sai sem aquele item; o resto sai normal. |
| **Indicador com variação acima de 15%** | Tratado como erro de dado: o item some da faixa. |
| **Um feed fora do ar** | Registra no log e segue com os outros 12. |
| **Todos os feeds fora** | Publica sem notícias; os números saem normal. |
| Abicom mudou o layout | **Falha** com mensagem clara no log. |
| Defasagem fora de faixa plausível | **Falha** antes de publicar. |
| HTMLy recusou a chave (401) | **Falha**. Refaça o passo 2 da instalação. |
| Computador desligado no horário | Roda assim que ligar. |

Em qualquer falha o site segue no ar com os dados anteriores, e o selo do topo
passa a dizer "Atualizado ontem" ou a data cheia. Número velho nunca passa
por novo. **Para ver o que houve, abra o arquivo mais recente em `logs\`.**

---

## Ajustes que você pode querer fazer

**Trocar ou acrescentar uma fonte de notícia:** `conteudo/feeds.json`. Copie um
bloco, ajuste `url`, `editoria` (mundo, brasil, transporte, agro) e `filtrar`.
Use `filtrar: false` só para veículo 100% especializado em energia.

**Está entrando notícia fora de tom:** aumente `pontosMinimos` (hoje 6) ou
acrescente um termo em `palavrasBloqueadas`.

**Está entrando pouca notícia:** baixe `pontosMinimos` ou aumente
`diasDeValidade` (hoje 7).

**Esconder a gasolina do topo:** `mostrarGasolina: false` no `editorial.json`.

**Mudar os indicadores da faixa de mercado:** lista `INDICADORES` em
`automacao/fontes.mjs`. Cada item usa o símbolo do Yahoo Finance (`^BVSP`,
`USDBRL=X`, `BZ=F`...). Leia o comentário acima da lista antes de mexer no
cálculo da variação — ele registra, com números, por que o método é esse.

**Mudou o CSS ou o JavaScript do portal:** troque o `?v=` nas duas linhas do
`portal/index.html` que carregam `style.css` e `app.js`. O HTMLy manda o
navegador guardar arquivos `.js` e `.css` por **30 dias sem conferir se
mudaram** — sem um endereço novo, quem já visitou o site fica com a versão
antiga. O `?v=` do **`dados.js` não se mexe à mão**: o robô reescreve a cada
atualização e publica o `index.html` junto (a página em si nunca fica guardada
no navegador, então a versão nova é sempre encontrada).

---

## "Sua conexão não é privada" nos computadores da empresa

Na rede da Repelub o site abre com **NET::ERR_CERT_AUTHORITY_INVALID**. Não é
defeito do site: o firewall da empresa (FortiGate) bloqueia o domínio
(categoria "Newly Observed Domain", depois "Unrated") e se põe no meio da
conexão com um certificado próprio. O site usa HSTS, que manda o navegador
recusar qualquer certificado que não seja o verdadeiro — por isso não aparece
nem a opção "continuar mesmo assim". Fora da empresa (4G, casa) o site abre
normalmente, com certificado válido (nota A+ no SSL Labs).

A correção é na empresa, não no site:
1. **TI:** liberar `www.supriprice.com.br` no filtro web do FortiGate.
2. **Classificação:** pedir ao FortiGuard que classifique o domínio (hoje
   "Unrated") — fortiguard.com, consulta de "Web Filter", opção de envio para
   revisão. Sugestão de categoria: notícias / negócios.

---

## Vídeo de divulgação

Em `video/` ficam as ferramentas que geraram o vídeo para redes sociais
(vertical 1080×1920 para Reels/TikTok/Stories e horizontal 1920×1080 para
LinkedIn/YouTube). **Os números do vídeo são os do dia em que ele foi gerado**
— para uma versão atualizada, refaça as capturas e renderize de novo:

1. Suba o servidor local `projeto-local` (pasta do projeto, porta 8767).
2. Abra `http://localhost:8767/video/estudio.html` e, no console:
   `w = await abrir('/portal/index.html', 390, 844); await prepararCaptura(w); await w.capturarPortal('m', 3)`
   — repita com `1440, 900` e `'d', 1.5`; e para o jornal,
   `abrir('/portal/relatorios/jornal-AAAA-MM-DD.html', 842, 1219)` + `capturarJornal(2)`.
3. Abra `http://localhost:8767/video/compositor.html` e rode
   `await Video.renderizar('vertical')` e `await Video.renderizar('horizontal')`.

Os MP4 e as capas saem em `video/`. Não vão para o git (pesam ~55 MB cada).

**Vídeo de lançamento (Instagram):** `video/lancamento.html` gera dois MP4 de
30 s com trilha original — Stories (1080×1920) e Feed (1080×1350). A música é
composta no próprio navegador (Web Audio), sem faixa de terceiros: não há risco
de direitos autorais nem de o Instagram tirar o som. Depois das capturas do
passo 2 (só as de celular e a do jornal do dia), abra
`http://localhost:8767/video/lancamento.html` e rode
`await Lanc.renderizar('stories')` e `await Lanc.renderizar('feed')`.
Números e manchetes vêm do `dados.js` do dia.

---

## Limites

- **HTMLy Pro:** domínio próprio e 500 MB por site. Cada jornal pesa ~16 KB.
- **A raspagem da Abicom depende do layout deles.** Um dia vai quebrar e avisar.
- **Depende do computador ligado** (ver no começo).
- **O CSV da ANP tem 3,5 MB** e é baixado a cada execução. É o passo mais demorado.
- **Fontes usadas:** Abicom/StoneX, ANP (dados abertos), Banco Central, ICE,
  Yahoo Finance, EIA, OilPrice, Hellenic Shipping, Petronotícias, Click Petróleo
  e Gás, Agência Brasil, InfoMoney, NTC&Logística, Transporte Moderno, Canal
  Rural, Agrolink, Compre Rural. Mantenha a atribuição de cada uma.

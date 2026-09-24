# SupriPrice · Panorama do Diesel

Site aberto ao público com o panorama do mercado de diesel atualizado todo dia.
É um site **estático**: só HTML, CSS e JavaScript. Não precisa de servidor de
aplicação, banco de dados nem processo rodando — sobe em qualquer hospedagem.

Hoje está em **supriprice.htmly.com.br**. Peso total: **1,3 MB**.

```
portal/
├── index.html                      a página
├── .htaccess                       só vale em hospedagem Apache (ver item 3)
├── robots.txt / sitemap.xml        buscadores
├── assets/
│   ├── css/style.css               visual
│   ├── js/dados.js        ← ÚNICO arquivo da rotina diária
│   ├── js/app.js                   lógica (downloads, compartilhar)
│   ├── fonts/                      IBM Plex Sans
│   └── supriprice-logo.png
└── relatorios/
    ├── 2026-09-24-geral.html       as edições (≈25 KB cada)
    └── assets/                     fontes e scripts que TODAS as edições usam
```

> **Importante:** `relatorios/assets/` é compartilhado por todas as edições.
> Nunca apague essa pasta ao trocar os relatórios, senão as edições perdem as
> fontes. Ela só cresce se uma edição nova usar uma fonte diferente.
>
> As edições apontam para essa pasta com caminho absoluto
> (`/relatorios/assets/...`), e não relativo. Isso é necessário porque o gerador
> de PDF e PNG clona a página do relatório usando o endereço do portal como
> base — com caminho relativo, as fontes não seriam encontradas e o arquivo
> sairia com fonte substituta. **Consequência:** o site precisa ficar na raiz do
> domínio, não dentro de uma subpasta. No HTMLy é exatamente assim.

---

## 1. Rotina diária (≈5 minutos)

Abra **`assets/js/dados.js`**. É o único arquivo que muda no dia a dia — nada
ali mexe no layout.

1. `meta.dataISO` → a data de hoje (`AAAA-MM-DD`). O selo "Atualizado hoje,
   24/09, às 08:00" no topo se ajusta sozinho e vira "ontem" ou a data cheia se
   você não publicar.
2. `produtos`, `ticker`, `polos`, `serieS10`, `bomba`, `paridade`, `agenda` → os
   números do dia. A defasagem em R$ e em % é calculada a partir de `petro` e
   `ppi`; você não precisa fazer a conta.
3. Coloque o relatório novo em `relatorios/` e acrescente em `edicoes` (o mais
   recente primeiro) e em `arquivo`.
4. `mundo` → as notícias internacionais. **Sempre preencha `url`** com o
   endereço da matéria: é ele que abre quando o leitor clica no título e é ele
   que vai nos botões "Encaminhar" e "WhatsApp".
5. Suba `dados.js` e o relatório novo para o servidor. Só esses dois.

O `.htaccess` já impede que `index.html` e `dados.js` fiquem presos em cache,
então a atualização aparece na hora para quem entra.

---

## 2. O que o portal faz

### Download gera o arquivo, não abre outra aba

O botão **Baixar** de cada edição abre um menu com **PDF, PNG, JPEG e HTML**.
O arquivo é montado no próprio navegador do visitante:

- o relatório é renderizado num iframe fora da tela, no tamanho A4 (842×1219);
- a página é capturada em canvas (`html2canvas`) em resolução 2×;
- PNG e JPEG saem direto do canvas; o PDF é montado em A4 retrato (`jsPDF`);
- o HTML é baixado como cópia do arquivo original.

O download vem com nome próprio (`supriprice-geral-2026-09-24.pdf`), sem
navegação e sem aba nova. Se a geração da imagem falhar (rede ruim, navegador
antigo), o portal avisa e entrega a versão HTML em vez de fingir que deu certo.

`html2canvas` e `jsPDF` vêm do cdnjs e são carregados **só quando alguém clica
em baixar** — não pesam no carregamento da página.

### Pelo mundo com link da publicação

Cada notícia tem:

- **título clicável** que abre a publicação original em nova aba
  (`rel="noopener noreferrer"`);
- a **fonte** identificada abaixo do texto;
- **Encaminhar** — usa o menu de compartilhamento do celular quando existe
  (`navigator.share`) e copia o link no computador;
- **WhatsApp** — abre o `wa.me` com título e link prontos.

Os links que estão em `dados.js` hoje apontam para as **seções de energia** dos
veículos (EIA, Comissão Europeia, Reuters). Troque pelo endereço exato de cada
matéria. Se `url` ficar vazio, o card mostra "Link da publicação ainda não
informado" em vez de um botão quebrado.

As edições e os itens do arquivo também têm botão de encaminhar.

---

## 3. Colocar no ar — HTMLy

O HTMLy aceita **um ZIP**, extrai e publica. É por aí que se atualiza o site.

1. Gere o zip com **o conteúdo** da pasta `portal/` na raiz — o `index.html`
   precisa ficar no primeiro nível do arquivo, não dentro de uma subpasta.
2. Entre no painel do HTMLy, escolha o site e envie o zip.
3. Pronto. Em segundos está no ar, com HTTPS.

**Só enviar o `index.html` não funciona** — foi o que aconteceu na primeira
tentativa. Sem `assets/` a página fica sem estilo nenhum e sem conteúdo, porque
o CSS e o JavaScript não existem no servidor. Sempre o zip inteiro.

**Como conferir se subiu certo.** Abra estes dois endereços; os dois têm que
mostrar código, não a página do site:

```
https://supriprice.htmly.com.br/assets/css/style.css
https://supriprice.htmly.com.br/assets/js/app.js
```

**Limites do plano.** O gratuito dá 1 site, **10 MB** e **3 atualizações por
dia**. O site ocupa 1,3 MB, e cada edição nova soma só ~25 KB — dá para muitos
meses. Domínio próprio (`www.supriprice.com.br`) exige o plano **Pro, R$ 29/mês**.

**O HTMLy recusa arquivos que "parecem" HTML.** Ele checa o conteúdo de cada
`.js` e rejeita o envio inteiro se detectar marcação HTML dentro. O script do
componente `doc-page`, que monta a folha A4, tinha muitas tags dentro de
templates de código e era recusado — por isso ele vai **embutido no `<head>` de
cada relatório**, e não como arquivo separado. Se um dia você regerar os
relatórios, esse detalhe precisa ser refeito.

**O `.htaccess` NÃO pode ir no zip.** O HTMLy recusa o envio inteiro com a
mensagem *"Invalid file '.htaccess': Blocked file extension"*. Ele é arquivo de
configuração de servidor Apache e não teria efeito nenhum lá (o HTMLy é CDN
Cloudflare). O arquivo continua na pasta `portal/` do seu computador, para o caso
de você migrar um dia para hospedagem comum — mas **sempre monte o zip sem ele**.

O mesmo vale para o `LEIA-ME.md`: fica só na sua máquina, não precisa ir para o ar.

**Quando o domínio próprio entrar no ar**, troque o endereço em 4 lugares:
as 3 linhas marcadas no `<head>` do `index.html`, o `meta.siteUrl` do
`dados.js`, o `robots.txt` e o `sitemap.xml` — e aí acrescente a linha de
`canonical` que está comentada no `index.html`.

**Depois de publicar**, cadastre o site no [Google Search
Console](https://search.google.com/search-console) e envie o `sitemap.xml`.

---

## 4. Rodar na sua máquina

Abrir o `index.html` com duplo clique **não funciona direito**: o navegador
bloqueia `fetch` em `file://` e o download em HTML falha. Use um servidor local
simples — por exemplo, no VS Code, a extensão *Live Server*; ou, se tiver Node
instalado:

```bash
npx serve portal
```

---

## 5. Detalhes técnicos

- Página escrita em HTML, CSS e JavaScript comuns — saiu o empacotador de
  artifact, que deixava tudo num arquivo de 5,8 MB impossível de editar.
- `<title>`, descrição, canonical, Open Graph e Twitter Card para o site
  aparecer certo no Google e quando alguém cola o link no WhatsApp.
- `robots.txt`, `sitemap.xml` e dado estruturado `schema.org/Dataset` com a data
  de atualização — sinaliza aos buscadores que o conteúdo muda todo dia.
- Menu que vira sanduíche no celular e destaca a seção em que você está.
- Acessibilidade: hierarquia de títulos, link "pular para o conteúdo", foco
  visível, `aria-live` nos avisos, rótulos em todos os campos.
- Estilo de impressão: `Ctrl+P` gera uma versão limpa, sem menu.
- Os dados vindos de `dados.js` passam por escape antes de entrar no HTML, e só
  links `http`/`https` são aceitos.
- Fontes servidas do próprio domínio, sem chamada ao Google Fonts.
- **Relatórios desempacotados.** Cada edição vinha como um arquivo único de
  1,5 MB, com 23 fontes embutidas em base64 — as mesmas fontes repetidas em
  todas as edições. Agora as fontes e os scripts ficam em `relatorios/assets/`,
  compartilhados: as 4 edições passaram de 5,4 MB para 98 KB somadas, e uma
  edição nova custa ~25 KB em vez de 1,5 MB. Também foram removidos os
  subconjuntos de fonte que o português não usa (cirílico, grego, vietnamita).
- A miniatura de cada edição mede a altura real da página e ajusta a proporção
  da caixa. Antes usava 842×1219 fixo e cortava o rodapé das edições mais longas.

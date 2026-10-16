# SupriPrice — contexto para o Claude

Portal de inteligência do mercado brasileiro de combustíveis: www.supriprice.com.br
(hospedado no HTMLy, slug `supriprice`). Atualizado sozinho por um robô Node.
Guia do dono: `AUTOMACAO.md`. Plano da assinatura (na gaveta): `docs/assinatura.md`.
Converse em português.

## Peças

- `portal/` — o site estático (index.html, market-share.html, assets/js/app.js,
  share.js, medicao.js, css/style.css). `assets/js/dados.js` é gerado pelo robô.
- `automacao/atualizar.mjs` — o robô. Coleta Abicom (defasagem), BCB/Yahoo
  (cotações), ANP (bomba e market share), feeds de notícia, negócios do setor
  (M&A/Cade), gera o jornal do dia e publica tudo no HTMLy.
  - `powerbi.mjs` prévia do market share pelo Power BI da ANP ·
    `fontes.mjs` Abicom/BCB/Brent/indicadores · `anp.mjs` bomba · `share.mjs`
    planilhas da ANP (trr.zip, liquidos.zip) · `noticias.mjs` feeds, radar e
    negócios · `jornal.mjs` jornal 1080x1920 (Stories) · `imagem.mjs` foto do
    jornal pelo Edge headless · `textos.mjs` texto estático para buscadores/IAs ·
    `estado.mjs` estado compartilhado computador/nuvem · `publicar.mjs` API do HTMLy.
- `conteudo/` — estado e configuração: `editorial.json` (análise ocasional,
  agenda), `feeds.json` (fontes de notícia e `negocios`), `*-ultimo/ultima.json`,
  `historico.json`, `edicoes.json`, `share-trr.json`, `negocios.json`.
- Agendamento: Tarefa do Windows (`automacao/instalar-tarefa.ps1`), 08, 09, 10,
  12, 15 e 17h, todos os dias, via `rodar-diario.ps1` (espera a rede, 3 tentativas).
  Reserva na nuvem: `.github/workflows/atualizar-panorama.yml` (meia hora depois;
  só age se o computador não atualizou; a Abicom bloqueia servidores, então lá é parcial).
- `supabase/functions/cotacoes` — proxy das cotações ao vivo da faixa do site (e, no campo
  `insumos`, diesel HO=F e gasolina RB=F de Nova York para a arbitragem ao vivo).
- **Arbitragem SupriPrice** (`automacao/paridade.mjs` + `montarArbitragem` no app.js): a nossa
  paridade, independente da Abicom. Importação = Nova York (US$/gal) / 3,785 x dólar + custo de
  trazer; arbitragem = importação − Petrobras. Custos calibrados em `editorial.json →
  arbitragemSupriPrice` (`node automacao/paridade.mjs --calibrar`, revisar ~1x/mês). O preço da
  Petrobras (`editorial.json → precosPetrobras`) precisa ser atualizado no dia de cada reajuste.
  Aberta a todos por enquanto; quando a assinatura começar, o ao vivo fica só para assinantes.
  No site e no jornal o nome é só "Arbitragem" (pedido de 14/10). O topo mostra "● Ao vivo" sem
  data; a data da última rodada fica discreta no fim do rodapé (#carimbo). O ponto de hoje do
  gráfico e das mini-linhas acompanha o ao vivo (vivoNaSerie no app.js).

## Comandos

```bash
node automacao/atualizar.mjs --simular   # roda tudo, não publica
node automacao/atualizar.mjs             # roda e publica
node automacao/share.mjs                 # testa só o market share
```

## Regras que o dono pediu (não quebrar)

- Chaves e senhas: a do HTMLy fica só na variável de ambiente `HTMLY_API_KEY`
  do Windows, cadastrada pelo dono com `automacao/cadastrar-chave.ps1`. Nunca
  pedir, ler em voz alta, gravar em arquivo nem colar chave em chat.
- `git push` é o dono quem roda. Commits locais podem ser feitos.
- Notícias: só manchete, resumo curto e link com o nome do veículo. Nunca o texto integral.
- Market share: a PLANILHA de dados abertos da ANP é a fonte oficial. Enquanto ela não traz um mês,
  o robô lê esse mês no Power BI público da ANP (`automacao/powerbi.mjs`, pedido de 14/10/2026) e o
  site mostra como PRÉVIA PARCIAL (`share.previa` no dados.js, quadro #previa na aba). Abaixo de 90%
  do volume declarado ou faltando uma das 5 maiores: só volume por empresa, sem participação.
  Quando a planilha sai, a prévia some e vale a planilha.
- Cotações: não usar TradingView (os termos proíbem robô).
- Não burlar Cloudflare/CAPTCHA da Abicom. Não mexer em configurações do Windows
  (energia, segurança) — só orientar.
- O dono não quer aparecer como dono do SupriPrice nos textos públicos.

## Armadilhas já conhecidas

- Jornal: a manchete é do EDITOR (`automacao/editor.mjs`, pedido de 16/10): fato novo com causa
  e contexto; dado velho (market share por estado de meses atrás) nunca é manchete; repetir o
  assunto de ontem só pesa contra fato fraco; agenda do editorial.json (hoje/amanhã) entra, com
  `manchete`/`lide` opcionais e `{quando}`. O "no dia" da arbitragem compara com o
  chartPreviousClose (range=1d), NUNCA com a barra de ontem da série diária do Yahoo: nos
  futuros de NY a barra difere do fechamento (16/10: 4,85 x 4,65). O % da arbitragem é sobre o
  preço da Petrobras ("+84% sobre o preço da Petrobras"), não "84% abaixo da paridade".

- Preço na bomba: as médias (Brasil, regiões, estados) vêm do RESUMO SEMANAL oficial da ANP
  (`resumo_semanal_lpc_*.xlsx`, achado na página "últimas semanas pesquisadas"), não da média
  simples do CSV posto a posto: a ANP pondera e a diferença chega a R$ 0,25 num estado. O CSV
  fica de reserva. O CSV tem endereços com `;` entre aspas: ler com `celulasCsv`, nunca `split(';')`.
- Market share: a ANP atualiza a base dia 1 (mês retrasado) e dia 20 (prévia do mês anterior).
  Em outubro, até o dia 20, o último mês é agosto mesmo; o site mostra a próxima divulgação.

- `.js`/`.css` no HTMLy têm cache imutável de 30 dias: ao mudar um asset, troque o
  `?v=` nas DUAS páginas e publique o asset ANTES das páginas (o robô só publica
  dados.js, páginas, jornal e estado; app.js/share.js/medicao.js/style.css sobem à parte
  com `publicarArquivos`).
- O HTMLy recusa `.js` que "pareça" HTML (detector de tipo): monte elementos com
  createElement em vez de grandes strings com tags num arquivo pequeno.
- Scripts Python/heredoc que escrevem `'\n'` dentro de código JS viram quebra de
  linha real e quebram a sintaxe: confira com `node --check` depois de editar.
- PowerShell 5.1: com `ErrorActionPreference=Stop`, stderr de programa nativo
  derruba o script (por isso o `rodar-diario.ps1` usa `Continue` em volta do node).
- Na rede da empresa (FortiGate) o domínio supriprice.com.br é bloqueado; a API do
  HTMLy (htmly.com.br) funciona.

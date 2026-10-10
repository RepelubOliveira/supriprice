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
  - `fontes.mjs` Abicom/BCB/Brent/indicadores · `anp.mjs` bomba · `share.mjs`
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
- `supabase/functions/cotacoes` — proxy das cotações ao vivo da faixa do site.

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
- Market share: só da PLANILHA de dados abertos da ANP (o dono não quer ler o Power BI).
- Cotações: não usar TradingView (os termos proíbem robô).
- Não burlar Cloudflare/CAPTCHA da Abicom. Não mexer em configurações do Windows
  (energia, segurança) — só orientar.
- O dono não quer aparecer como dono do SupriPrice nos textos públicos.

## Armadilhas já conhecidas

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

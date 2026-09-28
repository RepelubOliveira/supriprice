// SupriPrice — atualização diária do portal
// -----------------------------------------------------------------------------
// Junta tudo e publica:
//   Abicom   -> defasagem do diesel e da gasolina
//   BCB      -> dólar PTAX
//   Yahoo    -> Brent
//   ANP      -> preço na bomba (nacional, por região, por estado)
//   13 feeds -> manchetes de mundo, Brasil, transporte e agro
//
// Saídas:
//   portal/assets/js/dados.js         painel do portal
//   portal/relatorios/jornal-AAAA-MM-DD.html   o jornal do dia
//   conteudo/historico.json           série da defasagem
//   conteudo/edicoes.json             lista dos jornais já publicados
//
// Uso:
//   node automacao/atualizar.mjs
//   node automacao/atualizar.mjs --simular          gera, não publica
//   node automacao/atualizar.mjs --data=2026-09-28  força uma data
//
// Ambiente: HTMLY_API_KEY (obrigatória sem --simular), HTMLY_SLUG.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coletarTudo } from './fontes.mjs';
import { lerPrecosAnp } from './anp.mjs';
import { coletarNoticias } from './noticias.mjs';
import { gerarJornal } from './jornal.mjs';
import { publicarArquivos } from './publicar.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  editorial: path.join(RAIZ, 'conteudo', 'editorial.json'),
  feeds: path.join(RAIZ, 'conteudo', 'feeds.json'),
  historico: path.join(RAIZ, 'conteudo', 'historico.json'),
  edicoes: path.join(RAIZ, 'conteudo', 'edicoes.json'),
  dados: path.join(RAIZ, 'portal', 'assets', 'js', 'dados.js'),
  relatorios: path.join(RAIZ, 'portal', 'relatorios')
};

const args = process.argv.slice(2);
const SIMULAR = args.includes('--simular');
const DATA_FORCADA = (args.find((a) => a.startsWith('--data=')) || '').split('=')[1];
const MAX_EDICOES = 30;

const log = (...m) => console.log('•', ...m);
const brl = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');

function hojeBrasilia() {
  if (DATA_FORCADA) {
    const [a, m, d] = DATA_FORCADA.split('-').map(Number);
    return new Date(a, m - 1, d);
  }
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const [a, m, d] = p.split('-').map(Number);
  return new Date(a, m - 1, d);
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ddmm = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

async function lerJson(caminho, padrao) {
  if (!existsSync(caminho)) return padrao;
  return JSON.parse(await readFile(caminho, 'utf8'));
}

function registrarHistorico(historico, data, valor, gasolina) {
  const chave = iso(data);
  const fora = historico.filter((p) => p.data !== chave);
  const ponto = { data: chave, rotulo: ddmm(data), valor };
  if (typeof gasolina === 'number') ponto.gasolina = gasolina;
  fora.push(ponto);
  fora.sort((a, b) => a.data.localeCompare(b.data));
  return fora.slice(-40);
}

function montarSerie(historico) {
  const pontos = historico.slice(-23).map((p) => [p.rotulo, p.valor]);
  if (pontos.length < 2) return { pontos, escala: { min: 0, max: 1, linhas: [] }, marcadores: [] };
  const vals = pontos.map((p) => p[1]);
  const piso = Math.floor((Math.min(...vals) - 0.2) * 2) / 2;
  const teto = Math.ceil((Math.max(...vals) + 0.2) * 2) / 2;
  const linhas = [];
  for (let v = piso; v <= teto + 1e-9; v += 0.5) linhas.push(Number(v.toFixed(1)));
  const iMax = vals.indexOf(Math.max(...vals));
  return {
    pontos,
    escala: { min: piso, max: teto, linhas },
    marcadores: pontos.length > 4 ? [
      { i: iMax, texto: `Máx. ${brl(Math.max(...vals))}`, dy: -12, ancora: 'end' },
      { i: pontos.length - 1, texto: brl(vals[vals.length - 1]), dy: -12, ancora: 'end' }
    ] : []
  };
}

/**
 * `anteriores` traz o valor de ontem de CADA produto. Passar o do diesel para
 * a gasolina faria o cartão dela anunciar uma queda de R$ 2 que nunca houve.
 * Sem valor de ontem, `anterior` fica null e o portal omite a linha "Ontem".
 */
function montarProdutos(abicom, editorial, anteriores) {
  const precos = editorial.precosPetrobras || {};
  const cartao = (nome, bloco, petro, anterior) => ({
    nome, escopo: 'média dos polos', petro,
    ppi: Number((petro + bloco.defasagem).toFixed(4)),
    defasagem: bloco.defasagem, pct: bloco.pct,
    faixaMin: bloco.faixaMin, faixaMax: bloco.faixaMax,
    diasJanelaFechada: bloco.diasJanelaFechada,
    anterior: typeof anterior === 'number' ? anterior : null
  });
  const itens = [cartao('Diesel A', abicom.diesel, Number(precos.diesel) || 0, anteriores.diesel)];
  if (editorial.mostrarGasolina && abicom.gasolina) {
    itens.push(cartao('Gasolina A', abicom.gasolina, Number(precos.gasolina) || 0, anteriores.gasolina));
  }
  return itens;
}

function montarTicker(abicom, dolar, brent, anp) {
  const d = abicom.diesel;
  const t = [
    { label: 'Defasagem diesel', valor: brl(d.defasagem), nota: `${d.pct}%` },
    { label: 'Brent', valor: `US$ ${brent.valor.toFixed(2).replace('.', ',')}`, nota: '' },
    { label: 'Dólar (PTAX)', valor: brl(dolar.valor), nota: '' }
  ];
  const s10 = anp?.produtos?.find((p) => p.nome === 'Diesel S10');
  if (s10) {
    t.push({
      label: 'S10 na bomba', valor: brl(s10.media),
      nota: s10.variacao == null ? '' : (s10.variacao >= 0 ? '+' : '−') + brl(Math.abs(s10.variacao)).replace('R$ ', '')
    });
  }
  if (d.faixaMin != null) t.push({ label: 'Faixa por polo', valor: brl(d.faixaMin), nota: `a ${brl(d.faixaMax)}` });
  if (d.diasJanelaFechada != null) t.push({ label: 'Janela fechada', valor: String(d.diasJanelaFechada), nota: 'dias' });
  return t;
}

/** Bloco "Preço na bomba" e "Por região", agora vindos da ANP. */
function montarBomba(anp) {
  if (!anp) return null;
  return {
    nota: `ANP, ${anp.totalColetas.toLocaleString('pt-BR')} postos entre ` +
          `${anp.periodo.de.split('-').reverse().join('/')} e ${anp.periodo.ate.split('-').reverse().join('/')}.`,
    itens: anp.produtos.map((p) => ({
      nome: p.nome, valor: brl(p.media),
      variacao: p.variacao == null ? null : Number(p.variacao.toFixed(2))
    }))
  };
}

function montarPolosAnp(anp) {
  if (!anp?.regioes?.length) return null;
  const maior = Math.max(...anp.regioes.map((r) => r.media));
  return anp.regioes.map((r) => [
    r.nome, `${r.coletas} postos`, Number(r.media.toFixed(2)),
    Number((r.media / maior).toFixed(4)), 0
  ]);
}

function gerarArquivoDados(dados) {
  return `/* ==========================================================================
   SupriPrice — Panorama do Diesel
   ARQUIVO GERADO AUTOMATICAMENTE — não edite à mão.
   Gerado em ${new Date().toISOString()}

   defasagem  Abicom/StoneX      bomba   ANP (dados abertos)
   dólar      Banco Central      Brent   contrato BZ=F
   manchetes  feeds em conteudo/feeds.json, com link para a fonte

   Conteúdo editorial: conteudo/editorial.json
   ========================================================================== */

window.DADOS = ${JSON.stringify(dados)};
`;
}

async function principal() {
  const hoje = hojeBrasilia();
  log(`Data de referência: ${ddmm(hoje)}/${hoje.getFullYear()}`);

  if (hoje.getDay() === 0 || hoje.getDay() === 6) {
    log('Fim de semana: a Abicom não publica. Nada a fazer.');
    return;
  }

  const editorial = await lerJson(P.editorial, null);
  const cfgFeeds = await lerJson(P.feeds, null);
  if (!editorial) throw new Error(`Não encontrei ${P.editorial}`);
  if (!cfgFeeds) throw new Error(`Não encontrei ${P.feeds}`);

  // A defasagem é obrigatória. ANP e notícias são desejáveis: se uma delas
  // falhar, o portal sai sem aquele bloco em vez de não sair.
  log('Buscando Abicom, Banco Central e Brent...');
  const { abicom, dolar, brent } = await coletarTudo(hoje);
  if (!abicom) {
    log('A Abicom ainda não publicou o boletim de hoje. Saindo sem publicar.');
    return;
  }
  const def = abicom.diesel.defasagem;
  if (!(def > 0 && def < 20)) throw new Error(`Defasagem implausível (${def}). Abortando.`);
  log(`Abicom ${abicom.data}: diesel ${brl(def)} (${abicom.diesel.pct}%)`);
  log(`Dólar ${brl(dolar.valor)} · Brent US$ ${brent.valor}`);

  log('Buscando preços na bomba (ANP)...');
  let anp = null;
  try {
    anp = await lerPrecosAnp();
    const s10 = anp.produtos.find((p) => p.nome === 'Diesel S10');
    log(`ANP: S10 ${brl(s10.media)} em ${anp.totalColetas} postos (${anp.periodo.de} a ${anp.periodo.ate})`);
  } catch (e) {
    console.warn(`  ! ANP indisponível: ${e.message}`);
  }

  log('Lendo os feeds de notícia...');
  let noticias = null;
  try {
    noticias = await coletarNoticias(cfgFeeds);
    const c = Object.entries(noticias.editorias).map(([k, v]) => `${k}:${v.length}`).join(' ');
    log(`Notícias: ${noticias.feedsOk}/${noticias.feedsConsultados} feeds · ${c}`);
  } catch (e) {
    console.warn(`  ! Notícias indisponíveis: ${e.message}`);
  }

  const histAntes = await lerJson(P.historico, []);
  const ontem = histAntes.filter((p) => p.data !== iso(hoje)).slice(-1)[0];
  const anteriores = { diesel: ontem?.valor, gasolina: ontem?.gasolina };
  const historico = registrarHistorico(histAntes, hoje, def, abicom.gasolina?.defasagem);

  // --- jornal do dia -------------------------------------------------------
  const jornal = gerarJornal({ data: hoje, abicom, brent, dolar, anp, noticias, historico });
  await mkdir(P.relatorios, { recursive: true });
  await writeFile(path.join(P.relatorios, jornal.nomeArquivo), jornal.html, 'utf8');
  log(`Jornal: ${jornal.nomeArquivo} (${(jornal.html.length / 1024).toFixed(1)} KB) — "${jornal.titulo}"`);

  const edicoesAntes = await lerJson(P.edicoes, []);
  const edicoes = [
    { data: iso(hoje), rotulo: ddmm(hoje), titulo: jornal.titulo, chamada: jornal.chamada,
      arquivo: `relatorios/${jornal.nomeArquivo}`, slug: `supriprice-${iso(hoje)}` },
    ...edicoesAntes.filter((e) => e.data !== iso(hoje))
  ].slice(0, MAX_EDICOES);

  // --- dados.js ------------------------------------------------------------
  const dados = {
    meta: {
      dataISO: iso(hoje), horaFechamento: '08:00',
      fonte: `Fonte: Abicom/StoneX, fechamento ${abicom.data}`,
      siteUrl: 'https://supriprice.htmly.com.br/',
      gerado: new Date().toISOString()
    },
    produtos: montarProdutos(abicom, editorial, anteriores),
    ticker: montarTicker(abicom, dolar, brent, anp),
    serieS10: montarSerie(historico),
    polos: montarPolosAnp(anp) || editorial.polos,
    polosTitulo: anp ? 'Preço médio do S10 por região' : 'Defasagem por polo',
    bomba: montarBomba(anp) || editorial.bomba,
    anp: anp ? { maisCaros: anp.maisCaros, maisBaratos: anp.maisBaratos, referencia: anp.referencia } : null,
    paridade: editorial.paridade,
    agenda: editorial.agenda,
    noticias: noticias ? noticias.editorias : {},
    edicoes: edicoes.slice(0, 3),
    arquivo: edicoes.map((e) => ({
      data: e.rotulo, tag: 'Diário', titulo: e.titulo, arquivo: e.arquivo, slug: e.slug
    })).concat(editorial.arquivoHistorico || [])
  };

  const conteudo = gerarArquivoDados(dados);
  await writeFile(P.dados, conteudo, 'utf8');
  await writeFile(P.historico, JSON.stringify(historico, null, 2) + '\n', 'utf8');
  await writeFile(P.edicoes, JSON.stringify(edicoes, null, 2) + '\n', 'utf8');
  log(`dados.js ${(conteudo.length / 1024).toFixed(1)} KB · histórico ${historico.length} pontos · ${edicoes.length} edições`);

  if (SIMULAR) { log('Modo simulação: nada publicado.'); return; }

  log('Publicando no HTMLy...');
  const res = await publicarArquivos({
    slug: process.env.HTMLY_SLUG || 'supriprice',
    chave: process.env.HTMLY_API_KEY,
    arquivos: [
      { path: 'assets/js/dados.js', content: conteudo },
      { path: `relatorios/${jornal.nomeArquivo}`, content: jornal.html }
    ]
  });
  log(`Publicado: ${res.url || ''} · ${res.storage_bytes ?? '?'} bytes`);
}

principal().catch((e) => {
  console.error('\n✗ Falhou:', e.message);
  console.error('  Nada foi publicado. O site segue com os dados anteriores e o');
  console.error('  selo do topo avisa o leitor que a data não é de hoje.');
  process.exit(1);
});

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
import { coletarTudo, lerIndicadores } from './fontes.mjs';
import { lerPrecosAnp } from './anp.mjs';
import { coletarNoticias } from './noticias.mjs';
import { lerShare } from './share.mjs';
import { injetar, resumoHome, resumoShare, destaquesShare, datasetJsonLd, llmsTxt } from './textos.mjs';
import { gerarJornal } from './jornal.mjs';
import { publicarArquivos } from './publicar.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  editorial: path.join(RAIZ, 'conteudo', 'editorial.json'),
  feeds: path.join(RAIZ, 'conteudo', 'feeds.json'),
  historico: path.join(RAIZ, 'conteudo', 'historico.json'),
  edicoes: path.join(RAIZ, 'conteudo', 'edicoes.json'),
  anpUltima: path.join(RAIZ, 'conteudo', 'anp-ultima.json'),
  abicomUltimo: path.join(RAIZ, 'conteudo', 'abicom-ultimo.json'),
  shareTrr: path.join(RAIZ, 'conteudo', 'share-trr.json'),
  dados: path.join(RAIZ, 'portal', 'assets', 'js', 'dados.js'),
  index: path.join(RAIZ, 'portal', 'index.html'),
  relatorios: path.join(RAIZ, 'portal', 'relatorios')
};

// Sobe quando muda o formato do bloco de market share: força uma nova coleta
// mesmo que o guardado seja de hoje.
const VERSAO_SHARE = 4;

// Páginas que carregam o dados.js (o robô reescreve a versão em todas).
const PAGINAS = ['index.html', 'market-share.html'];

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

function montarTicker(abicom, dolar, brent, anp, indicadores) {
  const d = abicom.diesel;
  const t = [
    { label: 'Defasagem diesel', valor: brl(d.defasagem), nota: `${d.pct}%` },
    // O Brent sai daqui quando a faixa de mercado do topo já o mostra: são
    // números de momentos diferentes (fechamento x cotação atual), e dois
    // Brents distintos na mesma tela só confundem.
    ...(indicadores?.some((i) => i.id === 'brent') ? [] : [
      { label: 'Brent', valor: `US$ ${brent.valor.toFixed(2).replace('.', ',')}`, nota: '' }
    ]),
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
    // Sem variação: a ANP é semanal e a comparação por região não é apurada.
    // null faz o portal omitir a linha em vez de mostrar um zero inventado.
    Number((r.media / maior).toFixed(4)), null
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

  // Fim de semana: o site atualiza do mesmo jeito (notícias, ANP, market
  // share, selo do dia), em modo PARCIAL — a Abicom não publica sábado e
  // domingo, então vale o boletim de sexta, com a data dele à mostra.
  const fimDeSemana = hoje.getDay() === 0 || hoje.getDay() === 6;

  const editorial = await lerJson(P.editorial, null);
  const cfgFeeds = await lerJson(P.feeds, null);
  if (!editorial) throw new Error(`Não encontrei ${P.editorial}`);
  if (!cfgFeeds) throw new Error(`Não encontrei ${P.feeds}`);

  // A defasagem é obrigatória. ANP e notícias são desejáveis: se uma delas
  // falhar, o portal sai sem aquele bloco em vez de não sair.
  log('Buscando Abicom, Banco Central e Brent...');
  const coleta = await coletarTudo(hoje, { semAbicom: fimDeSemana });
  const { dolar, brent } = coleta;
  let abicom = coleta.abicom;

  // MODO PARCIAL. A Abicom publica entre ~6h30 e ~9h (medido de 24/09 a
  // 01/10/2026). Na rodada das 07:00 o boletim do dia quase nunca existe — e
  // antes o robô saía sem publicar NADA, nem cotação nem notícia. Agora,
  // sem boletim novo, ele atualiza mercado, ANP e notícias e mantém a
  // defasagem do último boletim, com a data dele à mostra. O jornal do dia e
  // o histórico só andam com boletim novo.
  let parcial = false;
  let dataAbicomISO = iso(hoje);
  if (abicom) {
    await writeFile(P.abicomUltimo, JSON.stringify({ dataISO: iso(hoje), abicom }) + '\n', 'utf8');
  } else {
    const ultimo = await lerJson(P.abicomUltimo, null);
    if (!ultimo) {
      log('A Abicom ainda não publicou o boletim de hoje e não há boletim anterior guardado. Saindo sem publicar.');
      return;
    }
    abicom = ultimo.abicom;
    dataAbicomISO = ultimo.dataISO;
    parcial = true;
    log(fimDeSemana
      ? `Fim de semana (a Abicom não publica): atualização PARCIAL (mercado, ANP e notícias), mantendo o boletim de ${abicom.data}.`
      : `A Abicom ainda não publicou o boletim de hoje: atualização PARCIAL (mercado, ANP e notícias), mantendo o boletim de ${abicom.data}.`);
  }
  const def = abicom.diesel.defasagem;
  if (!(def > 0 && def < 20)) throw new Error(`Defasagem implausível (${def}). Abortando.`);
  log(`Abicom ${abicom.data}: diesel ${brl(def)} (${abicom.diesel.pct}%)`);
  log(`Dólar ${brl(dolar.valor)} · Brent US$ ${brent.valor}`);

  // Faixa de mercado: nunca derruba a atualização. Cada indicador que falhar
  // simplesmente não aparece.
  log('Buscando indicadores de mercado...');
  const indicadores = await lerIndicadores();
  log(`Mercado: ${indicadores.map((i) => `${i.nome} ${i.variacao > 0 ? '+' : ''}${i.variacao}%`).join(' · ') || 'nenhum indicador disponível'}`);

  log('Buscando preços na bomba (ANP)...');
  // Se a ANP não responder, vale a ÚLTIMA LEITURA BOA dela, guardada a cada
  // sucesso — nunca números fixos. Antes havia uma "reserva" no
  // editorial.json com preços de uma semana qualquer, publicada como se fosse
  // atual. A leitura guardada carrega o próprio período ("20/09 a 25/09"), e
  // o portal e o jornal o exibem: o leitor sempre sabe de quando é o preço.
  // Como a ANP é semanal, na maioria das vezes ainda é a semana corrente.
  let anp = null;
  try {
    const csvLocal = (args.find((a) => a.startsWith('--anp-csv=')) || '').split('=')[1];
    anp = await lerPrecosAnp(csvLocal
      ? new TextDecoder('utf-8', { ignoreBOM: false }).decode(await readFile(csvLocal))
      : undefined);
    const s10 = anp.produtos.find((p) => p.nome === 'Diesel S10');
    log(`ANP: S10 ${brl(s10.media)} em ${anp.totalColetas} postos (${anp.periodo.de} a ${anp.periodo.ate})`);
    await writeFile(P.anpUltima, JSON.stringify(anp) + '\n', 'utf8');
  } catch (e) {
    console.warn(`  ! ANP indisponível: ${e.message}`);
    anp = await lerJson(P.anpUltima, null);
    if (anp) log(`ANP: usando a última leitura válida (${anp.periodo.de} a ${anp.periodo.ate})`);
    else console.warn('  ! Sem leitura anterior da ANP: o portal sai sem os blocos da bomba.');
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

  // Mercado de distribuição e market share (ANP). Os arquivos da ANP só mudam
  // dia 1 e dia 20, então basta a primeira rodada do dia baixar; as outras
  // usam o guardado. Falhou? Vale o último resultado bom — o portal mostra o
  // mês de referência — e a próxima rodada tenta de novo. Nunca derruba a
  // atualização.
  let share = await lerJson(P.shareTrr, null);
  if (share?.coletadoISO === iso(hoje) && share?.versao === VERSAO_SHARE) {
    log(`Market share: já coletado hoje (referência ${share.referencia.rotulo}).`);
  } else {
    log('Buscando mercado de distribuição e market share (ANP)...');
    try {
      const r = await lerShare();
      const base = r.share.baseANP;
      const csv = `dados/supriprice-market-share-${base}.csv`;
      const serie = `dados/share-serie-${base}.json`;
      // DIVULGAÇÃO: base com data nova = a ANP soltou números novos (dia 1 ou
      // 20). O jornal do dia ganha o bloco de market share por causa disso.
      const novaBase = share?.baseANP !== base;
      share = {
        versao: VERSAO_SHARE,
        coletadoISO: iso(hoje),
        divulgadoISO: novaBase || !share?.divulgadoISO ? iso(hoje) : share.divulgadoISO,
        publicados: novaBase ? [] : (share?.publicados || []),
        jornalBase: share?.jornalBase || null,
        jornalData: share?.jornalData || null,
        csv, serie,
        ...r.share
      };
      await mkdir(path.join(RAIZ, 'portal', 'dados'), { recursive: true });
      await writeFile(path.join(RAIZ, 'portal', csv), r.csv, 'utf8');
      await writeFile(path.join(RAIZ, 'portal', serie), JSON.stringify(r.serie), 'utf8');
      await writeFile(P.shareTrr, JSON.stringify(share) + '\n', 'utf8');
      const m = share.mercado, top = m.mes.top[0], trr = share.trrs.mes.top[0];
      log(`Mercado ${m.referencia.rotulo}${m.referencia.preliminar ? ' (preliminar)' : ''}: ${m.mes.total} mil m³ · ` +
        `líder ${top?.curto} ${top?.share}% · TRR líder ${trr?.curto} ${trr?.share}%` +
        (novaBase ? ` · BASE NOVA DA ANP (${base})` : ''));
    } catch (e) {
      console.warn(`  ! Market share indisponível: ${e.message}`);
      if (share) log(`Market share: usando o último guardado (referência ${share.referencia.rotulo}).`);
    }
  }
  // Arquivos grandes da aba (série ~230 KB, ranking CSV ~700 KB) sobem UMA vez
  // por base da ANP: o share-trr.json lembra o que já foi publicado. Se um
  // deles sumiu do disco antes de subir, o portal sai sem ele em vez de
  // apontar para o nada.
  const extrasShare = [];
  for (const campo of ['csv', 'serie']) {
    const arq = share?.[campo];
    if (!arq || (share.publicados || []).includes(arq)) continue;
    const local = path.join(RAIZ, 'portal', arq);
    if (existsSync(local)) extrasShare.push({ path: arq, content: await readFile(local, 'utf8') });
    else share = { ...share, [campo]: null };
  }

  const histAntes = await lerJson(P.historico, []);
  // "Ontem" é o boletim anterior ao que está sendo mostrado — no modo
  // parcial, o anterior ao último guardado, não ao dia de hoje.
  const ontem = histAntes.filter((p) => p.data < dataAbicomISO).slice(-1)[0];
  const anteriores = { diesel: ontem?.valor, gasolina: ontem?.gasolina };
  const historico = parcial
    ? histAntes
    : registrarHistorico(histAntes, hoje, def, abicom.gasolina?.defasagem);

  // --- jornal do dia -------------------------------------------------------
  // Só com boletim novo: a manchete do jornal nasce da defasagem do dia.
  let jornal = null;
  let jornalComShare = false;
  const edicoesAntes = await lerJson(P.edicoes, []);
  let edicoes = edicoesAntes;
  if (!parcial) {
    // Market share no jornal: na edição do dia em que a ANP divulga números
    // novos (e nas reedições desse mesmo dia). Se nesse dia não houver
    // edição, entra na próxima.
    const shareNoJornal = share?.mercado &&
      (share.jornalBase !== share.baseANP || share.jornalData === iso(hoje)) ? share : null;
    jornal = gerarJornal({ data: hoje, abicom, brent, dolar, anp, noticias, historico, indicadores, share: shareNoJornal });
    if (shareNoJornal) {
      jornalComShare = true;
      log(`Jornal: com o bloco de market share da ANP (${share.mercado.referencia.rotulo}).`);
    }
    await mkdir(P.relatorios, { recursive: true });
    await writeFile(path.join(P.relatorios, jornal.nomeArquivo), jornal.html, 'utf8');
    log(`Jornal: ${jornal.nomeArquivo} (${(jornal.html.length / 1024).toFixed(1)} KB) — "${jornal.titulo}"`);
    edicoes = [
      { data: iso(hoje), rotulo: ddmm(hoje), titulo: jornal.titulo, chamada: jornal.chamada,
        arquivo: `relatorios/${jornal.nomeArquivo}`, slug: `supriprice-${iso(hoje)}` },
      ...edicoesAntes.filter((e) => e.data !== iso(hoje))
    ].slice(0, MAX_EDICOES);
  } else {
    log('Jornal: mantido o da última edição (sem boletim novo da Abicom).');
  }

  // --- dados.js ------------------------------------------------------------
  const dados = {
    meta: {
      // dataISO = data do boletim da Abicom (o selo do topo fala dele);
      // atualizadoISO = dia desta execução (a faixa de mercado decide por ele
      // o que é cotação de hoje e o que é fechamento anterior).
      dataISO: dataAbicomISO,
      atualizadoISO: iso(hoje),
      fonte: `Fonte: Abicom/StoneX, fechamento ${abicom.data}`,
      siteUrl: 'https://www.supriprice.com.br/',
      gerado: new Date().toISOString()
    },
    produtos: montarProdutos(abicom, editorial, anteriores),
    indicadores,
    ticker: montarTicker(abicom, dolar, brent, anp, indicadores),
    serieS10: montarSerie(historico),
    polos: montarPolosAnp(anp) || [],
    polosTitulo: 'Preço médio do S10 por região',
    bomba: montarBomba(anp),
    anp: anp ? { maisCaros: anp.maisCaros, maisBaratos: anp.maisBaratos, referencia: anp.referencia } : null,
    share: share || null,
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

  // --- versão do dados.js no index.html ------------------------------------
  // O HTMLy serve .js com "Cache-Control: max-age=2592000, immutable": o
  // navegador guarda o arquivo por 30 dias sem nem perguntar se mudou. Com o
  // mesmo endereço todo dia, quem já visitou o site veria números velhos por
  // até um mês — foi assim que a faixa de mercado "sumiu" para quem tinha o
  // dados.js de antes dela. Cada atualização ganha um endereço novo
  // (dados.js?v=AAAAMMDD-HHMMSS); o index.html vem com "no-store", então o
  // navegador sempre acha a versão nova. O index vai ao disco também, para
  // uma publicação manual dele nunca apontar para uma versão antiga.
  const versao = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(new Date()).replace(/-/g, '').replace(' ', '-').replace(/:/g, '');
  const TEXTOS = {
    'index.html': { RESUMO: resumoHome({ abicom, anp, dolar }) },
    'market-share.html': {
      RESUMO: resumoShare(share),
      DESTAQUES: destaquesShare(share),
      DATASET: datasetJsonLd(share)
    }
  };
  const llms = llmsTxt({ abicom, anp, dolar, share, atualizadoISO: iso(hoje) });
  await writeFile(path.join(RAIZ, 'portal', 'llms.txt'), llms, 'utf8');

  // As duas páginas carregam o dados.js: as duas ganham o endereço novo.
  const REF_DADOS = /assets\/js\/dados\.js(\?v=[^"']*)?(["'])/g;
  const paginas = [];
  for (const nome of PAGINAS) {
    const antes = await readFile(path.join(RAIZ, 'portal', nome), 'utf8');
    const referencias = antes.match(REF_DADOS) || [];
    if (referencias.length !== 1) {
      throw new Error(`Esperava 1 referência ao dados.js em ${nome} e achei ${referencias.length}. Abortando para não publicar uma página que não carrega os números.`);
    }
    let html = antes.replace(REF_DADOS, `assets/js/dados.js?v=${versao}$2`);
    // Texto estático com os números do dia (para buscadores e IAs que leem a
    // página sem JavaScript). Marcador ausente não derruba nada: só avisa.
    for (const [marca, conteudo] of Object.entries(TEXTOS[nome] || {})) {
      if (!conteudo) continue;
      const r = injetar(html, marca, conteudo);
      if (r.ok) html = r.html; else console.warn(`  ! ${nome}: marcador ${marca} não encontrado.`);
    }
    await writeFile(path.join(RAIZ, 'portal', nome), html, 'utf8');
    paginas.push({ path: nome, content: html });
  }
  if (!parcial) {
    await writeFile(P.historico, JSON.stringify(historico, null, 2) + '\n', 'utf8');
    await writeFile(P.edicoes, JSON.stringify(edicoes, null, 2) + '\n', 'utf8');
  }
  log(`${parcial ? '[parcial] ' : ''}dados.js?v=${versao} ${(conteudo.length / 1024).toFixed(1)} KB · histórico ${historico.length} pontos · ${edicoes.length} edições`);

  if (SIMULAR) { log('Modo simulação: nada publicado.'); return; }

  log('Publicando no HTMLy...');
  const res = await publicarArquivos({
    slug: process.env.HTMLY_SLUG || 'supriprice',
    chave: process.env.HTMLY_API_KEY,
    arquivos: [
      // Tudo na mesma chamada: as páginas apontam para a versão nova do
      // dados.js no mesmo instante em que ela passa a existir.
      { path: 'assets/js/dados.js', content: conteudo },
      ...paginas,
      { path: 'llms.txt', content: llms },
      ...(jornal ? [{ path: `relatorios/${jornal.nomeArquivo}`, content: jornal.html }] : []),
      // Os arquivos da aba vão na MESMA chamada do dados.js que aponta para eles.
      ...extrasShare
    ]
  });
  log(`Publicado: ${res.url || ''} · ${res.storage_bytes ?? '?'} bytes`);
  if (share && (extrasShare.length || jornalComShare)) {
    share = {
      ...share,
      publicados: [...new Set([...(share.publicados || []), ...extrasShare.map((x) => x.path)])],
      ...(jornalComShare ? { jornalBase: share.baseANP, jornalData: iso(hoje) } : {})
    };
    await writeFile(P.shareTrr, JSON.stringify(share) + '\n', 'utf8');
    for (const x of extrasShare) log(`Market share publicado: ${x.path}`);
  }
}

principal().catch((e) => {
  console.error('\n✗ Falhou:', e.message);
  console.error('  Nada foi publicado. O site segue com os dados anteriores e o');
  console.error('  selo do topo avisa o leitor que a data não é de hoje.');
  process.exit(1);
});

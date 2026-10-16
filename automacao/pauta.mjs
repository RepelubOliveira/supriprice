// SupriPrice — a pauta do editor-chefe
// -----------------------------------------------------------------------------
// Pedido de 16/10/2026: o jornal tem que ser ESCRITO, não montado por regra.
// Todo dia, uma tarefa agendada do Claude (o "editor-chefe") lê o material do
// dia, escreve conteudo/pauta.json e publica. O robô usa a pauta quando ela é
// do dia; sem pauta, o editor automático (editor.mjs) segura a edição.
//
//   node automacao/pauta.mjs --material   tudo o que o editor precisa, num lugar só
//   node automacao/pauta.mjs --validar    confere a pauta antes de publicar
//
// Formato da pauta (conteudo/pauta.json):
// {
//   "data": "AAAA-MM-DD",            // só vale no dia
//   "chapeu": "...",                 // até 40 caracteres
//   "manchete": "...",               // até 95 caracteres
//   "lide": "...",                   // até 240; pode ter <strong>
//   "materia": {                     // o quadro do dia, texto autoral
//     "chapeu": "...", "titulo": "...",            // título até 80
//     "paragrafos": ["...", "..."],                // 2 ou 3, total até 520
//     "fontes": ["Veículo 1", "Veículo 2"]         // de onde vieram os fatos
//   },
//   "noticias": { "titulo": "...", "itens": [{ "titulo", "fonte", "url" }] }  // opcional, até 3
// }

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel, padrao = null) => {
  try { return JSON.parse(readFileSync(path.join(RAIZ, rel), 'utf8')); } catch { return padrao; }
};

export const LIMITES = { chapeu: 40, manchete: 95, lide: 240, materiaTitulo: 80, materiaTexto: 520 };

// MARCADORES: números que mudam durante o dia (a arbitragem anda a cada
// minuto e o jornal é refeito 6x). Na pauta, escreva {arb.diesel} em vez de
// "R$ 2,72": o robô põe o valor da rodada, igual ao dos quadros do jornal.
// Os limites de tamanho contam o marcador como ~8 caracteres.
const brlF = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
export function valoresMarcadores({ arbitragem: A, anp, indicadores }) {
  const v = {};
  for (const p of ['diesel', 'gasolina']) {
    const x = A?.[p];
    if (!x) continue;
    v[`arb.${p}`] = brlF(Math.abs(x.defasagem));
    v[`importado.${p}`] = brlF(x.ppi);
    v[`petrobras.${p}`] = brlF(x.petro);
    v[`pct.${p}`] = `${Math.abs(x.pct)}%`;
  }
  for (const p of anp?.produtos || []) {
    if (p.nome === 'Diesel S10') v.s10 = brlF(p.media);
    if (p.nome === 'Diesel S500') v.s500 = brlF(p.media);
  }
  for (const i of indicadores || []) {
    if (i.id === 'dolar') v.dolar = 'R$ ' + Number(i.valor).toFixed(2).replace('.', ',');
    if (i.id === 'brent') v.brent = 'US$ ' + Number(i.valor).toFixed(2).replace('.', ',');
    if (i.id === 'wti') v.wti = 'US$ ' + Number(i.valor).toFixed(2).replace('.', ',');
  }
  return v;
}

/** Troca os marcadores pelos valores; null se sobrar algum sem valor (aí vale o editor automático). */
export function preencherPauta(pauta, valores) {
  let faltou = false;
  const troca = (s) => typeof s !== 'string' ? s : s.replace(/\{([a-z0-9.]+)\}/gi, (m, k) => {
    if (valores[k] == null) { faltou = true; return m; }
    return valores[k];
  });
  const fundo = (o) => Array.isArray(o) ? o.map(fundo)
    : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fundo(x)])) : troca(o);
  const out = fundo(pauta);
  return faltou ? null : out;
}

/** A pauta de hoje, ou null (não existe, é de outro dia ou não passa na validação). */
export function lerPauta(hojeISO) {
  const p = ler('conteudo/pauta.json');
  if (!p || p.data !== hojeISO) return null;
  return validar(p).length ? null : p;
}

// Marcador conta como 8 caracteres ("R$ 2,72").
const semTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\{[a-z0-9.]+\}/gi, 'R$ 0,00');

export function validar(p) {
  const erros = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p?.data || '')) erros.push('data ausente ou fora do formato AAAA-MM-DD');
  for (const [campo, max] of [['chapeu', LIMITES.chapeu], ['manchete', LIMITES.manchete], ['lide', LIMITES.lide]]) {
    const t = semTags(p?.[campo]);
    if (!t.trim()) erros.push(`${campo} vazio`);
    else if (t.length > max) erros.push(`${campo} com ${t.length} caracteres (máximo ${max})`);
  }
  if (/<(?!\/?strong>)[^>]+>/i.test(p?.lide || '')) erros.push('lide só aceita <strong>');
  const m = p?.materia;
  if (m) {
    if (!m.titulo || m.titulo.length > LIMITES.materiaTitulo) erros.push(`materia.titulo vazio ou com mais de ${LIMITES.materiaTitulo}`);
    const tam = semTags((m.paragrafos || []).join(' ')).length;
    if (!(m.paragrafos || []).length || m.paragrafos.length > 3) erros.push('materia.paragrafos: 1 a 3 parágrafos');
    if (tam > LIMITES.materiaTexto) erros.push(`materia com ${tam} caracteres (máximo ${LIMITES.materiaTexto})`);
  }
  for (const n of p?.noticias?.itens || []) {
    if (!/^https?:\/\//.test(n.url || '') || !n.titulo || !n.fonte) erros.push('noticias.itens: cada item precisa de titulo, fonte e url');
  }
  return erros;
}

/** Tudo o que o editor precisa para escrever a edição de hoje. */
function material() {
  const dados = (() => {
    try {
      const t = readFileSync(path.join(RAIZ, 'portal', 'assets', 'js', 'dados.js'), 'utf8');
      return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    } catch { return {}; }
  })();
  const arb = ler('conteudo/arbitragem-ultima.json');
  const ed = ler('conteudo/editorial.json', {});
  const anp = ler('conteudo/anp-ultima.json');
  const edicoes = ler('conteudo/edicoes.json', []);
  const neg = ler('conteudo/negocios.json', {});
  const L = 3.785411784;
  const causa = (prod) => {
    const c1 = arb?.insumos?.[prod], c0 = arb?.anteriores?.[prod], d1 = arb?.insumos?.dolar, d0 = arb?.anteriores?.dolar;
    if (!c1 || !c0 || !d1 || !d0) return null;
    const ant = (c0 / L) * d0 + arb.custos[prod] - arb.precos[prod];
    return {
      nyVarPct: +((c1 / c0 - 1) * 100).toFixed(2), dolarVarPct: +((d1 / d0 - 1) * 100).toFixed(2),
      arbitragemAnterior: +ant.toFixed(2), variacaoNoDia: +(arb[prod].defasagem - ant).toFixed(2)
    };
  };
  const noticias = Object.fromEntries(Object.entries(dados.noticias || {}).map(([ed2, lista]) =>
    [ed2, (lista || []).slice(0, 8).map((n) => ({ titulo: n.titulo, fonte: n.fonte, url: n.url, data: n.data, resumo: n.resumo }))]));
  return {
    hoje: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
    regras: 'Use só os números abaixo. Notícia: só fatos do título/resumo, com o veículo. Ver automacao/pauta.mjs para o formato.',
    marcadores: {
      uso: 'Para números que mudam no dia, escreva o marcador entre chaves (ex.: {arb.diesel}); o robô põe o valor de cada rodada.',
      valoresAgora: valoresMarcadores({ arbitragem: arb, anp, indicadores: dados.indicadores })
    },
    arbitragem: arb && {
      quando: arb.quandoISO,
      diesel: { ...arb.diesel, causa: causa('diesel') },
      gasolina: { ...arb.gasolina, causa: causa('gasolina') },
      novaYork: arb.insumos, fechamentoAnterior: arb.anteriores,
      ultimosPregoes: (arb.serie || []).slice(-10).map((p) => `${p.rotulo}: diesel ${p.diesel} · gasolina ${p.gasolina}`),
      nota: 'arbitragem = preço de importação − preço da Petrobras (R$/L). pct = diferença sobre o preço da Petrobras. Não dizer "X% abaixo da paridade".'
    },
    mercado: (dados.indicadores || []).map((i) => `${i.nome}: ${i.valor} (${i.variacao > 0 ? '+' : ''}${i.variacao}% · ${i.data} ${i.hora || ''})`),
    bomba: anp && { periodo: anp.periodo, produtos: anp.produtos, regioes: anp.regioes, maisCaros: anp.maisCaros, maisBaratos: anp.maisBaratos },
    marketShare: dados.share && {
      referencia: dados.share.mercado?.referencia, total: dados.share.mercado?.mes?.total,
      top: dados.share.mercado?.mes?.top?.slice(0, 5), trrs: dados.share.trrs?.mes?.top?.slice(0, 5),
      previa: dados.share.previa && { mes: dados.share.previa.rotulo, mercado: dados.share.previa.mercado, trrs: dados.share.previa.trrs }
    },
    agenda: ed.agenda, analiseDaSemana: ed.analise && { manchete: ed.analise.manchete, chapeu: ed.analise.chapeu, de: ed.analise.de, ate: ed.analise.ate },
    precosPetrobras: ed.precosPetrobras,
    // Negócios do setor (M&A, Cade) estão em noticias.negocios; aqui, quando cada um apareceu.
    negociosVistosEm: neg.vistos || {},
    noticias,
    ultimasEdicoes: edicoes.slice(0, 10).map((e) => `${e.data} · ${e.titulo}`),
    pautaAnterior: ler('conteudo/pauta.json')
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--material')) {
    console.log(JSON.stringify(material(), null, 1));
  } else if (process.argv.includes('--validar')) {
    const p = ler('conteudo/pauta.json');
    const erros = p ? validar(p) : ['conteudo/pauta.json não existe ou não é JSON válido'];
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    if (p && p.data !== hoje) erros.push(`a pauta é de ${p.data}, hoje é ${hoje}`);
    console.log(erros.length ? 'PAUTA COM PROBLEMA:\n- ' + erros.join('\n- ') : 'Pauta ok para hoje.');
    process.exitCode = erros.length ? 1 : 0;
  } else {
    console.log('Uso: node automacao/pauta.mjs --material | --validar');
  }
}

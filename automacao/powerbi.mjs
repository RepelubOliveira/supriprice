/**
 * SupriPrice — leitor dos painéis públicos de Power BI da ANP
 * -----------------------------------------------------------------------------
 * PARA QUÊ: a planilha de dados abertos da ANP (share.mjs) é a fonte oficial
 * do market share, mas sai só no dia 1 (mês retrasado) e no dia 20 (prévia do
 * mês anterior). Os painéis de Power BI da ANP mostram o mês corrente ANTES,
 * à medida que os agentes declaram no SIMP. A pedido do dono (14/10/2026),
 * enquanto a planilha não traz um mês, o robô lê esse mês no Power BI e o
 * site mostra como PRÉVIA PARCIAL; quando a planilha sai, vale ela.
 *
 * COMO: os painéis são "publicar na Web" (públicos, sem login). O navegador
 * de quem abre o painel consulta a API de consulta do Power BI com a chave
 * pública que está no próprio endereço do painel (view?r=...). Fazemos a
 * mesma consulta. Não é uma API documentada: se a Microsoft ou a ANP mudarem
 * algo, isto falha e o site simplesmente fica com a planilha.
 */

import { nomeCurto, ESTADOS } from './share.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const API = 'https://wabi-brazil-south-api.analysis.windows.net';
const PAGINAS = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/paineis-dinamicos-da-anp/paineis-dinamicos-do-abastecimento/';

/** Chave pública e modelo do painel, lidos da página do gov.br (a ANP pode trocar o relatório). */
export async function abrirPainel(pagina) {
  try { return await abrirPainelUmaVez(pagina); } catch { await new Promise((ok) => setTimeout(ok, 4000)); return abrirPainelUmaVez(pagina); }
}

async function abrirPainelUmaVez(pagina) {
  const html = await (await fetch(PAGINAS + pagina, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) })).text();
  const r = (html.match(/app\.powerbi\.com\/view\?r=([A-Za-z0-9=_-]+)/) || [])[1];
  if (!r) throw new Error(`Power BI: não achei o painel na página ${pagina}.`);
  const { k } = JSON.parse(Buffer.from(r, 'base64').toString('utf8'));
  const m = await (await fetch(`${API}/public/reports/${k}/modelsAndExploration?preferReadOnlySession=true`,
    { headers: { 'X-PowerBI-ResourceKey': k }, signal: AbortSignal.timeout(60000) })).json();
  const modelId = m.models?.[0]?.id;
  if (!modelId) throw new Error(`Power BI: painel ${pagina} sem modelo.`);
  return { chave: k, modelId };
}

const col = (s, p) => ({ Column: { Expression: { SourceRef: { Source: s } }, Property: p } });
const soma = (s, p) => ({ Aggregation: { Expression: col(s, p), Function: 0 } });
const em = (s, p, vals) => ({ Condition: { In: { Expressions: [col(s, p)], Values: vals.map((v) => [{ Literal: { Value: v } }]) } } });
export const PBI = { col, soma, em };

/** Decodifica o formato compacto do Power BI (DSR) em objetos { nome: valor }. */
function decodificar(j, nomes) {
  const ds = j.results?.[0]?.result?.data?.dsr?.DS?.[0];
  if (!ds) throw new Error('Power BI: resposta sem dados ' + JSON.stringify(j?.results?.[0]?.result?.data?.dsr?.DataShapes?.[0]?.['odata.error'] || j).slice(0, 300));
  if (ds.RT || ds.IC === false) { /* janela cheia: quem chama pede por partes */ }
  const dicts = ds.ValueDicts || {};
  const linhas = ds.PH?.[0]?.DM0 || [];
  if (!linhas.length) return { linhas: [], completo: true };
  const schema = linhas[0].S;
  const out = []; let ant = [];
  for (const l of linhas) {
    const R = l.R || 0, N = l['Ø'] || 0;
    const c = l.C || schema.map((s) => l[s.N]);
    let k = 0; const v = [];
    for (let i = 0; i < schema.length; i++) {
      if (R & (1 << i)) v[i] = ant[i];
      else if (N & (1 << i)) v[i] = null;
      // Coluna com dicionário: número = posição no dicionário; texto = valor
      // literal (o Power BI para de usar o dicionário depois de ~100 valores).
      else { let x = c[k++]; if (schema[i].DN && typeof x === 'number') x = dicts[schema[i].DN][x]; v[i] = x; }
    }
    ant = v;
    out.push(Object.fromEntries(nomes.map((n, i) => [n, v[i]])));
  }
  // IC = false: a resposta foi cortada na janela (há mais linhas).
  return { linhas: out, completo: ds.IC !== false };
}

/**
 * Consulta agrupada. `campos` = [[nome, expressão]], `de` = tabelas, `onde` = filtros.
 * Devolve as linhas; erro se a resposta vier cortada (melhor falhar que mostrar pela metade).
 */
export async function consultar(painel, { de, campos, onde = [] }) {
  const Select = campos.map(([nome, expr]) => ({ ...expr, Name: nome }));
  const body = { version: '1.0.0', modelId: painel.modelId, cancelQueries: [], queries: [{ QueryId: '', Query: { Commands: [{
    SemanticQueryDataShapeCommand: {
      Query: { Version: 2, From: de.map(([Name, Entity]) => ({ Name, Entity, Type: 0 })), Select, Where: onde },
      Binding: { Primary: { Groupings: [{ Projections: Select.map((_, i) => i) }] },
        DataReduction: { DataVolume: 4, Primary: { Window: { Count: 30000 } } }, Version: 1 }
    } }] } }] };
  let ultimo;
  for (let t = 1; t <= 2; t++) {
    try {
      const r = await fetch(`${API}/public/reports/querydata?synchronous=true`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PowerBI-ResourceKey': painel.chave, 'User-Agent': UA },
        body: JSON.stringify(body), signal: AbortSignal.timeout(90000)
      });
      if (!r.ok) throw new Error(`Power BI HTTP ${r.status}`);
      const { linhas, completo } = decodificar(await r.json(), campos.map(([n]) => n));
      if (!completo) throw new Error('Power BI: resposta cortada (mais de 30 mil linhas).');
      return linhas;
    } catch (e) { ultimo = e; if (t < 2) await new Promise((ok) => setTimeout(ok, 3000)); }
  }
  throw ultimo;
}

/* ---------------------------------------------------- prévia do market share */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (m) => `${MESES[+m.slice(5, 7) - 1]}/${m.slice(2, 4)}`;
const mesSeguinte = (m) => { let [a, mm] = m.split('-').map(Number); mm++; if (mm > 12) { mm = 1; a++; } return `${a}-${String(mm).padStart(2, '0')}`; };
const mesAnterior = (m) => { let [a, mm] = m.split('-').map(Number); mm--; if (mm < 1) { mm = 12; a--; } return `${a}-${String(mm).padStart(2, '0')}`; };
const chaveNome = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// A partir de quanto do volume do mês anterior já declarado a prévia vira
// ranking com participação. Abaixo disso, quem não declarou (em 14/10/2026,
// Ipiranga e Raízen no mercado geral) distorce tudo: a Vibra apareceria com
// 63% de participação. Aí o site mostra só quanto cada empresa já declarou.
const COBERTURA_RANKING = 0.9;

/**
 * Volume por empresa e UF de destino num mês: { BR: Map, porUf: { MG: Map, ... } },
 * cada Map(chave -> { nome, volume }). Uma consulta só (empresa x UF).
 */
async function porEmpresa(painel, { fato, empresa, tipo }, mes) {
  const linhas = await consultar(painel, {
    de: [['f', fato], ['t', 'DM_TEMPO'], ['e', empresa]],
    campos: [['ag', col('e', 'NOM_RAZAO_SOCIAL')], ['uf', col('f', 'SIG_UF_DEST')], ['q', soma('f', 'QTD_PRODUTO')]],
    onde: [em('t', 'ANO', [`${+mes.slice(0, 4)}L`]), em('t', 'NUM_MES', [`${+mes.slice(5, 7)}L`]), em('f', 'TIPO_EXTRACAO', [`'${tipo}'`])]
  });
  const out = { BR: new Map(), porUf: {} };
  const somar = (m, k, nome, q) => { const a = m.get(k) || { nome, volume: 0 }; a.volume += q; m.set(k, a); };
  for (const l of linhas) {
    const q = +l.q || 0;
    if (q <= 0) continue;
    const k = chaveNome(l.ag), nome = String(l.ag).replace(/\s+/g, ' ').trim();
    somar(out.BR, k, nome, q);
    const uf = String(l.uf || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(uf)) somar(out.porUf[uf] ||= new Map(), k, nome, q);
  }
  return out;
}

/** Um bloco da prévia a partir dos volumes do mês e do anterior (Brasil ou um estado). */
function bloco(agora, antes) {
  if (!agora?.size || !antes?.size) return null;
  const soma = (m) => [...m.values()].reduce((s, x) => s + x.volume, 0);
  const totalAntes = soma(antes), total = soma(agora);
  // Cobertura: quanto do mercado do mês anterior já declarou este mês.
  let antesDeclarado = 0;
  for (const [k, x] of antes) if (agora.has(k)) antesDeclarado += x.volume;
  const cobertura = totalAntes ? antesDeclarado / totalAntes : 0;
  const top5Antes = [...antes.entries()].sort((a, b) => b[1].volume - a[1].volume).slice(0, 5);
  const faltam = top5Antes.filter(([k]) => !agora.has(k)).map(([, x]) => nomeCurto(x.nome));
  const ranking = cobertura >= COBERTURA_RANKING && !faltam.length;
  const top = [...agora.entries()].sort((a, b) => b[1].volume - a[1].volume).slice(0, ranking ? 5 : 8).map(([k, x], i) => {
    const ant = antes.get(k)?.volume;
    const item = { pos: i + 1, nome: x.nome, curto: nomeCurto(x.nome), volume: r1(x.volume),
      varPct: ant ? r1(((x.volume - ant) / ant) * 100) : null };
    if (ranking) {
      item.share = r2((x.volume / total) * 100);
      item.deltaPP = r2(item.share - (ant ? (ant / totalAntes) * 100 : 0));
    }
    return item;
  });
  return {
    ranking, cobertura: r2(cobertura * 100), total: r1(total),
    agentes: agora.size, agentesAntes: antes.size, faltam, top
  };
}

async function blocos(painel, fonte, mes, comEstados) {
  const [agora, antes] = await Promise.all([porEmpresa(painel, fonte, mes), porEmpresa(painel, fonte, mesAnterior(mes))]);
  return {
    BR: bloco(agora.BR, antes.BR),
    porUf: comEstados ? Object.fromEntries(ESTADOS.map((uf) => [uf, bloco(agora.porUf[uf], antes.porUf[uf])])) : {}
  };
}

/**
 * Prévia do mês seguinte ao último da planilha, lida no Power BI. Null se o
 * mês ainda não terminou ou se o Power BI não tem nada dele.
 * Brasil em mercado/trrs/distribuidoras; os estados da aba em `estados[UF]`
 * (mercado e TRRs: as fornecedoras de TRR, como na planilha, só no Brasil).
 * @param {string} refMes último mês da planilha ('2026-08')
 * @param {string} hojeISO
 */
export async function lerPreviaShare(refMes, hojeISO) {
  const mes = mesSeguinte(refMes);
  if (mes >= hojeISO.slice(0, 7)) return null; // mês corrente: os agentes declaram depois que ele acaba
  const [liq, trr] = await Promise.all([
    abrirPainel('painel-dinamico-do-mercado-brasileiro-de-combustiveis-liquidos'),
    abrirPainel('painel-dinamico-do-mercado-brasileiro-de-trr')
  ]);
  const [mercado, trrs, distribuidoras] = await Promise.all([
    blocos(liq, { fato: '(Movimento) - FT_SDL_MOVIMENTO', empresa: '(Movimento) - DM_SIMP_EMPRESA', tipo: 'Vendas' }, mes, true),
    blocos(trr, { fato: 'FT_SDL_MOVIMENTO_TRR', empresa: 'DM_SIMP_EMPRESA', tipo: 'TRR' }, mes, true),
    blocos(trr, { fato: 'FT_SDL_MOVIMENTO_TRR', empresa: 'DM_SIMP_EMPRESA', tipo: 'DISTRIBUIDOR' }, mes, false)
  ]);
  if (!mercado.BR && !trrs.BR && !distribuidoras.BR) return null;
  return {
    mes, rotulo: rotuloMes(mes), anterior: rotuloMes(mesAnterior(mes)),
    fonte: 'ANP · Painéis Dinâmicos do Abastecimento (Power BI), prévia enquanto a planilha não sai',
    lidoEm: new Date().toISOString(),
    mercado: mercado.BR, trrs: trrs.BR, distribuidoras: distribuidoras.BR,
    estados: Object.fromEntries(ESTADOS.map((uf) => [uf, { mercado: mercado.porUf[uf], trrs: trrs.porUf[uf] }]))
  };
}

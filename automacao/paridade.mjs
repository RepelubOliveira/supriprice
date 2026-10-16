// SupriPrice — ARBITRAGEM SUPRIPRICE: a nossa própria paridade de importação
// -----------------------------------------------------------------------------
// Um número nosso, com método aberto, que não depende da Abicom.
//
//   Preço de importação (R$/L) = cotação em Nova York (US$/galão) ÷ 3,785 L
//                                × dólar + custo de trazer (R$/L)
//   Arbitragem (R$/L)          = preço de importação − preço da Petrobras
//
//   Diesel:   contrato futuro de ULSD da NYMEX (HO=F, "heating oil")
//   Gasolina: contrato futuro de RBOB da NYMEX (RB=F)
//   Dólar:    USDBRL=X
//   Fonte:    Yahoo Finance (as mesmas cotações da faixa do site)
//
// "Custo de trazer" junta o que não tem cotação pública diária: frete
// marítimo do Golfo dos EUA ao Brasil, seguro, diferença entre o contrato de
// Nova York e o preço à vista do Golfo, custos de porto e internação. Ele é
// CALIBRADO (`node automacao/paridade.mjs --calibrar`) e fica em
// conteudo/editorial.json → arbitragemSupriPrice. Pode ser negativo: o
// contrato de Nova York costuma valer mais que o diesel à vista do Golfo, de
// onde o Brasil importa.
//
// O preço da Petrobras (R$/L, média das refinarias) é o de
// editorial.json → precosPetrobras. Reajuste da Petrobras = atualizar lá.
//
// O site recalcula ao vivo, a cada minuto, com a mesma fórmula (app.js) e as
// cotações da função do Supabase (supabase/functions/cotacoes).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LITROS_POR_GALAO = 3.785411784;
const SIMBOLOS = { diesel: 'HO=F', gasolina: 'RB=F', dolar: 'USDBRL=X' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const diaSP = (seg) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(seg * 1000));

async function grafico(simbolo, range = '3mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?interval=1d&range=${range}`;
  let erro;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const res = (await r.json())?.chart?.result?.[0];
      if (!res?.meta?.regularMarketPrice) throw new Error('sem cotação');
      const fech = new Map();
      (res.timestamp || []).forEach((t, k) => {
        const v = res.indicators?.quote?.[0]?.close?.[k];
        if (Number.isFinite(v)) fech.set(diaSP(t), v);
      });
      return {
        atual: res.meta.regularMarketPrice,
        quando: new Date(res.meta.regularMarketTime * 1000),
        fechamentos: fech
      };
    } catch (e) { erro = e; }
  }
  throw new Error(`${simbolo}: ${erro.message}`);
}

/** Fechamento do pregão anterior (null se o Yahoo não responder: o jornal só omite a causa). */
async function fechamentoAnterior(simbolo) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?interval=1d&range=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const v = (await r.json())?.chart?.result?.[0]?.meta?.chartPreviousClose;
    return Number.isFinite(v) && v > 0 ? r4(v) : null;
  } catch { return null; }
}

/** Preço de importação e arbitragem de um produto, em R$/L. */
export function calcular({ usdPorGalao, dolar, custo, petro }) {
  const ppi = (usdPorGalao / LITROS_POR_GALAO) * dolar + custo;
  const defasagem = ppi - petro;
  return { ppi: r4(ppi), petro, defasagem: r2(defasagem), pct: petro ? Math.round((defasagem / petro) * 100) : null };
}

/**
 * Lê as cotações e devolve a arbitragem de agora e a série diária (um ponto
 * por pregão, com o fechamento do dia).
 * @param {{ precos: {diesel:number, gasolina:number}, custos: {diesel:number, gasolina:number}, pregoes?: number }} o
 */
export async function lerArbitragem({ precos, custos, pregoes = 30 }) {
  const [ho, rb, usd] = await Promise.all([grafico(SIMBOLOS.diesel), grafico(SIMBOLOS.gasolina), grafico(SIMBOLOS.dolar)]);
  const prod = (nome, cot, dolar) => calcular({ usdPorGalao: cot, dolar, custo: custos[nome], petro: precos[nome] });

  // Série: dias com as três cotações; o dólar do mesmo dia (ou o último antes).
  const diasUsd = [...usd.fechamentos.keys()].sort();
  const dolarEm = (d) => { let v = null; for (const k of diasUsd) { if (k <= d) v = usd.fechamentos.get(k); else break; } return v; };
  const serie = [...ho.fechamentos.keys()].sort()
    .filter((d) => rb.fechamentos.has(d) && dolarEm(d))
    .slice(-pregoes)
    .map((d) => {
      const dol = dolarEm(d);
      return { data: d, rotulo: `${d.slice(8, 10)}/${d.slice(5, 7)}`,
        diesel: prod('diesel', ho.fechamentos.get(d), dol).defasagem,
        gasolina: prod('gasolina', rb.fechamentos.get(d), dol).defasagem };
    });

  const quando = new Date(Math.max(ho.quando, rb.quando, usd.quando));
  // Fechamento do pregão ANTERIOR: o jornal diz o que moveu o número (Nova
  // York ou dólar). Vem do chartPreviousClose da consulta de UM dia, como a
  // faixa de cotações (ver fontes.mjs): a série diária tem as datas
  // desalinhadas no câmbio e daria outro "ontem".
  const [antHo, antRb, antUsd] = await Promise.all([SIMBOLOS.diesel, SIMBOLOS.gasolina, SIMBOLOS.dolar].map(fechamentoAnterior));
  return {
    metodo: 'Arbitragem SupriPrice',
    quandoISO: quando.toISOString(),
    insumos: { diesel: r4(ho.atual), gasolina: r4(rb.atual), dolar: r4(usd.atual) },
    anteriores: { diesel: antHo, gasolina: antRb, dolar: antUsd },
    custos, precos, litrosPorGalao: LITROS_POR_GALAO,
    diesel: prod('diesel', ho.atual, usd.atual),
    gasolina: prod('gasolina', rb.atual, usd.atual),
    serie
  };
}

/* ------------------------------------------------------------ calibração */

// Ajusta o "custo de trazer" para que, em média, a nossa paridade acompanhe
// a da Abicom nos boletins guardados (conteudo/historico.json). Cada boletim
// do dia D usa o fechamento do pregão anterior. Usa a MEDIANA da diferença
// (um dia estranho não puxa o custo). Só mostra: quem grava é a pessoa.
async function calibrar() {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hist = JSON.parse(await readFile(path.join(raiz, 'conteudo', 'historico.json'), 'utf8'));
  const ed = JSON.parse(await readFile(path.join(raiz, 'conteudo', 'editorial.json'), 'utf8'));
  const precos = ed.precosPetrobras;
  const [ho, rb, usd] = await Promise.all([grafico(SIMBOLOS.diesel, '6mo'), grafico(SIMBOLOS.gasolina, '6mo'), grafico(SIMBOLOS.dolar, '6mo')]);
  const antes = (m, d) => { let v = null; for (const k of [...m.keys()].sort()) { if (k < d) v = m.get(k); else break; } return v; };
  const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  for (const [nome, cot, campo] of [['diesel', ho, 'valor'], ['gasolina', rb, 'gasolina']]) {
    const difs = [];
    for (const h of hist) {
      if (typeof h[campo] !== 'number') continue;
      const c = antes(cot.fechamentos, h.data), d = antes(usd.fechamentos, h.data);
      if (!c || !d) continue;
      difs.push(precos[nome] + h[campo] - (c / LITROS_POR_GALAO) * d);
    }
    const custo = mediana(difs);
    const erro = difs.reduce((s, x) => s + Math.abs(x - custo), 0) / (difs.length || 1);
    console.log(`${nome}: custo de trazer sugerido ${custo?.toFixed(3)} R$/L · ${difs.length} boletins · erro médio ${erro.toFixed(3)} R$/L`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--calibrar')) await calibrar();
  else {
    const ed = JSON.parse(await readFile(new URL('../conteudo/editorial.json', import.meta.url), 'utf8'));
    const a = await lerArbitragem({ precos: ed.precosPetrobras, custos: ed.arbitragemSupriPrice.custos });
    console.log(JSON.stringify({ ...a, serie: a.serie.slice(-5) }, null, 1));
  }
}

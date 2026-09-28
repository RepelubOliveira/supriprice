// SupriPrice — preços na bomba, direto da ANP
// -----------------------------------------------------------------------------
// A ANP publica em dados abertos o levantamento semanal de preços, posto a
// posto: região, estado, município, produto, data da coleta e valor de venda.
// São ~21 mil coletas de diesel nas últimas 4 semanas.
//
// Aqui esse arquivo vira: média nacional por produto, média por região, os
// estados mais caros e mais baratos, e a variação em relação à semana anterior.
//
// Fonte: https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos
// Licença: dados abertos da ANP (Creative Commons).

const BASE = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/qus/';
const ARQUIVO_DIESEL = 'ultimas-4-semanas-diesel-gnv.csv';
const UA = 'Mozilla/5.0 (compatible; SupriPriceBot/1.0; +https://supriprice.htmly.com.br)';

const NOME_REGIAO = { N: 'Norte', NE: 'Nordeste', CO: 'Centro-Oeste', SE: 'Sudeste', S: 'Sul' };

/** "7,59" -> 7.59 */
function valor(s) {
  const n = parseFloat(String(s).trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** "31/08/2026" -> Date */
function dataBR(s) {
  const m = String(s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function media(lista) {
  if (!lista.length) return null;
  return lista.reduce((a, b) => a + b, 0) / lista.length;
}

function mediana(lista) {
  if (!lista.length) return null;
  const o = [...lista].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/**
 * O CSV vem em UTF-8 com BOM, separado por ponto e vírgula.
 * Nenhum campo usado aqui contém aspas ou separador interno, então um split
 * simples basta — e evita arrastar uma biblioteca de CSV para o projeto.
 */
async function baixarCsv(arquivo) {
  const r = await fetch(BASE + arquivo, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(90000)
  });
  if (!r.ok) throw new Error(`ANP respondeu HTTP ${r.status} para ${arquivo}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  // ignoreBOM:false faz o TextDecoder comer o BOM sozinho; a limpeza abaixo
  // cobre o caso de a ANP mudar para um arquivo sem BOM ou em Latin-1.
  return new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes);
}

export async function lerPrecosAnp() {
  const texto = await baixarCsv(ARQUIVO_DIESEL);
  const linhas = texto.split(/\r?\n/);
  if (linhas.length < 100) throw new Error('CSV da ANP veio menor que o esperado.');

  // Tira o BOM, venha ele como U+FEFF (UTF-8 decodificado) ou como "ï»¿"
  // (os mesmos bytes lidos por engano como Latin-1).
  const cabecalho = linhas[0]
    .replace(/^﻿/, '')
    .replace(/^ï»¿/, '')
    .split(';')
    .map((c) => c.trim());
  const col = (nome) => {
    const i = cabecalho.findIndex((c) => c.toLowerCase() === nome.toLowerCase());
    if (i < 0) throw new Error(`Coluna "${nome}" não existe no CSV da ANP. O formato mudou.`);
    return i;
  };
  const iRegiao = col('Regiao - Sigla');
  const iEstado = col('Estado - Sigla');
  const iProduto = col('Produto');
  const iData = col('Data da Coleta');
  const iValor = col('Valor de Venda');

  // Só diesel: o arquivo também traz GNV.
  const coletas = [];
  for (let i = 1; i < linhas.length; i++) {
    const c = linhas[i].split(';');
    if (c.length < cabecalho.length) continue;
    const produto = (c[iProduto] || '').trim().toUpperCase();
    if (!produto.startsWith('DIESEL')) continue;
    const v = valor(c[iValor]);
    const d = dataBR(c[iData]);
    if (!v || !d || v < 1 || v > 30) continue;
    coletas.push({
      regiao: (c[iRegiao] || '').trim(),
      estado: (c[iEstado] || '').trim(),
      produto: produto.includes('S10') ? 'Diesel S10' : 'Diesel S500',
      data: d,
      valor: v
    });
  }
  if (coletas.length < 500) throw new Error(`Só ${coletas.length} coletas válidas de diesel. Abortando.`);

  // As "semanas" são definidas pela própria data de coleta.
  const datas = [...new Set(coletas.map((c) => c.data.getTime()))].sort((a, b) => b - a);
  const maisRecente = datas[0];
  const inicioSemana = maisRecente - 6 * 86400000;
  const inicioAnterior = inicioSemana - 7 * 86400000;

  const daSemana = coletas.filter((c) => c.data.getTime() > inicioSemana);
  const daAnterior = coletas.filter(
    (c) => c.data.getTime() > inicioAnterior && c.data.getTime() <= inicioSemana
  );

  const porProduto = (lista, produto) => lista.filter((c) => c.produto === produto).map((c) => c.valor);

  const produtos = ['Diesel S10', 'Diesel S500'].map((p) => {
    const atual = porProduto(daSemana, p);
    const antes = porProduto(daAnterior, p);
    const m = media(atual);
    const mAntes = media(antes);
    return {
      nome: p,
      media: m ? Number(m.toFixed(3)) : null,
      mediana: mediana(atual) ? Number(mediana(atual).toFixed(3)) : null,
      minimo: atual.length ? Number(Math.min(...atual).toFixed(2)) : null,
      maximo: atual.length ? Number(Math.max(...atual).toFixed(2)) : null,
      variacao: m && mAntes ? Number((m - mAntes).toFixed(3)) : null,
      coletas: atual.length
    };
  }).filter((p) => p.media);

  if (!produtos.length) throw new Error('Nenhum produto com média válida no CSV da ANP.');

  // S10 é a referência do portal para os recortes geográficos.
  const s10Semana = daSemana.filter((c) => c.produto === 'Diesel S10');

  const agrupar = (chave) => {
    const mapa = new Map();
    for (const c of s10Semana) {
      const k = c[chave];
      if (!k) continue;
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(c.valor);
    }
    return [...mapa.entries()]
      .map(([k, vs]) => ({ chave: k, media: Number(media(vs).toFixed(3)), coletas: vs.length }))
      .filter((x) => x.coletas >= 5); // menos que isso não é média, é acaso
  };

  const regioes = agrupar('regiao')
    .map((r) => ({ nome: NOME_REGIAO[r.chave] || r.chave, media: r.media, coletas: r.coletas }))
    .sort((a, b) => b.media - a.media);

  const estados = agrupar('estado').sort((a, b) => b.media - a.media);

  return {
    referencia: new Date(maisRecente).toISOString().slice(0, 10),
    periodo: {
      de: new Date(inicioSemana + 86400000).toISOString().slice(0, 10),
      ate: new Date(maisRecente).toISOString().slice(0, 10)
    },
    totalColetas: daSemana.length,
    produtos,
    regioes,
    maisCaros: estados.slice(0, 5).map((e) => ({ estado: e.chave, media: e.media })),
    maisBaratos: estados.slice(-5).reverse().map((e) => ({ estado: e.chave, media: e.media })),
    fonte: 'ANP — Levantamento de Preços de Combustíveis'
  };
}

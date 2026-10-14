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

import { lerZip } from './share.mjs';

const BASE = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/qus/';
const ARQUIVO_DIESEL = 'ultimas-4-semanas-diesel-gnv.csv';
// Mesmo motivo do fontes.mjs: cabeçalho de navegador passa pelas triagens
// automáticas sem ser barrado pela origem do pedido.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

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
  // Duas tentativas: o gov.br às vezes fica lento a ponto de estourar os 90 s
  // (aconteceu em 30/09/2026, às 17h41) e na tentativa seguinte responde.
  // A leitura do corpo fica DENTRO da repetição: o limite de tempo também
  // corta o download no meio, e é aí que a lentidão costuma aparecer.
  let bytes, ultimoErro;
  for (let tentativa = 1; tentativa <= 2 && !bytes; tentativa++) {
    try {
      const r = await fetch(BASE + arquivo, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(90000)
      });
      if (!r.ok) throw new Error(`ANP respondeu HTTP ${r.status} para ${arquivo}`);
      bytes = new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      ultimoErro = e;
      if (tentativa < 2) await new Promise((ok) => setTimeout(ok, 5000));
    }
  }
  if (!bytes) throw ultimoErro;
  // ignoreBOM:false faz o TextDecoder comer o BOM sozinho; a limpeza abaixo
  // cobre o caso de a ANP mudar para um arquivo sem BOM ou em Latin-1.
  return new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes);
}

/**
 * Quebra o CSV em linhas e células respeitando aspas. Uns 2% das linhas da ANP
 * têm ";" ou aspas dentro do endereço (ex.: complemento "LOJA 1; BOX 2"); com
 * um split simples elas saíam com as colunas deslocadas e eram descartadas
 * (em 14/10/2026: 3.087 postos de S10 lidos contra 3.136 da ANP).
 */
function celulasCsv(txt) {
  const out = [];
  let linha = [], cel = '', aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (aspas) {
      if (ch === '"') { if (txt[i + 1] === '"') { cel += '"'; i++; } else aspas = false; }
      else cel += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ';') { linha.push(cel); cel = ''; }
    else if (ch === '\n') { linha.push(cel.replace(/\r$/, '')); out.push(linha); linha = []; cel = ''; }
    else cel += ch;
  }
  if (cel || linha.length) { linha.push(cel); out.push(linha); }
  return out;
}

/**
 * @param {string} [textoPronto] conteúdo de um CSV já baixado. Sem ele, baixa
 *   do gov.br. Existe para semear conteudo/anp-ultima.json quando o gov.br
 *   está lento demais (node automacao/atualizar.mjs --anp-csv=arquivo.csv).
 */
export async function lerPrecosAnp(textoPronto) {
  const texto = textoPronto ?? await baixarCsv(ARQUIVO_DIESEL);
  // Tira o BOM, venha ele como U+FEFF (UTF-8 decodificado) ou como "ï»¿"
  // (os mesmos bytes lidos por engano como Latin-1).
  const linhas = celulasCsv(texto.replace(/^﻿/, '').replace(/^ï»¿/, ''));
  if (linhas.length < 100) throw new Error('CSV da ANP veio menor que o esperado.');

  const cabecalho = linhas[0].map((c) => c.trim());
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
    const c = linhas[i];
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

  const base = {
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
  return comResumoOficial(base);
}

/* ------------------------------------------------ síntese semanal oficial */

// As médias que a ANP DIVULGA (e a imprensa cita) saem do "resumo semanal"
// em Excel, não da média simples dos postos do CSV: a ANP pondera (em
// 14/10/2026, mesmos 25 postos de S10 em Alagoas: R$ 7,58 na média simples,
// R$ 7,33 no resumo; Brasil S500 R$ 7,05 x R$ 6,98). Por isso as médias do
// Brasil, das regiões e dos estados vêm do resumo; o CSV posto a posto fica
// de reserva (se a página ou o Excel falharem) e para a mediana.
const PAGINA_LPC = 'https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/' +
  'levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas';

const UF_SIGLA = {
  ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA', CEARA: 'CE', 'DISTRITO FEDERAL': 'DF',
  'ESPIRITO SANTO': 'ES', GOIAS: 'GO', MARANHAO: 'MA', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS',
  'MINAS GERAIS': 'MG', PARA: 'PA', PARAIBA: 'PB', PARANA: 'PR', PERNAMBUCO: 'PE', PIAUI: 'PI',
  'RIO DE JANEIRO': 'RJ', 'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', RONDONIA: 'RO',
  RORAIMA: 'RR', 'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', SERGIPE: 'SE', TOCANTINS: 'TO'
};
const REGIAO_NOME = { NORTE: 'Norte', NORDESTE: 'Nordeste', 'CENTRO OESTE': 'Centro-Oeste', SUDESTE: 'Sudeste', SUL: 'Sul' };
// No resumo, "ÓLEO DIESEL" é o S500 comum (nota da própria planilha).
const PRODUTO_RESUMO = { 'OLEO DIESEL S10': 'Diesel S10', 'OLEO DIESEL': 'Diesel S500' };

const semAcentoMaius = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const xmlTexto = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Abas de um .xlsx como listas de linhas (valores em texto). Sem dependências. */
function lerXlsx(buf, abas) {
  const BASE = ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'];
  const a = lerZip(buf, BASE, 'resumo da ANP');
  const wb = a[BASE[0]].dados.toString('utf8'), rels = a[BASE[1]].dados.toString('utf8');
  const textos = [...a[BASE[2]].dados.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => xmlTexto([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const alvo = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)) {
    if (!abas.includes(m[1])) continue;
    const rel = rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${m[2]}"[^>]*\\bTarget="([^"]+)"`))
      || rels.match(new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${m[2]}"`));
    if (rel) alvo[m[1]] = 'xl/' + rel[1].replace(/^\/?xl\//, '');
  }
  const arqs = lerZip(buf, Object.values(alvo), 'resumo da ANP');
  const coluna = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const saida = {};
  for (const [aba, caminho] of Object.entries(alvo)) {
    const xml = arqs[caminho].dados.toString('utf8');
    saida[aba] = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
      const linha = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (c[1].match(/\br="([A-Z]+\d+)"/) || [])[1];
        const tipo = (c[1].match(/\bt="([^"]+)"/) || [])[1];
        const v = ((c[2] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const inl = ((c[2] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        const val = tipo === 's' ? textos[+v] : tipo === 'inlineStr' ? xmlTexto(inl || '') : v != null ? xmlTexto(v) : '';
        linha[ref ? coluna(ref) : linha.length] = val;
      }
      return linha;
    });
  }
  return saida;
}

/** Linhas de uma aba do resumo como objetos, a partir do cabeçalho "DATA INICIAL". */
function tabela(linhas) {
  const i = (linhas || []).findIndex((l) => semAcentoMaius(l?.[0]) === 'DATA INICIAL');
  if (i < 0) return [];
  const cab = linhas[i].map(semAcentoMaius);
  return linhas.slice(i + 1).filter((l) => l?.[0]).map((l) => Object.fromEntries(cab.map((c, k) => [c, l[k]])));
}

/** Data do Excel (número de série ou texto) -> AAAA-MM-DD. */
function dataXlsx(v) {
  if (/^\d+(\.\d+)?$/.test(String(v))) return new Date(Math.round((+v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})|(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? (m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5]}-${m[4]}`) : null;
}

async function baixarBinario(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`ANP respondeu HTTP ${r.status} para ${url.split('/').pop()}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Lê um resumo semanal: { de, ate, produtos{nome:{media,min,max,postos}}, regioes, estados } (só diesel). */
function lerResumo(buf) {
  const abas = lerXlsx(buf, ['BRASIL', 'REGIOES', 'ESTADOS']);
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const out = { de: null, ate: null, produtos: {}, regioes: [], estados: [] };
  for (const r of tabela(abas.BRASIL)) {
    const p = PRODUTO_RESUMO[semAcentoMaius(r.PRODUTO)];
    if (!p) continue;
    out.de = dataXlsx(r['DATA INICIAL']); out.ate = dataXlsx(r['DATA FINAL']);
    out.produtos[p] = { media: num(r['PRECO MEDIO REVENDA']), minimo: num(r['PRECO MINIMO REVENDA']),
      maximo: num(r['PRECO MAXIMO REVENDA']), postos: num(r['NUMERO DE POSTOS PESQUISADOS']) };
  }
  for (const r of tabela(abas.REGIOES)) {
    if (PRODUTO_RESUMO[semAcentoMaius(r.PRODUTO)] !== 'Diesel S10') continue;
    out.regioes.push({ nome: REGIAO_NOME[semAcentoMaius(r.REGIAO)] || r.REGIAO, media: num(r['PRECO MEDIO REVENDA']),
      coletas: num(r['NUMERO DE POSTOS PESQUISADOS']) });
  }
  for (const r of tabela(abas.ESTADOS)) {
    if (PRODUTO_RESUMO[semAcentoMaius(r.PRODUTO)] !== 'Diesel S10') continue;
    const uf = UF_SIGLA[semAcentoMaius(r.ESTADOS)];
    if (uf) out.estados.push({ estado: uf, media: num(r['PRECO MEDIO REVENDA']), postos: num(r['NUMERO DE POSTOS PESQUISADOS']) });
  }
  if (!out.produtos['Diesel S10']?.media || !out.de) throw new Error('resumo semanal sem o diesel S10.');
  return out;
}

/**
 * Troca as médias calculadas do CSV pelas oficiais do resumo semanal da
 * mesma semana (ou de uma mais nova). Qualquer falha: fica o cálculo do CSV.
 */
async function comResumoOficial(base) {
  try {
    const pagina = await (await fetch(PAGINA_LPC, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) })).text();
    const links = [...new Set([...pagina.matchAll(/href="([^"]*resumo_semanal_lpc[^"]*\.xlsx)"/gi)]
      .map((m) => new URL(m[1], PAGINA_LPC).href))];
    if (!links.length) throw new Error('não achei o link do resumo semanal na página da ANP.');
    const atual = lerResumo(await baixarBinario(links[0]));
    if (atual.de < base.periodo.de) throw new Error(`resumo (${atual.de}) mais velho que o CSV (${base.periodo.de}).`);
    let anterior = null;
    try { if (links[1]) anterior = lerResumo(await baixarBinario(links[1])); } catch { /* sem variação */ }

    const mesmaSemana = atual.de === base.periodo.de;
    const produtos = ['Diesel S10', 'Diesel S500'].filter((p) => atual.produtos[p]?.media).map((p) => {
      const o = atual.produtos[p], csv = base.produtos.find((x) => x.nome === p);
      const ant = anterior?.produtos[p]?.media;
      return {
        nome: p, media: o.media,
        mediana: mesmaSemana ? csv?.mediana ?? null : null,
        minimo: o.minimo, maximo: o.maximo,
        variacao: ant ? Number((o.media - ant).toFixed(3)) : null,
        coletas: o.postos
      };
    });
    const estados = atual.estados.filter((e) => e.postos >= 5 && e.media).sort((a, b) => b.media - a.media);
    return {
      ...base,
      referencia: atual.ate,
      periodo: { de: atual.de, ate: atual.ate },
      totalColetas: produtos.reduce((s, p) => s + (p.coletas || 0), 0),
      produtos,
      regioes: atual.regioes.length ? atual.regioes.sort((a, b) => b.media - a.media) : base.regioes,
      maisCaros: estados.length >= 10 ? estados.slice(0, 5).map(({ estado, media }) => ({ estado, media })) : base.maisCaros,
      maisBaratos: estados.length >= 10 ? estados.slice(-5).reverse().map(({ estado, media }) => ({ estado, media })) : base.maisBaratos,
      fonte: 'ANP — Levantamento de Preços de Combustíveis (síntese semanal)',
      origem: 'resumo-semanal'
    };
  } catch (e) {
    console.warn(`  ! Resumo semanal da ANP indisponível (${e.message}); médias calculadas do CSV posto a posto.`);
    return { ...base, origem: 'csv' };
  }
}

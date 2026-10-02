/**
 * SupriPrice — market share do mercado de TRR (ANP)
 * -----------------------------------------------------------------------------
 * FONTE: a base de dados que a própria ANP usa no "Painel Dinâmico do Mercado
 * Brasileiro de TRR" (Power BI), publicada como dados abertos em trr.zip:
 *   https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/mdpg/trr.zip
 * Os dados vêm do SIMP (declaração mensal dos agentes). Segundo a ANP, o
 * arquivo é atualizado duas vezes por mês: dia 1 com o mês retrasado
 * (consolidado) e dia 20 com o mês anterior (preliminar).
 *
 * Ler a planilha e não o Power BI: o painel é só uma vista destes mesmos
 * arquivos, e a planilha é um download simples e estável, como o da ANP de
 * preços que o robô já faz.
 *
 * Dos seis CSVs do zip, usamos dois:
 *   TRR_Vendas_Dist_Atual.csv  — o que cada DISTRIBUIDORA vendeu aos TRRs
 *                                ("Fornecimento por Distribuidor" no painel)
 *   TRR_Vendas_TRR_Atual.csv   — o que cada TRR vendeu ao consumidor final,
 *                                com a UF de destino ("Mercado TRR")
 *
 * RODA UMA VEZ POR DIA: o robô roda 3x ao dia, mas o zip só muda duas vezes
 * por mês. A primeira rodada do dia baixa (5 MB, poucos segundos) e guarda o
 * resultado em conteudo/share-trr.json; as outras reaproveitam. Se a ANP não
 * responder, vale o último resultado guardado — o portal mostra o mês de
 * referência, então o leitor sempre sabe de quando é o número.
 *
 * Teste isolado:  node automacao/share.mjs
 */

import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const URL_TRR = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/mdpg/trr.zip';
export const URL_PAINEL = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/paineis-dinamicos-da-anp/paineis-dinamicos-do-abastecimento/painel-dinamico-do-mercado-brasileiro-de-trr';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Estados em destaque no portal, na ordem pedida. */
export const ESTADOS = [
  ['MG', 'Minas Gerais'], ['SP', 'São Paulo'], ['MS', 'Mato Grosso do Sul'],
  ['RJ', 'Rio de Janeiro'], ['DF', 'Distrito Federal'], ['GO', 'Goiás'],
  ['BA', 'Bahia'], ['SC', 'Santa Catarina'], ['PR', 'Paraná']
];

const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
const REGIOES = new Set(['N', 'NE', 'CO', 'SE', 'S']);

const TOP = 5;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/* ------------------------------------------------------------- download */

async function baixar(url) {
  let ultimo;
  for (let i = 1; i <= 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      ultimo = e;
      if (i < 2) await new Promise((res) => setTimeout(res, 3000));
    }
  }
  throw new Error(`ANP (trr.zip): ${ultimo?.message || ultimo}`);
}

/* ------------------------------------------------------------------ zip */

/**
 * Leitor de zip mínimo (só o que este arquivo usa: deflate ou sem compressão,
 * sem zip64). Evita trazer uma dependência para o projeto, que hoje roda só
 * com o Node puro. Devolve { nome: { dados: Buffer, dataISO } }.
 */
export function lerZip(buf, nomes) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('trr.zip: arquivo zip inválido (sem diretório central).');

  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const saida = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('trr.zip: diretório central corrompido.');
    const metodo = buf.readUInt16LE(p + 10);
    const hora = buf.readUInt16LE(p + 12);
    const data = buf.readUInt16LE(p + 14);
    const tamComp = buf.readUInt32LE(p + 20);
    const lenNome = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lenNome);
    p += 46 + lenNome + lenExtra + lenComent;
    if (!nomes.includes(nome)) continue;

    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const bruto = buf.subarray(ini, ini + tamComp);
    let dados;
    if (metodo === 8) dados = inflateRawSync(bruto);
    else if (metodo === 0) dados = bruto;
    else throw new Error(`trr.zip: compressão ${metodo} não suportada em ${nome}.`);

    const dd = (v) => String(v).padStart(2, '0');
    const dataISO = `${(data >> 9) + 1980}-${dd((data >> 5) & 15)}-${dd(data & 31)}`;
    saida[nome] = { dados, dataISO, hora: `${dd(hora >> 11)}:${dd((hora >> 5) & 63)}` };
  }
  for (const nome of nomes) if (!saida[nome]) throw new Error(`trr.zip: não encontrei ${nome}. A ANP mudou o arquivo?`);
  return saida;
}

/* ------------------------------------------------------------------ CSV */

/**
 * Lê o CSV da ANP (latin-1, ";", decimal com vírgula). Localiza as colunas
 * pelo CONTEÚDO, não só pelo nome: no TRR_Vendas_TRR_Atual o cabeçalho diz
 * "UF de Origem; Região de Origem" mas os dados vêm na ordem inversa
 * ("SE;SP"). Se a ANP corrigir o cabeçalho, a leitura continua certa.
 */
function lerCsv(buf, rotulo) {
  const linhas = buf.toString('latin1').split(/\r?\n/).filter((l) => l.trim());
  const celulas = (l) => l.split(';').map((c) => c.trim().replace(/^"|"$/g, '').trim());
  const cab = celulas(linhas[0]).map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
  const corpo = linhas.slice(1).map(celulas);
  if (!corpo.length) throw new Error(`${rotulo}: arquivo vazio.`);

  const col = (re) => cab.findIndex((c) => re.test(c));
  const iAno = col(/^ano$/);
  const iMes = col(/^mes$/);
  const iAgente = col(/agente|distribuidor/);
  const iQtd = col(/quantidade/);
  if ([iAno, iMes, iAgente, iQtd].some((i) => i < 0)) {
    throw new Error(`${rotulo}: colunas esperadas não encontradas (${cab.join(' | ')}).`);
  }

  // Colunas de UF: quase todos os valores são siglas de estado (a de destino
  // traz também "NI", não informado) e ao menos um não é sigla de região (SE
  // é Sergipe e também Sudeste). Na ordem do arquivo: origem, destino.
  const amostra = corpo.slice(0, 5000);
  const ufs = [];
  for (let c = 0; c < cab.length; c++) {
    const vals = amostra.map((l) => l[c]);
    const emUf = vals.filter((v) => UFS.has(v)).length;
    if (emUf >= vals.length * 0.9 && vals.some((v) => UFS.has(v) && !REGIOES.has(v))) ufs.push(c);
  }
  if (ufs.length === 1) ufs.length = 0; // só uma coluna de UF: não dá para saber se é a de destino

  const reg = [];
  for (const l of corpo) {
    const ano = +l[iAno], mes = +l[iMes];
    const qtd = +String(l[iQtd]).replace(/\./g, '').replace(',', '.');
    if (!ano || !mes || !Number.isFinite(qtd)) continue;
    reg.push({
      mes: `${ano}-${String(mes).padStart(2, '0')}`,
      agente: l[iAgente],
      ufDestino: ufs.length ? l[ufs[ufs.length - 1]] : null,
      qtd
    });
  }
  if (!reg.length) throw new Error(`${rotulo}: nenhuma linha válida.`);
  return { reg, temUf: ufs.length > 0 };
}

/* ---------------------------------------------------------------- nomes */

// Grafias conhecidas: o nome jurídico das grandes é longo e ninguém as chama
// assim. O resto passa pela limpeza automática abaixo.
const APELIDOS = {
  'VIBRA ENERGIA': 'Vibra Energia',
  'IPIRANGA PRODUTOS DE PETROLEO': 'Ipiranga',
  'RAIZEN': 'Raízen'
};

/** Chave de agrupamento: maiúsculas, sem acento, sem espaço duplo. */
function chave(nome) {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
// Forma jurídica no fim do nome: "S.A.", "S/A", "LTDA", "EIRELI"...
const SUFIXO = /[\s.,-]+(S\/A|S\.?\s?A|LTDA|EIRELI|EPP|ME)\.?\s*$/i;

function semSufixo(t) {
  while (SUFIXO.test(t)) t = t.replace(SUFIXO, '').trim();
  return t;
}

/** "RIO BRANCO DERIVADOS DE PETROLEO  LTDA" → "Rio Branco Derivados de Petroleo". */
export function nomeCurto(nome) {
  const k = semSufixo(chave(nome));
  if (APELIDOS[k]) return APELIDOS[k];
  const limpo = semSufixo(nome.replace(/\s+/g, ' ').trim())
    // A atividade por extenso vira a sigla que o mercado usa.
    .replace(/\bTRANSPORTADORA?,? REVENDEDORA? (E )?RETALHISTA\b/i, 'TRR');
  return limpo.toLowerCase().split(' ').map((p, i) => {
    if (i > 0 && MINUSCULAS.has(p)) return p;
    // Sigla: até 3 letras sem vogal ("MS", "2M") ou TRR.
    if (/^[^aeiouáéíóúâêôãõ]{1,3}$/i.test(p) && /[a-z]/i.test(p) || p === 'trr') return p.toUpperCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}

/* --------------------------------------------------------------- contas */

function rotuloMes(m) {
  const [a, mm] = m.split('-');
  return `${MESES[+mm - 1]}/${a.slice(2)}`;
}

function mesAnterior(m, n = 1) {
  let [a, mm] = m.split('-').map(Number);
  mm -= n;
  while (mm < 1) { mm += 12; a--; }
  return `${a}-${String(mm).padStart(2, '0')}`;
}

/** Soma por agente num conjunto de meses (e opcionalmente numa UF). */
function somar(reg, meses, uf) {
  const porChave = new Map();
  let total = 0;
  for (const r of reg) {
    if (!meses.has(r.mes) || (uf && r.ufDestino !== uf)) continue;
    const k = chave(r.agente);
    const atual = porChave.get(k) || { volume: 0, nomes: new Map() };
    atual.volume += r.qtd;
    atual.nomes.set(r.agente, (atual.nomes.get(r.agente) || 0) + r.qtd);
    porChave.set(k, atual);
    total += r.qtd;
  }
  return { porChave, total };
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/** Top N de um período, com a variação de participação sobre outro período. */
function ranking(reg, meses, uf, mesesComparar) {
  const { porChave, total } = somar(reg, meses, uf);
  const comp = mesesComparar ? somar(reg, mesesComparar, uf) : null;
  const top = [...porChave.entries()]
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, TOP)
    .map(([k, v], i) => {
      // O nome mais usado no período (a grafia muda de um mês para outro).
      const nome = [...v.nomes.entries()].sort((a, b) => b[1] - a[1])[0][0].replace(/\s+/g, ' ').trim();
      const share = total ? (v.volume / total) * 100 : 0;
      const item = { pos: i + 1, nome, curto: nomeCurto(nome), volume: r1(v.volume), share: r2(share) };
      if (comp && comp.total) {
        const antes = comp.porChave.get(k);
        item.deltaPP = r2(share - (antes ? (antes.volume / comp.total) * 100 : 0));
      }
      return item;
    });
  return { total: r1(total), agentes: porChave.size, top };
}

/**
 * Monta o bloco "share" do dados.js a partir do conteúdo do trr.zip.
 * Período "mes": último mês da base, com variação em pontos percentuais sobre
 * o mês anterior. Período "ano": soma dos últimos 12 meses.
 */
export function calcularShare(zipBuf) {
  const NOMES = ['TRR_Vendas_Dist_Atual.csv', 'TRR_Vendas_TRR_Atual.csv'];
  const arq = lerZip(zipBuf, NOMES);
  const dist = lerCsv(arq[NOMES[0]].dados, NOMES[0]);
  const trr = lerCsv(arq[NOMES[1]].dados, NOMES[1]);
  if (!trr.temUf) throw new Error(`${NOMES[1]}: não achei a coluna de UF.`);

  const meses = [...new Set(trr.reg.map((r) => r.mes))].sort();
  const ref = meses[meses.length - 1];
  const ant = mesAnterior(ref);
  const doze = new Set(Array.from({ length: 12 }, (_, i) => mesAnterior(ref, i)));
  const soRef = new Set([ref]), soAnt = new Set([ant]);
  const temAnterior = meses.includes(ant);

  // Dia 20 a ANP publica o mês anterior como PRELIMINAR; dia 1, o retrasado
  // consolidado. Base com data no mês seguinte ao de referência = preliminar.
  const dataBase = arq[NOMES[1]].dataISO;
  const preliminar = mesAnterior(dataBase.slice(0, 7)) === ref;

  const bloco = (reg, uf) => ({
    mes: ranking(reg, soRef, uf, temAnterior ? soAnt : null),
    ano: ranking(reg, doze, uf)
  });

  return {
    fonte: 'ANP · SIMP — Painel Dinâmico do Mercado Brasileiro de TRR',
    urlPainel: URL_PAINEL,
    urlDados: URL_TRR,
    baseANP: dataBase,
    referencia: { mes: ref, rotulo: rotuloMes(ref), anterior: temAnterior ? rotuloMes(ant) : null, preliminar },
    janela: { de: rotuloMes(mesAnterior(ref, 11)), ate: rotuloMes(ref) },
    unidade: 'mil m³',
    distribuidoras: bloco(dist.reg),
    trrs: bloco(trr.reg),
    estados: ESTADOS.map(([uf, nome]) => ({ uf, nome, ...bloco(trr.reg, uf) }))
  };
}

/** Baixa o trr.zip e calcula. Lança erro se a ANP não responder. */
export async function lerShareTrr() {
  return calcularShare(await baixar(URL_TRR));
}

/* --------------------------------------------------------- teste isolado */

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const s = await lerShareTrr();
  const linha = (t) => t.top.map((x) => `${x.pos}. ${x.curto} ${x.share.toFixed(1)}%` +
    (x.deltaPP != null ? ` (${x.deltaPP > 0 ? '+' : ''}${x.deltaPP.toFixed(2)} p.p.)` : '')).join(' | ');
  console.log(`Base ANP de ${s.baseANP} · referência ${s.referencia.rotulo}${s.referencia.preliminar ? ' (preliminar)' : ''}`);
  console.log(`Distribuidoras (${s.distribuidoras.mes.agentes}, ${s.distribuidoras.mes.total} mil m³): ${linha(s.distribuidoras.mes)}`);
  console.log(`TRRs Brasil (${s.trrs.mes.agentes}): ${linha(s.trrs.mes)}`);
  console.log(`TRRs Brasil 12 meses (${s.janela.de}–${s.janela.ate}): ${linha(s.trrs.ano)}`);
  for (const e of s.estados) console.log(`  ${e.uf} (${e.mes.agentes}, ${e.mes.total}): ${linha(e.mes)}`);
}

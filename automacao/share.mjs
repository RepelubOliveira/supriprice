/**
 * SupriPrice — mercado de distribuição e market share (ANP)
 * -----------------------------------------------------------------------------
 * FONTES: as bases que a própria ANP usa nos Painéis Dinâmicos do
 * Abastecimento (Power BI), publicadas como dados abertos ("Movimentação de
 * Derivados e Biocombustíveis"). Ler a planilha e não o Power BI: o painel é
 * só uma vista destes mesmos arquivos, e a planilha é um download simples e
 * estável, como o da ANP de preços que o robô já faz.
 *
 *   trr.zip       (5 MB)  — Painel Dinâmico do Mercado Brasileiro de TRR
 *     TRR_Vendas_Dist_Atual.csv    o que cada DISTRIBUIDORA vendeu aos TRRs
 *     TRR_Vendas_TRR_Atual.csv     o que cada TRR vendeu ao consumidor final
 *   liquidos.zip  (21 MB) — Painel do Mercado Brasileiro de Combustíveis Líquidos
 *     Liquidos_Vendas_Atual.csv    TUDO o que as distribuidoras venderam:
 *                                  produto, UF de destino e canal (posto
 *                                  bandeirado, bandeira branca, consumidor
 *                                  final, TRR)
 *
 * Os dados vêm do SIMP (declaração mensal dos agentes). A ANP atualiza dia 1
 * (mês retrasado, consolidado) e dia 20 (mês anterior, preliminar).
 *
 * RODA UMA VEZ POR DIA: o robô roda 3x ao dia, mas os arquivos só mudam duas
 * vezes por mês. A primeira rodada do dia baixa e guarda o resultado em
 * conteudo/share-trr.json; as outras reaproveitam. As duas bases são exigidas
 * juntas: se uma falhar, vale o último resultado guardado inteiro (o portal
 * mostra o mês de referência) e a próxima rodada tenta de novo.
 *
 * Além do resumo para o portal, gera o RANKING COMPLETO em CSV (todas as
 * empresas, Brasil e cada estado, mês e 12 meses), para baixar e abrir no Excel.
 *
 * Teste isolado:  node automacao/share.mjs
 */

import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BASE = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo';
export const URL_TRR = `${BASE}/dados-abertos/arquivos/mdpg/trr.zip`;
export const URL_LIQUIDOS = `${BASE}/dados-abertos/arquivos/mdpg/liquidos.zip`;
export const URL_PAINEL_TRR = `${BASE}/paineis-dinamicos-da-anp/paineis-dinamicos-do-abastecimento/painel-dinamico-do-mercado-brasileiro-de-trr`;
export const URL_PAINEL_LIQUIDOS = `${BASE}/paineis-dinamicos-da-anp/paineis-dinamicos-do-abastecimento/painel-dinamico-do-mercado-brasileiro-de-combustiveis-liquidos`;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Estados em destaque no portal, na ordem pedida. O CSV traz todos. */
export const ESTADOS = ['MG', 'SP', 'MS', 'RJ', 'DF', 'GO', 'BA', 'SC', 'PR'];

const NOME_UF = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins'
};
const UFS = new Set(Object.keys(NOME_UF));
const REGIOES = new Set(['N', 'NE', 'CO', 'SE', 'S']);

const TOP = 5;
const SERIE_TOP = 25;   // empresas guardadas por mês na série da aba
const ANO_INICIO = 2024; // primeiro ano da série
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/* ------------------------------------------------------------- download */

async function baixar(url, rotulo) {
  let ultimo;
  for (let i = 1; i <= 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      ultimo = e;
      if (i < 2) await new Promise((res) => setTimeout(res, 3000));
    }
  }
  throw new Error(`ANP (${rotulo}): ${ultimo?.message || ultimo}`);
}

/* ------------------------------------------------------------------ zip */

/**
 * Leitor de zip mínimo (só o que estes arquivos usam: deflate ou sem
 * compressão, sem zip64). Evita trazer uma dependência para o projeto, que
 * hoje roda só com o Node puro. Devolve { nome: { dados: Buffer, dataISO } }.
 */
export function lerZip(buf, nomes, rotulo = 'zip') {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error(`${rotulo}: arquivo zip inválido (sem diretório central).`);

  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const saida = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${rotulo}: diretório central corrompido.`);
    const metodo = buf.readUInt16LE(p + 10);
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
    else throw new Error(`${rotulo}: compressão ${metodo} não suportada em ${nome}.`);

    const dd = (v) => String(v).padStart(2, '0');
    saida[nome] = { dados, dataISO: `${(data >> 9) + 1980}-${dd((data >> 5) & 15)}-${dd(data & 31)}` };
  }
  for (const nome of nomes) if (!saida[nome]) throw new Error(`${rotulo}: não encontrei ${nome}. A ANP mudou o arquivo?`);
  return saida;
}

/* ------------------------------------------------------------------ CSV */

const semAcento = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Lê o CSV da ANP (latin-1, ";", decimal com vírgula). Localiza as colunas
 * pelo CONTEÚDO, não só pelo nome: no TRR_Vendas_TRR_Atual o cabeçalho diz
 * "UF de Origem; Região de Origem" mas os dados vêm na ordem inversa
 * ("SE;SP"). Se a ANP corrigir o cabeçalho, a leitura continua certa.
 *
 * anoMinimo descarta cedo as linhas antigas: o Liquidos_Vendas_Atual tem
 * 1 milhão de linhas desde 2017, e só os dois últimos anos interessam.
 */
function lerCsv(buf, rotulo, { anoMinimo = 0 } = {}) {
  const txt = buf.toString('latin1');
  const celulas = (l) => l.split(';').map((c) => c.trim().replace(/^"|"$/g, '').trim());
  let pos = txt.indexOf('\n');
  if (pos < 0) throw new Error(`${rotulo}: arquivo vazio.`);
  const cab = celulas(txt.slice(0, pos)).map((c) => semAcento(c).toLowerCase());

  const col = (re) => cab.findIndex((c) => re.test(c));
  const iAno = col(/^ano$/);
  const iMes = col(/^mes$/);
  const iAgente = col(/agente|distribuidor/);
  const iQtd = col(/quantidade/);
  const iProduto = col(/^nome do produto$/);
  const iMercado = col(/mercado destinat/);
  if ([iAno, iMes, iAgente, iQtd].some((i) => i < 0)) {
    throw new Error(`${rotulo}: colunas esperadas não encontradas (${cab.join(' | ')}).`);
  }

  const linhas = [];
  while (pos < txt.length) {
    const fim = txt.indexOf('\n', pos + 1);
    const l = txt.slice(pos + 1, fim < 0 ? txt.length : fim);
    pos = fim < 0 ? txt.length : fim;
    if (!l.trim()) continue;
    // Atalho: com o ano na 1ª coluna, nem quebra a linha se ela for antiga.
    if (anoMinimo && iAno === 0 && +l.replace(/^"/, '').slice(0, 4) < anoMinimo) continue;
    linhas.push(celulas(l));
  }
  if (!linhas.length) throw new Error(`${rotulo}: nenhuma linha no período.`);

  // Colunas de UF: quase todos os valores são siglas de estado (a de destino
  // traz também "NI", não informado) e ao menos um não é sigla de região (SE
  // é Sergipe e também Sudeste). Na ordem do arquivo: origem, destino.
  const amostra = linhas.slice(0, 5000);
  const ufs = [];
  for (let c = 0; c < cab.length; c++) {
    const vals = amostra.map((l) => l[c]);
    const emUf = vals.filter((v) => UFS.has(v)).length;
    if (emUf >= vals.length * 0.9 && vals.some((v) => UFS.has(v) && !REGIOES.has(v))) ufs.push(c);
  }
  const iUf = ufs.length >= 2 ? ufs[ufs.length - 1] : -1; // só uma: não dá para saber se é a de destino

  const reg = [];
  for (const l of linhas) {
    const ano = +l[iAno], mes = +l[iMes];
    const qtd = +String(l[iQtd]).replace(/\./g, '').replace(',', '.');
    if (!ano || !mes || !Number.isFinite(qtd)) continue;
    reg.push({
      mes: `${ano}-${String(mes).padStart(2, '0')}`,
      agente: l[iAgente],
      uf: iUf >= 0 ? l[iUf] : null,
      produto: iProduto >= 0 ? l[iProduto] : null,
      mercado: iMercado >= 0 ? l[iMercado] : null,
      qtd
    });
  }
  if (!reg.length) throw new Error(`${rotulo}: nenhuma linha válida.`);
  return { reg, temUf: iUf >= 0 };
}

/* ---------------------------------------------------------------- nomes */

// Grafias conhecidas: o nome jurídico das grandes é longo e ninguém as chama
// assim. O resto passa pela limpeza automática abaixo.
const APELIDOS = {
  'VIBRA ENERGIA': 'Vibra Energia',
  'IPIRANGA PRODUTOS DE PETROLEO': 'Ipiranga',
  'RAIZEN': 'Raízen',
  'ALE COMBUSTIVEIS': 'ALE Combustíveis',
  "ATEM' S DISTRIBUIDORA DE PETROLEO": 'Atem',
  'PETROLEO SABBA': 'Sabbá'
};

/** Chave de agrupamento: maiúsculas, sem acento, sem espaço duplo. */
function chave(nome) {
  return semAcento(nome).toUpperCase().replace(/\s+/g, ' ').trim();
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

/** Canal de venda da ANP → rótulo do portal. TRR e "TRRNI" viram um só. */
function canal(m) {
  const k = semAcento(m || '').toUpperCase();
  if (k.startsWith('TRR')) return 'TRRs';
  if (k.includes('BANDEIRA BRANCA')) return 'Postos bandeira branca';
  if (k.includes('BANDEIRADO')) return 'Postos bandeirados';
  if (k.includes('CONSUMIDOR FINAL')) return 'Consumidor final';
  return m ? m.charAt(0) + m.slice(1).toLowerCase() : 'Outros';
}

function produto(p) {
  const k = semAcento(p || '').toUpperCase();
  if (k.startsWith('OLEO COMB')) return 'Óleo combustível';
  if (k.startsWith('ETANOL')) return 'Etanol hidratado';
  return p || 'Outros';
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

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/** Soma por agente num conjunto de meses, com filtro opcional (UF). */
function somar(reg, meses, filtro) {
  const porChave = new Map();
  let total = 0;
  for (const r of reg) {
    if (!meses.has(r.mes) || (filtro && !filtro(r))) continue;
    const k = chave(r.agente);
    let a = porChave.get(k);
    if (!a) { a = { volume: 0, nomes: new Map() }; porChave.set(k, a); }
    a.volume += r.qtd;
    a.nomes.set(r.agente, (a.nomes.get(r.agente) || 0) + r.qtd);
    total += r.qtd;
  }
  return { porChave, total };
}

/**
 * Ranking de um período. limite = 5 para o portal, Infinity para o CSV.
 * Com mesesComparar, cada item traz a variação da participação em pontos
 * percentuais (ganho ou perda de mercado).
 */
function ranking(reg, meses, { filtro, comparar, limite = TOP } = {}) {
  const { porChave, total } = somar(reg, meses, filtro);
  const comp = comparar ? somar(reg, comparar, filtro) : null;
  const top = [...porChave.entries()]
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, limite)
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

/** Volume por uma dimensão (produto, canal), do maior para o menor. */
function composicao(reg, meses, rotular) {
  const s = new Map();
  let total = 0;
  for (const r of reg) {
    if (!meses.has(r.mes)) continue;
    const k = rotular(r);
    s.set(k, (s.get(k) || 0) + r.qtd);
    total += r.qtd;
  }
  return [...s.entries()].sort((a, b) => b[1] - a[1])
    .map(([nome, v]) => ({ nome, volume: r1(v), share: r2(total ? (v / total) * 100 : 0) }));
}

function totalDe(reg, meses) {
  let t = 0;
  for (const r of reg) if (meses.has(r.mes)) t += r.qtd;
  return t;
}

/** Períodos a partir do último mês da base: o mês, o anterior, 12 meses. */
function periodos(reg) {
  const ref = reg.reduce((m, r) => (r.mes > m ? r.mes : m), '');
  const ant = mesAnterior(ref);
  return {
    ref, ant,
    soRef: new Set([ref]),
    soAnt: new Set([ant]),
    anoAntes: new Set([mesAnterior(ref, 12)]),
    doze: new Set(Array.from({ length: 12 }, (_, i) => mesAnterior(ref, i))),
    temAnterior: reg.some((r) => r.mes === ant)
  };
}

const pct = (a, b) => (b ? r2(((a - b) / b) * 100) : null);

/* ------------------------------------------------------------- montagem */

/**
 * Monta o bloco "share" do dados.js e o CSV completo a partir dos dois zips.
 * Período "mes": último mês da base, com variação sobre o mês anterior.
 * Período "ano": soma dos últimos 12 meses.
 */
export function calcularShare(zipTrr, zipLiquidos) {
  const T = ['TRR_Vendas_Dist_Atual.csv', 'TRR_Vendas_TRR_Atual.csv'];
  const L = ['Liquidos_Vendas_Atual.csv'];
  const arqT = lerZip(zipTrr, T, 'trr.zip');
  const arqL = lerZip(zipLiquidos, L, 'liquidos.zip');
  // A série da aba começa em jan/2024 (início dos arquivos "Atual" da ANP) e
  // cresce um mês por vez.
  const anoMinimo = ANO_INICIO;

  const dist = lerCsv(arqT[T[0]].dados, T[0], { anoMinimo });
  const trr = lerCsv(arqT[T[1]].dados, T[1], { anoMinimo });
  const liq = lerCsv(arqL[L[0]].dados, L[0], { anoMinimo });
  if (!trr.temUf) throw new Error(`${T[1]}: não achei a coluna de UF de destino.`);
  if (!liq.temUf) throw new Error(`${L[0]}: não achei a coluna de UF de destino.`);

  const pT = periodos(trr.reg);
  const pL = periodos(liq.reg);

  // Dia 20 a ANP publica o mês anterior como PRELIMINAR; dia 1, o retrasado
  // consolidado. Base com data no mês seguinte ao de referência = preliminar.
  const referencia = (p, dataBase) => ({
    mes: p.ref, rotulo: rotuloMes(p.ref),
    anterior: p.temAnterior ? rotuloMes(p.ant) : null,
    preliminar: mesAnterior(dataBase.slice(0, 7)) === p.ref
  });
  const janela = (p) => ({ de: rotuloMes(mesAnterior(p.ref, 11)), ate: rotuloMes(p.ref) });

  const bloco = (reg, p, filtro) => ({
    mes: ranking(reg, p.soRef, { filtro, comparar: p.temAnterior ? p.soAnt : null }),
    ano: ranking(reg, p.doze, { filtro })
  });

  // Resumo do último mês: vai no dados.js (chamada na página inicial) e no
  // jornal do dia em que a ANP divulga. A aba de market share usa a SÉRIE.
  const volRef = totalDe(liq.reg, pL.soRef);
  const canais = composicao(liq.reg, pL.soRef, (r) => canal(r.mercado));
  const mercado = {
    referencia: referencia(pL, arqL[L[0]].dataISO),
    baseANP: arqL[L[0]].dataISO,
    varMesPct: pL.temAnterior ? pct(volRef, totalDe(liq.reg, pL.soAnt)) : null,
    varAnoPct: pct(volRef, totalDe(liq.reg, pL.anoAntes)),
    canalTrr: canais.find((c) => c.nome === 'TRRs') || null,
    mes: ranking(liq.reg, pL.soRef, { comparar: pL.temAnterior ? pL.soAnt : null })
  };

  const share = {
    fonte: 'ANP · SIMP — Painéis Dinâmicos do Abastecimento',
    urlPainel: URL_PAINEL_TRR,
    urlPainelLiquidos: URL_PAINEL_LIQUIDOS,
    baseANP: arqT[T[1]].dataISO,
    referencia: referencia(pT, arqT[T[1]].dataISO),
    unidade: 'mil m³',
    mercado,
    distribuidoras: { mes: ranking(dist.reg, pT.soRef, { comparar: pT.temAnterior ? pT.soAnt : null }) },
    trrs: { mes: ranking(trr.reg, pT.soRef, { comparar: pT.temAnterior ? pT.soAnt : null }) }
  };

  return {
    share,
    serie: gerarSerie({ dist, trr, liq, base: share.baseANP, refTrr: share.referencia, refMerc: mercado.referencia }),
    csv: gerarCsv({ dist, trr, liq, pT, pL })
  };
}

/* ------------------------------------------------------- série da aba */

/**
 * Série mensal para a aba de market share, que filtra por qualquer mês ou
 * período no próprio navegador. Por mês e por recorte (Brasil e os estados em
 * destaque) guarda o TOTAL exato, o número de empresas e as SERIE_TOP maiores
 * com o volume de cada uma. Somar meses dá o ranking de qualquer período: uma
 * empresa fora das 25 maiores de um mês não chega ao Top 20 do período.
 *
 * Formato compacto (nomes num dicionário; volumes em mil m³, 2 casas):
 *   { meses: ["2024-01", ...], nomes: [...], curtos: [...],
 *     merc: { BR: { t: [total por mês], n: [empresas], a: [[[nome, vol], ...] por mês],
 *                   prod: { nomes, v: [[vol por produto] por mês] }, canal: {...} }, MG: ... },
 *     forn: { BR: {...} },  trr: { BR: {...}, MG: ... } }
 */
function gerarSerie({ dist, trr, liq, base, refTrr, refMerc }) {
  const meses = [...new Set([...liq.reg, ...trr.reg].map((r) => r.mes))].sort();
  const idxMes = new Map(meses.map((m, i) => [m, i]));
  const recortes = ['BR', ...ESTADOS];

  // Nome de cada empresa: a grafia mais usada em toda a base.
  const grafias = new Map();
  const nomeDe = new Map();
  const dicionario = [];
  const idNome = (k) => {
    if (!nomeDe.has(k)) {
      const g = [...grafias.get(k).entries()].sort((a, b) => b[1] - a[1])[0][0].replace(/\s+/g, ' ').trim();
      nomeDe.set(k, dicionario.length);
      dicionario.push(g);
    }
    return nomeDe.get(k);
  };
  const r2v = (v) => Math.round(v * 100) / 100;

  function serieDe(reg, comUf, comMix) {
    const saida = {};
    const acum = {};
    for (const rc of comUf ? recortes : ['BR']) {
      acum[rc] = meses.map(() => ({ total: 0, ag: new Map(), prod: new Map(), canal: new Map() }));
    }
    for (const r of reg) {
      const im = idxMes.get(r.mes);
      if (im == null) continue;
      const k = chave(r.agente);
      let g = grafias.get(k);
      if (!g) { g = new Map(); grafias.set(k, g); }
      g.set(r.agente, (g.get(r.agente) || 0) + r.qtd);
      const alvos = [acum.BR[im]];
      if (comUf && acum[r.uf]) alvos.push(acum[r.uf][im]);
      for (const a of alvos) {
        a.total += r.qtd;
        a.ag.set(k, (a.ag.get(k) || 0) + r.qtd);
        if (comMix) {
          const p = produto(r.produto), c = canal(r.mercado);
          a.prod.set(p, (a.prod.get(p) || 0) + r.qtd);
          a.canal.set(c, (a.canal.get(c) || 0) + r.qtd);
        }
      }
    }
    for (const [rc, lista] of Object.entries(acum)) {
      const o = {
        t: lista.map((a) => r2v(a.total)),
        n: lista.map((a) => a.ag.size),
        a: lista.map((a) => [...a.ag.entries()].sort((x, y) => y[1] - x[1]).slice(0, SERIE_TOP)
          .map(([k, v]) => [idNome(k), r2v(v)]))
      };
      if (comMix) {
        for (const dim of ['prod', 'canal']) {
          const nomes = [...new Set(lista.flatMap((a) => [...a[dim].keys()]))]
            .sort((x, y) => lista.reduce((s, a) => s + (a[dim].get(y) || 0), 0) - lista.reduce((s, a) => s + (a[dim].get(x) || 0), 0));
          o[dim] = { nomes, v: lista.map((a) => nomes.map((n) => r2v(a[dim].get(n) || 0))) };
        }
      }
      saida[rc] = o;
    }
    return saida;
  }

  const merc = serieDe(liq.reg, true, true);
  const forn = serieDe(dist.reg, false, false);
  const trrs = serieDe(trr.reg, true, false);
  return {
    versao: 1,
    base,
    meses,
    ref: { merc: refMerc, trr: refTrr },
    estados: ESTADOS.map((uf) => ({ uf, nome: NOME_UF[uf] })),
    nomes: dicionario,
    curtos: dicionario.map(nomeCurto),
    merc, forn, trr: trrs
  };
}

/* ---------------------------------------------------------- CSV completo */

/**
 * Ranking completo para baixar: todas as empresas, Brasil e cada estado, mês
 * e 12 meses. Feito para o Excel brasileiro: ";" como separador, vírgula
 * decimal e BOM no início (sem ele o Excel estraga os acentos).
 */
function gerarCsv({ dist, trr, liq, pT, pL }) {
  const num = (v, casas) => v.toFixed(casas).replace('.', ',');
  const campo = (t) => (/[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  const linhas = [['Segmento', 'Recorte', 'Período', 'Posição', 'Empresa', 'Volume (mil m³)', 'Participação (%)']];
  const ufs = Object.keys(NOME_UF).sort((a, b) => NOME_UF[a].localeCompare(NOME_UF[b], 'pt-BR'));

  const emitir = (segmento, reg, p, porUf) => {
    const rotulos = [
      [p.soRef, rotuloMes(p.ref)],
      [p.doze, `12 meses (${rotuloMes(mesAnterior(p.ref, 11))} a ${rotuloMes(p.ref)})`]
    ];
    const recortes = [['Brasil', null], ...(porUf ? ufs.map((uf) => [`${uf} - ${NOME_UF[uf]}`, uf]) : [])];
    for (const [rotuloRecorte, uf] of recortes) {
      for (const [meses, rotuloPeriodo] of rotulos) {
        const r = ranking(reg, meses, { filtro: uf ? (x) => x.uf === uf : null, limite: Infinity });
        for (const x of r.top) {
          linhas.push([segmento, rotuloRecorte, rotuloPeriodo, String(x.pos), x.nome, num(x.volume, 1), num(x.share, 2)]);
        }
      }
    }
  };

  emitir('Distribuidoras - mercado total', liq.reg, pL, true);
  emitir('Distribuidoras - fornecimento aos TRRs', dist.reg, pT, false);
  emitir('TRRs - vendas ao consumidor final', trr.reg, pT, true);
  return '﻿' + linhas.map((l) => l.map(campo).join(';')).join('\r\n') + '\r\n';
}

/** Baixa as duas bases e calcula. Lança erro se alguma não vier. */
export async function lerShare() {
  const [zipTrr, zipLiq] = await Promise.all([
    baixar(URL_TRR, 'trr.zip'),
    baixar(URL_LIQUIDOS, 'liquidos.zip')
  ]);
  return calcularShare(zipTrr, zipLiq);
}

/* --------------------------------------------------------- teste isolado */

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const t0 = Date.now();
  const { share: s, serie, csv } = await lerShare();
  const linha = (t) => t.top.map((x) => `${x.pos}. ${x.curto} ${x.share.toFixed(1)}%` +
    (x.deltaPP != null ? ` (${x.deltaPP > 0 ? '+' : ''}${x.deltaPP.toFixed(2)})` : '')).join(' | ');
  const m = s.mercado;
  console.log(`Mercado ${m.referencia.rotulo}: ${m.mes.total} mil m³ (${m.varMesPct}% no mês, ${m.varAnoPct}% no ano) · ` +
    `${m.mes.agentes} distribuidoras · canal TRR ${m.canalTrr?.share}%`);
  console.log(`  Top: ${linha(m.mes)}`);
  console.log(`Fornecimento a TRRs ${s.referencia.rotulo}: ${linha(s.distribuidoras.mes)}`);
  console.log(`TRRs Brasil (${s.trrs.mes.agentes}, ${s.trrs.mes.total}): ${linha(s.trrs.mes)}`);
  const js = JSON.stringify(serie);
  console.log(`Série: ${serie.meses[0]} a ${serie.meses.at(-1)} (${serie.meses.length} meses), ${serie.nomes.length} nomes, ` +
    `${(js.length / 1024).toFixed(0)} KB`);
  console.log(`  MG ago/26 distribuidoras: total ${serie.merc.MG.t.at(-1)}, ${serie.merc.MG.n.at(-1)} empresas, ` +
    serie.merc.MG.a.at(-1).slice(0, 3).map(([i, v]) => `${serie.curtos[i]} ${v}`).join(' | '));
  console.log(`  Produtos BR: ${serie.merc.BR.prod.nomes.join(', ')} · Canais: ${serie.merc.BR.canal.nomes.join(', ')}`);
  console.log(`CSV: ${csv.split('\n').length - 2} linhas, ${(csv.length / 1024).toFixed(0)} KB · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

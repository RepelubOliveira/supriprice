/**
 * SupriPrice — textos estáticos que o robô grava direto no HTML
 * -----------------------------------------------------------------------------
 * POR QUE: o portal monta os números com JavaScript. Buscadores e IAs (Claude,
 * ChatGPT, Perplexity...) muitas vezes leem a página SEM rodar o JavaScript —
 * e viam só "Este painel precisa de JavaScript". Sem texto, o site não tinha
 * como ser encontrado nem citado.
 *
 * Agora, a cada atualização, o robô escreve em texto corrido os números do dia:
 *   - um resumo no topo da página inicial e da aba de market share;
 *   - os líderes de cada estado na aba de market share;
 *   - os dados estruturados (schema.org) que o Google usa para entender a aba;
 *   - o llms.txt, a "ficha" do site no formato que as IAs procuram.
 *
 * O texto fica entre marcadores <!-- NOME:INICIO --> e <!-- NOME:FIM --> nas
 * páginas: o robô troca só o que está entre eles.
 */

const SITE = 'https://www.supriprice.com.br';

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dec = (v, casas = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const brl = (v) => 'R$ ' + dec(v, 2);
const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const pctSinal = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${dec(Math.abs(v), 1)}%`;

/** Troca o conteúdo entre <!-- MARCA:INICIO --> e <!-- MARCA:FIM -->. */
export function injetar(html, marca, conteudo) {
  const re = new RegExp(`(<!-- ${marca}:INICIO -->)[\\s\\S]*?(<!-- ${marca}:FIM -->)`);
  if (!re.test(html)) return { html, ok: false };
  return { html: html.replace(re, `$1${conteudo}$2`), ok: true };
}

/** Frase de topo da página inicial: defasagem, bomba e dólar do dia. */
export function resumoHome({ abicom, anp, dolar }) {
  const d = abicom.diesel, g = abicom.gasolina;
  const s10 = anp?.produtos?.find((p) => p.nome === 'Diesel S10');
  let t = `Em ${esc(abicom.data)}, a defasagem do diesel A ficou em <strong>${brl(d.defasagem)} por litro</strong>, ` +
    `${d.pct}% abaixo da paridade de importação (Abicom/StoneX)`;
  if (g?.defasagem != null) t += `; a da gasolina A, em ${brl(g.defasagem)}${g.pct != null ? ` (${g.pct}%)` : ''}`;
  t += '.';
  if (s10) {
    t += ` O diesel S10 custou em média <strong>${brl(s10.media)}</strong> na bomba ` +
      `(ANP, ${esc(dataBr(anp.periodo.de))} a ${esc(dataBr(anp.periodo.ate))}).`;
  }
  if (dolar?.valor) t += ` Dólar PTAX: ${brl(dolar.valor)}.`;
  return t;
}

/** Frase de topo da aba de market share: o último mês divulgado pela ANP. */
export function resumoShare(share) {
  const m = share?.mercado;
  if (!m?.mes?.top?.length) return '';
  const ref = m.referencia;
  const top = m.mes.top.slice(0, 3).map((x) => `${esc(x.curto)} (${dec(x.share, 1)}%)`).join(', ');
  const trr = share.trrs?.mes?.top?.slice(0, 3).map((x) => `${esc(x.curto)} (${dec(x.share, 1)}%)`).join(', ');
  let t = `Em ${esc(ref.rotulo)}${ref.preliminar ? ' (dados preliminares)' : ''}, as distribuidoras venderam ` +
    `<strong>${dec(m.mes.total, 1)} mil m³</strong> de diesel, gasolina, etanol e óleo combustível no Brasil`;
  if (m.varMesPct != null) t += ` (${pctSinal(m.varMesPct)} sobre o mês anterior${m.varAnoPct != null ? `, ${pctSinal(m.varAnoPct)} sobre um ano antes` : ''})`;
  t += `. Maiores distribuidoras: ${top}.`;
  if (m.canalTrr) t += ` O canal TRR respondeu por ${dec(m.canalTrr.share, 1)}% do volume`;
  if (trr) t += `${m.canalTrr ? ';' : ' Entre os TRRs,'} maiores TRRs: ${trr}`;
  return t + '. Fonte: ANP (SIMP).';
}

/** Líderes por estado, em lista: visível na aba, legível sem JavaScript. */
export function destaquesShare(share) {
  const lista = share?.destaques || [];
  if (!lista.length) return '';
  const ref = share.mercado?.referencia?.rotulo || share.referencia?.rotulo || '';
  const itens = lista.map((e) => {
    const partes = [];
    if (e.distribuidora) partes.push(`distribuidora líder <strong>${esc(e.distribuidora.nome)}</strong> (${dec(e.distribuidora.share, 1)}%)`);
    if (e.trr) partes.push(`TRR líder <strong>${esc(e.trr.nome)}</strong> (${dec(e.trr.share, 1)}%)`);
    return `<li><b>${esc(e.nome)}</b>: ${dec(e.volume, 1)} mil m³ vendidos pelas distribuidoras; ${partes.join('; ')}.</li>`;
  }).join('');
  return `<h2 class="ms-sec__titulo">Líderes por estado em ${esc(ref)}</h2><ul class="ms-destaques__lista">${itens}</ul>`;
}

/** Dados estruturados (schema.org/Dataset) da aba de market share. */
export function datasetJsonLd(share) {
  const ref = share?.mercado?.referencia?.mes || share?.referencia?.mes;
  if (!ref) return '';
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Market share do mercado de distribuição de combustíveis no Brasil — distribuidoras e TRRs',
    description: 'Volume vendido e participação de mercado das distribuidoras de combustíveis e dos ' +
      'transportadores-revendedores-retalhistas (TRRs) no Brasil e por estado, mês a mês: diesel, gasolina, ' +
      'etanol e óleo combustível. Compilado pelo SupriPrice a partir dos dados abertos da ANP (SIMP).',
    url: `${SITE}/market-share.html`,
    inLanguage: 'pt-BR',
    keywords: ['market share', 'distribuidoras de combustíveis', 'TRR', 'ANP', 'SIMP', 'diesel', 'Brasil'],
    creator: { '@type': 'Organization', name: 'SupriPrice', url: `${SITE}/` },
    isBasedOn: 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/dados-abertos-movimentacao-de-derivados-de-petroleo',
    temporalCoverage: `2024-01/${ref}`,
    spatialCoverage: { '@type': 'Place', name: 'Brasil' },
    dateModified: share.baseANP,
    ...(share.csv ? {
      distribution: [{ '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE}/${share.csv}` }]
    } : {})
  };
  // "<" escapado: o JSON vai dentro de <script>.
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

/** llms.txt: a ficha do site para IAs (formato llmstxt.org), com os números do dia. */
export function llmsTxt({ abicom, anp, dolar, share, atualizadoISO }) {
  const d = abicom.diesel, g = abicom.gasolina;
  const s10 = anp?.produtos?.find((p) => p.nome === 'Diesel S10');
  const m = share?.mercado;
  const L = [];
  L.push('# SupriPrice');
  L.push('');
  L.push('> Portal brasileiro de inteligência do mercado de combustíveis: defasagem diária do diesel e da ' +
    'gasolina em relação à paridade de importação (Abicom/StoneX), preço na bomba (ANP), market share de ' +
    'distribuidoras e TRRs no Brasil e por estado (ANP/SIMP), cotações e notícias do setor. Atualizado três ' +
    'vezes por dia útil (07h, 12h e 17h, horário de Brasília).');
  L.push('');
  L.push(`Números mais recentes (atualizado em ${dataBr(atualizadoISO)}):`);
  L.push('');
  L.push(`- Defasagem do diesel A (Abicom, ${abicom.data}): R$ ${dec(d.defasagem)} por litro, ${d.pct}% abaixo da paridade de importação.`);
  if (g?.defasagem != null) L.push(`- Defasagem da gasolina A (Abicom, ${abicom.data}): R$ ${dec(g.defasagem)} por litro${g.pct != null ? `, ${g.pct}%` : ''}.`);
  if (s10) L.push(`- Diesel S10 na bomba, média Brasil (ANP, ${dataBr(anp.periodo.de)} a ${dataBr(anp.periodo.ate)}): R$ ${dec(s10.media)}.`);
  if (dolar?.valor) L.push(`- Dólar PTAX: R$ ${dec(dolar.valor)}.`);
  if (m?.mes?.top?.length) {
    L.push(`- Vendas das distribuidoras no Brasil em ${m.referencia.rotulo} (ANP/SIMP): ${dec(m.mes.total, 1)} mil m³` +
      (m.varMesPct != null ? ` (${pctSinal(m.varMesPct)} no mês)` : '') + '.');
    L.push(`- Maiores distribuidoras em ${m.referencia.rotulo}: ` +
      m.mes.top.map((x) => `${x.curto} ${dec(x.share, 1)}%`).join(', ') + '.');
    if (share.trrs?.mes?.top?.length) {
      L.push(`- Maiores TRRs do Brasil em ${share.referencia.rotulo}: ` +
        share.trrs.mes.top.map((x) => `${x.curto} ${dec(x.share, 1)}%`).join(', ') + '.');
    }
    for (const e of share.destaques || []) {
      const p = [];
      if (e.distribuidora) p.push(`distribuidora líder ${e.distribuidora.nome} (${dec(e.distribuidora.share, 1)}%)`);
      if (e.trr) p.push(`TRR líder ${e.trr.nome} (${dec(e.trr.share, 1)}%)`);
      if (p.length) L.push(`- ${e.nome}, ${m.referencia.rotulo}: ${p.join('; ')}.`);
    }
  }
  L.push('');
  L.push('## Páginas');
  L.push('');
  L.push(`- [Panorama do diesel](${SITE}/): defasagem diária do diesel e da gasolina, preço na bomba por região e estado, cotações (dólar, euro, Brent, WTI, Ibovespa) e notícias de transporte, agro, Brasil e mundo.`);
  L.push(`- [Market share](${SITE}/market-share.html): volume e participação de distribuidoras e TRRs, Brasil e estados (MG, SP, MS, RJ, DF, GO, BA, SC, PR), filtro por mês ou período desde jan/2024.`);
  if (share?.csv) L.push(`- [Ranking completo em CSV](${SITE}/${share.csv}): todas as distribuidoras e TRRs, Brasil e 27 estados.`);
  L.push(`- Jornal do dia: página A4 com os números e as manchetes, disponível na página inicial (PDF, PNG, JPEG).`);
  L.push('');
  L.push('## Fontes');
  L.push('');
  L.push('- Defasagem: Abicom (Associação Brasileira dos Importadores de Combustíveis), análise com a StoneX.');
  L.push('- Preço na bomba e market share: ANP, dados abertos (Levantamento de Preços; SIMP).');
  L.push('- Dólar PTAX: Banco Central do Brasil. Cotações: Yahoo Finance.');
  L.push('');
  L.push('## Como citar');
  L.push('');
  L.push(`Fonte: SupriPrice (${SITE}). Reprodução permitida citando a fonte com link.`);
  return L.join('\n') + '\n';
}

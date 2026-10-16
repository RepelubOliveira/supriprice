// SupriPrice — o editor do jornal: escolhe e escreve a manchete do dia
// -----------------------------------------------------------------------------
// Pedido de 16/10/2026: o jornal estava "automático demais" (a manchete do
// dia 16 foi o market share de AGOSTO em Minas, enquanto a arbitragem caía
// R$ 0,20). Regras deste editor:
//
//  1. Manchete é FATO NOVO. Dado velho (market share de um mês atrás por
//     estado) pode ser o quadro do dia, nunca a manchete.
//  2. Cada fato traz o PORQUÊ quando os números permitem (Nova York ou dólar),
//     o contexto (menor nível desde..., N pregões seguidos) e um lide próprio
//     que explica a manchete, em vez de uma lista de números.
//  3. Repetir o assunto de ontem só pesa contra fato FRACO. Notícia forte
//     (a arbitragem andou R$ 0,20) sai de novo, com outro ângulo.
//  4. A agenda do editorial.json entra quando o evento é hoje, amanhã ou depois.
//
// Nada é inventado: cada frase sai de um número que o robô tem. Onde falta o
// dado, a frase não aparece.

const L_GAL = 3.785411784;
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const brl = (v, c = 2) => 'R$ ' + Number(v).toFixed(c).replace('.', ',');
const num = (v, c = 2) => Number(v).toFixed(c).replace('.', ',');
const pct = (v) => { const a = Math.abs(v); return (a < 0.1 ? a.toFixed(2) : a.toFixed(1)).replace('.', ',') + '%'; };
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dias = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
const mil = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/* ----------------------------------------------------------- arbitragem */

const PRODUTOS = {
  diesel: { nome: 'diesel', ny: 'o diesel em Nova York', nyCurto: 'do diesel em Nova York' },
  gasolina: { nome: 'gasolina', ny: 'a gasolina em Nova York', nyCurto: 'da gasolina em Nova York' }
};

/**
 * Fatos da arbitragem de um produto: o movimento do dia (com a causa),
 * o acumulado da semana e, sempre, o nível (manchete de reserva).
 */
function fatosArbitragem(A, prod, iso) {
  const P = PRODUTOS[prod], x = A?.[prod];
  const s = (A?.serie || []).filter((p) => typeof p[prod] === 'number');
  if (!x || s.length < 3) return [];
  const atual = x.defasagem;
  // Ponto de hoje na série = cotação em andamento; a base é o fechamento anterior.
  const ultimo = s[s.length - 1];
  const fechados = ultimo.data === iso ? s.slice(0, -1) : s;
  const base = fechados[fechados.length - 1];
  const v = fechados.map((p) => p[prod]).concat(atual);
  // Movimento do dia: contra o FECHAMENTO ANTERIOR oficial (o mesmo que o
  // cartão do site usa para o "no dia"). A série diária do Yahoo para os
  // futuros de Nova York tem a barra de "ontem" diferente do fechamento
  // (16/10/2026: barra 4,85 x fechamento 4,65), então ela fica só para
  // sequência, extremos e semana.
  const custo = A.custos?.[prod];
  const baseOficial = A.anteriores?.[prod] && A.anteriores?.dolar && typeof custo === 'number'
    ? (A.anteriores[prod] / L_GAL) * A.anteriores.dolar + custo - x.petro : null;
  const delta = atual - (baseOficial ?? base[prod]);
  const refFech = baseOficial != null ? 'no fechamento anterior' : `no fechamento de ${ddmm(base.data)}`;
  const valor = brl(Math.abs(atual));
  const lado = atual >= 0 ? 'acima' : 'abaixo';
  const fatos = [];

  // Causa: quanto do movimento veio de Nova York e quanto do dólar.
  const c1 = A.insumos?.[prod], c0 = A.anteriores?.[prod], d1 = A.insumos?.dolar, d0 = A.anteriores?.dolar;
  let nyVar = null, usdVar = null, causa = null;
  if (c1 && c0 && d1 && d0) {
    nyVar = (c1 / c0 - 1) * 100;
    usdVar = (d1 / d0 - 1) * 100;
    const pNy = ((c1 - c0) / L_GAL) * d1, pUsd = (c0 / L_GAL) * (d1 - d0);
    const forte = Math.abs(pNy) >= Math.abs(pUsd) ? ['ny', pNy] : ['dolar', pUsd];
    if (Math.sign(forte[1]) === Math.sign(delta) && Math.abs(forte[1]) >= Math.abs(delta) * 0.6) causa = forte[0];
  }

  // Sequência de pregões no mesmo sentido e nível extremo.
  let seguidos = 0;
  for (let i = v.length - 1; i > 0 && Math.sign(v[i] - v[i - 1]) === Math.sign(delta) && Math.abs(v[i] - v[i - 1]) >= 0.005; i--) seguidos++;
  let extremo = null;
  {
    const n = fechados.length;
    let j = -1;
    for (let i = n - 1; i >= 0; i--) { if (delta < 0 ? fechados[i][prod] <= atual : fechados[i][prod] >= atual) { j = i; break; } }
    const nivel = delta < 0 ? 'menor' : 'maior';
    if (j < 0 && n >= 15) extremo = `${nivel} nível em ${n} pregões`;
    else if (j >= 0 && n - 1 - j >= 5) extremo = `${nivel} nível desde ${ddmm(fechados[j].data)}`;
  }

  const cai = delta < 0;
  const frasePreco = `O preço de importação ${prod === 'diesel' ? 'do diesel ' : 'da gasolina '}foi a <strong>${brl(x.ppi)} por litro</strong>, ` +
    `${valor} ${lado} dos ${brl(x.petro)} da Petrobras`;
  const fraseCausa = nyVar != null
    ? `${P.ny.charAt(0).toUpperCase() + P.ny.slice(1)} ${nyVar < 0 ? 'caiu' : 'subiu'} ${pct(nyVar)}, a US$ ${num(c1)} o galão, ` +
      `e o dólar ${usdVar < 0 ? 'recuou' : 'subiu'} ${pct(usdVar)}. `
    : '';

  // 1) Movimento do dia
  if (Math.abs(delta) >= 0.08) {
    let manchete;
    if (extremo) manchete = `Arbitragem ${prod === 'diesel' ? 'do diesel' : 'da gasolina'} ${cai ? 'cai' : 'sobe'} para ${valor}, ${extremo}`;
    else if (seguidos >= 3) manchete = `Arbitragem ${prod === 'diesel' ? 'do diesel' : 'da gasolina'} ${cai ? 'cai' : 'sobe'} pelo ${seguidos}º pregão seguido e vai a ${valor}`;
    else if (causa === 'ny') manchete = `${cai ? 'Queda' : 'Alta'} de ${pct(nyVar)} ${P.nyCurto} ${cai ? 'reduz' : 'eleva'} a arbitragem para ${valor}`;
    else if (causa === 'dolar') manchete = `${cai ? 'Dólar mais barato reduz' : 'Dólar mais caro eleva'} a arbitragem ${prod === 'diesel' ? 'do diesel' : 'da gasolina'} para ${valor}`;
    else manchete = `Arbitragem ${prod === 'diesel' ? 'do diesel' : 'da gasolina'} ${cai ? 'recua' : 'avança'} ${brl(Math.abs(delta))} e vai a ${valor}`;
    const lide = fraseCausa + frasePreco + `: ${brl(Math.abs(delta))} ${cai ? 'a menos' : 'a mais'} que ${refFech}.`;
    let nota = 2 + Math.min(2.5, Math.abs(delta) / 0.1);
    if (extremo) nota += 0.5;
    if (seguidos >= 3) nota += 0.3;
    if (prod === 'gasolina') nota -= 0.6;
    fatos.push({ tipo: `arbitragem-${prod}`, nota, chapeu: `Arbitragem · ${P.nome}`, manchete, lide });
  }

  // 2) Acumulado da semana (cinco pregões)
  if (v.length >= 6) {
    const semana = atual - v[v.length - 6];
    if (Math.abs(semana) >= 0.25) {
      const sobe = semana > 0;
      fatos.push({
        tipo: `arbitragem-semana-${prod}`, nota: prod === 'diesel' ? 1.7 : 1.2, chapeu: `Arbitragem · ${P.nome}`,
        manchete: `Arbitragem ${prod === 'diesel' ? 'do diesel' : 'da gasolina'} acumula ${sobe ? 'alta' : 'queda'} de ${brl(Math.abs(semana))} em cinco pregões e está em ${valor}`,
        lide: fraseCausa + frasePreco + '.'
      });
    }
  }

  // 3) Nível (reserva: há sempre uma manchete com número de hoje)
  if (prod === 'diesel') {
    const g = A.gasolina;
    const semana = v.length >= 6 ? atual - v[v.length - 6] : null;
    fatos.push({
      tipo: 'arbitragem-nivel', nota: 0.6, chapeu: 'Arbitragem',
      manchete: `Arbitragem do diesel está em ${valor} por litro${g ? `; a da gasolina, em ${brl(Math.abs(g.defasagem))}` : ''}`,
      lide: frasePreco + '.' + (semana != null && Math.abs(semana) >= 0.05
        ? ` Em cinco pregões, a diferença ${semana > 0 ? 'subiu' : 'caiu'} ${brl(Math.abs(semana))}.` : ' Em cinco pregões, a diferença pouco mudou.')
    });
  }
  return fatos;
}

/** Uma frase curta da arbitragem do diesel, para completar lides de outros assuntos. */
function fraseArbitragem(A) {
  const d = A?.diesel;
  return d ? ` Hoje, o diesel importado sai a ${brl(d.ppi)} por litro, ${brl(Math.abs(d.defasagem))} ${d.defasagem >= 0 ? 'acima' : 'abaixo'} dos ${brl(d.petro)} da Petrobras.` : '';
}

/* --------------------------------------------------------------- agenda */

function fatosAgenda(agenda, iso, A) {
  const out = [];
  for (const item of agenda || []) {
    const m = String(item.data || '').match(/^(\d{2})\/(\d{2})$/);
    if (!m) continue;
    const alvo = `${iso.slice(0, 4)}-${m[2]}-${m[1]}`;
    const d = dias(iso, alvo);
    if (d < 0 || d > 2) continue;
    const quando = d === 0 ? 'hoje' : d === 1 ? 'amanhã' : `em ${item.data}`;
    const texto = String(item.texto || '').trim();
    const [primeira, ...resto] = texto.split(/(?<=\.)\s+/);
    const manchete = item.manchete
      ? item.manchete.replace('{quando}', quando)
      : `${quando.charAt(0).toUpperCase() + quando.slice(1)}: ${primeira.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}`;
    const lide = esc(item.lide ? item.lide.replace('{quando}', quando) : (resto.join(' ') || primeira)) + fraseArbitragem(A);
    out.push({ tipo: 'agenda', nota: d === 0 ? 4.2 : d === 1 ? 3.9 : 2.3, chapeu: item.chapeu || 'Agenda do setor', manchete, lide });
  }
  return out;
}

/* ------------------------------------------------------- outros assuntos */

function fatosMercado(indicadores, iso, A) {
  const out = [];
  for (const [id, nome, limite, moeda] of [['dolar', 'Dólar', 1.2, 'BRL'], ['brent', 'Brent', 2.5, 'USD'], ['wti', 'WTI', 2.5, 'USD']]) {
    const i = (indicadores || []).find((x) => x.id === id);
    if (!i || i.dataISO !== iso || Math.abs(i.variacao) < limite) continue;
    const valor = moeda === 'BRL' ? brl(i.valor, 3) : `US$ ${num(i.valor)}`;
    out.push({
      tipo: 'mercado', nota: 2 + Math.abs(i.variacao) / limite / 2, chapeu: 'Câmbio e petróleo',
      manchete: `${nome} ${i.variacao > 0 ? 'sobe' : 'cai'} ${pct(i.variacao)} e vai a ${valor}`,
      lide: `${id === 'dolar' ? 'O dólar' : `O ${nome}`} entra direto no preço de importação dos combustíveis.` +
        (A?.diesel ? ` O do diesel está em <strong>${brl(A.diesel.ppi)} por litro</strong>, ${brl(Math.abs(A.diesel.defasagem))} acima da Petrobras.` : '')
    });
  }
  return out;
}

const REGIAO = { Norte: 'o Norte', Nordeste: 'o Nordeste', 'Centro-Oeste': 'o Centro-Oeste', Sudeste: 'o Sudeste', Sul: 'o Sul' };

function fatosBomba(anp, iso) {
  const s10 = anp?.produtos?.find((p) => p.nome === 'Diesel S10');
  if (!s10 || !anp.periodo?.ate || dias(anp.periodo.ate, iso) > 3) return [];
  const regs = [...(anp.regioes || [])].sort((a, b) => b.media - a.media);
  const caro = anp.maisCaros?.[0], barato = anp.maisBaratos?.[0];
  const mexeu = s10.variacao != null && Math.abs(s10.variacao) >= 0.02;
  const manchete = mexeu
    ? `Diesel S10 ${s10.variacao > 0 ? 'sobe' : 'cai'} ${brl(Math.abs(s10.variacao))} nos postos e vai a ${brl(s10.media)}`
    : `Diesel S10 fica estável nos postos, a ${brl(s10.media)} o litro`;
  let lide = `No levantamento da ANP de ${ddmm(anp.periodo.de)} a ${ddmm(anp.periodo.ate)}`;
  lide += regs.length >= 2
    ? `, ${REGIAO[regs[0].nome] || regs[0].nome} pagou mais (${brl(regs[0].media)}) e ${REGIAO[regs[regs.length - 1].nome] || regs[regs.length - 1].nome} menos (${brl(regs[regs.length - 1].media)}).`
    : '.';
  if (caro && barato) lide += ` Entre os estados, o S10 vai de ${brl(barato.media)} (${esc(barato.estado)}) a ${brl(caro.media)} (${esc(caro.estado)}).`;
  return [{ tipo: 'bomba', nota: mexeu ? 2.2 : 1.1, chapeu: 'Preço na bomba · ANP', manchete, lide }];
}

function fatosNegocios(negocios) {
  const n = negocios?.[0];
  if (!n) return [];
  const resumo = n.resumo ? esc(n.resumo.length > 230 ? n.resumo.slice(0, 227).replace(/\s+\S*$/, '') + '…' : n.resumo) : '';
  return [{
    tipo: 'negocios', nota: n.cade ? 2.9 : 2.7, chapeu: `Negócios do setor · ${n.fonte}`, manchete: n.titulo,
    lide: resumo ? `${resumo} <span class="lide__fonte">(${esc(n.fonte)})</span>` : '', semDesconto: true
  }];
}

function fatosShare(share) {
  const m = share?.mercado;
  if (!m?.mes?.top?.length || m.mes.top.length < 3) return [];
  const top = m.mes.top.slice(0, 3);
  const soma = top.reduce((a, x) => a + x.share, 0);
  const varMes = m.varMesPct == null ? '' : ` (${m.varMesPct > 0 ? '+' : '−'}${num(Math.abs(m.varMesPct), 1)}% no mês)`;
  return [{
    tipo: 'share', nota: 3.2, chapeu: 'Market share · ANP',
    manchete: `${top.map((x) => x.curto).join(', ').replace(/, ([^,]*)$/, ' e $1')} somam ${num(soma, 0)}% das vendas em ${m.referencia.rotulo}`,
    lide: `A ANP divulgou hoje os números de ${m.referencia.rotulo}: as distribuidoras venderam <strong>${mil(m.mes.total)} mil m³</strong>${varMes}` +
      (m.canalTrr ? `, e o canal TRR ficou com ${num(m.canalTrr.share, 1)}%.` : '.')
  }];
}

function fatosPrevia(previa, iso, edicoesAntes) {
  const m = previa?.mercado, l = m?.top?.[0];
  if (!l) return [];
  const mes = MESES_LONGOS[+previa.mes.slice(5, 7) - 1];
  const recente = (edicoesAntes || []).some((e) => e.data < iso && dias(e.data, iso) <= 6 && /previa/.test(e.tipoManchete || ''));
  const faltam = (m.faltam || []).slice(0, 2);
  const manchete = m.ranking
    ? `Prévia de ${mes}: ${l.curto} lidera com ${num(l.share, 1)}% das vendas`
    : `ANP já tem ${num(m.cobertura, 0)}% das vendas de ${mes}` +
      (faltam.length ? `; ${faltam.join(' e ')} ainda não ${faltam.length > 1 ? 'declararam' : 'declarou'}` : '');
  const lide = `Pelos números já declarados à ANP, ${esc(l.curto)} soma ${mil(l.volume)} mil m³` +
    (l.varPct != null ? ` (${l.varPct > 0 ? '+' : '−'}${num(Math.abs(l.varPct), 1)}% sobre ${previa.anterior})` : '') +
    '. Os números são parciais até a planilha oficial da ANP.';
  return [{ tipo: 'previa', nota: m.ranking ? 3 : recente ? 0.4 : 1.4, chapeu: `Prévia de ${previa.rotulo} · ANP`, manchete, lide }];
}

/* ------------------------------------------------------------ escolha */

/**
 * Todos os fatos candidatos do dia, já com o desconto de repetição, do mais
 * forte ao mais fraco.
 */
export function fatosDoDia({ iso, arbitragem, agenda, indicadores, anp, negocios, share, previa, analise, destaque, edicoesAntes }) {
  const fatos = [
    ...fatosArbitragem(arbitragem, 'diesel', iso),
    ...fatosArbitragem(arbitragem, 'gasolina', iso),
    ...fatosAgenda(agenda, iso, arbitragem),
    ...fatosMercado(indicadores, iso, arbitragem),
    ...fatosBomba(anp, iso),
    ...fatosNegocios(negocios),
    ...fatosShare(share),
    ...fatosPrevia(previa, iso, edicoesAntes)
  ];
  if (destaque?.tipo === 'analise' && analise?.manchete) {
    fatos.push({ tipo: 'analise', nota: 1.2, chapeu: analise.chapeu || 'Análise', manchete: analise.manchete,
      lide: analise.lide ? esc(analise.lide) : '', analise: true });
  }
  const ontem = (edicoesAntes || []).find((e) => e.data < iso);
  const tipoOntem = ontem?.tipoManchete || '';
  for (const f of fatos) {
    if (f.semDesconto) continue;
    if (ontem && f.manchete === ontem.titulo) f.nota *= 0.1;          // a mesma frase de ontem, nunca
    else if (f.tipo === tipoOntem) f.nota *= f.nota >= 2.5 ? 0.9 : 0.4; // assunto de ontem: só pesa se for fraco
  }
  return fatos.sort((a, b) => b.nota - a.nota);
}

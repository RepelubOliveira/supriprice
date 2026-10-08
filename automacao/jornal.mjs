// SupriPrice — o jornal do dia, gerado automaticamente
// -----------------------------------------------------------------------------
// FORMATO FIXO DE STORIES: 1080 x 1920 px (9:16), o tamanho do Status do
// WhatsApp e dos Stories do Instagram. O PNG/JPEG baixado no site sai nesse
// tamanho exato, pronto para postar. Antes era uma folha A4 de altura livre,
// que crescia com as notícias e ficava inviável no celular.
//
// Para caber SEMPRE, cada bloco tem altura reservada e cada texto tem limite
// de linhas (o excesso vira "…"). O robô também escolhe pouco conteúdo: 3
// manchetes, 4 números, 1 bloco do dia.
//
// SAI TODO DIA, inclusive fim de semana. Sem boletim novo da Abicom (sábado,
// domingo, ou de manhã antes de ela publicar), a manchete vem dos fatos do dia:
// a análise da semana (conteudo/editorial.json → "analise"), o market share
// recém-divulgado pela ANP ou o preço na bomba. A defasagem segue a do último
// boletim, sempre com a data dele.
//
// Textos corridos são construídos a partir dos números. A única exceção é a
// ANÁLISE DA SEMANA, escrita à mão no editorial.json e assinada como
// "Análise SupriPrice". Onde o dado falta, a frase não é inventada.

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira',
  'sexta-feira', 'sábado'];

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Espaço inseparável: "R$" nunca fica sozinho no fim da linha.
const brl = (v, casas = 2) => 'R$ ' + Number(v).toFixed(casas).replace('.', ',');
const num = (v, casas = 2) => Number(v).toFixed(casas).replace('.', ',');
const mil = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sinal = (v) => (v >= 0 ? '+' : '−') + num(Math.abs(v));
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

// O ícone da marca (o mesmo do favicon), desenhado inline.
const ICONE = '<svg viewBox="5 5 54 54" width="76" height="76" aria-hidden="true">' +
  '<path d="M12 6 H40 L58 24 V52 A6 6 0 0 1 52 58 H12 A6 6 0 0 1 6 52 V12 A6 6 0 0 1 12 6 Z" fill="#FFFFFF"/>' +
  '<circle cx="45" cy="19" r="4.6" fill="#F2A413"/>' +
  '<text x="27" y="48" text-anchor="middle" font-family="Archivo, Arial Black, Arial, sans-serif" font-size="36" ' +
  'font-weight="800" fill="#0E2A47">S</text></svg>';

/* ------------------------------------------------- destaque e manchete */

// O jornal muda todo dia: o robô escolhe o FATO MAIS FORTE do dia e evita
// repetir o assunto das edições anteriores. Cada candidato tem uma nota; o que
// apareceu nas últimas edições perde pontos. A análise escrita à mão
// (editorial.json → analise) é OCASIONAL: no máximo a cada `intervaloDias`
// (padrão 7), não todo dia.

const dias = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);

/** Cotação do dia (não o fechamento de um pregão anterior) com a variação. */
function movimento(indicadores, id, iso) {
  const i = indicadores?.find((x) => x.id === id);
  return i && i.dataISO === iso ? i : null;
}

/** Quando a análise apareceu pela última vez (edições antigas sem registro contam se a análise estava valendo). */
function ultimaAnalise(edicoesAntes, analise) {
  const datas = (edicoesAntes || []).filter((e) => e.destaque === 'analise' ||
    (!e.destaque && analise && (!analise.de || e.data >= analise.de) && (!analise.ate || e.data <= analise.ate)))
    .map((e) => e.data).sort();
  return datas[datas.length - 1] || null;
}

/**
 * Escolhe o bloco do dia. Devolve { tipo, uf? }.
 * Tipos: share (divulgação da ANP), analise, mercado, defasagem, bomba,
 * estados, share-estado.
 */
export function escolherDestaque({ iso, abicom, anp, historico, indicadores, share, shareResumo, analise, parcial, edicoesAntes }) {
  const anteriores = (edicoesAntes || []).filter((e) => e.data < iso);
  const recentes = anteriores.slice(0, 3).map((e) => (e.destaque || '').split(':')[0]);
  const c = [];
  if (share?.mercado?.mes?.top?.length) c.push({ tipo: 'share', nota: 5 });
  if (analise) {
    const ult = ultimaAnalise(anteriores, analise);
    if (!ult || dias(ult, iso) >= (analise.intervaloDias || 7)) c.push({ tipo: 'analise', nota: 4 });
  }
  const dol = movimento(indicadores, 'dolar', iso), br = movimento(indicadores, 'brent', iso);
  const forca = Math.max(dol ? Math.abs(dol.variacao) / 1.5 : 0, br ? Math.abs(br.variacao) / 2.5 : 0);
  if (indicadores?.length) c.push({ tipo: 'mercado', nota: forca >= 1 ? 2 + forca : 0.35 });
  const d = abicom.diesel;
  const varDef = !parcial && historico?.length > 1 ? d.defasagem - historico[historico.length - 2].valor : 0;
  if ((historico || []).length >= 5) c.push({ tipo: 'defasagem', nota: Math.abs(varDef) >= 0.15 ? 2.5 : 0.5 });
  if (anp?.regioes?.length) {
    const nova = anp.periodo?.ate && dias(anp.periodo.ate, iso) <= 3;
    c.push({ tipo: 'bomba', nota: nova ? 1.5 : 0.4 });
  }
  if (anp?.maisCaros?.length && anp?.maisBaratos?.length) c.push({ tipo: 'estados', nota: 0.45 });
  const ufs = (shareResumo?.destaques || []).filter((e) => e.topDist?.length || e.topTrr?.length);
  if (ufs.length) c.push({ tipo: 'share-estado', nota: 0.5 });

  for (const x of c) {
    const vezes = recentes.filter((r) => r === x.tipo).length;
    if (vezes) x.nota *= x.tipo === 'share-estado' ? 0.6 : 0.25 / vezes;
  }
  c.sort((a, b) => b.nota - a.nota);
  const escolhido = c[0] || { tipo: 'bomba' };
  if (escolhido.tipo === 'share-estado') {
    // Um estado por dia, em rodízio pela data.
    escolhido.uf = ufs[Math.abs(dias('2026-01-01', iso)) % ufs.length].uf;
  }
  return escolhido;
}

/** Uma frase de manchete a partir do bloco do dia. */
function mancheteDoDestaque({ destaque, historico, anp, indicadores, shareResumo, iso }) {
  switch (destaque?.tipo) {
    case 'defasagem': {
      const pts = (historico || []).slice(-20).map((p) => p.valor);
      if (pts.length < 5) return null;
      return { tipo: 'd-defasagem', chapeu: 'Arbitragem do diesel',
        manchete: `Defasagem do diesel oscila entre ${brl(Math.min(...pts))} e ${brl(Math.max(...pts))} em ${pts.length} pregões` };
    }
    case 'estados': {
      const caro = anp?.maisCaros?.[0], barato = anp?.maisBaratos?.[0];
      if (!caro || !barato) return null;
      return { tipo: 'd-estados', chapeu: 'Preço na bomba',
        manchete: `Diesel S10 custa de ${brl(barato.media)} (${barato.estado}) a ${brl(caro.media)} (${caro.estado}) entre os estados` };
    }
    case 'bomba': {
      const s10 = anp?.produtos?.find((p) => p.nome === 'Diesel S10');
      const regs = [...(anp?.regioes || [])].sort((a, b) => b.media - a.media);
      if (!s10 || regs.length < 2) return null;
      return { tipo: 'd-bomba', chapeu: 'Preço na bomba',
        manchete: `Diesel S10 a ${brl(s10.media)}: ${regs[0].nome} paga mais, ${regs[regs.length - 1].nome} paga menos` };
    }
    case 'mercado': {
      const dol = indicadores?.find((i) => i.id === 'dolar'), br = indicadores?.find((i) => i.id === 'brent');
      if (!dol || !br) return null;
      const fech = dol.dataISO < iso ? 'fecham' : 'estão';
      return { tipo: 'd-mercado', chapeu: 'Câmbio e petróleo',
        manchete: `Dólar e Brent ${fech} a ${brl(dol.valor)} e US$ ${num(br.valor)}` };
    }
    case 'share-estado': {
      const e = shareResumo?.destaques?.find((x) => x.uf === destaque.uf);
      const lider = e?.topDist?.[0];
      if (!lider) return null;
      return { tipo: 'd-share-estado', chapeu: 'Market share · ANP',
        manchete: `${lider.nome} lidera a venda de combustíveis em ${e.nome}, com ${num(lider.share, 1)}%` };
    }
    default: return null;
  }
}

/** A manchete: o fato mais forte, sem repetir o tipo da edição anterior. */
function escolherManchete({ iso, abicom, anp, historico, share, shareResumo, analise, parcial, indicadores, destaque, edicoesAntes }) {
  const d = abicom.diesel;
  const anterior = (edicoesAntes || []).find((e) => e.data < iso)?.tipoManchete || '';
  const c = [];
  const varDef = !parcial && historico?.length > 1 ? d.defasagem - historico[historico.length - 2].valor : null;
  if (varDef != null && Math.abs(varDef) >= 0.15) {
    c.push({ tipo: 'defasagem', nota: 3, chapeu: 'Arbitragem do diesel', manchete: varDef > 0
      ? `Defasagem do diesel sobe ${brl(Math.abs(varDef))} e chega a ${brl(d.defasagem)}`
      : `Defasagem do diesel recua ${brl(Math.abs(varDef))} e fica em ${brl(d.defasagem)}` });
  }
  for (const [id, nome, limite, moeda] of [['dolar', 'Dólar', 1.5, 'BRL'], ['brent', 'Brent', 2.5, 'USD'], ['wti', 'WTI', 2.5, 'USD']]) {
    const i = movimento(indicadores, id, iso);
    if (i && Math.abs(i.variacao) >= limite) {
      const valor = moeda === 'BRL' ? brl(i.valor) : `US$ ${num(i.valor)}`;
      c.push({ tipo: 'mercado', nota: 2 + Math.abs(i.variacao) / limite / 2, chapeu: 'Mercado',
        manchete: `${nome} ${i.variacao > 0 ? 'sobe' : 'cai'} ${num(Math.abs(i.variacao), 1)}% e vai a ${valor}` });
    }
  }
  const m = share?.mercado;
  if (m?.mes?.top?.length >= 3) {
    const top = m.mes.top.slice(0, 3);
    const soma = top.reduce((a, x) => a + x.share, 0);
    c.push({ tipo: 'share', nota: 2.6, chapeu: 'Market share · ANP',
      manchete: `${top.map((x) => x.curto).join(', ').replace(/, ([^,]*)$/, ' e $1')} somam ${num(soma, 0)}% das vendas em ${m.referencia.rotulo}` });
  }
  if (destaque?.tipo === 'analise' && analise?.manchete) {
    c.push({ tipo: 'analise', nota: parcial ? 2.4 : 1.2, chapeu: analise.chapeu || 'Análise', manchete: analise.manchete, analise: true });
  }
  const s10 = anp?.produtos?.find((p) => p.nome === 'Diesel S10');
  if (s10?.variacao != null && Math.abs(s10.variacao) >= 0.02 && anp.periodo?.ate && dias(anp.periodo.ate, iso) <= 3) {
    c.push({ tipo: 'bomba', nota: 1.6, chapeu: 'Preço na bomba',
      manchete: `Diesel S10 ${s10.variacao > 0 ? 'sobe' : 'cai'} ${brl(Math.abs(s10.variacao))} na bomba e vai a ${brl(s10.media)}` });
  }
  // A manchete que nasce do destaque do dia: garante que o jornal não abra
  // sempre com a mesma frase quando não há fato forte.
  const md = mancheteDoDestaque({ destaque, historico, anp, indicadores, shareResumo, iso });
  if (md) c.push({ ...md, nota: 1.0 });
  if (!parcial && d.diasJanelaFechada > 200) {
    c.push({ tipo: 'janela', nota: 0.8, chapeu: 'Arbitragem do diesel', manchete: `Janela de importação completa ${d.diasJanelaFechada} dias fechada` });
  }
  if (!parcial) {
    c.push({ tipo: 'nivel', nota: 0.7, chapeu: 'Arbitragem do diesel', manchete: `Defasagem do diesel fica em ${brl(d.defasagem)} por litro` });
  }
  c.push({ tipo: 'paridade', nota: 0.5, chapeu: 'Arbitragem do diesel', manchete: `Diesel segue ${d.pct}% abaixo da paridade de importação` });

  for (const x of c) if (x.tipo === anterior) x.nota *= 0.3;
  c.sort((a, b) => b.nota - a.nota);
  const e = c[0];
  return { chapeu: e.chapeu, manchete: e.manchete, tipoManchete: e.tipo, analiseNaManchete: !!e.analise };
}

/** Abertura curta (cabe em 4 linhas): os números, sem adjetivo gratuito. */
function lide({ abicom, anp, dataAbicomISO, parcial, fimDeSemana, analise, analiseNaManchete }) {
  const d = abicom.diesel;
  const s10 = anp?.produtos?.find((p) => p.nome === 'Diesel S10');
  const partes = [];
  if (analiseNaManchete && analise?.lide) partes.push(esc(analise.lide));

  const ref = `defasagem do diesel de <strong>${brl(d.defasagem)} por litro</strong> (${d.pct}% abaixo da paridade)`;
  if (!parcial) {
    partes.push(`A defasagem média do diesel fechou em <strong>${brl(d.defasagem)} por litro</strong>, ${d.pct}% abaixo da paridade de importação.`);
  } else if (fimDeSemana) {
    partes.push(`Sem boletim da Abicom no fim de semana, vale o de ${ddmm(dataAbicomISO)}: ${ref}.`);
  } else {
    partes.push(`O boletim de hoje da Abicom ainda não saiu; no último (${ddmm(dataAbicomISO)}), ${ref}.`);
  }
  if (s10 && !analiseNaManchete) {
    const mov = s10.variacao == null ? '' : s10.variacao > 0.004 ? `, alta de ${brl(s10.variacao)} na semana`
      : s10.variacao < -0.004 ? `, queda de ${brl(Math.abs(s10.variacao))} na semana` : ', estável na semana';
    partes.push(`Na bomba, o S10 está em ${brl(s10.media)}${mov}.`);
  }
  return partes.join(' ');
}

/* ---------------------------------------------------------------- blocos */

function valorIndicador(i) {
  if (i.moeda === 'pts') return `${Math.round(i.valor).toLocaleString('pt-BR')}`;
  if (i.moeda === 'BRL') return brl(i.valor, 3);
  return `US$ ${num(i.valor)}`;
}

/** Linha de cotações, como a de um jornal econômico. Seta além da cor. */
function blocoMercado(indicadores, iso) {
  if (!indicadores?.length) return '<div class="mercado"></div>';
  return `
  <div class="mercado">
    ${indicadores.slice(0, 5).map((i) => {
      const classe = i.variacao > 0 ? 'alta' : i.variacao < 0 ? 'baixa' : '';
      const seta = i.variacao > 0 ? '▲' : i.variacao < 0 ? '▼' : '';
      const quando = i.dataISO < iso ? ` <small>fech. ${esc(i.data)}</small>` : '';
      return `
      <div class="mercado__item">
        <span class="mercado__nome">${esc(i.nome)}${quando}</span>
        <span class="mercado__valor">${esc(valorIndicador(i))}</span>
        <span class="mercado__var ${classe}">${seta} ${esc(sinal(i.variacao))}%</span>
      </div>`;
    }).join('')}
  </div>`;
}

function blocoNumeros({ abicom, dolar, anp, dataAbicomISO, brent }) {
  const d = abicom.diesel, g = abicom.gasolina;
  const s10 = anp?.produtos?.find((p) => p.nome === 'Diesel S10');
  const itens = [
    { rotulo: 'Defasagem do diesel', valor: brl(d.defasagem), nota: `${d.pct}% abaixo da paridade · Abicom ${ddmm(dataAbicomISO)}` },
    g?.defasagem != null
      ? { rotulo: 'Defasagem da gasolina', valor: brl(g.defasagem), nota: `${g.pct ?? '—'}% abaixo da paridade · Abicom ${ddmm(dataAbicomISO)}` }
      : { rotulo: 'Brent', valor: `US$ ${num(brent.valor)}`, nota: 'fechamento do contrato' },
    s10
      ? { rotulo: 'Diesel S10 na bomba', valor: brl(s10.media),
        nota: `${s10.variacao == null ? '' : `${sinal(s10.variacao)} na semana · `}ANP ${ddmm(anp.periodo.de)} a ${ddmm(anp.periodo.ate)}` }
      : null,
    { rotulo: 'Dólar PTAX', valor: brl(dolar.valor), nota: `Banco Central${dolar.data ? ` · ${ddmm(dolar.data)}` : ''}` }
  ].filter(Boolean).slice(0, 4);
  return `
  <section class="numeros">
    ${itens.map((i) => `
      <div class="numero">
        <span class="numero__rotulo">${esc(i.rotulo)}</span>
        <span class="numero__valor">${esc(i.valor)}</span>
        <span class="numero__nota">${esc(i.nota)}</span>
      </div>`).join('')}
  </section>`;
}

/** Análise da semana: o texto escrito à mão no editorial.json. */
function blocoAnalise(a) {
  return `
  <section class="bloco bloco--analise">
    <p class="bloco__chapeu">${esc(a.chapeu || 'Análise da semana')}</p>
    <h2 class="bloco__titulo">${esc(a.titulo)}</h2>
    ${a.texto ? `<p class="bloco__texto">${esc(a.texto)}</p>` : ''}
    <ul class="bloco__pontos">
      ${(a.pontos || []).slice(0, 3).map((p) => `<li>${esc(p)}</li>`).join('')}
    </ul>
    <p class="bloco__assina">Análise SupriPrice · não é recomendação comercial</p>
  </section>`;
}

/** Market share da ANP (dia em que ela divulga números novos). */
function blocoShare(share) {
  const m = share.mercado, t = share.trrs?.mes;
  const pp = (v) => {
    if (v == null) return '';
    const r = Math.round(v * 10) / 10;
    return r === 0 ? '0,0' : `${r > 0 ? '+' : '−'}${num(Math.abs(r), 1)}`;
  };
  const lista = (titulo, bloco) => `
      <div class="share__col">
        <p class="share__tit">${esc(titulo)}</p>
        <ol>${bloco.top.slice(0, 5).map((x) => `
          <li><span>${esc(x.curto)}</span><b>${num(x.share, 1)}%</b><i>${pp(x.deltaPP)}</i></li>`).join('')}
        </ol>
      </div>`;
  const varMes = m.varMesPct == null ? '' : ` (${m.varMesPct > 0 ? '+' : '−'}${num(Math.abs(m.varMesPct), 1)}% no mês)`;
  return `
  <section class="bloco bloco--share">
    <p class="bloco__chapeu">Market share · ANP divulga ${esc(m.referencia.rotulo)}</p>
    <p class="bloco__texto">Distribuidoras venderam <strong>${mil(m.mes.total)} mil m³</strong>${varMes}${m.canalTrr ? `; canal TRR: ${num(m.canalTrr.share, 1)}%` : ''}.</p>
    <div class="share">
      ${lista('Distribuidoras', m.mes)}
      ${t?.top?.length ? lista('TRRs', t) : ''}
    </div>
  </section>`;
}

/** Faixa de uma linha: o market share quando a análise ocupa o bloco. */
function faixaShare(share) {
  const m = share.mercado;
  return `<p class="faixa"><span>Market share ANP ${esc(m.referencia.rotulo)}: ` +
    m.mes.top.slice(0, 3).map((x) => `${esc(x.curto)} <b>${num(x.share, 1)}%</b>`).join(' · ') + '</span></p>';
}

/** Preço na bomba por região (dia sem análise nem market share). */
function blocoAnp(anp) {
  const s10 = anp.produtos.find((p) => p.nome === 'Diesel S10');
  const s500 = anp.produtos.find((p) => p.nome === 'Diesel S500');
  const regioes = (anp.regioes || []).slice(0, 5);
  return `
  <section class="bloco bloco--anp">
    <p class="bloco__chapeu">Preço na bomba · ANP, ${ddmm(anp.periodo.de)} a ${ddmm(anp.periodo.ate)}</p>
    <p class="bloco__texto">Média nacional: S10 <strong>${brl(s10.media)}</strong>${s500 ? ` · S500 <strong>${brl(s500.media)}</strong>` : ''}.
      ${anp.totalColetas ? `${anp.totalColetas.toLocaleString('pt-BR')} postos pesquisados.` : ''}</p>
    <ul class="regioes">
      ${regioes.map((r) => `<li><span>${esc(r.nome)}</span><b>${brl(r.media)}</b></li>`).join('')}
    </ul>
    ${anp.maisCaros?.[0] && anp.maisBaratos?.[0] ? `<p class="bloco__assina">S10 mais caro em ${esc(anp.maisCaros[0].estado)} (${brl(anp.maisCaros[0].media)}), mais barato em ${esc(anp.maisBaratos[0].estado)} (${brl(anp.maisBaratos[0].media)}).</p>` : ''}
  </section>`;
}

/** Câmbio e petróleo do dia, e por que importam para o diesel. */
function blocoMercadoDia(indicadores, iso) {
  const linhas = (indicadores || []).slice(0, 5).map((i) => {
    const classe = i.variacao > 0 ? 'alta' : i.variacao < 0 ? 'baixa' : '';
    const seta = i.variacao > 0 ? '▲' : i.variacao < 0 ? '▼' : '';
    const sem = i.semana == null ? '<i>—</i>'
      : `<i class="${i.semana > 0 ? 'alta' : i.semana < 0 ? 'baixa' : ''}">${esc(sinal(i.semana))}%</i>`;
    return `<li><span>${esc(i.nome)}${i.dataISO < iso ? ` <small>fech. ${esc(i.data)}</small>` : ''}</span>` +
      `<b>${esc(valorIndicador(i))}</b><i class="${classe}">${seta} ${esc(sinal(i.variacao))}%</i>${sem}</li>`;
  }).join('');
  return `
  <section class="bloco bloco--dados">
    <p class="bloco__chapeu">Câmbio e petróleo · no dia e em 5 pregões</p>
    <ul class="tabela-dia"><li class="tabela-dia__cab"><span></span><b></b><i>Dia</i><i>5 pregões</i></li>${linhas}</ul>
    <p class="bloco__assina">Dólar e petróleo formam a paridade de importação: em alta, a defasagem aumenta; em queda, diminui.</p>
  </section>`;
}

/** A defasagem nos últimos pregões, com o desenho da linha. */
function blocoDefasagem(historico, abicom) {
  const pts = (historico || []).slice(-20);
  const vals = pts.map((p) => p.valor);
  const lo = Math.min(...vals), hi = Math.max(...vals), faixa = hi - lo || 1;
  const L = 900, A = 150;
  const x = (i) => (i / Math.max(1, pts.length - 1)) * L;
  const y = (v) => A - ((v - lo) / faixa) * (A - 16) - 8;
  const linha = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' L');
  const d = abicom.diesel;
  return `
  <section class="bloco bloco--dados">
    <p class="bloco__chapeu">Defasagem do diesel · últimos ${pts.length} pregões</p>
    <svg class="spark" viewBox="0 0 ${L} ${A}" preserveAspectRatio="none" aria-hidden="true">
      <path d="M${linha}" fill="none" stroke="#B3341F" stroke-width="4" stroke-linejoin="round"/>
    </svg>
    <ul class="regioes">
      <li><span>Mínima</span><b>${brl(lo)}</b></li><li><span>Máxima</span><b>${brl(hi)}</b></li>
      ${d.faixaMin != null ? `<li><span>Entre os polos</span><b>${brl(d.faixaMin)} a ${brl(d.faixaMax)}</b></li>` : ''}
      ${d.diasJanelaFechada != null ? `<li><span>Janela fechada</span><b>${d.diasJanelaFechada} dias</b></li>` : ''}
    </ul>
    <p class="bloco__assina">De ${esc(pts[0].rotulo)} a ${esc(pts[pts.length - 1].rotulo)} · Abicom/StoneX, média dos polos, R$ por litro.</p>
  </section>`;
}

/** Os estados mais caros e mais baratos no S10 (ANP). */
function blocoEstados(anp) {
  const lista = (t, itens) => `<div class="share__col"><p class="share__tit">${t}</p><ol>${itens.slice(0, 5).map((e) =>
    `<li><span>${esc(e.estado)}</span><b>${brl(e.media)}</b><i></i></li>`).join('')}</ol></div>`;
  return `
  <section class="bloco bloco--dados">
    <p class="bloco__chapeu">Diesel S10 por estado · ANP, ${ddmm(anp.periodo.de)} a ${ddmm(anp.periodo.ate)}</p>
    <div class="share">${lista('Mais caros', anp.maisCaros)}${lista('Mais baratos', anp.maisBaratos)}</div>
    <p class="bloco__assina">Preço médio na bomba, por litro, no levantamento semanal da ANP.</p>
  </section>`;
}

/** Market share num estado (um por dia, em rodízio). */
function blocoShareEstado(shareResumo, uf) {
  const e = shareResumo.destaques.find((x) => x.uf === uf);
  const ref = shareResumo.mercado?.referencia?.rotulo || shareResumo.referencia?.rotulo || '';
  const pp = (v) => {
    if (v == null) return '';
    const r = Math.round(v * 10) / 10;
    return r === 0 ? '0,0' : `${r > 0 ? '+' : '−'}${num(Math.abs(r), 1)}`;
  };
  const lista = (t, itens) => `<div class="share__col"><p class="share__tit">${t}</p><ol>${(itens || []).map((x) =>
    `<li><span>${esc(x.nome)}</span><b>${num(x.share, 1)}%</b><i>${pp(x.deltaPP)}</i></li>`).join('')}</ol></div>`;
  return `
  <section class="bloco bloco--share">
    <p class="bloco__chapeu">Market share em ${esc(e.nome)} · ANP, ${esc(ref)}</p>
    <p class="bloco__texto">Distribuidoras venderam <strong>${mil(e.volume)} mil m³</strong> no estado${e.volumeTrr ? `; TRRs, ${mil(e.volumeTrr)} mil m³` : ''}.</p>
    <div class="share">${lista('Distribuidoras', e.topDist)}${lista('TRRs', e.topTrr)}</div>
    <p class="bloco__assina">p.p.: ganho ou perda de participação no mês. Todos os estados em supriprice.com.br/market-share.html</p>
  </section>`;
}

/** 3 manchetes: o radar da análise, ou um giro pelas editorias. */
function blocoNoticias(editorias, radar, analise) {
  let titulo = 'O que move o mercado', itens = [];
  if (radar?.length >= 2) {
    titulo = analise?.radarTitulo || 'Radar';
    itens = radar.slice(0, 3);
  } else {
    // Uma de cada editoria, em rodízio: mundo, Brasil, transporte, agro.
    const filas = ['mundo', 'brasil', 'transporte', 'agro'].map((e) => [...(editorias[e] || [])]);
    while (itens.length < 3 && filas.some((f) => f.length)) {
      for (const f of filas) if (f.length && itens.length < 3) itens.push(f.shift());
    }
  }
  if (!itens.length) return '<section class="noticias"></section>';
  return `
  <section class="noticias">
    <p class="noticias__tit">${esc(titulo)}</p>
    <ul>${itens.map((n) => `
      <li><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.titulo)}</a>
        <span class="fonte">${esc(n.fonte)}</span></li>`).join('')}
    </ul>
  </section>`;
}

/* --------------------------------------------------------------- página */

/**
 * Monta o HTML completo do jornal.
 * @returns {{html: string, nomeArquivo: string, titulo: string, chamada: string}}
 */
export function gerarJornal({
  data, abicom, brent, dolar, anp, noticias, historico, indicadores,
  share, shareResumo, analise, radar, parcial = false, fimDeSemana = false, dataAbicomISO, edicoesAntes = []
}) {
  const iso = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
  dataAbicomISO = dataAbicomISO || iso;

  // O bloco do dia muda todo dia (ver escolherDestaque).
  const destaque = escolherDestaque({ iso, abicom, anp, historico, indicadores, share, shareResumo, analise, parcial, edicoesAntes });
  const { chapeu, manchete, tipoManchete, analiseNaManchete } = escolherManchete({
    iso, abicom, anp, historico, share, shareResumo, analise, parcial, indicadores, destaque, edicoesAntes
  });

  let bloco = '', faixa = '';
  switch (destaque.tipo) {
    case 'share': bloco = blocoShare(share); break;
    case 'analise': bloco = blocoAnalise(analise); break;
    case 'mercado': bloco = blocoMercadoDia(indicadores, iso); break;
    case 'defasagem': bloco = blocoDefasagem(historico, abicom); break;
    case 'estados': bloco = blocoEstados(anp); break;
    case 'share-estado': bloco = blocoShareEstado(shareResumo, destaque.uf); break;
    default: bloco = anp ? blocoAnp(anp) : '';
  }
  // Dia de divulgação da ANP em que outro assunto ganhou o bloco: o market
  // share vai numa faixa de uma linha.
  if (share?.mercado?.mes?.top?.length && destaque.tipo !== 'share') faixa = faixaShare(share);
  // O radar do tema da análise só aparece no dia em que a análise aparece.
  if (destaque.tipo !== 'analise') radar = [];

  const principal = radar?.[0] || noticias?.editorias?.mundo?.[0] || noticias?.editorias?.brasil?.[0] || null;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SupriPrice · Panorama do Diesel — ${esc(iso.split('-').reverse().join('/'))}</title>
<meta name="description" content="${esc(manchete)}. Boletim diário do mercado de combustíveis.">
<meta name="robots" content="index, follow">
<meta name="supriprice-formato" content="stories-1080x1920">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #E9E5DA; }
  body { font-family: 'IBM Plex Sans', 'Segoe UI', system-ui, -apple-system, sans-serif; color: #14171A; overflow-x: hidden; }
  .tnum, .mercado__valor, .numero__valor, .share b, .regioes b { font-variant-numeric: tabular-nums; }

  /* A folha: 1080 x 1920, fixa. Na tela pequena o script abaixo encolhe. */
  .folha {
    width: 1080px; height: 1920px; overflow: hidden; background: #FBF9F4;
    display: flex; flex-direction: column; transform-origin: 0 0;
  }
  .clamp { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }

  /* Cabeçalho */
  .cab { height: 176px; flex: none; background: #0E2A47; color: #fff; display: flex; align-items: center;
    justify-content: space-between; padding: 0 56px; gap: 24px; }
  .cab__marca { display: flex; align-items: center; gap: 22px; }
  .cab__nome { display: block; font-family: Georgia, 'IBM Plex Serif', 'Times New Roman', serif; font-weight: 700; font-size: 52px; line-height: 1; letter-spacing: -.01em; }
  .cab__sub { display: block; margin-top: 10px; font-size: 20px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #C9D5E3; }
  .cab__data { text-align: right; font-size: 22px; line-height: 1.35; color: #C9D5E3; }
  .cab__data b { display: block; font-size: 28px; color: #fff; text-transform: none; }

  /* Cotações */
  .mercado { height: 112px; flex: none; display: grid; grid-template-columns: repeat(5, 1fr);
    border-bottom: 2px solid #14171A; background: #fff; }
  .mercado__item { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 3px; border-right: 1px solid #E2DCCC; }
  .mercado__item:last-child { border-right: 0; }
  .mercado__nome { font-size: 17px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #6A7480; }
  .mercado__nome small { font-size: 14px; font-weight: 600; letter-spacing: 0; text-transform: none; }
  .mercado__valor { font-size: 26px; font-weight: 700; }
  .mercado__var { font-size: 19px; font-weight: 700; }
  .alta { color: #2E6B4F; } .baixa { color: #B3341F; }

  /* Abertura */
  .abre { height: 420px; flex: none; padding: 30px 56px 0; display: flex; flex-direction: column; gap: 14px; }
  .chapeu { font-size: 22px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #B3341F; }
  .manchete { font-family: Georgia, 'IBM Plex Serif', 'Times New Roman', serif; font-weight: 700; font-size: 58px; line-height: 1.12;
    letter-spacing: -.01em; -webkit-line-clamp: 3; max-height: 196px; }
  .lide { font-size: 28px; line-height: 1.42; color: #2A2F36; -webkit-line-clamp: 4; max-height: 160px; }
  .lide strong { color: #14171A; }

  /* Números */
  .numeros { height: 300px; flex: none; margin: 0 56px; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
    gap: 2px; background: #DCD5C4; border: 2px solid #DCD5C4; }
  .numero { background: #fff; padding: 18px 24px; display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; }
  .numero__rotulo { font-size: 18px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #6A7480; }
  .numero__valor { font-size: 50px; font-weight: 700; line-height: 1.05; color: #0E2A47; }
  .numero__nota { font-size: 18px; color: #6A7480; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Bloco do dia */
  .bloco { height: 392px; flex: none; margin: 24px 56px 0; padding: 26px 30px; border-radius: 6px; overflow: hidden;
    display: flex; flex-direction: column; gap: 12px; }
  .bloco > * { flex: none; } /* nada encolhe: cada parte tem o próprio limite de linhas */
  .bloco--analise { background: #0E2A47; color: #fff; }
  .bloco--share, .bloco--anp { background: #fff; border: 2px solid #DCD5C4; }
  .bloco__chapeu { font-size: 19px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #F2A413; }
  .bloco--share .bloco__chapeu, .bloco--anp .bloco__chapeu { color: #B3341F; }
  .bloco__titulo { font-family: Georgia, 'IBM Plex Serif', serif; font-size: 36px; line-height: 1.15; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .bloco__texto { font-size: 23px; line-height: 1.4; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .bloco--analise .bloco__texto { color: #D5DEEA; }
  .bloco__pontos { list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .bloco__pontos li { position: relative; padding-left: 26px; font-size: 22px; line-height: 1.36; color: #fff;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .bloco__pontos li::before { content: ''; position: absolute; left: 0; top: 11px; width: 12px; height: 12px; border-radius: 50%; background: #F2A413; }
  .bloco__assina { margin-top: auto; font-size: 17px; color: #9FB0C4; }
  .bloco--anp .bloco__assina, .bloco--share .bloco__assina { color: #6A7480; }
  .share { display: grid; grid-template-columns: 1fr 1fr; gap: 0 34px; }
  .share__tit { font-size: 18px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #6A7480; margin-bottom: 4px; }
  .share ol { list-style: none; }
  .share li { display: grid; grid-template-columns: 1fr auto 62px; gap: 10px; align-items: baseline; font-size: 21px; padding: 5px 0; border-bottom: 1px solid #EEE8DA; }
  .share li span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .share li i { font-style: normal; font-size: 17px; color: #6A7480; text-align: right; }
  .bloco--dados { background: #fff; border: 2px solid #DCD5C4; }
  .bloco--dados .bloco__chapeu { color: #B3341F; }
  .bloco--dados .bloco__assina { color: #6A7480; }
  .tabela-dia { list-style: none; display: flex; flex-direction: column; }
  .tabela-dia li { display: grid; grid-template-columns: 1fr auto 140px 150px; gap: 16px; align-items: baseline;
    font-size: 25px; padding: 6px 0; border-bottom: 1px solid #EEE8DA; }
  .tabela-dia small { font-size: 16px; color: #6A7480; }
  .tabela-dia .tabela-dia__cab { padding: 0 0 2px; font-size: 16px; }
  .tabela-dia .tabela-dia__cab i { font-weight: 700; color: #6A7480; letter-spacing: .06em; text-transform: uppercase; }
  .tabela-dia b { font-variant-numeric: tabular-nums; }
  .tabela-dia i { font-style: normal; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
  .spark { width: 100%; height: 150px; display: block; flex: none; }
  .regioes { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 34px; margin-top: 4px; }
  .regioes li { display: flex; justify-content: space-between; font-size: 24px; padding: 6px 0; border-bottom: 1px dotted #D7D0BF; }

  /* Faixa (market share quando a análise ocupa o bloco) */
  .faixa { height: 54px; flex: none; margin: 14px 56px 0; padding: 0 22px; display: flex; align-items: center;
    background: #FFF4DC; border-left: 6px solid #F2A413; font-size: 20px; }
  .faixa span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Notícias: ocupa o que sobra, 3 itens de até 2 linhas. */
  .noticias { flex: 1 1 auto; min-height: 0; overflow: hidden; margin: 22px 56px 0; }
  .noticias__tit { font-family: Georgia, 'IBM Plex Serif', serif; font-size: 30px; font-weight: 700; padding-bottom: 8px; border-bottom: 2px solid #14171A; margin-bottom: 6px; }
  .noticias ul { list-style: none; }
  .noticias li { padding: 10px 0; border-bottom: 1px solid #E6E0D0; }
  .noticias a { color: #14171A; text-decoration: none; font-size: 25px; font-weight: 600; line-height: 1.3;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .fonte { display: block; margin-top: 3px; font-size: 17px; color: #6A7480; }

  /* Rodapé */
  .rodape { height: 128px; flex: none; background: #0E2A47; color: #C9D5E3; padding: 0 56px;
    display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .rodape__fontes { font-size: 16px; line-height: 1.5; max-width: 560px; }
  .rodape__site { text-align: right; }
  .rodape__site b { display: block; font-size: 36px; color: #fff; letter-spacing: -.01em; }
  .rodape__site span { font-size: 17px; color: #F2A413; font-weight: 600; }
</style>
</head>
<body>
<article class="folha">

  <header class="cab">
    <div class="cab__marca">
      ${ICONE}
      <div>
        <span class="cab__nome">Panorama do Diesel</span>
        <span class="cab__sub">SupriPrice · mercado de combustíveis</span>
      </div>
    </div>
    <div class="cab__data">${esc(DIAS[data.getDay()].charAt(0).toUpperCase() + DIAS[data.getDay()].slice(1))}<b>${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}</b></div>
  </header>

  ${blocoMercado(indicadores, iso)}

  <section class="abre">
    <p class="chapeu">${esc(chapeu)}</p>
    <h1 class="manchete clamp">${esc(manchete)}</h1>
    <p class="lide clamp">${lide({ abicom, anp, dataAbicomISO, parcial, fimDeSemana, analise, analiseNaManchete })}</p>
  </section>

  ${blocoNumeros({ abicom, dolar, anp, dataAbicomISO, brent })}
  ${bloco}
  ${faixa}
  ${blocoNoticias(noticias?.editorias || {}, radar, analise)}

  <footer class="rodape">
    <p class="rodape__fontes">Fontes: Abicom/StoneX (defasagem) · ANP (bomba e market share) · Banco Central
      (PTAX) · Yahoo Finance (cotações) · veículos citados nas manchetes.
      © ${data.getFullYear()} SupriPrice. Reprodução permitida citando a fonte.</p>
    <p class="rodape__site"><b>supriprice.com.br</b><span>Números atualizados todos os dias</span></p>
  </footer>

</article>
<script>
  // Na tela do celular a folha de 1080 px é encolhida para caber, sem mudar o
  // desenho. No download (iframe de 1080 px) a escala fica 1 e sai o tamanho exato.
  (function () {
    var f = document.querySelector('.folha');
    // Notícia que não cabe INTEIRA no espaço que sobrou sai da folha (em vez
    // de aparecer cortada no meio). Mede antes de qualquer escala.
    function encaixar() {
      var area = document.querySelector('.noticias');
      if (!area) return;
      var limite = area.getBoundingClientRect().bottom;
      Array.prototype.slice.call(area.querySelectorAll('li')).reverse().forEach(function (li) {
        if (li.getBoundingClientRect().bottom > limite + 1 && area.querySelectorAll('li').length > 1) li.remove();
      });
    }
    f.style.transform = '';
    encaixar();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { f.style.transform = ''; encaixar(); ajustar(); });
    function ajustar() {
      var s = Math.min(1, window.innerWidth / 1080);
      f.style.transform = s < 1 ? 'scale(' + s + ')' : '';
      document.body.style.height = s < 1 ? Math.ceil(1920 * s) + 'px' : '';
    }
    ajustar();
    window.addEventListener('resize', ajustar);
  })();
  // Audiência (Google Analytics): só no site e só para quem já aceitou os
  // cookies na página inicial. O jornal não mostra a barra de cookies — ela
  // sairia na foto do Stories.
  (function () {
    var ok = false;
    try { ok = localStorage.getItem('sp-consentimento') === 'sim'; } catch (e) {}
    if (!ok || !/(^|\\.)supriprice\\.(com\\.br|htmly\\.com\\.br)$/.test(location.hostname) || window.self !== window.top) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', 'G-8F90TTKC9Y', { allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=G-8F90TTKC9Y';
    document.head.appendChild(s);
  })();
</script>
</body>
</html>`;

  return {
    html,
    nomeArquivo: `jornal-${iso}.html`,
    titulo: manchete,
    destaque: destaque.tipo + (destaque.uf ? `:${destaque.uf}` : ''),
    tipoManchete,
    chamada: principal ? `Destaque: ${principal.titulo}` : `Defasagem em ${brl(abicom.diesel.defasagem)} por litro.`
  };
}

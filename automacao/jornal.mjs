// SupriPrice — o jornal do dia, gerado automaticamente
// -----------------------------------------------------------------------------
// Monta uma página A4 com os números do dia, o preço na bomba da ANP e as
// manchetes do mercado, pronta para ler na tela, imprimir ou baixar em PDF.
//
// O QUE ESTA PÁGINA É: um boletim de dados com as manchetes do dia, cada uma
// com link para quem apurou. Os textos corridos são construídos a partir dos
// próprios números — não há análise escrita por pessoa nem por modelo. Onde o
// dado falta, a frase não é inventada: a seção simplesmente não aparece.

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho',
  'agosto','setembro','outubro','novembro','dezembro'];
const DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira',
  'sexta-feira','sábado'];

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const brl = (v, casas = 2) => 'R$ ' + Number(v).toFixed(casas).replace('.', ',');
const num = (v, casas = 2) => Number(v).toFixed(casas).replace('.', ',');
const sinal = (v) => (v >= 0 ? '+' : '−') + num(Math.abs(v));

function porExtenso(d) {
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Frase de abertura construída a partir dos números, sem adjetivo gratuito. */
function lide({ abicom, brent, dolar, anp }) {
  const d = abicom.diesel;
  const partes = [];

  partes.push(
    `A defasagem média do diesel fechou em <strong>${brl(d.defasagem)} por litro</strong>, ` +
    `${d.pct}% abaixo da paridade de importação.`
  );

  if (d.faixaMin != null && d.faixaMax != null) {
    partes.push(
      `Entre os polos, a diferença vai de ${brl(d.faixaMin)} a ${brl(d.faixaMax)} por litro.`
    );
  }
  if (d.diasJanelaFechada != null) {
    partes.push(`A janela de importação está fechada há ${d.diasJanelaFechada} dias na média.`);
  }
  partes.push(
    `O Brent fechou a US$ ${num(brent.valor)} e o dólar, a ${brl(dolar.valor)}.`
  );

  if (anp) {
    const s10 = anp.produtos.find((p) => p.nome === 'Diesel S10');
    if (s10) {
      const mov = s10.variacao == null ? ''
        : s10.variacao > 0.004 ? ` — alta de ${brl(s10.variacao)} na semana`
        : s10.variacao < -0.004 ? ` — queda de ${brl(Math.abs(s10.variacao))} na semana`
        : ' — estável na semana';
      partes.push(
        `Na bomba, o S10 saiu por ${brl(s10.media)} em média nacional${mov}.`
      );
    }
  }
  return partes.join(' ');
}

function blocoNumeros({ abicom, brent, dolar }) {
  const d = abicom.diesel;
  const itens = [
    { rotulo: 'Defasagem do diesel', valor: brl(d.defasagem), nota: `${d.pct}% abaixo da paridade` },
    { rotulo: 'Brent', valor: `US$ ${num(brent.valor)}`, nota: 'fechamento do contrato' },
    { rotulo: 'Dólar', valor: brl(dolar.valor), nota: 'PTAX de venda' }
  ];
  if (abicom.gasolina) {
    itens.push({
      rotulo: 'Defasagem da gasolina',
      valor: brl(abicom.gasolina.defasagem),
      nota: `${abicom.gasolina.pct}% abaixo da paridade`
    });
  }
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

function blocoAnp(anp) {
  if (!anp) return '';
  const s10 = anp.produtos.find((p) => p.nome === 'Diesel S10');
  const s500 = anp.produtos.find((p) => p.nome === 'Diesel S500');

  const linhaProduto = (p) => p ? `
    <tr>
      <td>${esc(p.nome)}</td>
      <td class="n">${brl(p.media)}</td>
      <td class="n">${p.variacao == null ? '—' : sinal(p.variacao)}</td>
      <td class="n">${brl(p.minimo)} a ${brl(p.maximo)}</td>
    </tr>` : '';

  const regioes = (anp.regioes || []).map((r) => `
    <li><span>${esc(r.nome)}</span><b>${brl(r.media)}</b></li>`).join('');

  // Sem preposição antes da sigla: "no BA" estaria errado e "na BA"/"no ES"
  // exigiria saber o gênero de cada estado.
  const extremos = [];
  if (anp.maisCaros?.[0]) extremos.push(`mais caro em <strong>${esc(anp.maisCaros[0].estado)}</strong>, a ${brl(anp.maisCaros[0].media)}`);
  if (anp.maisBaratos?.[0]) extremos.push(`mais barato em <strong>${esc(anp.maisBaratos[0].estado)}</strong>, a ${brl(anp.maisBaratos[0].media)}`);

  return `
  <section class="bloco">
    <h2>Preço na bomba</h2>
    <p class="bloco__sub">Levantamento da ANP em ${anp.totalColetas.toLocaleString('pt-BR')} postos,
      de ${esc(anp.periodo.de.split('-').reverse().join('/'))} a ${esc(anp.periodo.ate.split('-').reverse().join('/'))}.</p>
    <table class="tabela">
      <thead><tr><th>Produto</th><th class="n">Média</th><th class="n">Semana</th><th class="n">Faixa</th></tr></thead>
      <tbody>${linhaProduto(s10)}${linhaProduto(s500)}</tbody>
    </table>
    ${regioes ? `<ul class="regioes">${regioes}</ul>` : ''}
    ${extremos.length ? `<p class="bloco__nota">S10 ${extremos.join('; ')}.</p>` : ''}
  </section>`;
}

function blocoNoticias(editorias, titulos) {
  const ordem = ['mundo', 'brasil', 'transporte', 'agro'];
  const secoes = ordem
    .filter((e) => (editorias[e] || []).length)
    .map((e) => {
      const itens = editorias[e].slice(0, 4).map((n) => `
        <li>
          <a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.titulo)}</a>
          <span class="fonte">${esc(n.fonte)}</span>
        </li>`).join('');
      return `
      <div class="editoria">
        <h3>${esc(titulos[e] || e)}</h3>
        <ul>${itens}</ul>
      </div>`;
    }).join('');

  if (!secoes) return '';
  return `
  <section class="bloco">
    <h2>O que move o mercado</h2>
    <p class="bloco__sub">Manchetes das últimas horas. Clique para ler na fonte.</p>
    <div class="editorias">${secoes}</div>
  </section>`;
}

function blocoGrafico(historico) {
  const pts = (historico || []).slice(-20);
  if (pts.length < 5) return '';
  const vals = pts.map((p) => p.valor);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const faixa = hi - lo || 1;
  const L = 560, A = 90;
  const x = (i) => (i / (pts.length - 1)) * L;
  const y = (v) => A - ((v - lo) / faixa) * (A - 12) - 6;
  const linha = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' L');

  return `
  <section class="bloco">
    <h2>Defasagem nos últimos ${pts.length} pregões</h2>
    <svg class="spark" viewBox="0 0 ${L} ${A}" preserveAspectRatio="none" aria-hidden="true">
      <path d="M${linha}" fill="none" stroke="#B3341F" stroke-width="2"/>
    </svg>
    <p class="bloco__nota">De ${brl(lo)} a ${brl(hi)} por litro no período.
      Primeiro ponto em ${esc(pts[0].rotulo)}, último em ${esc(pts[pts.length - 1].rotulo)}.</p>
  </section>`;
}

/**
 * Monta o HTML completo do jornal.
 * @returns {{html: string, nomeArquivo: string, titulo: string, chamada: string}}
 */
export function gerarJornal({ data, abicom, brent, dolar, anp, noticias, historico }) {
  const iso = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
  const titulos = { mundo: 'Mundo', brasil: 'Brasil', transporte: 'Transporte', agro: 'Agro' };

  // A manchete sai do fato mais forte que os números dão, nesta ordem.
  const d = abicom.diesel;
  let manchete;
  const variacao = historico?.length > 1
    ? d.defasagem - historico[historico.length - 2].valor
    : null;

  if (variacao != null && Math.abs(variacao) >= 0.15) {
    manchete = variacao > 0
      ? `Defasagem do diesel sobe ${brl(Math.abs(variacao))} e chega a ${brl(d.defasagem)}`
      : `Defasagem do diesel recua ${brl(Math.abs(variacao))} e fica em ${brl(d.defasagem)}`;
  } else if (d.diasJanelaFechada && d.diasJanelaFechada > 200) {
    manchete = `Janela de importação completa ${d.diasJanelaFechada} dias fechada`;
  } else {
    manchete = `Diesel segue ${d.pct}% abaixo da paridade de importação`;
  }

  const principal = (noticias?.editorias?.mundo?.[0]) || (noticias?.editorias?.brasil?.[0]) || null;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SupriPrice · Panorama do Diesel — ${esc(iso.split('-').reverse().join('/'))}</title>
<meta name="description" content="${esc(manchete)}. Boletim diário do mercado de combustíveis.">
<meta name="robots" content="index, follow">
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #F2EFE7; color: #14171A;
    font-family: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
    font-size: 13.5px; line-height: 1.5;
    display: flex; justify-content: center; padding: 20px 12px;
  }
  .folha {
    width: 100%; max-width: 820px; background: #FBF9F4; padding: 26px 30px 22px;
    box-shadow: 0 2px 18px rgba(14,42,71,.10); border: 1px solid #E2DCCC;
  }
  .topo { border-bottom: 3px double #14171A; padding-bottom: 10px; margin-bottom: 14px; }
  .topo__linha {
    display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px;
    font-size: 10.5px; font-weight: 700; letter-spacing: .09em;
    text-transform: uppercase; color: #55606E;
  }
  .cabecalho {
    font-family: Georgia, 'Times New Roman', serif; font-weight: 700;
    font-size: clamp(30px, 5.4vw, 46px); line-height: 1; letter-spacing: -.02em;
    text-align: center; margin: 8px 0 6px;
  }
  .topo__sub {
    text-align: center; font-size: 11px; font-weight: 600; letter-spacing: .16em;
    text-transform: uppercase; color: #6B4A18;
  }
  .manchete {
    font-family: Georgia, 'Times New Roman', serif; font-weight: 700;
    font-size: clamp(22px, 3.6vw, 31px); line-height: 1.16; margin: 16px 0 8px;
    text-wrap: balance;
  }
  .lide { font-size: 15px; line-height: 1.58; color: #23282E; margin-bottom: 16px; }
  .lide strong { font-weight: 700; }
  .numeros {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1px; background: #DCD5C4; border: 1px solid #DCD5C4; margin-bottom: 18px;
  }
  .numero { background: #FBF9F4; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
  .numero__rotulo { font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #6A7480; }
  .numero__valor { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .numero__nota { font-size: 11px; color: #6A7480; }
  .bloco { margin-bottom: 18px; }
  .bloco h2 {
    font-family: Georgia, serif; font-size: 17px; margin: 0 0 3px;
    border-bottom: 1px solid #14171A; padding-bottom: 4px;
  }
  .bloco__sub { font-size: 11.5px; color: #6A7480; margin: 0 0 8px; }
  .bloco__nota { font-size: 11.5px; color: #55606E; margin: 6px 0 0; }
  .tabela { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tabela th, .tabela td { padding: 5px 6px; border-bottom: 1px solid #E6E0D0; text-align: left; }
  .tabela th { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6A7480; }
  .tabela .n { text-align: right; font-variant-numeric: tabular-nums; }
  .regioes {
    list-style: none; padding: 0; margin: 10px 0 0; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 4px 14px; font-size: 12.5px;
  }
  .regioes li { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px dotted #D7D0BF; padding-bottom: 2px; }
  .regioes b { font-variant-numeric: tabular-nums; }
  .editorias { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px 22px; }
  .editoria h3 {
    font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: #B3341F; margin: 0 0 5px;
  }
  .editoria ul { list-style: none; padding: 0; margin: 0; }
  .editoria li { margin-bottom: 8px; line-height: 1.34; }
  .editoria a { color: #14171A; text-decoration: none; font-size: 13px; font-weight: 600; }
  .editoria a:hover { color: #B3341F; text-decoration: underline; }
  .fonte { display: block; font-size: 10.5px; color: #6A7480; margin-top: 1px; }
  .spark { width: 100%; height: 70px; display: block; }
  .rodape {
    border-top: 1px solid #14171A; margin-top: 14px; padding-top: 8px;
    font-size: 10.5px; line-height: 1.45; color: #6A7480;
    display: flex; flex-wrap: wrap; gap: 4px 18px; justify-content: space-between;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .folha { box-shadow: none; border: 0; max-width: none; padding: 0; }
    .editoria a { color: #000; }
  }
</style>
</head>
<body>
<article class="folha">

  <header class="topo">
    <div class="topo__linha">
      <span>${esc(porExtenso(data))}</span>
      <span>Óleo diesel · Brasil e mundo</span>
      <span>Edição da manhã</span>
    </div>
    <h1 class="cabecalho">Panorama do Diesel</h1>
    <p class="topo__sub">Transporte · Agro · Indústria</p>
  </header>

  <h2 class="manchete">${esc(manchete)}</h2>
  <p class="lide">${lide({ abicom, brent, dolar, anp })}</p>

  ${blocoNumeros({ abicom, brent, dolar })}
  ${blocoAnp(anp)}
  ${blocoGrafico(historico)}
  ${blocoNoticias(noticias?.editorias || {}, titulos)}

  <footer class="rodape">
    <span>Defasagem: Abicom/StoneX · Bomba: ANP · Dólar: Banco Central · Brent: ICE ·
      Manchetes: veículos citados, com link para a matéria original.</span>
    <span>Boletim gerado automaticamente. Conteúdo informativo, não constitui recomendação comercial. © ${data.getFullYear()} SupriPrice</span>
  </footer>

</article>
</body>
</html>`;

  return {
    html,
    nomeArquivo: `jornal-${iso}.html`,
    titulo: manchete,
    chamada: principal ? `Destaque: ${principal.titulo}` : `Defasagem em ${brl(d.defasagem)} por litro.`
  };
}

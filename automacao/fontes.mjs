// SupriPrice — coleta dos números do dia
// -----------------------------------------------------------------------------
// Três fontes, todas públicas e sem chave:
//   Abicom  — defasagem diária do diesel e da gasolina (análise com a StoneX)
//   BCB     — dólar PTAX de fechamento (oficial)
//   Yahoo   — Brent (contrato futuro BZ=F)
//
// Regra de ouro deste arquivo: se uma fonte não responder ou vier num formato
// inesperado, ele LANÇA erro em vez de devolver um palpite. Publicar número
// errado num portal de mercado é pior do que não publicar.

const UA = 'Mozilla/5.0 (compatible; SupriPriceBot/1.0; +https://supriprice.htmly.com.br)';

async function buscar(url, { texto = true, tentativas = 3 } = {}) {
  let ultimoErro;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
        signal: AbortSignal.timeout(25000)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return texto ? await r.text() : await r.json();
    } catch (e) {
      ultimoErro = e;
      if (i < tentativas) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw new Error(`Falha ao buscar ${url}: ${ultimoErro.message}`);
}

/** "3,01" -> 3.01 */
function numero(s) {
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Número inválido: "${s}"`);
  return n;
}

const NOMEADAS = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', deg: '°'
};

/** Tira tags, resolve entidades e normaliza espaços. */
function textoLimpo(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    // Entidades numéricas (&#8211; e &#x2013;) antes das nomeadas.
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NOMEADAS[n.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A Abicom escreve o título ora com hífen, ora com travessão. Normalizar evita
// que a leitura da data quebre por causa de um caractere.
const TRACO = '[-\\u2010-\\u2015]';

function exigir(regex, alvo, oQue) {
  const m = alvo.match(regex);
  if (!m) throw new Error(`Não encontrei ${oQue} na página da Abicom. O layout deles provavelmente mudou.`);
  return m;
}

/**
 * Lê o post diário da Abicom.
 * URL previsível: https://abicom.com.br/ppi/ppi-DD-MM-AAAA/
 * Em dia sem publicação (fim de semana, feriado) devolve null.
 */
export async function lerAbicom(data) {
  const dd = String(data.getDate()).padStart(2, '0');
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  const url = `https://abicom.com.br/ppi/ppi-${dd}-${mm}-${data.getFullYear()}/`;

  let html;
  try {
    html = await buscar(url, { tentativas: 2 });
  } catch (e) {
    if (/HTTP 404/.test(e.message)) return null; // ainda não publicaram
    throw e;
  }

  const t = textoLimpo(html);

  // A página traz diesel e gasolina em seções separadas. Isolar a seção evita
  // pegar o número da gasolina achando que é do diesel.
  const secao = (de, ate) => {
    const m = t.match(new RegExp(`${de}([\\s\\S]*?)${ate}`));
    return m ? m[1] : '';
  };
  const secDiesel = secao('Óleo Diesel A', 'Gasolina A');
  const secGasolina = secao('Gasolina A', 'Observações Importantes');
  if (!secDiesel) throw new Error('Não encontrei a seção do Óleo Diesel na página da Abicom.');

  const lerProduto = (sec, nome) => {
    const med = exigir(/Arbitragem Média:\s*(-?)R\$\s*([\d.,]+)\/L/, sec, `a arbitragem média do ${nome}`);
    const faixa = sec.match(/Variando de\s*(-?)R\$\s*([\d.,]+)\/L\s*a\s*(-?)R\$\s*([\d.,]+)\/L/);
    const janelas = sec.match(/(\d+)\s*dias de janelas fechadas/);
    return {
      // A Abicom publica a defasagem como negativa (preço abaixo da paridade).
      // Guardamos o módulo; o sinal vira rótulo no portal.
      defasagem: numero(med[2]),
      desfavoravel: med[1] === '-',
      faixaMin: faixa ? numero(faixa[4]) : null, // menor defasagem em módulo
      faixaMax: faixa ? numero(faixa[2]) : null, // maior defasagem em módulo
      diasJanelaFechada: janelas ? Number(janelas[1]) : null
    };
  };

  const pctDiesel = exigir(/Óleo Diesel:\s*(-?)([\d.,]+)%/, t, 'a defasagem percentual do diesel');
  const pctGasolina = t.match(/Gasolina:\s*(-?)([\d.,]+)%/);
  const dataPost = exigir(
    new RegExp(`PPI\\s*${TRACO}\\s*(\\d{2})\\/(\\d{2})\\/(\\d{4})`),
    t,
    'a data da publicação'
  );

  const [, dPost, mPost, aPost] = dataPost;
  if (`${dPost}-${mPost}-${aPost}` !== `${dd}-${mm}-${data.getFullYear()}`) {
    throw new Error(`A página ${url} diz ser de ${dPost}/${mPost}/${aPost}. Abortando para não publicar dado de outro dia.`);
  }

  const ptax = t.match(/Ptax:\s*R\$\s*([\d.,]+)/);

  return {
    url,
    data: `${dPost}/${mPost}/${aPost}`,
    diesel: { ...lerProduto(secDiesel, 'diesel'), pct: numero(pctDiesel[2]) },
    gasolina: secGasolina
      ? { ...lerProduto(secGasolina, 'gasolina'), pct: pctGasolina ? numero(pctGasolina[2]) : null }
      : null,
    ptaxCitado: ptax ? numero(ptax[1]) : null
  };
}

/**
 * Dólar PTAX de fechamento, direto do Banco Central.
 * A PTAX não sai em fim de semana nem feriado: volta até 7 dias atrás.
 */
export async function lerDolar(data) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(data);
    d.setDate(d.getDate() - i);
    const mdy = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
    const url =
      'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
      `CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${mdy}'&$format=json`;

    const j = await buscar(url, { texto: false });
    const linha = j?.value?.[0];
    if (linha?.cotacaoVenda) {
      return {
        valor: Number(linha.cotacaoVenda),
        data: String(linha.dataHoraCotacao || '').slice(0, 10),
        fonte: 'Banco Central (PTAX venda)'
      };
    }
  }
  throw new Error('Banco Central não devolveu PTAX nos últimos 8 dias.');
}

/** Brent (BZ=F). Usa o último fechamento disponível. */
export async function lerBrent() {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=10d';
  const j = await buscar(url, { texto: false });

  const res = j?.chart?.result?.[0];
  const fechamentos = res?.indicators?.quote?.[0]?.close || [];
  const marcas = res?.timestamp || [];

  for (let i = fechamentos.length - 1; i >= 0; i--) {
    if (Number.isFinite(fechamentos[i])) {
      return {
        valor: Number(fechamentos[i].toFixed(2)),
        data: new Date(marcas[i] * 1000).toISOString().slice(0, 10),
        fonte: 'Brent (ICE, contrato BZ=F)'
      };
    }
  }
  throw new Error('Yahoo não devolveu nenhum fechamento válido do Brent.');
}

export async function coletarTudo(data) {
  // Em paralelo: uma fonte lenta não atrasa as outras.
  const [abicom, dolar, brent] = await Promise.all([
    lerAbicom(data),
    lerDolar(data),
    lerBrent()
  ]);
  return { abicom, dolar, brent };
}

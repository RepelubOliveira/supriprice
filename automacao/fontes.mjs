// SupriPrice — coleta dos números do dia
// -----------------------------------------------------------------------------
// Três fontes, todas públicas e sem chave:
//   Abicom  — defasagem diária do diesel e da gasolina (análise com a StoneX)
//   BCB     — dólar PTAX de fechamento (oficial)
//   Yahoo   — Brent (contrato futuro BZ=F) e a faixa de indicadores:
//             Ibovespa, dólar, euro, Brent e WTI
//
// Regra de ouro deste arquivo: se uma fonte não responder ou vier num formato
// inesperado, ele LANÇA erro em vez de devolver um palpite. Publicar número
// errado num portal de mercado é pior do que não publicar.

// Cabeçalhos de navegador comum. ATENÇÃO ao que isto NÃO resolve: tentamos
// primeiro rodar esta coleta no GitHub Actions e tomamos 403 do Cloudflare da
// Abicom; trocar os cabeçalhos não mudou nada, porque a recusa é pela origem
// do pedido, não pelo que ele diz ser. Pior: pedidos de servidor recebem uma
// verificação anti-robô ("Performing security verification"), e passar por
// cima disso está fora de questão. Por isso a atualização roda na máquina do
// usuário (automacao/rodar-diario.ps1), onde a página abre sem desafio algum,
// que é o uso que o site permite — o robots.txt libera /ppi/ para todo agente.
const CABECALHOS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1'
};

async function buscar(url, { texto = true, tentativas = 3 } = {}) {
  let ultimoErro;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const r = await fetch(url, {
        headers: CABECALHOS,
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

/**
 * Faixa de indicadores de mercado (Ibovespa, dólar, euro, Brent, WTI).
 *
 * DE ONDE VEM A VARIAÇÃO — decidido com dado real em 30/09/2026, depois de
 * comparar três métodos com fontes independentes:
 *
 *   indicador   InfoMoney  AwesomeAPI  Yahoo range=1d  série diária emendada
 *   Ibovespa      +1,75%       —           +1,73%           +1,73%
 *   Dólar         -0,76%    -0,62%         -0,60%           -0,98%
 *   Euro             —      -0,73%         -0,73%           -1,28%
 *   Brent            —         —           +2,03%           -4,37%
 *
 * Usamos o chartPreviousClose da consulta com range=1d: é o fechamento do
 * pregão anterior DO MESMO CONTRATO, e bate com as fontes independentes.
 * NÃO use a série diária de vários dias para achar "o fechamento de ontem":
 *  - nos futuros ela emenda contratos na virada do mês — em 30/09 o Brent
 *    trocou de novembro para dezembro, e a emenda fabricava uma queda de 4%
 *    num dia em que o WTI subiu 1,3%;
 *  - no câmbio os candles diários fecham em horário que não é o de mercado,
 *    e há dias vazios (null).
 * E NÃO use o chartPreviousClose com range de vários dias: aí ele é o
 * fechamento de antes da janela inteira, não de ontem.
 */
const INDICADORES = [
  { id: 'ibov', nome: 'Ibovespa', simbolo: '^BVSP', moeda: 'pts' },
  { id: 'dolar', nome: 'Dólar', simbolo: 'USDBRL=X', moeda: 'BRL' },
  { id: 'euro', nome: 'Euro', simbolo: 'EURBRL=X', moeda: 'BRL' },
  { id: 'brent', nome: 'Brent', simbolo: 'BZ=F', moeda: 'USD' },
  { id: 'wti', nome: 'WTI', simbolo: 'CL=F', moeda: 'USD' }
];

// Acima disso num único pregão é quase certamente erro de dado. Melhor
// esconder o indicador do que estampar "-40%" no topo do portal.
const VARIACAO_MAXIMA = 15;

async function lerIndicador(ind) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ind.simbolo)}?interval=1d&range=1d`;
  const j = await buscar(url, { texto: false });
  const meta = j?.chart?.result?.[0]?.meta;

  const valor = meta?.regularMarketPrice;
  const anterior = meta?.chartPreviousClose;
  if (!Number.isFinite(valor)) throw new Error(`${ind.nome}: Yahoo não devolveu cotação.`);
  if (!Number.isFinite(anterior) || anterior <= 0) {
    throw new Error(`${ind.nome}: Yahoo não devolveu o fechamento anterior.`);
  }

  const variacao = ((valor - anterior) / anterior) * 100;
  if (Math.abs(variacao) > VARIACAO_MAXIMA) {
    throw new Error(`${ind.nome}: variação implausível (${variacao.toFixed(1)}%).`);
  }

  // Hora da cotação em Brasília: o portal diz de quando é cada número, porque
  // a atualização roda às 08:20 e 10:30 — não é cotação ao vivo.
  const quando = new Date(meta.regularMarketTime * 1000);
  const fmt = (o) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...o }).format(quando);

  return {
    id: ind.id,
    nome: ind.nome,
    moeda: ind.moeda,
    valor,
    anterior,
    variacao: Math.round(variacao * 100) / 100,
    // dataISO permite ao portal e ao jornal saberem se a cotação é de hoje ou
    // o fechamento de um pregão anterior (às 08:20 a B3 ainda não abriu).
    dataISO: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(quando),
    data: fmt({ day: '2-digit', month: '2-digit' }),
    hora: fmt({ hour: '2-digit', minute: '2-digit' })
  };
}

/**
 * Lê todos os indicadores. Cada um é independente: se o Yahoo falhar num
 * deles, a faixa sai sem aquele item. Nunca derruba a atualização.
 */
export async function lerIndicadores() {
  const resultados = await Promise.allSettled(INDICADORES.map(lerIndicador));
  const ok = [];
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') ok.push(r.value);
    else console.warn(`  ! ${INDICADORES[i].nome}: ${r.reason?.message || r.reason}`);
  });
  return ok;
}

export async function coletarTudo(data, { semAbicom = false } = {}) {
  // Em paralelo: uma fonte lenta não atrasa as outras. No fim de semana a
  // Abicom não publica: nem pergunta (semAbicom), segue o boletim de sexta.
  const [abicom, dolar, brent] = await Promise.all([
    semAbicom ? null : lerAbicom(data),
    lerDolar(data),
    lerBrent()
  ]);
  return { abicom, dolar, brent };
}

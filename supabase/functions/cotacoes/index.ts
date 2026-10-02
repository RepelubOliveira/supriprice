// SupriPrice - cotações ao vivo para a faixa de mercado do portal
// -----------------------------------------------------------------------------
// POR QUE EXISTE: o Yahoo Finance não libera consulta direta do navegador
// (não manda o cabeçalho CORS), então a página não consegue buscar Brent, WTI
// e Ibovespa sozinha. Esta função faz a consulta do lado do servidor e entrega
// ao portal.
//
// Publicada no projeto Supabase "radar-precos-risel", com o nome "cotacoes".
// Quem publica é o Claude, pelo conector do Supabase; esta cópia fica no
// repositório para o código não se perder.
//
// CUIDADOS:
// - Cache de 60 s: com mil visitantes ao mesmo tempo, o Yahoo continua
//   recebendo no máximo uma consulta por minuto (por instância da função).
// - Sem chave, sem banco, sem segredo: só lê cotações públicas. Por isso roda
//   sem exigir login (verify_jwt desligado) - o portal é público.
// - Mesma regra validada do robô (automacao/fontes.mjs): variação sobre o
//   fechamento anterior (chartPreviousClose do range=1d). Variação acima de
//   15% num pregão é tratada como erro de dado e o item fica de fora.

const INDICADORES = [
  { id: 'ibov', nome: 'Ibovespa', simbolo: '^BVSP', moeda: 'pts' },
  { id: 'dolar', nome: 'Dólar', simbolo: 'USDBRL=X', moeda: 'BRL' },
  { id: 'euro', nome: 'Euro', simbolo: 'EURBRL=X', moeda: 'BRL' },
  { id: 'brent', nome: 'Brent', simbolo: 'BZ=F', moeda: 'USD' },
  { id: 'wti', nome: 'WTI', simbolo: 'CL=F', moeda: 'USD' },
];

const VARIACAO_MAXIMA = 15;
const VALIDADE_MS = 60_000;

const ORIGENS = new Set([
  'https://www.supriprice.com.br',
  'https://supriprice.com.br',
]);
// Testes locais (servidor de pré-visualização na própria máquina).
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

type Indicador = (typeof INDICADORES)[number];

function emBrasilia(quando: Date, o: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...o }).format(quando);
}

async function lerIndicador(ind: Indicador) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ind.simbolo)}?interval=1d&range=1d`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`${ind.nome}: HTTP ${r.status}`);
  const meta = (await r.json())?.chart?.result?.[0]?.meta;

  const valor = meta?.regularMarketPrice;
  const anterior = meta?.chartPreviousClose;
  if (!Number.isFinite(valor)) throw new Error(`${ind.nome}: sem cotação`);
  if (!Number.isFinite(anterior) || anterior <= 0) throw new Error(`${ind.nome}: sem fechamento anterior`);

  const variacao = ((valor - anterior) / anterior) * 100;
  if (Math.abs(variacao) > VARIACAO_MAXIMA) {
    throw new Error(`${ind.nome}: variação implausível (${variacao.toFixed(1)}%)`);
  }

  const quando = new Date(meta.regularMarketTime * 1000);
  return {
    id: ind.id,
    nome: ind.nome,
    moeda: ind.moeda,
    valor,
    anterior,
    variacao: Math.round(variacao * 100) / 100,
    dataISO: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(quando),
    data: emBrasilia(quando, { day: '2-digit', month: '2-digit' }),
    hora: emBrasilia(quando, { hour: '2-digit', minute: '2-digit' }),
  };
}

let cache: { quando: number; corpo: string } | null = null;
let emAndamento: Promise<string> | null = null;

async function montarCorpo(): Promise<string> {
  const resultados = await Promise.allSettled(INDICADORES.map(lerIndicador));
  const indicadores = [];
  const falhas = [];
  for (const [i, r] of resultados.entries()) {
    if (r.status === 'fulfilled') indicadores.push(r.value);
    else falhas.push(INDICADORES[i].id);
  }
  if (!indicadores.length) throw new Error('Yahoo não respondeu nenhum indicador');
  return JSON.stringify({ geradoISO: new Date().toISOString(), indicadores, falhas });
}

async function obterCorpo(): Promise<string> {
  if (cache && Date.now() - cache.quando < VALIDADE_MS) return cache.corpo;
  // Várias visitas no mesmo instante esperam a MESMA consulta ao Yahoo.
  if (!emAndamento) {
    emAndamento = montarCorpo()
      .then((corpo) => {
        cache = { quando: Date.now(), corpo };
        return corpo;
      })
      .finally(() => {
        emAndamento = null;
      });
  }
  try {
    return await emAndamento;
  } catch (e) {
    // Yahoo fora do ar: melhor a última leitura boa (o portal mostra a hora
    // de cada cotação) do que nada.
    if (cache) return cache.corpo;
    throw e;
  }
}

Deno.serve(async (req: Request) => {
  const origem = req.headers.get('Origin') || '';
  const cors: Record<string, string> = { Vary: 'Origin' };
  if (ORIGENS.has(origem) || LOCAL.test(origem)) {
    cors['Access-Control-Allow-Origin'] = origem;
    cors['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    cors['Access-Control-Max-Age'] = '86400';
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return new Response('Método não permitido', { status: 405, headers: cors });

  try {
    const corpo = await obterCorpo();
    return new Response(corpo, {
      headers: {
        ...cors,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=30',
      },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ erro: 'cotações indisponíveis' }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
});

// SupriPrice — agregação de notícias
// -----------------------------------------------------------------------------
// Lê os feeds RSS de conteudo/feeds.json, filtra o que é sobre combustível e
// mercado, remove repetidas e devolve as matérias agrupadas por editoria.
//
// SOBRE DIREITO AUTORAL — não mude isto sem pensar:
// guardamos manchete, um resumo curto e o LINK para a matéria original. Nunca
// o texto integral. É o modelo de um agregador: o leitor termina de ler no site
// de quem apurou. Toda matéria carrega o nome da fonte.

const UA = 'Mozilla/5.0 (compatible; SupriPriceBot/1.0; +https://supriprice.htmly.com.br)';
const LIMITE_RESUMO = 200;

/** Entidades XML/HTML mais comuns nos feeds. */
const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', aacute: 'á', eacute: 'é'
};

function decodificar(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

function semTags(s) {
  return decodificar(String(s || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pega <tag>conteúdo</tag>, com ou sem CDATA. */
function tag(xml, nome) {
  const m = xml.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

/** Atom usa <link href="..."/> em vez de <link>texto</link>. */
function extrairLink(xml) {
  const direto = tag(xml, 'link');
  if (direto && /^https?:/i.test(direto.trim())) return direto.trim();
  const href = xml.match(/<link[^>]+href=["']([^"']+)["']/i);
  return href ? href[1] : '';
}

function extrairData(xml) {
  const bruta = tag(xml, 'pubDate') || tag(xml, 'published') || tag(xml, 'updated') || tag(xml, 'dc:date');
  const d = bruta ? new Date(bruta) : null;
  return d && !isNaN(d) ? d : null;
}

/** Normaliza para comparar títulos e detectar repetição entre veículos. */
function assinatura(titulo) {
  return titulo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 3)
    .slice(0, 6)
    .sort()
    .join(' ');
}

async function buscarFeed(feed) {
  try {
    const r = await fetch(feed.url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    console.warn(`  ! ${feed.nome}: ${e.message}`);
    return null;
  }
}

function lerItens(xml, feed) {
  const blocos = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocos
    .map((b) => {
      const titulo = semTags(tag(b, 'title'));
      const link = extrairLink(b);
      const resumoBruto = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded');
      let resumo = semTags(resumoBruto);
      if (resumo.length > LIMITE_RESUMO) {
        const corte = resumo.slice(0, LIMITE_RESUMO);
        resumo = corte.slice(0, corte.lastIndexOf(' ')) + '…';
      }
      return {
        titulo,
        url: link,
        resumo,
        data: extrairData(b),
        fonte: feed.fonte,
        editoria: feed.editoria,
        idioma: feed.idioma || 'pt',
        peso: feed.peso || 1
      };
    })
    .filter((n) => n.titulo && /^https?:\/\//i.test(n.url));
}

function relevante(noticia, cfg) {
  const alvo = (noticia.titulo + ' ' + noticia.resumo).toLowerCase();

  for (const bloqueada of cfg.palavrasBloqueadas || []) {
    if (alvo.includes(bloqueada.toLowerCase())) return false;
  }
  // Resumo vazio ou quase: sem contexto, a manchete sozinha não se sustenta.
  if (noticia.resumo.length < 25) return false;

  return true;
}

/**
 * Relevância em pontos, em vez de sim/não. Filtro binário deixava passar
 * "Kia Bongo 2027" só porque o texto citava combustível de passagem, e isso
 * competia de igual para igual com "Petrobras compra 650 milhões de litros
 * de diesel". Aqui, palavra-chave no título vale muito mais que no corpo.
 */
function pontuar(noticia, cfg) {
  const titulo = noticia.titulo.toLowerCase();
  const corpo = noticia.resumo.toLowerCase();
  const chaves = (cfg.palavrasChave || []).map((p) => p.toLowerCase());

  let pontos = 0;
  let noTitulo = 0;
  const vistas = new Set();

  for (const k of chaves) {
    if (titulo.includes(k)) { pontos += 4; noTitulo++; vistas.add(k); }
    else if (corpo.includes(k) && !vistas.has(k)) { pontos += 1; vistas.add(k); }
  }

  // Assunto central do portal: vale reforço.
  for (const nucleo of ['diesel', 'combustív', 'petróleo', 'refinaria', 'frete']) {
    if (titulo.includes(nucleo)) pontos += 3;
  }

  pontos += (noticia.peso || 1);
  return { pontos, noTitulo };
}

/**
 * Busca todos os feeds e devolve { mundo: [...], transporte: [...], ... }.
 * Um feed fora do ar não derruba a coleta: ele é registrado e pulado.
 */
export async function coletarNoticias(cfg) {
  const agora = Date.now();
  const limite = agora - (cfg.diasDeValidade || 4) * 86400000;

  const respostas = await Promise.all(
    cfg.feeds.map(async (f) => ({ feed: f, xml: await buscarFeed(f) }))
  );

  let todas = [];
  let feedsOk = 0;
  for (const { feed, xml } of respostas) {
    if (!xml) continue;
    feedsOk++;
    const itens = lerItens(xml, feed);
    const filtradas = itens
      .filter((n) => {
        if (!relevante(n, cfg)) return false;
        if (n.data && n.data.getTime() < limite) return false;
        return true;
      })
      .map((n) => ({ ...n, ...pontuar(n, cfg) }))
      // Feed genérico só entra com a palavra-chave no título: é o que separa
      // notícia de combustível de notícia que apenas menciona combustível.
      .filter((n) => !feed.filtrar || n.noTitulo > 0)
      .filter((n) => n.pontos >= (cfg.pontosMinimos ?? 0));

    todas = todas.concat(filtradas);
  }

  if (feedsOk === 0) throw new Error('Nenhum feed de notícias respondeu.');

  // Mesma notícia em veículos diferentes: fica a mais relevante.
  const porAssinatura = new Map();
  for (const n of todas) {
    const chave = assinatura(n.titulo);
    if (!chave) continue;
    const atual = porAssinatura.get(chave);
    if (!atual || n.pontos > atual.pontos) porAssinatura.set(chave, n);
  }

  // Ordena por relevância; entre igualmente relevantes, a mais nova primeiro.
  const unicas = [...porAssinatura.values()].sort((a, b) => {
    if (b.pontos !== a.pontos) return b.pontos - a.pontos;
    return (b.data ? b.data.getTime() : 0) - (a.data ? a.data.getTime() : 0);
  });

  const porEditoria = {};
  for (const n of unicas) {
    (porEditoria[n.editoria] = porEditoria[n.editoria] || []).push(n);
  }
  for (const ed of Object.keys(porEditoria)) {
    porEditoria[ed] = porEditoria[ed].slice(0, cfg.maxPorEditoria || 6).map((n) => ({
      titulo: n.titulo,
      resumo: n.resumo,
      url: n.url,
      fonte: n.fonte,
      idioma: n.idioma,
      data: n.data ? n.data.toISOString() : null
    }));
  }

  return {
    editorias: porEditoria,
    total: unicas.length,
    feedsConsultados: cfg.feeds.length,
    feedsOk
  };
}

// SupriPrice — agregação de notícias
// -----------------------------------------------------------------------------
// Lê os feeds RSS de conteudo/feeds.json, filtra o que é sobre combustível e
// mercado, remove repetidas e devolve as matérias agrupadas por editoria.
//
// SOBRE DIREITO AUTORAL — não mude isto sem pensar:
// guardamos manchete, um resumo curto e o LINK para a matéria original. Nunca
// o texto integral. É o modelo de um agregador: o leitor termina de ler no site
// de quem apurou. Toda matéria carrega o nome da fonte.

const UA = 'Mozilla/5.0 (compatible; SupriPriceBot/1.0; +https://www.supriprice.com.br)';
const LIMITE_RESUMO = 200;

/** Entidades XML/HTML mais comuns nos feeds. */
const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', aacute: 'á', eacute: 'é'
};

function decodificarUmaVez(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

/**
 * Alguns feeds codificam duas vezes: o WordPress publica "&amp;#038;" dentro do
 * CDATA, que decodificado uma vez ainda sobra como "&#038;" no meio da URL.
 * Repete até estabilizar, com teto para não entrar em laço com texto malformado.
 */
function decodificar(s) {
  let atual = String(s || '');
  for (let i = 0; i < 3; i++) {
    const proximo = decodificarUmaVez(atual);
    if (proximo === atual) break;
    atual = proximo;
  }
  return atual;
}

/**
 * Ordem importa: vários feeds mandam o HTML escapado ("&lt;p&gt;"), então é
 * preciso DECODIFICAR primeiro e só então tirar as tags — senão o resumo sai
 * com "<p style=..." no meio do texto. Decodifica de novo no fim porque o
 * conteúdo real pode trazer suas próprias entidades.
 */
function semTags(s) {
  const decodificado = decodificar(String(s || ''));
  const semMarcacao = decodificado.replace(/<[^>]+>/g, ' ');
  return decodificar(semMarcacao).replace(/\s+/g, ' ').trim();
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
  const bruto = (direto && /^https?:/i.test(direto.trim()))
    ? direto.trim()
    : (xml.match(/<link[^>]+href=["']([^"']+)["']/i) || [, ''])[1];
  return decodificar(bruto).trim();
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
  // O bloqueio olha o título e só o COMEÇO do resumo. Vários feeds anexam
  // links de outras matérias no fim da descrição; uma palavra vinda desse
  // rodapé derrubava notícias boas — foi assim que "Fazenda mantém subsídio
  // ao óleo diesel" sumia por causa de um "vagas" de outra chamada.
  const titulo = noticia.titulo.toLowerCase();
  const inicioResumo = noticia.resumo.slice(0, 120).toLowerCase();

  for (const bloqueada of cfg.palavrasBloqueadas || []) {
    const b = bloqueada.toLowerCase();
    if (titulo.includes(b) || inicioResumo.includes(b)) return false;
  }
  // Resumo curto NÃO descarta a matéria: alguns veículos publicam no feed só
  // um logotipo e um link, e a manchete continua valendo. O portal e o jornal
  // já sabem exibir um item sem resumo.
  if (noticia.titulo.length < 15) return false;

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

// Veículos que vão para o topo do radar: a busca do Google Notícias mistura
// imprensa conhecida com sites de reprodução de conteúdo.
const VEICULOS_PREFERIDOS = ['g1', 'globo', 'folha', 'estadão', 'estadao', 'valor', 'cnn', 'poder360', 'infomoney',
  'bloomberg', 'reuters', 'exame', 'uol', 'agência brasil', 'agencia brasil', 'veja', 'investnews', 'money times',
  'seu dinheiro', 'gazeta do povo', 'sbt', 'band', 'correio braziliense', 'metrópoles', 'metropoles', 'bbc',
  'cbn', 'jota', 'petronotícias', 'petronoticias', 'canal rural', 'broadcast', 'e-investidor', 'o globo'];

/** Palavras relevantes de um título (para achar a mesma notícia em outro veículo). */
function palavrasDe(titulo) {
  return new Set(titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
}

/** Sem acento e em minúsculas, para comparar termos. */
const plano = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Id estável de uma notícia: as palavras do título, em ordem. */
function idNoticia(titulo) {
  return [...palavrasDe(titulo)].sort().slice(0, 8).join('-').slice(0, 80);
}

/**
 * NEGÓCIOS DO SETOR: aquisições, fusões, vendas e decisões do Cade envolvendo
 * distribuidoras, TRRs, redes de postos e transportadoras. Duas origens:
 *   - buscas no Google Notícias (RSS público), que pegam a imprensa de todo o
 *     país — inclusive as decisões do Cade, que não tem feed próprio;
 *   - feeds das entidades e veículos do setor (Minaspetro, Sincopetro,
 *     Brasilcom, ICL, Brasil Postos...).
 * Só entra manchete com um termo de NEGÓCIO no título e um termo do SETOR no
 * título ou no começo do resumo. Configuração: conteudo/feeds.json → negocios.
 * Mesmo modelo do resto do portal: manchete, veículo e link.
 */
export async function buscarNegocios(cfg) {
  if (!cfg) return { itens: [], consultas: 0, ok: 0 };
  const limite = Date.now() - (cfg.diasDeValidade || 10) * 86400000;
  const negocio = (cfg.termosNegocio || []).map(plano);
  const setor = (cfg.termosSetor || []).map(plano);
  const bloqueadas = (cfg.bloqueadas || []).map(plano);
  const fontesFora = (cfg.fontesBloqueadas || []).map(plano);

  const fontes = [
    ...(cfg.buscas || []).map((q) => ({
      nome: `Busca "${q}"`, google: true, peso: 1,
      url: 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=pt-BR&gl=BR&ceid=BR:pt-419'
    })),
    ...(cfg.feeds || []).map((f) => ({ ...f, google: false }))
  ];
  const respostas = await Promise.all(fontes.map(async (f) => ({ f, xml: await buscarFeed(f) })));

  const todos = [];
  let ok = 0;
  for (const { f, xml } of respostas) {
    if (!xml) continue;
    ok++;
    for (const b of xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || []) {
      let titulo = semTags(tag(b, 'title'));
      let fonte = f.fonte || 'Google Notícias';
      let resumo = '';
      if (f.google) {
        fonte = semTags(tag(b, 'source')) || fonte;
        if (titulo.endsWith(` - ${fonte}`)) titulo = titulo.slice(0, -(fonte.length + 3)).trim();
      } else {
        resumo = semTags(tag(b, 'description') || tag(b, 'summary'));
        if (resumo.length > LIMITE_RESUMO) resumo = resumo.slice(0, resumo.lastIndexOf(' ', LIMITE_RESUMO)) + '…';
      }
      const url = extrairLink(b), data = extrairData(b);
      if (!titulo || !/^https?:\/\//i.test(url)) continue;
      if (data && data.getTime() < limite) continue;
      const t = plano(titulo), r = plano(resumo.slice(0, 160));
      if (!negocio.some((k) => t.includes(k))) continue;
      if (!setor.some((k) => t.includes(k) || r.includes(k))) continue;
      if (bloqueadas.some((k) => t.includes(k))) continue;
      if (fontesFora.some((k) => plano(fonte) === k)) continue;
      const cade = /\bcade\b/.test(t);
      const preferido = VEICULOS_PREFERIDOS.some((v) => plano(fonte).includes(plano(v)));
      const pontos = (cade ? 3 : 0) + (preferido ? 1 : 0) + (f.peso || 1) +
        (setor.some((k) => t.includes(k)) ? 2 : 0);
      todos.push({ titulo, resumo, url, fonte, data, cade, pontos, p: palavrasDe(titulo) });
    }
  }

  // Mais relevante primeiro; empate, a mais nova. A mesma notícia em outro
  // veículo (metade ou mais das palavras em comum) entra uma vez só.
  todos.sort((a, b) => (b.pontos - a.pontos) || ((b.data ? b.data.getTime() : 0) - (a.data ? a.data.getTime() : 0)));
  const escolhidas = [];
  for (const n of todos) {
    const repetida = escolhidas.some((e) => {
      const comuns = [...n.p].filter((w) => e.p.has(w)).length;
      return comuns / Math.max(1, Math.min(n.p.size, e.p.size)) >= 0.5;
    });
    if (!repetida) escolhidas.push(n);
    if (escolhidas.length >= (cfg.max || 8)) break;
  }
  // Na lista final, a mais nova primeiro.
  escolhidas.sort((a, b) => (b.data ? b.data.getTime() : 0) - (a.data ? a.data.getTime() : 0));
  return {
    itens: escolhidas.map((n) => ({
      id: idNoticia(n.titulo), titulo: n.titulo, resumo: n.resumo, url: n.url, fonte: n.fonte,
      data: n.data ? n.data.toISOString() : null, cade: n.cade
    })),
    consultas: fontes.length,
    ok
  };
}

/**
 * RADAR da análise da semana: uma busca temática no Google Notícias (RSS
 * público), configurada em conteudo/editorial.json → analise.radar. Serve
 * para o jornal ter as manchetes do tema da semana (ex.: eleições e
 * combustíveis), que os feeds fixos do setor quase nunca trazem.
 *
 * Mesmo modelo do resto do portal: manchete + veículo + link para a matéria.
 * Só entra manchete com uma das palavras do radar no TÍTULO; veículos
 * conhecidos vêm primeiro; a mesma notícia em dois veículos entra uma vez.
 * Falhou? Devolve lista vazia e o jornal usa as notícias de sempre.
 */
export async function buscarRadar(radar, { diasDeValidade = 4, max = 6 } = {}) {
  if (!radar?.busca) return [];
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(radar.busca) +
    '&hl=pt-BR&gl=BR&ceid=BR:pt-419';
  const xml = await buscarFeed({ nome: 'Radar (Google Notícias)', url });
  if (!xml) return [];

  const limite = Date.now() - diasDeValidade * 86400000;
  const palavras = (radar.palavras || []).map((p) => p.toLowerCase());
  const itens = (xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []).map((b) => {
    // O veículo vem na tag <source>; o título termina com " - Veículo".
    const fonte = semTags(tag(b, 'source')) || 'Google Notícias';
    let titulo = semTags(tag(b, 'title'));
    if (titulo.endsWith(` - ${fonte}`)) titulo = titulo.slice(0, -(fonte.length + 3)).trim();
    const preferido = VEICULOS_PREFERIDOS.some((v) => fonte.toLowerCase().includes(v));
    return { titulo, fonte, url: extrairLink(b), data: extrairData(b), preferido };
  }).filter((n) => n.titulo && /^https?:\/\//i.test(n.url))
    .filter((n) => !n.data || n.data.getTime() >= limite)
    .filter((n) => !palavras.length || palavras.some((p) => n.titulo.toLowerCase().includes(p)))
    .sort((a, b) => (b.preferido - a.preferido) || ((b.data ? b.data.getTime() : 0) - (a.data ? a.data.getTime() : 0)));

  // Mesma notícia em outro veículo: metade ou mais das palavras em comum.
  const escolhidas = [];
  for (const n of itens) {
    const p = palavrasDe(n.titulo);
    const repetida = escolhidas.some((e) => {
      const comuns = [...p].filter((w) => e.p.has(w)).length;
      return comuns / Math.max(1, Math.min(p.size, e.p.size)) >= 0.5;
    });
    if (!repetida) escolhidas.push({ ...n, p });
    if (escolhidas.length >= max) break;
  }
  return escolhidas.map((n) => ({ titulo: n.titulo, url: n.url, fonte: n.fonte, data: n.data ? n.data.toISOString() : null }));
}

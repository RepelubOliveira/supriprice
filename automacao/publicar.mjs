// SupriPrice — publicação no HTMLy
// -----------------------------------------------------------------------------
// Usa a tool publish_site do servidor MCP do HTMLy (JSON-RPC sobre HTTP),
// autenticada com a API key da conta (header Authorization: Bearer).
//
// Por que o MCP e não a API REST v1: a REST cria site e edita configurações,
// mas não atualiza o conteúdo de um arquivo. O publish_site trabalha por MERGE
// — mandamos só o dados.js e todo o resto do site fica exatamente como está.

const ENDPOINT = 'https://htmly.com.br/api/mcp';

async function chamarMcp(metodo, params, chave) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${chave}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: metodo, params }),
    signal: AbortSignal.timeout(60000)
  });

  const bruto = await r.text();
  if (!r.ok) throw new Error(`HTMLy respondeu HTTP ${r.status}: ${bruto.slice(0, 400)}`);

  // O transporte pode responder em JSON puro ou em SSE ("data: {...}").
  let corpo = bruto.trim();
  if (corpo.startsWith('event:') || corpo.startsWith('data:')) {
    const linha = corpo.split('\n').find((l) => l.startsWith('data:'));
    corpo = linha ? linha.slice(5).trim() : corpo;
  }

  let json;
  try {
    json = JSON.parse(corpo);
  } catch {
    throw new Error(`Resposta do HTMLy não é JSON: ${corpo.slice(0, 400)}`);
  }

  if (json.error) throw new Error(`HTMLy: ${json.error.message || JSON.stringify(json.error)}`);
  return json.result;
}

/** O resultado das tools vem como texto dentro de content[]. */
function extrairResultado(result) {
  const bloco = result?.content?.find((c) => c.type === 'text');
  if (!bloco) return result;
  try {
    return JSON.parse(bloco.text);
  } catch {
    return { texto: bloco.text };
  }
}

/**
 * Publica um ou mais arquivos no site, por merge.
 * @param {{slug: string, chave: string, arquivos: Array<{path: string, content: string}>}} opcoes
 */
export async function publicarArquivos({ slug, chave, arquivos }) {
  if (!chave) throw new Error('HTMLY_API_KEY não definida.');
  if (!slug) throw new Error('HTMLY_SLUG não definido.');
  if (!arquivos?.length) throw new Error('Nenhum arquivo para publicar.');

  const result = await chamarMcp(
    'tools/call',
    { name: 'publish_site', arguments: { slug, files: arquivos } },
    chave
  );

  const dados = extrairResultado(result);

  // A resposta confere o trabalho: files_written tem que conter o que mandamos.
  const escritos = (dados.files_written || []).map((f) => f.path || f);
  for (const a of arquivos) {
    if (!escritos.includes(a.path)) {
      throw new Error(
        `O HTMLy não confirmou a gravação de ${a.path}. ` +
          `Gravados: ${escritos.join(', ') || '(nenhum)'}`
      );
    }
  }

  return dados;
}

/** Lista os sites da conta — útil para conferir o slug e o espaço usado. */
export async function listarSites(chave) {
  return extrairResultado(await chamarMcp('tools/call', { name: 'list_sites', arguments: {} }, chave));
}

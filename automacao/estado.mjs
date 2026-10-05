// SupriPrice — estado compartilhado entre o computador e a nuvem
// -----------------------------------------------------------------------------
// O robô roda em dois lugares:
//   - no COMPUTADOR (Tarefa Agendada, 07h/12h/17h): o único que alcança a
//     Abicom; é a fonte do editorial (análise da semana) e dos modelos das
//     páginas;
//   - na NUVEM (GitHub Actions, 07h30/12h30/17h30): reserva, só age se o
//     computador não tiver atualizado (desligado, fim de semana, feriado).
//
// Para um continuar de onde o outro parou, o estado de trabalho (último
// boletim da Abicom, última ANP, histórico da defasagem, edições do jornal,
// market share, editorial e feeds) é publicado no próprio site, em
// dados/estado.json, a cada atualização. Quem roda depois baixa e junta com o
// que tem. O repositório no GitHub NÃO é usado para isso: ele só muda com
// "git push", e a nuvem trabalharia com dados velhos.
//
// Regras da junção (nenhum dado bom é jogado fora):
//   abicom e ANP  -> fica o mais recente (pela data do boletim/levantamento)
//   histórico     -> união por data
//   edições       -> união por data (mesma data: vale o estado mais novo)
//   market share  -> fica o estado mais novo; "publicados" é a união
//   editorial e feeds -> o computador é a fonte; a nuvem usa os do site

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { lerArquivoSite } from './publicar.mjs';

export const CAMINHO_ESTADO = 'dados/estado.json';
const MARCA_LOCAL = 'estado-gerado.txt'; // quando ESTA máquina publicou por último

const ARQUIVOS = ['abicom-ultimo', 'anp-ultima', 'historico', 'edicoes', 'share-trr', 'editorial', 'feeds'];

async function lerJson(p, padrao = null) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return padrao; }
}
const gravar = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n', 'utf8');

/** Baixa o estado publicado no site (ou null se ainda não houver). */
export async function baixarEstado({ slug, chave }) {
  const texto = await lerArquivoSite({ slug, chave, path: CAMINHO_ESTADO });
  if (!texto) return null;
  const e = JSON.parse(texto);
  return e?.arquivos ? e : null;
}

/** Monta o estado a publicar, a partir dos arquivos de conteudo/. */
export async function montarEstado({ raiz, origem, extras = {} }) {
  const arquivos = {};
  for (const nome of ARQUIVOS) {
    const v = extras[nome] ?? await lerJson(path.join(raiz, 'conteudo', `${nome}.json`));
    if (v != null) arquivos[nome] = v;
  }
  return JSON.stringify({ versao: 1, gerado: new Date().toISOString(), origem, arquivos });
}

/** Grava a hora em que esta máquina publicou (para comparar com o site). */
export async function marcarPublicacao(raiz, geradoISO) {
  await writeFile(path.join(raiz, 'conteudo', MARCA_LOCAL), geradoISO + '\n', 'utf8');
}

/**
 * Junta o estado do site com o local e grava em conteudo/.
 * @returns {string[]} o que mudou, para o registro
 */
export async function sincronizar({ raiz, remoto, nuvem }) {
  const dir = path.join(raiz, 'conteudo');
  const marca = path.join(dir, MARCA_LOCAL);
  const localGerado = existsSync(marca) ? (await readFile(marca, 'utf8')).trim() : '';
  const remotoMaisNovo = remoto.gerado > localGerado;
  const R = remoto.arquivos || {};
  const mudou = [];
  const p = (n) => path.join(dir, `${n}.json`);

  // Abicom: o boletim mais recente.
  if (R['abicom-ultimo']) {
    const L = await lerJson(p('abicom-ultimo'));
    if (!L || R['abicom-ultimo'].dataISO > L.dataISO) { await gravar(p('abicom-ultimo'), R['abicom-ultimo']); mudou.push('boletim da Abicom'); }
  }
  // ANP: o levantamento mais recente.
  if (R['anp-ultima']) {
    const L = await lerJson(p('anp-ultima'));
    if (!L || (R['anp-ultima'].periodo?.ate || '') > (L.periodo?.ate || '')) { await gravar(p('anp-ultima'), R['anp-ultima']); mudou.push('preço da ANP'); }
  }
  // Histórico: união por data.
  if (Array.isArray(R.historico)) {
    const L = await lerJson(p('historico'), []);
    const porData = new Map(L.map((x) => [x.data, x]));
    let novos = 0;
    for (const x of R.historico) if (!porData.has(x.data)) { porData.set(x.data, x); novos++; }
    if (novos) { await gravar(p('historico'), [...porData.values()].sort((a, b) => (a.data < b.data ? -1 : 1))); mudou.push(`${novos} ponto(s) do histórico`); }
  }
  // Edições: união por data; mesma data, vale o estado mais novo.
  if (Array.isArray(R.edicoes)) {
    const L = await lerJson(p('edicoes'), []);
    const porData = new Map(L.map((x) => [x.data, x]));
    let n = 0;
    for (const x of R.edicoes) {
      if (!porData.has(x.data) || (remotoMaisNovo && JSON.stringify(porData.get(x.data)) !== JSON.stringify(x))) { porData.set(x.data, x); n++; }
    }
    if (n) { await gravar(p('edicoes'), [...porData.values()].sort((a, b) => (a.data < b.data ? 1 : -1)).slice(0, 30)); mudou.push(`${n} edição(ões) do jornal`); }
  }
  // Market share: o estado mais novo; os arquivos já publicados, de ambos.
  if (R['share-trr']) {
    const L = await lerJson(p('share-trr'));
    const base = !L || remotoMaisNovo ? R['share-trr'] : L;
    const publicados = [...new Set([...(L?.publicados || []), ...(R['share-trr'].publicados || [])])];
    const final = { ...base, publicados };
    if (JSON.stringify(final) !== JSON.stringify(L)) { await gravar(p('share-trr'), final); mudou.push('market share'); }
  }
  // Editorial e feeds: na nuvem, valem os do site (o computador é a fonte).
  if (nuvem) {
    for (const n of ['editorial', 'feeds']) {
      if (R[n]) { await gravar(p(n), R[n]); mudou.push(n); }
    }
  }
  return mudou;
}

/**
 * Horário da última rodada do computador que já deveria ter acontecido
 * (07:00, 12:00 ou 17:00 de Brasília), em ISO UTC. Brasília é UTC-3 o ano todo.
 */
export function ultimaRodadaPrevista(agora = new Date()) {
  const brt = new Date(agora.getTime() - 3 * 3600000); // relógio de Brasília em campos UTC
  const horas = [7, 12, 17];
  let alvo = null;
  for (const h of horas) {
    const t = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate(), h) + 3 * 3600000;
    if (t <= agora.getTime()) alvo = t;
  }
  if (alvo == null) { // antes das 07:00: a das 17:00 de ontem
    alvo = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() - 1, 17) + 3 * 3600000;
  }
  return new Date(alvo).toISOString();
}

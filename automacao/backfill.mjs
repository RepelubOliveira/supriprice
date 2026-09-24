// SupriPrice — carga inicial do histórico
// -----------------------------------------------------------------------------
// Roda UMA vez, quando a automação é ligada. Percorre os boletins passados da
// Abicom e monta o conteudo/historico.json, para o gráfico de 30 dias já nascer
// cheio em vez de levar um mês para se formar.
//
//   node automacao/backfill.mjs            últimos 30 dias úteis
//   node automacao/backfill.mjs --dias=45
//
// É deliberadamente devagar (1 requisição por segundo): estamos lendo o site de
// outra empresa e não há motivo para apressar.

import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerAbicom } from './fontes.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQ_HISTORICO = path.join(RAIZ, 'conteudo', 'historico.json');

const args = process.argv.slice(2);
const DIAS = Number((args.find((a) => a.startsWith('--dias=')) || '--dias=30').split('=')[1]);

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ddmm = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function hojeBrasilia() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const [a, m, d] = p.split('-').map(Number);
  return new Date(a, m - 1, d);
}

async function principal() {
  const existente = existsSync(ARQ_HISTORICO)
    ? JSON.parse(await readFile(ARQ_HISTORICO, 'utf8'))
    : [];
  const jaTenho = new Set(existente.map((p) => p.data));

  const pontos = [...existente];
  const hoje = hojeBrasilia();
  let encontrados = 0;
  let semBoletim = 0;

  console.log(`Buscando até ${DIAS} dias úteis de histórico na Abicom...\n`);

  for (let i = 0; i < DIAS * 2 && encontrados < DIAS; i++) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    if (jaTenho.has(iso(d))) { encontrados++; continue; }

    try {
      const r = await lerAbicom(d);
      if (r && r.diesel && r.diesel.defasagem > 0) {
        pontos.push({ data: iso(d), rotulo: ddmm(d), valor: r.diesel.defasagem });
        encontrados++;
        console.log(`  ${ddmm(d)}  R$ ${r.diesel.defasagem.toFixed(2).replace('.', ',')}`);
      } else {
        semBoletim++;
        console.log(`  ${ddmm(d)}  sem boletim (feriado?)`);
      }
    } catch (e) {
      console.log(`  ${ddmm(d)}  erro: ${e.message}`);
    }
    await dormir(1000);
  }

  pontos.sort((a, b) => a.data.localeCompare(b.data));
  const finais = pontos.slice(-40);

  await writeFile(ARQ_HISTORICO, JSON.stringify(finais, null, 2) + '\n', 'utf8');
  console.log(`\n${finais.length} pontos gravados em conteudo/historico.json`);
  console.log(`(${encontrados} com boletim, ${semBoletim} dias sem publicação)`);
  console.log('\nAgora rode: node automacao/atualizar.mjs --simular');
}

principal().catch((e) => {
  console.error('\n✗ Falhou:', e.message);
  process.exit(1);
});

// SupriPrice — atualização diária do Panorama do Diesel
// -----------------------------------------------------------------------------
// Junta os números do dia (Abicom + Banco Central + Brent) com a parte
// editorial (conteudo/editorial.json), gera o portal/assets/js/dados.js e
// publica só esse arquivo no HTMLy.
//
// Uso:
//   node automacao/atualizar.mjs              publica
//   node automacao/atualizar.mjs --simular    gera o arquivo, não publica
//   node automacao/atualizar.mjs --data=2026-09-24   força uma data
//
// Variáveis de ambiente:
//   HTMLY_API_KEY  chave da conta (Perfil do HTMLy). Só é exigida sem --simular.
//   HTMLY_SLUG     slug do site (padrão: supriprice)

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coletarTudo } from './fontes.mjs';
import { publicarArquivos } from './publicar.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQ_EDITORIAL = path.join(RAIZ, 'conteudo', 'editorial.json');
const ARQ_HISTORICO = path.join(RAIZ, 'conteudo', 'historico.json');
const ARQ_DADOS = path.join(RAIZ, 'portal', 'assets', 'js', 'dados.js');
const CAMINHO_PUBLICADO = 'assets/js/dados.js';

const args = process.argv.slice(2);
const SIMULAR = args.includes('--simular');
const DATA_FORCADA = (args.find((a) => a.startsWith('--data=')) || '').split('=')[1];

const log = (...m) => console.log('•', ...m);

/** Hoje no fuso de Brasília, como objeto Date com ano/mês/dia locais de lá. */
function hojeBrasilia() {
  if (DATA_FORCADA) {
    const [a, m, d] = DATA_FORCADA.split('-').map(Number);
    return new Date(a, m - 1, d);
  }
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const [a, m, d] = partes.split('-').map(Number);
  return new Date(a, m - 1, d);
}

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ddmm = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
const brl = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`;

async function lerJson(caminho, padrao) {
  if (!existsSync(caminho)) return padrao;
  return JSON.parse(await readFile(caminho, 'utf8'));
}

/**
 * Histórico da defasagem: alimenta o gráfico de 30 dias e o "ontem" dos cartões.
 * Fica versionado no repositório, então cresce sozinho a cada execução.
 */
function registrarHistorico(historico, data, valor) {
  const chave = iso(data);
  const semHoje = historico.filter((p) => p.data !== chave);
  semHoje.push({ data: chave, rotulo: ddmm(data), valor });
  semHoje.sort((a, b) => a.data.localeCompare(b.data));
  return semHoje.slice(-40); // ~2 meses de dias úteis
}

function montarSerie(historico) {
  const pontos = historico.slice(-23).map((p) => [p.rotulo, p.valor]);
  const valores = pontos.map((p) => p[1]);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  // Escala com folga, arredondada para meio real.
  const piso = Math.floor((min - 0.2) * 2) / 2;
  const teto = Math.ceil((max + 0.2) * 2) / 2;
  const linhas = [];
  for (let v = piso; v <= teto + 1e-9; v += 0.5) linhas.push(Number(v.toFixed(1)));

  const iMax = valores.indexOf(max);
  const marcadores = [];
  if (pontos.length > 2) {
    marcadores.push({ i: iMax, texto: `Máx. ${brl(max)}`, dy: -12, ancora: 'end' });
    marcadores.push({
      i: pontos.length - 1,
      texto: brl(valores[valores.length - 1]),
      dy: -12,
      ancora: 'end'
    });
  }
  return { pontos, escala: { min: piso, max: teto, linhas }, marcadores };
}

function montarProdutos(abicom, editorial) {
  const precos = editorial.precosPetrobras || {};
  const itens = [];

  const cartao = (nome, escopo, bloco, petro) => ({
    nome,
    escopo,
    petro,
    ppi: Number((petro + bloco.defasagem).toFixed(4)),
    defasagem: bloco.defasagem,
    pct: bloco.pct,
    faixaMin: bloco.faixaMin,
    faixaMax: bloco.faixaMax,
    diasJanelaFechada: bloco.diasJanelaFechada
  });

  itens.push(cartao('Diesel A', 'média dos polos', abicom.diesel, Number(precos.diesel) || 0));
  if (editorial.mostrarGasolina && abicom.gasolina) {
    itens.push(cartao('Gasolina A', 'média dos polos', abicom.gasolina, Number(precos.gasolina) || 0));
  }
  return itens;
}

function montarTicker(abicom, dolar, brent) {
  const d = abicom.diesel;
  const linhas = [
    { label: 'Defasagem diesel', valor: brl(d.defasagem), nota: `${d.pct}%` },
    { label: 'Brent', valor: `US$ ${brent.valor.toFixed(2).replace('.', ',')}`, nota: '' },
    { label: 'Dólar (PTAX)', valor: brl(dolar.valor), nota: '' }
  ];
  if (d.faixaMin != null && d.faixaMax != null) {
    linhas.push({ label: 'Faixa por polo', valor: brl(d.faixaMin), nota: `a ${brl(d.faixaMax)}` });
  }
  if (d.diasJanelaFechada != null) {
    linhas.push({ label: 'Janela fechada', valor: `${d.diasJanelaFechada}`, nota: 'dias' });
  }
  return linhas;
}

function gerarArquivoDados(dados) {
  const cabecalho = [
    '/* ==========================================================================',
    '   SupriPrice — Panorama do Diesel',
    '   ARQUIVO GERADO AUTOMATICAMENTE — não edite à mão.',
    '',
    `   Gerado em ${new Date().toISOString()}`,
    '   Origem dos números:',
    '     defasagem  Abicom (análise diária em parceria com a StoneX)',
    '     dólar      Banco Central, PTAX de venda',
    '     Brent      contrato futuro BZ=F',
    '',
    '   Para mudar o conteúdo editorial (notícias, agenda, relatórios, preços',
    '   da Petrobras), edite conteudo/editorial.json e rode a automação.',
    '   ========================================================================== */',
    ''
  ].join('\n');

  return `${cabecalho}window.DADOS = ${JSON.stringify(dados, null, 2)};\n`;
}

async function principal() {
  const hoje = hojeBrasilia();
  log(`Data de referência: ${ddmm(hoje)}/${hoje.getFullYear()} (fuso de Brasília)`);

  const diaSemana = hoje.getDay();
  if (diaSemana === 0 || diaSemana === 6) {
    log('Fim de semana: a Abicom não publica. Nada a fazer.');
    return;
  }

  const editorial = await lerJson(ARQ_EDITORIAL, null);
  if (!editorial) throw new Error(`Não encontrei ${ARQ_EDITORIAL}.`);

  log('Buscando Abicom, Banco Central e Brent...');
  const { abicom, dolar, brent } = await coletarTudo(hoje);

  if (!abicom) {
    log('A Abicom ainda não publicou o boletim de hoje. Saindo sem publicar.');
    log('(O agendamento tenta de novo mais tarde. Feriado não tem boletim.)');
    return;
  }

  log(`Abicom ${abicom.data}: diesel ${brl(abicom.diesel.defasagem)} (${abicom.diesel.pct}%)`);
  log(`Dólar ${brl(dolar.valor)} (${dolar.data}) · Brent US$ ${brent.valor} (${brent.data})`);

  // Sanidade: um valor fora de faixa quase certamente é erro de leitura.
  const def = abicom.diesel.defasagem;
  if (!(def > 0 && def < 20)) {
    throw new Error(`Defasagem lida (${def}) está fora de qualquer faixa plausível. Abortando.`);
  }

  const historicoAntes = await lerJson(ARQ_HISTORICO, []);
  const anterior = historicoAntes.filter((p) => p.data !== iso(hoje)).slice(-1)[0];
  const historico = registrarHistorico(historicoAntes, hoje, def);

  const dados = {
    meta: {
      dataISO: iso(hoje),
      horaFechamento: '08:00',
      fonte: `Fonte: Abicom/StoneX, fechamento ${abicom.data}`,
      siteUrl: 'https://supriprice.htmly.com.br/',
      gerado: new Date().toISOString()
    },
    produtos: montarProdutos(abicom, editorial).map((p) => ({
      ...p,
      anterior: anterior ? anterior.valor : p.defasagem
    })),
    ticker: montarTicker(abicom, dolar, brent),
    serieS10: montarSerie(historico),
    polos: editorial.polos,
    bomba: editorial.bomba,
    paridade: editorial.paridade,
    agenda: editorial.agenda,
    edicoes: editorial.edicoes,
    mundo: editorial.mundo,
    arquivo: editorial.arquivo
  };

  const conteudo = gerarArquivoDados(dados);
  await writeFile(ARQ_DADOS, conteudo, 'utf8');
  await writeFile(ARQ_HISTORICO, JSON.stringify(historico, null, 2) + '\n', 'utf8');
  log(`dados.js gerado (${(conteudo.length / 1024).toFixed(1)} KB) · histórico com ${historico.length} pontos`);

  if (SIMULAR) {
    log('Modo simulação: nada foi publicado.');
    return;
  }

  log('Publicando no HTMLy...');
  const res = await publicarArquivos({
    slug: process.env.HTMLY_SLUG || 'supriprice',
    chave: process.env.HTMLY_API_KEY,
    arquivos: [{ path: CAMINHO_PUBLICADO, content: conteudo }]
  });
  log(`Publicado: ${res.url || '(sem url)'} · ${res.storage_bytes ?? '?'} bytes no site`);
}

principal().catch((e) => {
  console.error('\n✗ Falhou:', e.message);
  console.error('  Nada foi publicado. O site continua mostrando os dados anteriores,');
  console.error('  e o selo do topo avisa o leitor que a data não é de hoje.');
  process.exit(1);
});

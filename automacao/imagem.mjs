// SupriPrice — "foto" do jornal do dia em PNG (1080 x 1920, formato Stories)
// -----------------------------------------------------------------------------
// POR QUE: o download de imagem do site usava o html2canvas, que redesenha a
// página por conta própria — e desenhava o texto deslocado (manchete cortada,
// números encavalados). Aqui o robô abre o jornal no próprio Edge (ou Chrome)
// do computador, em modo invisível, e tira a foto: sai exatamente o que o
// navegador mostra. O PNG é publicado junto com o jornal; o site só entrega o
// arquivo (e converte para JPEG/PDF a partir dele).
//
// Falhou (navegador não encontrado, demorou demais)? O jornal sai do mesmo
// jeito, sem PNG, e o site volta ao método antigo para aquela edição.

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LARGURA = 1080, ALTURA = 1920;

function acharNavegador() {
  const candidatos = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'
  ].filter(Boolean);
  return candidatos.find((c) => existsSync(c)) || null;
}

/** Largura e altura gravadas no cabeçalho do PNG. */
function dimensoesPng(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

/**
 * Abre o HTML do jornal no navegador invisível e devolve o PNG (Buffer).
 * Lança erro se não conseguir — quem chama decide seguir sem a imagem.
 */
export async function fotografarJornal(caminhoHtml, caminhoPng) {
  const navegador = acharNavegador();
  if (!navegador) throw new Error('Edge/Chrome não encontrado neste computador.');

  // Perfil temporário: não mexe no navegador do usuário nem trava se ele estiver aberto.
  const perfil = await mkdtemp(path.join(tmpdir(), 'supriprice-foto-'));
  const args = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--force-device-scale-factor=1', `--window-size=${LARGURA},${ALTURA}`,
    // Dá tempo para as fontes e o ajuste das notícias rodarem antes da foto.
    '--virtual-time-budget=4000',
    `--user-data-dir=${perfil}`, `--screenshot=${caminhoPng}`,
    pathToFileURL(caminhoHtml).href
  ];
  try {
    // A foto da rodada anterior do mesmo dia não pode ser confundida com a nova.
    await rm(caminhoPng, { force: true });
    await new Promise((ok, erro) => {
      const p = spawn(navegador, args, { stdio: 'ignore', windowsHide: true });
      const prazo = setTimeout(() => { p.kill(); erro(new Error('O navegador demorou mais de 60 s.')); }, 60000);
      p.on('error', (e) => { clearTimeout(prazo); erro(e); });
      p.on('exit', () => { clearTimeout(prazo); ok(); });
    });
    // O executável do Edge sai logo e deixa um processo filho tirando a foto:
    // espera o arquivo aparecer e parar de crescer (até 45 s).
    let anterior = -1;
    for (let i = 0; i < 90; i++) {
      const tam = existsSync(caminhoPng) ? statSync(caminhoPng).size : -1;
      if (tam > 0 && tam === anterior) break;
      anterior = tam;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!existsSync(caminhoPng)) throw new Error('o navegador não gravou a imagem.');
    const png = await readFile(caminhoPng);
    const dim = dimensoesPng(png);
    if (!dim || dim.largura !== LARGURA || dim.altura !== ALTURA) {
      throw new Error(`imagem com tamanho inesperado (${dim ? `${dim.largura}x${dim.altura}` : 'inválida'}).`);
    }
    return png;
  } finally {
    await rm(perfil, { recursive: true, force: true }).catch(() => {});
  }
}

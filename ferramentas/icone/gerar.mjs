// COMO RODAR (só se a marca mudar): numa pasta qualquer, copie este arquivo,
// baixe a fonte Archivo 800 como archivo-800.ttf (fonts.google.com) e rode:
//   npm install opentype.js @resvg/resvg-js
//   node gerar.mjs "<caminho do projeto>/portal"
// Gera favicon.ico, favicon.svg, apple-touch-icon.png, icone-192.png e icone-512.png.

// Gera o ícone do SupriPrice (etiqueta + "S" + ponto laranja) a partir do
// desenho de "SupriPrice Logo.dc.html", com a letra convertida em contorno
// (não depende da fonte instalada em quem abre o site).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';

const saida = process.argv[2];
mkdirSync(saida, { recursive: true });

const fonte = opentype.parse(readFileSync('archivo-800.ttf').buffer);
console.log('fonte:', fonte.names.fullName?.en, '| variável:', !!fonte.tables.fvar);

// Mesmo posicionamento do SVG original: x=27 (centro), base em y=48, corpo 36.
const largura = fonte.getAdvanceWidth('S', 36);
const letra = fonte.getPath('S', 27 - largura / 2, 48, 36).toPathData(2);

const ETIQUETA = 'M12 6 H40 L58 24 V52 A6 6 0 0 1 52 58 H12 A6 6 0 0 1 6 52 V12 A6 6 0 0 1 12 6 Z';
const desenho = `<path d="${ETIQUETA}" fill="#0E2A47"/><circle cx="45" cy="19" r="4.6" fill="#F2A413"/><path d="${letra}" fill="#FFFFFF"/>`;

// Favicon: recorte justo na etiqueta (cada pixel conta a 16 px).
const svgFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 5 54 54">${desenho}</svg>`;
// Ícone de app (iPhone, Android): etiqueta centrada sobre branco, com folga —
// o iPhone pinta de preto o que for transparente e arredonda os cantos.
const svgApp = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#FFFFFF"/>` +
  `<g transform="translate(32 32) scale(0.78) translate(-32 -32)">${desenho}</g></svg>`;

writeFileSync(`${saida}/favicon.svg`, svgFavicon + '\n');

const png = (svg, px) => new Resvg(svg, { fitTo: { mode: 'width', value: px } }).render().asPng();
const pngs = {};
for (const px of [16, 32, 48]) pngs[px] = png(svgFavicon, px);
writeFileSync(`${saida}/favicon-32.png`, pngs[32]);
writeFileSync(`${saida}/apple-touch-icon.png`, png(svgApp, 180));
writeFileSync(`${saida}/icone-192.png`, png(svgApp, 192));
writeFileSync(`${saida}/icone-512.png`, png(svgApp, 512));

// favicon.ico com PNGs dentro (16, 32, 48): o formato que todo navegador e o
// Google aceitam, inclusive quem pede /favicon.ico direto.
const tamanhos = [16, 32, 48];
const cab = Buffer.alloc(6 + 16 * tamanhos.length);
cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(tamanhos.length, 4);
let deslocamento = cab.length;
tamanhos.forEach((px, i) => {
  const o = 6 + 16 * i, dados = pngs[px];
  cab.writeUInt8(px, o); cab.writeUInt8(px, o + 1); cab.writeUInt8(0, o + 2); cab.writeUInt8(0, o + 3);
  cab.writeUInt16LE(1, o + 4); cab.writeUInt16LE(32, o + 6);
  cab.writeUInt32LE(dados.length, o + 8); cab.writeUInt32LE(deslocamento, o + 12);
  deslocamento += dados.length;
});
writeFileSync(`${saida}/favicon.ico`, Buffer.concat([cab, ...tamanhos.map((px) => pngs[px])]));
console.log('ok');

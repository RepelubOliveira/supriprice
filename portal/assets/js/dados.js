/* ==========================================================================
   SupriPrice — Panorama do Diesel
   DADOS DO DIA — este é o ÚNICO arquivo que precisa ser editado todo dia.
   Nada aqui mexe no layout: é só conteúdo.

   Rotina diária sugerida (leva ~5 min):
     1. Atualize `meta.dataISO` para o dia de hoje (formato AAAA-MM-DD).
     2. Atualize `produtos`, `ticker`, `polos`, `serieS10`, `bomba`, `paridade`.
     3. Coloque o relatório novo em /relatorios e adicione em `edicoes`
        (o mais recente primeiro) e em `arquivo`.
     4. Atualize `mundo` — SEMPRE com o link da publicação em `url`.
     5. Salve e publique. O selo "Atualizado em..." se ajusta sozinho.
   ========================================================================== */

window.DADOS = {

  /* --- Identidade e data ------------------------------------------------ */
  meta: {
    // Data de referência do panorama (dia D). Formato AAAA-MM-DD.
    dataISO: '2026-09-24',
    // Hora em que o painel é fechado todo dia.
    horaFechamento: '08:00',
    fonte: 'Fonte: Abicom, fechamento 23/09/2026',
    // Endereço público do site.
    siteUrl: 'https://supriprice.htmly.com.br/'
  },

  /* --- Cartões de arbitragem -------------------------------------------- */
  // petro = preço Petrobras (R$/L), ppi = paridade de importação (R$/L),
  // anterior = defasagem de ontem (R$/L). A defasagem é calculada sozinha.
  produtos: [
    { nome: 'S10',  petro: 3.28, ppi: 6.66, anterior: 3.45 },
    { nome: 'S500', petro: 3.16, ppi: 6.38, anterior: 3.30 }
  ],

  /* --- Coluna de indicadores (lateral do topo) -------------------------- */
  ticker: [
    { label: 'Média dos polos', valor: 'R$ 2,90',    nota: '88%' },
    { label: 'Brent',           valor: 'US$ 102,20', nota: '' },
    { label: 'Dólar',           valor: 'R$ 5,10',    nota: '' },
    { label: 'Subsídio',        valor: 'R$ 2,12',    nota: 'até 26/09' },
    { label: 'Depois de 26/09', valor: 'R$ 1,00',    nota: 'até 17/10' }
  ],

  /* --- Série do gráfico (defasagem S10, R$/L) --------------------------- */
  serieS10: {
    // [rótulo do eixo X, valor em R$/L]
    pontos: [
      ['25/08', 2.62], ['26/08', 2.70], ['27/08', 2.74], ['28/08', 2.81],
      ['31/08', 2.88], ['01/09', 2.95], ['02/09', 3.02], ['03/09', 3.10],
      ['04/09', 3.18], ['07/09', 3.26], ['08/09', 3.41], ['09/09', 3.55],
      ['10/09', 3.62], ['11/09', 3.71], ['14/09', 3.80], ['15/09', 3.89],
      ['16/09', 3.82], ['17/09', 2.85], ['18/09', 2.96], ['21/09', 3.12],
      ['22/09', 3.30], ['23/09', 3.45], ['24/09', 3.38]
    ],
    escala: { min: 2.4, max: 4.0, linhas: [2.5, 3.0, 3.5, 4.0] },
    // Índices da série que ganham um marcador com texto.
    marcadores: [
      { i: 15, texto: 'Máx. R$ 3,89',      dy: -12, ancora: 'end' },
      { i: 17, texto: 'Reajuste +R$ 1,00', dy:  22, ancora: 'start' },
      { i: 22, texto: 'R$ 3,38',           dy: -12, ancora: 'end' }
    ]
  },

  /* --- Defasagem por polo ------------------------------------------------ */
  // [nome, operador, defasagem R$/L, defasagem %, variação vs. ontem R$/L]
  polos: [
    ['Itacoatiara (AM)',           'Petrobras',          3.52, 1.08, -0.05],
    ['Suape (PE)',                 'Petrobras',          3.49, 1.06, -0.08],
    ['Itaqui (MA)',                'Petrobras',          3.44, 1.05, -0.07],
    ['Santos / Paulínia (SP)',     'Petrobras',          3.24, 0.99, -0.07],
    ['Paranaguá / Araucária (PR)', 'Petrobras',          3.21, 0.98, -0.06],
    ['Aratu (BA)',                 'Acelen (Mataripe)',  0.50, 0.09,  0.02]
  ],

  /* --- Blocos laterais --------------------------------------------------- */
  bomba: {
    nota: 'Média nacional, 1ª quinzena de setembro.',
    itens: [
      { nome: 'Diesel S10',  valor: 'R$ 7,11' },
      { nome: 'Diesel S500', valor: 'R$ 6,76' }
    ]
  },

  paridade: [
    { nome: 'Diesel S10, polos Petrobras',  valor: 'R$ 6,66' },
    { nome: 'Diesel S500, polos Petrobras', valor: 'R$ 6,38' },
    { nome: 'Início de 2026',               valor: 'R$ 3,00' }
  ],

  agenda: [
    { data: '26/09', texto: 'Vence a parcela de R$ 1,12/L do subsídio.' },
    { data: 'Out.',  texto: 'Mês de maior consumo de diesel do ano.' },
    { data: '17/10', texto: 'Fim do subsídio de R$ 1,00/L. Pode ser prorrogado.' }
  ],

  /* --- Relatório do dia (3 edições em destaque) -------------------------- */
  // `arquivo` é o caminho do HTML dentro de /relatorios.
  // `slug` vira o nome do arquivo baixado (ex.: supriprice-geral-24-09.pdf).
  edicoes: [
    {
      id: 'geral',
      titulo: 'Edição Geral',
      data: '24/09',
      descricao: 'Brasil e mundo, abastecimento e preços.',
      arquivo: 'relatorios/2026-09-24-geral.html',
      slug: 'supriprice-geral-2026-09-24'
    },
    {
      id: 's10',
      titulo: 'Edição S10',
      data: '23/09',
      descricao: 'Transporte rodoviário e frotas.',
      arquivo: 'relatorios/2026-09-23-s10.html',
      slug: 'supriprice-s10-2026-09-23'
    },
    {
      id: 's500',
      titulo: 'Edição S500',
      data: '23/09',
      descricao: 'Campo, obras, mineração e geradores.',
      arquivo: 'relatorios/2026-09-23-s500.html',
      slug: 'supriprice-s500-2026-09-23'
    }
  ],

  /* --- Pelo mundo -------------------------------------------------------- */
  // IMPORTANTE: `url` é o link da publicação original. É ele que abre quando o
  // leitor clica no título e é ele que vai no botão "Encaminhar".
  // Troque pelo endereço EXATO da matéria — os links abaixo são das seções de
  // energia de cada veículo e servem só como ponto de partida.
  mundo: [
    {
      local: 'Estados Unidos',
      titulo: 'Galão a US$ 6,53 e ameaça de veto',
      texto: 'Trump defende barrar exportações. Origem de 80% do diesel que o Brasil importou em setembro.',
      fonte: 'U.S. Energy Information Administration',
      url: 'https://www.eia.gov/petroleum/gasdiesel/'
    },
    {
      local: 'Europa',
      titulo: 'Preço dobrou no ano',
      texto: 'Futuros em máxima histórica. A Comissão Europeia diz não ver falta de produto.',
      fonte: 'Comissão Europeia — Weekly Oil Bulletin',
      url: 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en'
    },
    {
      local: 'Rússia',
      titulo: 'Um quarto do refino parado',
      texto: 'Ataques ucranianos às refinarias tiraram o país da lista de fornecedores.',
      fonte: 'Reuters — Energy',
      url: 'https://www.reuters.com/business/energy/'
    },
    {
      local: 'Oriente Médio',
      titulo: 'Ormuz ainda trava a oferta',
      texto: 'Sauditas preparam a volta do oleoduto Leste-Oeste. EUA e Irã falam em nova rodada.',
      fonte: 'Reuters — Energy',
      url: 'https://www.reuters.com/business/energy/'
    }
  ],

  /* --- Arquivo ----------------------------------------------------------- */
  arquivo: [
    {
      data: '24/09', tag: 'Geral',
      titulo: 'Ameaça dos EUA chega às vésperas do mês de maior consumo',
      arquivo: 'relatorios/2026-09-24-geral.html',
      slug: 'supriprice-geral-2026-09-24'
    },
    {
      data: '23/09', tag: 'S10',
      titulo: 'O petróleo recuou. A falta de diesel importado, não.',
      arquivo: 'relatorios/2026-09-23-s10.html',
      slug: 'supriprice-s10-2026-09-23'
    },
    {
      data: '23/09', tag: 'S500',
      titulo: 'S500: o diesel do campo fica mais difícil de achar',
      arquivo: 'relatorios/2026-09-23-s500.html',
      slug: 'supriprice-s500-2026-09-23'
    },
    {
      data: '11/09', tag: 'Geral',
      titulo: 'Por que o diesel está mais caro e mais escasso hoje',
      arquivo: 'relatorios/2026-09-11-geral.html',
      slug: 'supriprice-geral-2026-09-11'
    }
  ]
};

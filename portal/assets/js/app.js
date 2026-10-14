/* ==========================================================================
   SupriPrice — Panorama do Diesel
   Lógica do portal: renderização a partir de assets/js/dados.js, geração de
   arquivos para download e compartilhamento das publicações.

   Não é preciso editar este arquivo na rotina diária — só dados.js.
   ========================================================================== */
(function () {
  'use strict';

  // Endereço limpo: quem chega por /index.html (link antigo, favorito) passa
  // a ver só www.supriprice.com.br/, sem recarregar a página.
  if (/\/index\.html$/.test(location.pathname) && window.history && history.replaceState) {
    history.replaceState(null, '', location.pathname.replace(/index\.html$/, '') + location.search + location.hash);
  }

  var D = window.DADOS;
  if (!D) { console.error('[SupriPrice] dados.js não carregou.'); return; }

  /* ---------------------------------------------------------------- utils */

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };

  /** Escapa texto para interpolação segura em HTML. */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Só aceita http(s) — evita javascript: vindo de um dado mal colado. */
  function urlSegura(u) {
    try {
      var p = new URL(u, location.href);
      return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
    } catch (e) { return ''; }
  }

  function brl(v) { return 'R$ ' + v.toFixed(2).replace('.', ','); }
  function num(v) { return v.toFixed(2).replace('.', ','); }

  var COR = { alta: '#B3341F', baixa: '#2E6B4F', navy: '#0E2A47' };

  var toastEl = $('#toast'), toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3800);
  }

  /* ------------------------------------------------------- selo do dia D */

  function montarSelo() {
    var meta = D.meta || {};
    var ano = $('#ano'); if (ano) ano.textContent = String(new Date().getFullYear());
    if (!meta.dataISO) return;

    // No topo, só "Atualizado" (e "Ao vivo" quando a arbitragem começa a ser
    // recalculada no navegador, em ligarTopoAoVivo). A data e a hora da última
    // rodada do robô ficam, discretas, no fim do rodapé (pedido de 14/10).
    var refISO = meta.atualizadoISO || meta.dataISO;
    var quando = refISO.split('-').reverse().join('/');
    if (meta.gerado) {
      try {
        var g = new Date(meta.gerado);
        quando = g.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ', ' +
          g.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
      } catch (e) { /* fica a data */ }
    }
    var carimbo = $('#carimbo');
    if (carimbo) carimbo.textContent = 'Última atualização: ' + quando + '.';
    var caixa = $('#seloCaixa');
    if (caixa) caixa.title = 'Última atualização: ' + quando;

    // Dado estruturado para buscadores — ajuda o site a aparecer como fonte diária.
    var ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: 'Panorama do Diesel — SupriPrice',
      description: 'Defasagem diária entre o preço da Petrobras e a paridade de importação do diesel.',
      temporalCoverage: meta.dataISO,
      dateModified: meta.atualizadoISO || meta.dataISO,
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'SupriPrice' }
    });
    document.head.appendChild(ld);
  }

  /* --------------------------------------------------------- arbitragem */

  /**
   * Cartões do topo (Arbitragem), no estilo escolhido em 13/10:
   * valor grande, quanto mudou no dia, a conta (importação e Petrobras) e a
   * mini-linha dos últimos pregões. Recebe a lista do robô ou a calculada
   * ao vivo (ligarTopoAoVivo).
   */
  function montarProdutos(lista) {
    var alvo = $('#produtos'); if (!alvo) return;
    var serie = (D.arbitragem && D.arbitragem.serie) || [];

    function sparkline(prod) {
      var pts = serie.map(function (x) { return x[prod]; }).filter(function (v) { return typeof v === 'number'; });
      if (pts.length < 5) return '';
      var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), W = 240, H = 44;
      var xy = pts.map(function (v, i) {
        return (i * W / (pts.length - 1)).toFixed(1) + ',' + (H - 4 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - 8)).toFixed(1);
      }).join(' ');
      return '<svg class="arb__spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<polyline points="' + xy + '"/></svg>' +
        '<p class="arb__spark-leg">' + pts.length + ' pregões · mín. ' + brl(lo) + ' · máx. ' + brl(hi) + '</p>';
    }

    alvo.innerHTML = (lista || D.produtos || []).map(function (p) {
      // Com `defasagem` e `pct` prontos (robô ou ao vivo) ou só petro e ppi.
      var def = (typeof p.defasagem === 'number') ? p.defasagem : (p.ppi - p.petro);
      var pct = (typeof p.pct === 'number') ? p.pct : Math.round(def / p.petro * 100);
      var delta = typeof p.anterior === 'number' ? def - p.anterior : null;
      var mov = delta == null ? '' : Math.abs(delta) < 0.005 ? 'estável no dia'
        : (delta > 0 ? '▲ ' : '▼ ') + brl(Math.abs(delta)) + ' no dia';
      var prod = /gasolina/i.test(p.nome) ? 'gasolina' : 'diesel';
      var titulo = /^(S10|S500)$/.test(p.nome) ? 'Diesel ' + p.nome : p.nome;
      return '' +
        '<article class="arb__cartao">' +
          '<p class="arb__nome">' + esc(titulo) + '<span>' + (def >= 0 ? 'abaixo da paridade' : 'acima da paridade') + '</span></p>' +
          '<p class="arb__valor tnum">' + brl(Math.abs(def)) + '<small>/litro · ' + Math.abs(pct) + '%</small></p>' +
          '<p class="arb__mov tnum' + (delta > 0.004 ? ' is-alta' : delta < -0.004 ? ' is-baixa' : '') + '"' +
            (delta == null ? '' : ' title="Variação desde o fechamento do pregão anterior"') + '>' + esc(mov) + '</p>' +
          '<dl class="arb__conta tnum">' +
            '<div><dt>Importação</dt><dd>' + brl(p.ppi) + '</dd></div>' +
            '<div><dt>Petrobras</dt><dd>' + brl(p.petro) + '</dd></div>' +
          '</dl>' +
          sparkline(prod) +
        '</article>';
    }).join('');
  }

  function montarTicker() {
    var alvo = $('#ticker'); if (!alvo) return;
    alvo.innerHTML = (D.ticker || []).map(function (t) {
      return '' +
        '<div class="ticker-row">' +
          '<span class="ticker-row__label">' + esc(t.label) + '</span>' +
          '<span class="ticker-row__val"><b class="tnum">' + esc(t.valor) + '</b>' +
            (t.nota ? '<span>' + esc(t.nota) + '</span>' : '') + '</span>' +
        '</div>';
    }).join('');
  }

  /* ------------------------------------------ arbitragem SupriPrice */

  // A NOSSA paridade de importação (automacao/paridade.mjs), recalculada ao
  // vivo no navegador com as cotações da função do Supabase:
  //   importação = cotação em Nova York (US$/galão) / 3,785 x dólar + custo
  //   arbitragem = importação - preço da Petrobras
  // O robô entrega no dados.js os custos calibrados, os preços da Petrobras,
  // a última leitura e a série diária; aqui só se refaz a conta a cada minuto.
  var ARB = D.arbitragem || null;
  var ARB_PRODUTOS = [
    { id: 'diesel', nome: 'Diesel A', insumo: 'diesel_ny' },
    { id: 'gasolina', nome: 'Gasolina A', insumo: 'gasolina_ny' }
  ];

  function contaArb(prod, cotacao, dolar) {
    var custo = ARB.custos[prod], petro = ARB.precos[prod];
    var ppi = cotacao / ARB.litrosPorGalao * dolar + custo;
    return { ppi: ppi, petro: petro, defasagem: ppi - petro, pct: Math.round((ppi - petro) / petro * 100) };
  }

  /**
   * Arbitragem ao vivo a partir da resposta da função de cotações. Devolve
   * null se faltar alguma cotação. `inicio` é a conta com os fechamentos
   * anteriores (para dizer quanto mudou no dia).
   */
  function arbAoVivo(j) {
    if (!ARB || !j) return null;
    var por = {};
    (j.indicadores || []).concat(j.insumos || []).forEach(function (i) { if (i && i.id) por[i.id] = i; });
    var dol = por.dolar;
    if (!dol) return null;
    var out = { hora: '', data: '', dataISO: '' };
    var ok = true;
    ARB_PRODUTOS.forEach(function (p) {
      var c = por[p.insumo];
      if (!c) { ok = false; return; }
      out[p.id] = contaArb(p.id, c.valor, dol.valor);
      out[p.id].inicio = contaArb(p.id, c.anterior, dol.anterior);
      if (!out.hora || c.hora > out.hora) { out.hora = c.hora; out.data = c.data; out.dataISO = c.dataISO; }
    });
    return ok ? out : null;
  }

  /** A mesma forma, a partir do que o robô gravou (antes da 1ª consulta ao vivo). */
  function arbDoRobo() {
    if (!ARB || !ARB.diesel) return null;
    var hoje = hojeBrasilia();
    var antes = (ARB.serie || []).filter(function (p) { return !hoje || p.data < hoje; });
    var ult = antes[antes.length - 1];
    var quando = new Date(ARB.quandoISO);
    var out = {
      hora: quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
      data: quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }),
      dataISO: ARB.quandoISO.slice(0, 10)
    };
    ARB_PRODUTOS.forEach(function (p) {
      out[p.id] = { ppi: ARB[p.id].ppi, petro: ARB[p.id].petro, defasagem: ARB[p.id].defasagem, pct: ARB[p.id].pct,
        inicio: ult ? { defasagem: ult[p.id] } : null };
    });
    return out;
  }

  /** Itens da faixa de cotações: a arbitragem entra junto com dólar e petróleo. */
  function arbItensFaixa(a) {
    if (!a) return [];
    return ARB_PRODUTOS.map(function (p) {
      var x = a[p.id], delta = x.inicio ? x.defasagem - x.inicio.defasagem : 0;
      return { id: 'arb_' + p.id, nome: 'Arbitragem ' + (p.id === 'diesel' ? 'diesel' : 'gasolina'),
        moeda: 'BRL', arb: true, valor: x.defasagem, delta: delta,
        variacao: Math.abs(delta) < 0.005 ? 0 : delta, data: a.data, hora: a.hora, dataISO: a.dataISO };
    });
  }

  /**
   * Leva a leitura ao vivo para a série diária (o ponto de hoje): o gráfico
   * do último mês e as mini-linhas dos cartões andam junto com o número.
   * Se a série ainda não tem o dia da cotação, ganha um ponto novo.
   */
  function vivoNaSerie(a) {
    var chave = a.dataISO;
    if (!chave || !ARB) return false;
    var rot = chave.slice(8, 10) + '/' + chave.slice(5, 7);
    var dv = Math.round(a.diesel.defasagem * 100) / 100, gv = Math.round(a.gasolina.defasagem * 100) / 100;
    var s = ARB.serie || (ARB.serie = []), ult = s[s.length - 1];
    if (ult && ult.data === chave) { ult.diesel = dv; ult.gasolina = gv; }
    else if (!ult || chave > ult.data) s.push({ data: chave, rotulo: rot, diesel: dv, gasolina: gv });
    else return false;
    var pts = D.serieS10 && D.serieS10.pontos;
    if (pts) {
      var u = pts[pts.length - 1];
      if (u && u[0] === rot) u[1] = dv; else pts.push([rot, dv]);
    }
    GRAF.vivo = { rot: rot, hora: a.hora };
    return true;
  }

  /** Topo ao vivo: a cada consulta da faixa (uma por minuto), refaz os cartões. */
  function ligarTopoAoVivo() {
    if (!ARB) return;
    document.addEventListener('sp:cotacoes', function (ev) {
      var a = arbAoVivo(ev.detail);
      if (!a) return;
      var nomes = { diesel: 'Diesel A', gasolina: 'Gasolina A' };
      var mostrar = (D.produtos || []).map(function (p) { return /gasolina/i.test(p.nome) ? 'gasolina' : 'diesel'; });
      if (!mostrar.length) mostrar = ['diesel', 'gasolina'];
      var mudouSerie = false;
      try { mudouSerie = vivoNaSerie(a); } catch (e) { /* segue sem o ponto de hoje */ }
      montarProdutos(mostrar.map(function (id) {
        var x = a[id];
        return { nome: nomes[id], escopo: 'Arbitragem', petro: x.petro, ppi: x.ppi,
          defasagem: x.defasagem, pct: x.pct, anterior: x.inicio ? x.inicio.defasagem : null };
      }));
      if (mudouSerie) { try { montarGrafico(); } catch (e) { console.error('[SupriPrice] gráfico:', e); } }

      var selo = $('#selo'), caixa = $('#seloCaixa');
      if (selo) selo.textContent = 'Ao vivo';
      if (caixa && a.hora) caixa.title = 'Recalculada às ' + a.hora + ' · cálculo próprio, a cada minuto';

      // O resumo em texto (escrito pelo robô para buscadores) acompanha os cartões.
      function vivo(chave, texto) { var el = document.querySelector('[data-vivo="' + chave + '"]'); if (el) el.textContent = texto; }
      ['diesel', 'gasolina'].forEach(function (id) {
        var x = a[id]; if (!x) return;
        vivo(id, brl(Math.abs(x.defasagem)) + (id === 'diesel' ? ' por litro' : ''));
        vivo(id + 'Pct', Math.abs(x.pct) + '%' + (id === 'diesel' ? (x.defasagem >= 0 ? ' abaixo' : ' acima') : ''));
      });
      if (a.dataISO) vivo('data', a.dataISO.split('-').reverse().join('/'));
    });
  }

  /* ----------------------------------------------------- faixa de mercado */

  // Convenção de bolsa, OPOSTA à do painel de combustível: aqui alta é verde e
  // queda é vermelha. A seta acompanha a cor para quem não distingue as duas.
  function valorIndicador(i) {
    if (i.moeda === 'pts') return Math.round(i.valor).toLocaleString('pt-BR') + ' pts';
    if (i.moeda === 'BRL') return 'R$ ' + i.valor.toFixed(4).replace('.', ',');
    return 'US$ ' + num(i.valor);
  }

  // Velocidade do letreiro em pixels por segundo. A duração da volta é
  // calculada a partir dela, para a faixa andar no mesmo ritmo com 3 ou com
  // 10 indicadores, em tela estreita ou larga.
  var MKT_VELOCIDADE = 45;

  // Cotações ao vivo. O Yahoo não deixa o navegador consultá-lo direto (sem
  // CORS), então quem busca é uma função nossa no Supabase, com cache de 60 s
  // (código em supabase/functions/cotacoes). Os números do dados.js, gravados
  // pelo robô, aparecem primeiro e continuam valendo se a função falhar.
  var COTACOES_URL = 'https://wqoztljdblwuqgaryujd.supabase.co/functions/v1/cotacoes';
  var COTACOES_INTERVALO = 60000;

  /** AAAA-MM-DD de hoje em Brasília, seja qual for o fuso do visitante. */
  function hojeBrasilia() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    } catch (e) { return ''; }
  }

  function montarMercado() {
    var caixa = $('#mercado'), lista = $('#mercadoLista'), meta = $('#mercadoMeta');
    if (!caixa || !lista) return;
    var ind = (D.indicadores || []).concat(arbItensFaixa(arbDoRobo()));
    var aoVivo = false;
    // O dia da EXECUÇÃO, não o do boletim: na atualização parcial das 07:00 o
    // boletim é de ontem, mas a cotação do dólar das 06:50 é de hoje. Com as
    // cotações ao vivo, passa a ser o dia de hoje mesmo.
    var hoje = D.meta && (D.meta.atualizadoISO || D.meta.dataISO);

    /** Um item da faixa. eco=true é cópia só visual: some do leitor de tela. */
    function item(i, eco) {
      var sentido = i.variacao > 0 ? 'up' : (i.variacao < 0 ? 'down' : 'flat');
      var seta = sentido === 'up' ? '▲' : (sentido === 'down' ? '▼' : '');
      var pct = (sentido === 'up' ? '+' : (sentido === 'down' ? '−' : '')) +
        (i.arb ? 'R$ ' + num(Math.abs(i.delta || 0)) : num(Math.abs(i.variacao)) + '%');
      // Às 08:20 a B3 ainda não abriu: o Ibovespa é o fechamento de ontem.
      // Dizer isso evita que o leitor tome o número como sendo do dia.
      var antigo = hoje && i.dataISO && i.dataISO < hoje;
      var dica = i.arb ? 'Arbitragem · variação no dia'
        : (antigo ? 'Fechamento de ' + i.data : 'Cotação de ' + i.data + ', ' + i.hora) +
        ' · variação sobre o fechamento anterior';
      return '' +
        '<li class="mkt__item" data-ind="' + esc(i.id) + '" title="' + esc(dica) + '"' +
          (eco ? ' aria-hidden="true"' : '') + '>' +
          '<span class="mkt__name">' + esc(i.nome) + '</span>' +
          '<span class="mkt__val tnum">' + esc(i.arb ? brl(i.valor) : valorIndicador(i)) + '</span>' +
          '<span class="mkt__chg mkt__chg--' + sentido + ' tnum">' +
            (seta ? '<span aria-hidden="true">' + seta + '</span> ' : '') +
            '<span class="sr-only">' + (sentido === 'up' ? 'alta de ' : (sentido === 'down' ? 'queda de ' : 'estável, ')) + '</span>' +
            esc(pct) +
          '</span>' +
          (antigo ? '<span class="mkt__when">fech. ' + esc(i.data) + '</span>' : '') +
        '</li>';
    }
    function volta(eco) { return ind.map(function (i) { return item(i, eco); }).join(''); }

    function escreverMeta() {
      if (!meta) return;
      var horas = ind.filter(function (i) { return !hoje || !i.dataISO || i.dataISO >= hoje; })
        .map(function (i) { return i.hora; }).sort();
      var hora = horas.length ? horas[horas.length - 1] : '';
      if (aoVivo) {
        meta.innerHTML = '<span class="mkt__live" aria-hidden="true"></span>Ao vivo' +
          (hora ? ' · ' + esc(hora) : '') + ' · Yahoo Finance';
        meta.title = 'Atualiza sozinho a cada minuto. Bolsas e futuros com atraso de até 15 min.';
      } else {
        meta.textContent = (hora ? 'Cotações das ' + hora : 'Último fechamento') + ' · Yahoo Finance';
      }
    }

    var semMovimento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var larguraMontada = -1;

    /** (Re)monta a faixa inteira: na abertura e quando muda a lista de itens. */
    function montar() {
      if (!ind.length) return;
      escreverMeta();
      caixa.hidden = false;
      // Movimento reduzido pedido no sistema: lista parada, uma vez só. O CSS
      // quebra os itens em linhas e esconde o botão de pausa.
      if (semMovimento) { lista.innerHTML = volta(false); return; }
      larguraMontada = -1;
      montarLaco();
    }

    /*
     * Chegou cotação nova. Se os itens são os mesmos, troca só o texto de cada
     * um, no lugar: a faixa não para nem pula. As duas metades do laço mudam
     * igual, então o recomeço continua invisível.
     */
    function aplicarAoVivo(novos) {
      var porId = {};
      novos.forEach(function (n) { if (n && n.id) porId[n.id] = n; });
      var antes = ind.map(function (i) { return i.id; }).join();
      var vistos = {};
      // Mantém a ordem do robô; o que só a função trouxe entra no fim.
      ind = ind.map(function (i) { vistos[i.id] = 1; return porId[i.id] || i; })
        .concat(novos.filter(function (n) { return n && n.id && !vistos[n.id]; }));
      aoVivo = true;
      hoje = hojeBrasilia() || hoje;

      if (ind.map(function (i) { return i.id; }).join() !== antes || !lista.children.length) {
        montar();
        return;
      }
      var molde = document.createElement('ul');
      Array.prototype.forEach.call(lista.querySelectorAll('li[data-ind]'), function (li) {
        var i = porId[li.getAttribute('data-ind')];
        if (!i) return;
        molde.innerHTML = item(i, li.getAttribute('aria-hidden') === 'true');
        lista.replaceChild(molde.firstChild, li);
      });
      escreverMeta();
    }

    var ultimaBusca = 0;
    function buscarAoVivo() {
      if (!window.fetch || document.hidden) return;
      ultimaBusca = Date.now();
      var ctrl = window.AbortController ? new AbortController() : null;
      var limite = ctrl && setTimeout(function () { ctrl.abort(); }, 10000);
      fetch(COTACOES_URL, { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          if (!j || !j.indicadores || !j.indicadores.length) return;
          aplicarAoVivo(j.indicadores.concat(arbItensFaixa(arbAoVivo(j))));
          try { document.dispatchEvent(new CustomEvent('sp:cotacoes', { detail: j })); } catch (e) { /* navegador antigo */ }
        })
        // Falhou: fica o que já está na tela, com a hora de cada cotação.
        .catch(function () {})
        .then(function () { if (limite) clearTimeout(limite); });
    }

    /*
     * O laço: a animação desliza a lista em -50%. Para o recomeço ser
     * invisível, a lista tem duas metades idênticas. E cada metade precisa
     * ser pelo menos tão larga quanto a faixa — senão, em tela larga, sobraria
     * um vão vazio antes de a segunda metade entrar. Por isso a volta de
     * indicadores se repete quantas vezes for preciso dentro de cada metade.
     * Só a primeira volta é lida pelo leitor de tela; o resto é eco visual.
     */
    function montarLaco() {
      if (semMovimento || !ind.length) return;
      var janela = lista.parentNode;
      var largura = janela.clientWidth;
      if (largura === larguraMontada) return;
      larguraMontada = largura;

      lista.innerHTML = volta(false);
      var umaVolta = lista.scrollWidth;
      if (!umaVolta || !largura) return;

      var repeticoes = Math.max(1, Math.ceil(largura / umaVolta));
      var primeira = volta(false), eco = '';
      for (var k = 1; k < repeticoes; k++) primeira += volta(true);
      for (var j = 0; j < repeticoes; j++) eco += volta(true);
      lista.innerHTML = primeira + eco;
      lista.style.setProperty('--mkt-dur', ((umaVolta * repeticoes) / MKT_VELOCIDADE).toFixed(1) + 's');
    }

    montar();

    // Ao vivo: busca já na abertura e depois a cada minuto, só com a aba à
    // vista. Voltando a uma aba esquecida, atualiza na hora.
    buscarAoVivo();
    setInterval(buscarAoVivo, COTACOES_INTERVALO);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - ultimaBusca > COTACOES_INTERVALO) buscarAoVivo();
    });

    // A fonte carrega depois e muda a largura dos textos; e a janela pode
    // mudar de tamanho. Nos dois casos a conta precisa ser refeita.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { larguraMontada = -1; montarLaco(); });
    }
    var espera;
    window.addEventListener('resize', function () {
      clearTimeout(espera);
      espera = setTimeout(montarLaco, 200);
    });

    var botao = $('#mercadoPausa');
    if (botao) {
      botao.addEventListener('click', function () {
        var pausado = caixa.classList.toggle('is-paused');
        botao.setAttribute('aria-pressed', pausado ? 'true' : 'false');
        botao.setAttribute('aria-label', pausado ? 'Retomar a faixa de cotações' : 'Pausar a faixa de cotações');
        botao.firstElementChild.textContent = pausado ? '▶' : '❚❚';
      });
    }
  }

  /* ------------------------------------------------------------ gráfico */

  // Defasagem do diesel no período, numa linha simples de ler: um ponto por
  // boletim, a MÉDIA do período tracejada e a área entre as duas pintada
  // (vermelho = acima da média, azul = abaixo). Só três valores escritos no
  // desenho (último, máxima e mínima); o resto aparece na dica ao passar o
  // mouse ou tocar. Acima, os quatro números do período por extenso.
  // O SVG é desenhado na largura real da caixa (sem esticar o texto) e
  // refeito quando a janela muda de tamanho.
  var DIAS_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  // vivo: { rot, hora } do ponto de hoje quando ele acompanha o ao vivo.
  var GRAF = { vivo: null, desenhar: null, area: null };

  function montarGrafico() {
    var alvo = $('#grafico'); if (!alvo || !D.serieS10) return;
    var d = D.serieS10.pontos || [];
    // Página publicada antiga (figure.chart) também recebe o desenho novo.
    alvo.className = 'linha';
    alvo.removeAttribute('role');
    alvo.removeAttribute('aria-label');

    if (d.length < 5) {
      alvo.innerHTML = '<p class="linha__vazio"><b>Série em formação</b>O gráfico ganha um ponto por pregão. ' +
        'Já são ' + d.length + '.</p>';
      return;
    }

    // "dd/mm" -> dia da semana (para a dica). O ano vem do boletim mais
    // recente; mês maior que o dele é do ano anterior.
    var ref = (D.meta && D.meta.dataISO) || new Date().toISOString().slice(0, 10);
    var anoRef = +ref.slice(0, 4), mesRef = +ref.slice(5, 7);
    var pts = d.map(function (p, i) {
      var dd = +p[0].slice(0, 2), mm = +p[0].slice(3, 5);
      var dow = new Date(Date.UTC(mm > mesRef ? anoRef - 1 : anoRef, mm - 1, dd, 12)).getUTCDay();
      return { rot: p[0], v: p[1], dow: dow, ant: i ? d[i - 1][1] : null };
    });
    var vals = pts.map(function (p) { return p.v; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var media = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var iMax = vals.indexOf(hi), iMin = vals.indexOf(lo), iUlt = pts.length - 1;
    var vivo = GRAF.vivo && GRAF.vivo.rot === pts[iUlt].rot ? GRAF.vivo : null;
    var nota = $('#graficoNota');
    if (nota) nota.textContent = 'R$ por litro, no fechamento de cada pregão' + (vivo ? '; o ponto de hoje acompanha o ao vivo' : '');

    alvo.innerHTML =
      '<ul class="linha__resumo">' +
        (vivo
          ? '<li><span><i class="mkt__live" aria-hidden="true"></i>Agora</span><b class="tnum">' + brl(pts[iUlt].v) + '</b><small>' +
              pts[iUlt].rot + (vivo.hora ? ', ' + esc(vivo.hora) : '') + '</small></li>'
          : '<li><span>Último pregão</span><b class="tnum">' + brl(pts[iUlt].v) + '</b><small>' + pts[iUlt].rot + '</small></li>') +
        '<li><span>Média do período</span><b class="tnum">' + brl(media) + '</b><small>' + pts.length + ' pregões</small></li>' +
        '<li><span>Máxima</span><b class="tnum">' + brl(hi) + '</b><small>' + pts[iMax].rot + '</small></li>' +
        '<li><span>Mínima</span><b class="tnum">' + brl(lo) + '</b><small>' + pts[iMin].rot + '</small></li>' +
      '</ul>' +
      '<div class="linha__area"></div>' +
      '<p class="linha__legenda">' +
        '<span><i class="linha__chave linha__chave--linha"></i>Arbitragem em cada pregão</span>' +
        '<span><i class="linha__chave linha__chave--media"></i>Média do período</span>' +
        '<span><i class="linha__chave linha__chave--acima"></i>Acima da média</span>' +
        '<span><i class="linha__chave linha__chave--abaixo"></i>Abaixo da média</span>' +
      '</p>';
    var area = $('.linha__area', alvo);

    function desenhar() {
      var W = Math.max(280, area.clientWidth), estreito = W < 560;
      var H = estreito ? 230 : 280;
      var m = { e: estreito ? 46 : 58, d: estreito ? 14 : 24, t: 28, b: 30 };
      // Escala com folga e linhas de grade em passos redondos de R$ 0,25/0,50.
      var passo = (hi - lo) > 1.2 ? 0.5 : 0.25;
      var yMin = Math.floor((lo - 0.1) / passo) * passo, yMax = Math.ceil((hi + 0.1) / passo) * passo;
      var X = function (i) { return m.e + (W - m.e - m.d) * i / (pts.length - 1); };
      var Y = function (v) { return m.t + (H - m.t - m.b) * (yMax - v) / (yMax - yMin); };
      var yMed = Y(media);
      var f = function (n) { return n.toFixed(1); };

      var grade = '';
      for (var g = yMin; g <= yMax + 1e-9; g += passo) {
        grade += '<line x1="' + m.e + '" x2="' + (W - m.d) + '" y1="' + f(Y(g)) + '" y2="' + f(Y(g)) + '" class="linha__grade"/>' +
          '<text x="' + (m.e - 8) + '" y="' + f(Y(g) + 4) + '" text-anchor="end" class="linha__eixo">' + (estreito ? num(g) : brl(g)) + '</text>';
      }
      // Datas no eixo de baixo: umas 5 (3 no celular), sempre com a última.
      var nx = estreito ? 3 : 5, pX = Math.max(1, Math.round((pts.length - 1) / (nx - 1))), datas = '';
      for (var i = 0; i < pts.length; i += pX) {
        if (i === pts.length - 1 || pts.length - 1 - i < pX / 2) continue;
        datas += '<text x="' + f(X(i)) + '" y="' + (H - 8) + '" text-anchor="middle" class="linha__eixo">' + pts[i].rot + '</text>';
      }
      datas += '<text x="' + f(X(iUlt)) + '" y="' + (H - 8) + '" text-anchor="end" class="linha__eixo">' + pts[iUlt].rot + '</text>';

      var caminho = 'M' + pts.map(function (p, i) { return f(X(i)) + ',' + f(Y(p.v)); }).join(' L');
      var fecha = ' L' + f(X(iUlt)) + ',' + f(yMed) + ' L' + f(X(0)) + ',' + f(yMed) + ' Z';

      // Valor escrito em 3 pontos; o rótulo vai acima (ou abaixo, se for a
      // mínima) e não sai da caixa.
      function rotulo(i, texto, embaixo) {
        var x = X(i), y = Y(pts[i].v) + (embaixo ? 20 : -11);
        var anc = x > W - 60 ? 'end' : x < m.e + 30 ? 'start' : 'middle';
        return '<text x="' + f(x) + '" y="' + f(y) + '" text-anchor="' + anc + '" class="linha__valor">' + texto + '</text>';
      }
      var rotulos = rotulo(iMax, 'Máx. ' + brl(hi)) + rotulo(iMin, 'Mín. ' + brl(lo), true);
      if (iUlt !== iMax && iUlt !== iMin) rotulos += rotulo(iUlt, brl(pts[iUlt].v), pts[iUlt].v < media);

      var desc = 'Arbitragem do diesel de ' + pts[0].rot + ' a ' + pts[iUlt].rot + ': último pregão ' + brl(pts[iUlt].v) +
        ', média ' + brl(media) + ', máxima ' + brl(hi) + ' em ' + pts[iMax].rot + ', mínima ' + brl(lo) + ' em ' + pts[iMin].rot + '.';

      area.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(desc) + '">' +
          '<defs>' +
            '<clipPath id="lnAcima"><rect x="0" y="0" width="' + W + '" height="' + f(yMed) + '"/></clipPath>' +
            '<clipPath id="lnAbaixo"><rect x="0" y="' + f(yMed) + '" width="' + W + '" height="' + f(H - yMed) + '"/></clipPath>' +
          '</defs>' +
          grade +
          '<path d="' + caminho + fecha + '" class="linha__acima" clip-path="url(#lnAcima)"/>' +
          '<path d="' + caminho + fecha + '" class="linha__abaixo" clip-path="url(#lnAbaixo)"/>' +
          '<line x1="' + m.e + '" x2="' + (W - m.d) + '" y1="' + f(yMed) + '" y2="' + f(yMed) + '" class="linha__media"/>' +
          '<path d="' + caminho + '" class="linha__traco"/>' +
          '<text x="' + m.e + '" y="' + f(yMed - 6) + '" class="linha__media-txt">média ' + brl(media) + '</text>' +
          pts.map(function (p, i) {
            var destaque = i === iMax || i === iMin || i === iUlt;
            return '<circle cx="' + f(X(i)) + '" cy="' + f(Y(p.v)) + '" r="' + (destaque ? 5 : 3) + '" class="linha__ponto' + (destaque ? ' is-destaque' : '') + '"/>';
          }).join('') +
          (vivo ? '<circle cx="' + f(X(iUlt)) + '" cy="' + f(Y(pts[iUlt].v)) + '" r="6" class="linha__vivo"/>' : '') +
          rotulos + datas +
          '<line class="linha__guia" y1="' + m.t + '" y2="' + (H - m.b) + '" x1="0" x2="0" visibility="hidden"/>' +
          '<circle class="linha__foco" r="7" cx="0" cy="0" visibility="hidden"/>' +
          '<rect class="linha__toque" x="' + m.e + '" y="0" width="' + (W - m.e - m.d) + '" height="' + H + '"/>' +
        '</svg>' +
        '<div class="linha__dica" hidden></div>';

      // Dica: o boletim mais perto do mouse/dedo.
      var svg = $('svg', area), guia = $('.linha__guia', area), foco = $('.linha__foco', area), dica = $('.linha__dica', area);
      function mostrar(ev) {
        var r = svg.getBoundingClientRect();
        var cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
        var i = Math.round((cx - m.e) / (W - m.e - m.d) * (pts.length - 1));
        i = Math.max(0, Math.min(pts.length - 1, i));
        var p = pts[i], x = X(i), y = Y(p.v);
        guia.setAttribute('x1', x); guia.setAttribute('x2', x); guia.setAttribute('visibility', 'visible');
        foco.setAttribute('cx', x); foco.setAttribute('cy', y); foco.setAttribute('visibility', 'visible');
        var dv = p.ant == null ? null : p.v - p.ant;
        var agora = vivo && i === iUlt;
        dica.innerHTML = '<b>' + (agora ? 'Hoje, ao vivo' + (vivo.hora ? ' às ' + esc(vivo.hora) : '') : DIAS_SEM[p.dow] + ', ' + p.rot) +
          '</b><span class="tnum">' + brl(p.v) + ' por litro</span>' +
          (dv == null ? '' : '<small class="tnum">' + (Math.abs(dv) < 0.005 ? 'igual ao pregão anterior'
            : (dv > 0 ? '▲ alta' : '▼ queda') + ' de ' + brl(Math.abs(dv)) + ' no dia') + '</small>') +
          '<small class="tnum">' + (p.v >= media ? brl(p.v - media) + ' acima da média' : brl(media - p.v) + ' abaixo da média') + '</small>';
        dica.hidden = false;
        var dx = x + 14;
        if (dx + dica.offsetWidth > W) dx = x - 14 - dica.offsetWidth;
        dica.style.left = Math.max(0, dx) + 'px';
        dica.style.top = Math.max(0, Math.min(H - dica.offsetHeight, y - dica.offsetHeight / 2)) + 'px';
      }
      function esconder() {
        guia.setAttribute('visibility', 'hidden'); foco.setAttribute('visibility', 'hidden'); dica.hidden = true;
      }
      var toque = $('.linha__toque', area);
      toque.addEventListener('mousemove', mostrar);
      toque.addEventListener('mouseleave', esconder);
      toque.addEventListener('touchstart', mostrar, { passive: true });
      toque.addEventListener('touchmove', mostrar, { passive: true });
    }

    desenhar();
    // Um só ouvinte de redimensionar, que sempre chama o desenho mais recente
    // (o gráfico é refeito a cada minuto com o ponto ao vivo).
    var primeira = !GRAF.desenhar;
    GRAF.desenhar = desenhar; GRAF.area = area;
    if (primeira) {
      var ultimaLargura = area.clientWidth, espera;
      window.addEventListener('resize', function () {
        clearTimeout(espera);
        espera = setTimeout(function () {
          if (GRAF.area.clientWidth !== ultimaLargura) { ultimaLargura = GRAF.area.clientWidth; GRAF.desenhar(); }
        }, 150);
      });
    }
  }

  /* ------------------------------------------------------ painéis fixos */

  function montarPolos() {
    var alvo = $('#polos'); if (!alvo) return;
    if (!(D.polos || []).length) {
      alvo.innerHTML = '<p class="card__note">Sem dados da ANP nesta atualização.</p>';
      return;
    }
    alvo.innerHTML = D.polos.map(function (r) {
      var nome = r[0], op = r[1], defR = r[2], pct = r[3], delta = r[4];
      return '' +
        '<div class="port">' +
          '<span class="port__name">' + esc(nome) + '</span>' +
          '<span class="port__op">' + esc(op) + '</span>' +
          '<span class="port__val"><b class="tnum">' + brl(defR) + '</b>' +
            '<span class="tnum">' + Math.round(pct * 100) + '%</span></span>' +
          '<span class="port__bar"><i style="width:' + Math.min(100, pct / 1.1 * 100).toFixed(0) +
            '%;background:' + (pct > 0.5 ? COR.alta : COR.navy) + ';"></i></span>' +
          // Sem variação apurada, nada de "+0,00 vs. ontem": a ANP é semanal e
          // não tem "ontem" — o zero que aparecia era inventado.
          (typeof delta === 'number'
            ? '<span class="port__delta tnum" style="color:' + (delta >= 0 ? COR.alta : COR.baixa) + ';">' +
                (delta >= 0 ? '+' : '-') + num(Math.abs(delta)) + ' vs. ontem</span>'
            : '') +
        '</div>';
    }).join('');
  }

  function montarBlocos() {
    var bomba = $('#bomba');
    if (bomba && D.bomba) {
      bomba.innerHTML = D.bomba.itens.map(function (b) {
        var v = '';
        if (typeof b.variacao === 'number') {
          var cor = b.variacao >= 0 ? COR.alta : COR.baixa;
          v = '<span style="font-size:13px;font-weight:700;color:' + cor + ';margin-left:8px;">' +
              (b.variacao >= 0 ? '+' : '−') + num(Math.abs(b.variacao)) + '</span>';
        }
        return '<div class="kv"><span class="kv__name">' + esc(b.nome) +
               '</span><span class="kv__val is-lg tnum">' + esc(b.valor) + v + '</span></div>';
      }).join('');
      var nota = $('#bombaNota'); if (nota) nota.textContent = D.bomba.nota || '';
    }

    // Estados mais caros e mais baratos, quando a ANP responde.
    var ext = $('#extremos');
    if (ext) {
      var a = D.anp;
      if (a && a.maisCaros && a.maisCaros.length) {
        var linha = function (e, cor) {
          return '<div class="kv"><span class="kv__name">' + esc(e.estado) +
                 '</span><span class="kv__val is-md tnum" style="color:' + cor + ';">' +
                 brl(e.media) + '</span></div>';
        };
        ext.innerHTML =
          '<p class="card__note" style="margin-bottom:2px;">Mais caros</p>' +
          a.maisCaros.slice(0, 3).map(function (e) { return linha(e, COR.alta); }).join('') +
          '<p class="card__note" style="margin:10px 0 2px;">Mais baratos</p>' +
          (a.maisBaratos || []).slice(0, 3).map(function (e) { return linha(e, COR.baixa); }).join('');
        var en = $('#extremosNota');
        if (en) en.textContent = 'Diesel S10, média por estado. Referência ' +
          String(a.referencia || '').split('-').reverse().join('/') + '.';
      } else {
        ext.innerHTML = '<p class="card__note">Sem dados da ANP nesta atualização.</p>';
      }
    }

    // Antes da primeira execução da automação o bloco ainda traz os polos da
    // Petrobras, não as regiões da ANP — o título tem que acompanhar o dado.
    var tituloPolos = $('#polosTitulo');
    if (tituloPolos) tituloPolos.textContent = D.polosTitulo || 'Defasagem por polo';

    var ag = $('#agenda');
    if (ag) {
      // Item com data DD/MM já vencida sai sozinho — agenda é o que vem pela
      // frente, e ninguém precisa lembrar de editar o editorial.json. Datas
      // em texto livre ("Out.") ficam sempre.
      var hojeAg = new Date(); hojeAg.setHours(0, 0, 0, 0);
      var futuros = (D.agenda || []).filter(function (a) {
        var m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(a.data || '').trim());
        if (!m) return true;
        var d = new Date(hojeAg.getFullYear(), +m[2] - 1, +m[1]);
        // Em dezembro, "05/01" é o janeiro que vem, não o que já passou.
        if (hojeAg - d > 180 * 86400000) d.setFullYear(d.getFullYear() + 1);
        return d >= hojeAg;
      });
      ag.innerHTML = futuros.length
        ? futuros.map(function (a) {
            return '<div class="agenda-row"><b>' + esc(a.data) + '</b><span>' + esc(a.texto) + '</span></div>';
          }).join('')
        : '<p class="card__note">Nada agendado nos próximos dias.</p>';
    }
  }

  /* ================================================================
     GERAÇÃO DE ARQUIVOS PARA DOWNLOAD
     O relatório é um HTML de página A4. Para PNG/JPEG/PDF ele é
     renderizado num iframe fora da tela e capturado em canvas.
     Nada abre em aba nova: o arquivo é montado aqui e salvo.
     ================================================================ */

  var CDN = {
    html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  };
  var scriptsCarregados = {};

  function carregarScript(url) {
    if (scriptsCarregados[url]) return scriptsCarregados[url];
    scriptsCarregados[url] = new Promise(function (ok, erro) {
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () {
        delete scriptsCarregados[url];
        erro(new Error('Falha ao carregar ' + url));
      };
      document.head.appendChild(s);
    });
    return scriptsCarregados[url];
  }

  /** Dispara o download de um Blob sem sair da página. */
  function salvarBlob(blob, nome) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoga só depois que o navegador pegou o blob.
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // O jornal é uma folha fixa de Stories: 1080 x 1920 (9:16). O PNG/JPEG sai
  // exatamente nesse tamanho, pronto para o Status do WhatsApp e o Instagram.
  var LARGURA_JORNAL = 1080, ALTURA_JORNAL = 1920;

  /** Renderiza o relatório num iframe oculto e devolve o documento pronto. */
  function abrirRelatorioOculto(caminho) {
    return new Promise(function (ok, erro) {
      var frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + LARGURA_JORNAL +
        'px;height:' + ALTURA_JORNAL + 'px;border:0;visibility:hidden;';
      frame.src = caminho;

      var limpo = false;
      function fechar() { if (!limpo) { limpo = true; frame.remove(); } }

      var prazo = setTimeout(function () {
        fechar();
        erro(new Error('Tempo esgotado ao montar o relatório.'));
      }, 30000);

      frame.onload = function () {
        var doc;
        try { doc = frame.contentDocument; } catch (e) { doc = null; }
        if (!doc) { clearTimeout(prazo); fechar(); erro(new Error('Relatório inacessível.')); return; }

        // O relatório se desempacota sozinho depois do load: espera o
        // conteúdo real substituir a capa de carregamento. Exigir texto
        // renderizado evita capturar a tela de "Unpacking...".
        var tentativas = 0;
        (function esperar() {
          tentativas++;
          var texto = doc.body ? (doc.body.innerText || '').trim() : '';
          var pronto = !doc.getElementById('__bundler_thumbnail') &&
                       doc.body && doc.body.children.length > 0 &&
                       doc.body.scrollHeight > 200 &&
                       texto.length > 200;
          if (!pronto && tentativas < 130) { setTimeout(esperar, 150); return; }

          Promise.resolve(doc.fonts && doc.fonts.ready)
            .catch(function () {})
            .then(function () {
              var imgs = Array.prototype.slice.call(doc.images || []);
              return Promise.all(imgs.map(function (img) {
                if (img.complete) return null;
                return new Promise(function (r) {
                  img.addEventListener('load', r, { once: true });
                  img.addEventListener('error', r, { once: true });
                  setTimeout(r, 4000);
                });
              }));
            })
            .then(function () { setTimeout(function () {
              clearTimeout(prazo);
              ok({ doc: doc, fechar: fechar });
            }, 600); });
        })();
      };

      frame.onerror = function () {
        clearTimeout(prazo); fechar(); erro(new Error('Não foi possível abrir o relatório.'));
      };

      document.body.appendChild(frame);
    });
  }

  /** Converte o relatório em <canvas>. */
  function relatorioParaCanvas(caminho) {
    return carregarScript(CDN.html2canvas)
      .then(function () { return abrirRelatorioOculto(caminho); })
      .then(function (ctx) {
        var alvo = ctx.doc.body;
        return window.html2canvas(alvo, {
          width: LARGURA_JORNAL,
          height: Math.max(ALTURA_JORNAL, alvo.scrollHeight),
          windowWidth: LARGURA_JORNAL,
          windowHeight: ALTURA_JORNAL,
          // Escala 1: 1080 x 1920 exatos (escala 2 dava 2160 x 3840, pesado
          // demais e reduzido de qualquer jeito pelo WhatsApp e Instagram).
          scale: 1,
          backgroundColor: '#FBF9F4',
          useCORS: true,
          allowTaint: false,
          logging: false,
          scrollX: 0,
          scrollY: 0
        }).then(
          function (canvas) { ctx.fechar(); return canvas; },
          function (e) { ctx.fechar(); throw e; }
        );
      });
  }

  function canvasParaBlob(canvas, tipo, qualidade) {
    return new Promise(function (ok, erro) {
      canvas.toBlob(function (b) {
        b ? ok(b) : erro(new Error('Não foi possível gerar a imagem.'));
      }, tipo, qualidade);
    });
  }

  /** Baixa o próprio HTML do relatório — sempre funciona, mesmo offline. */
  function baixarHtml(edicao) {
    return fetch(edicao.arquivo, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then(function (b) {
        salvarBlob(new Blob([b], { type: 'text/html;charset=utf-8' }), edicao.slug + '.html');
      });
  }

  /**
   * Edições novas trazem a "foto" pronta do jornal (PNG 1080x1920, tirada pelo
   * robô no próprio navegador): o PNG é só baixado, e JPEG e PDF saem dele.
   * Sai idêntico ao que se vê na tela — o html2canvas desenhava o texto
   * deslocado. As edições antigas, sem foto, seguem pelo html2canvas.
   */
  function imagemParaCanvas(caminho) {
    return new Promise(function (ok, erro) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        var g = c.getContext('2d');
        g.fillStyle = '#FBF9F4'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0);
        ok(c);
      };
      img.onerror = function () { erro(new Error('Imagem do jornal indisponível.')); };
      img.src = caminho;
    });
  }

  function gerarDownload(edicao, formato) {
    if (formato === 'html') return baixarHtml(edicao);
    if (formato === 'png' && edicao.imagem) {
      return fetch(edicao.imagem).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (b) { salvarBlob(b, edicao.slug + '.png'); });
    }

    var montar = edicao.imagem ? imagemParaCanvas(edicao.imagem) : relatorioParaCanvas(edicao.arquivo);
    return montar.then(function (canvas) {
      if (formato === 'png') {
        return canvasParaBlob(canvas, 'image/png')
          .then(function (b) { salvarBlob(b, edicao.slug + '.png'); });
      }
      if (formato === 'jpeg') {
        return canvasParaBlob(canvas, 'image/jpeg', 0.92)
          .then(function (b) { salvarBlob(b, edicao.slug + '.jpg'); });
      }
      // PDF do tamanho da folha (9:16), página inteira, sem cortes.
      return carregarScript(CDN.jspdf).then(function () {
        var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        if (!jsPDF) throw new Error('Gerador de PDF indisponível.');

        var pdf = new jsPDF({ unit: 'mm', format: [108, 192], orientation: 'portrait', compress: true });
        var pw = pdf.internal.pageSize.getWidth();   // 108
        var ph = pdf.internal.pageSize.getHeight();  // 192
        var razao = canvas.width / canvas.height;
        var w = pw, h = pw / razao;
        if (h > ph) { h = ph; w = ph * razao; }
        pdf.addImage(
          canvas.toDataURL('image/jpeg', 0.94), 'JPEG',
          (pw - w) / 2, (ph - h) / 2, w, h, undefined, 'FAST'
        );
        salvarBlob(pdf.output('blob'), edicao.slug + '.pdf');
      });
    });
  }

  var ROTULOS = {
    pdf:  { nome: 'PDF',  desc: 'Documento para enviar' },
    png:  { nome: 'PNG',  desc: 'Stories e WhatsApp, 1080×1920' },
    jpeg: { nome: 'JPEG', desc: 'Mesmo tamanho, formato JPEG' },
    html: { nome: 'HTML', desc: 'Página original' }
  };

  /** Executa o download com feedback no botão e fallback honesto. */
  function executarDownload(edicao, formato, botao) {
    var textoOriginal = botao.innerHTML;
    botao.setAttribute('aria-busy', 'true');
    botao.innerHTML = '<span>Gerando ' + ROTULOS[formato].nome + '…</span>';
    toast('Gerando ' + ROTULOS[formato].nome + ' de "' + edicao.titulo + '". Pode levar alguns segundos.');

    gerarDownload(edicao, formato)
      .then(function () {
        toast('Arquivo ' + ROTULOS[formato].nome + ' salvo nos seus downloads.');
        if (window.spEvento) window.spEvento('baixou_jornal', { formato: formato, edicao: edicao.data || '' });
      })
      .catch(function (e) {
        console.error('[SupriPrice] download', formato, e);
        if (formato === 'html') { toast('Não foi possível baixar o relatório. Tente de novo.'); return; }
        // Não abre aba nova: entrega o HTML, que é gerado localmente.
        toast('Não deu para montar o ' + ROTULOS[formato].nome + '. Baixando a versão HTML.');
        return baixarHtml(edicao).catch(function () {
          toast('Download indisponível no momento. Tente novamente em instantes.');
        });
      })
      .then(function () {
        botao.removeAttribute('aria-busy');
        botao.innerHTML = textoOriginal;
      });
  }

  /* ---------------------------------------------------- relatório do dia */

  function montarEdicoes() {
    var alvo = $('#edicoes'); if (!alvo) return;
    var formatos = ['pdf', 'png', 'jpeg', 'html'];

    alvo.innerHTML = (D.edicoes || []).map(function (e, i) {
      return '' +
        '<article class="edition" data-edicao="' + i + '">' +
          '<div class="edition__preview">' +
            // Com a foto pronta, a prévia é a própria imagem (leve e exata).
            (e.imagem
              ? '<img src="' + esc(e.imagem) + '" alt="Jornal de ' + esc(e.rotulo || e.data) + ': ' + esc(e.titulo) + '" loading="lazy">'
              : '<iframe src="' + esc(e.arquivo) + '" title="Prévia da ' + esc(e.titulo) + '" ' +
                'loading="lazy" tabindex="-1" aria-hidden="true" scrolling="no"></iframe>') +
          '</div>' +
          '<div class="edition__meta">' +
            '<h3 class="edition__title">' + esc(e.titulo) + '</h3>' +
            '<span class="edition__date">' + esc(e.rotulo || e.data) + '</span>' +
          '</div>' +
          '<p class="edition__desc">' + esc(e.descricao) + '</p>' +
          '<div class="edition__actions">' +
            '<div class="dropdown">' +
              '<button class="btn btn--primary" type="button" data-abrir-menu="' + i + '" ' +
                'aria-expanded="false" aria-controls="menu-' + i + '">' +
                '<span>Baixar</span>' +
                '<svg class="btn__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                  'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                  '<path d="M6 9l6 6 6-6"/></svg>' +
              '</button>' +
              '<div class="dropdown__menu" id="menu-' + i + '" hidden>' +
                formatos.map(function (f) {
                  return '<button class="dropdown__item" type="button" data-baixar="' + f +
                    '" data-edicao="' + i + '">' + ROTULOS[f].nome +
                    '<span>' + ROTULOS[f].desc + '</span></button>';
                }).join('') +
              '</div>' +
            '</div>' +
            '<button class="btn btn--ghost" type="button" data-compartilhar-edicao="' + i +
              '" title="Compartilhar esta edição">Encaminhar</button>' +
          '</div>' +
        '</article>';
    }).join('');

    ajustarPrevias();
  }

  /** Encaixa a prévia (folha de 1080 px) na largura real do cartão. */
  function ajustarPrevias() {
    var previas = document.querySelectorAll('.edition__preview');
    Array.prototype.forEach.call(previas, function (box) {
      var frame = box.querySelector('iframe');
      if (!frame) return;
      var escala = box.clientWidth / LARGURA_JORNAL;
      if (escala > 0) frame.style.transform = 'scale(' + escala.toFixed(4) + ')';
    });
  }

  // Nota: o jornal é uma folha fixa de 1080x1920, por isso a proporção da
  // prévia é fixa (9:16).

  /* -------------------------------------------------------- compartilhar */

  var ICONE_LINK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" aria-hidden="true">' +
    '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/>' +
    '<path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';
  var ICONE_ZAP =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.1 14.9l-.3-.2-2.6.7.7-2.5-.2-.3A8 8 0 0 1 12 4zm4.3 10.1c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.1-.2 0-.4.1-.5l.4-.5c.1-.2.1-.3 0-.5l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.1s.9 2.5 1 2.6c.1.2 1.8 2.8 4.4 3.8 1.9.7 2.3.6 2.7.5.4 0 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.1z"/></svg>';

  /** Compartilha um link: usa o menu nativo quando existe, senão copia. */
  function compartilhar(dados) {
    var url = urlSegura(dados.url);
    if (!url) { toast('Link indisponível para esta publicação.'); return; }

    if (navigator.share) {
      navigator.share({ title: dados.titulo, text: dados.texto || dados.titulo, url: url })
        .catch(function (e) { if (e && e.name !== 'AbortError') copiarLink(url); });
      return;
    }
    copiarLink(url);
  }

  function copiarLink(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(function () { toast('Link copiado. É só colar onde quiser encaminhar.'); })
        .catch(function () { toast('Copie o link: ' + url); });
    } else {
      toast('Copie o link: ' + url);
    }
  }

  function linkWhatsApp(texto, url) {
    return 'https://wa.me/?text=' + encodeURIComponent(texto + ' ' + url);
  }

  /* -------------------------------------------------------- pelo mundo */

  var EDITORIAS = [
    { id: 'negocios', nome: 'Negócios do setor', sub: 'Aquisições, fusões e decisões do Cade' },
    { id: 'mundo', nome: 'Mundo', sub: 'Importação, exportação e mercado internacional' },
    { id: 'brasil', nome: 'Brasil', sub: 'Setor de combustíveis no país' },
    { id: 'transporte', nome: 'Transporte', sub: 'Rodoviário, frete e logística' },
    { id: 'agro', nome: 'Agro', sub: 'A demanda que vem do campo' }
  ];

  /** Guarda as notícias numa lista plana para os botões de compartilhar. */
  var noticiasPlanas = [];

  function montarNoticias() {
    var alvo = $('#listaNoticias'); if (!alvo) return;
    var fonte = D.noticias || {};
    noticiasPlanas = [];

    var blocos = EDITORIAS.filter(function (e) {
      return (fonte[e.id] || []).length;
    }).map(function (e) {
      var itens = fonte[e.id].map(function (n) {
        var url = urlSegura(n.url);
        if (!url) return '';
        var idx = noticiasPlanas.push({ titulo: n.titulo, url: url, fonte: n.fonte }) - 1;
        var quando = n.data ? tempoRelativo(n.data) : '';
        return '' +
          '<article class="news-item">' +
            '<h4 class="news-item__head">' +
              '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
                esc(n.titulo) + '</a>' +
            '</h4>' +
            (n.resumo ? '<p class="news-item__text">' + esc(n.resumo) + '</p>' : '') +
            '<div class="news-item__foot">' +
              '<span class="news-item__source">' + esc(n.fonte) +
                (quando ? ' · ' + esc(quando) : '') + '</span>' +
              '<button class="chip-btn chip-btn--mini" type="button" data-share-noticia="' + idx + '">' +
                ICONE_LINK + 'Encaminhar</button>' +
            '</div>' +
          '</article>';
      }).join('');

      return '' +
        '<div class="news-col">' +
          '<div class="news-col__head">' +
            '<h3>' + esc(e.nome) + '</h3>' +
            '<p>' + esc(e.sub) + '</p>' +
          '</div>' +
          itens +
        '</div>';
    }).join('');

    alvo.innerHTML = blocos ||
      '<p class="card__note">As manchetes do dia ainda não foram coletadas.</p>';

    var rodape = $('#noticiasRodape');
    if (rodape) {
      rodape.textContent = noticiasPlanas.length
        ? 'Publicamos manchete, resumo e link. O texto completo é de quem apurou — ' +
          'clique para ler no site da fonte.'
        : '';
    }
  }

  /** "há 2 horas", "ontem", "há 3 dias". */
  function tempoRelativo(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 60) return 'há ' + Math.max(1, min) + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'há ' + h + (h === 1 ? ' hora' : ' horas');
    var dias = Math.round(h / 24);
    if (dias === 1) return 'ontem';
    return 'há ' + dias + ' dias';
  }

  /* ------------------------------------------------------- market share */

  /** 160.4 → "160,4" (uma casa, milhar com ponto). */
  function dec1(v) {
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  /**
   * Chamada da aba de Market share na página inicial: o último mês divulgado
   * pela ANP em três linhas. Os números completos, com filtro de período e de
   * estado, ficam em market-share.html (share.js).
   */
  /**
   * Quando sai o próximo mês do market share, pelo calendário da ANP: dia 20
   * a prévia do mês anterior, dia 1 o consolidado do retrasado. Responde a
   * "estamos em outubro e ainda é agosto?" (em 14/10/2026 a base da ANP, de
   * 01/10, ia só até agosto; setembro sai em 20/10). Também usada pela aba.
   */
  function proximaShare(ref) {
    if (!ref || !ref.mes) return '';
    var hoje = hojeBrasilia() || new Date().toISOString().slice(0, 10);
    var a = +hoje.slice(0, 4), m = +hoje.slice(5, 7), dia = +hoje.slice(8, 10);
    var MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    var antA = m === 1 ? a - 1 : a, antM = m === 1 ? 12 : m - 1;
    var anterior = antA + '-' + ('0' + antM).slice(-2);
    var rot = MES[antM - 1] + '/' + String(antA).slice(2);
    var dd = function (d, mes) { return ('0' + d).slice(-2) + '/' + ('0' + mes).slice(-2); };
    if (ref.mes < anterior) {
      return 'prévia de ' + rot + ' prevista para ' + dd(20, m) + (dia > 20 ? ' (a ANP ainda não divulgou)' : '');
    }
    if (ref.mes === anterior && ref.preliminar) return rot + ' consolidado previsto para ' + dd(1, m === 12 ? 1 : m + 1);
    return '';
  }
  window.spProximaShare = proximaShare;

  function montarShare() {
    var S = D.share, caixa = $('#share');
    var M = S && S.mercado;
    if (!caixa) return; // outra página (a própria aba não tem a chamada)
    if (!M || !M.mes || !M.mes.top || !M.mes.top.length) {
      // Sem números ainda: o atalho do menu também some, para não levar a nada.
      var atalho = $('.nav a[href="market-share.html"]'); if (atalho) atalho.hidden = true;
      return;
    }
    var ref = M.referencia || {};
    // "Novo" por uma semana depois que a ANP divulga números.
    var novo = S.divulgadoISO && (Date.now() - new Date(S.divulgadoISO + 'T12:00:00').getTime()) < 7 * 864e5;
    $('#shareEyebrow').innerHTML = 'Market share · ANP · ' + esc(ref.rotulo || '') +
      (ref.preliminar ? ' (prévia)' : '') + (novo ? '<span class="share-teaser__novo">NOVO</span>' : '');

    var partes = ['As distribuidoras venderam <b>' + dec1(M.mes.total) + ' mil m³</b> em ' + esc(ref.rotulo || '')];
    if (typeof M.varMesPct === 'number') {
      partes[0] += ' (' + (M.varMesPct > 0 ? '+' : M.varMesPct < 0 ? '−' : '') + dec1(Math.abs(M.varMesPct)) + '% no mês)';
    }
    if (M.canalTrr) partes.push('o canal TRR ficou com ' + dec1(M.canalTrr.share) + '%');
    var prox = proximaShare(ref);
    // Prévia do mês seguinte, lida no Power BI da ANP (só enquanto a planilha não o traz).
    var P = S.previa, pm = P && P.mercado;
    var previa = P && (!ref.mes || P.mes > ref.mes) && pm
      ? ' <a class="share-teaser__previa" href="market-share.html#previa">Prévia de ' + esc(P.rotulo) + ': ' +
        dec1(pm.cobertura) + '% do volume já declarado →</a>'
      : '';
    $('#shareResumo').innerHTML = partes.join('; ') + '. Veja por estado, por período e o ranking completo.' + previa +
      (prox ? ' <small class="share-teaser__prox">Planilha oficial da ANP: ' + esc(prox) + '.</small>' : '');

    $('#shareTop').innerHTML = M.mes.top.slice(0, 3).map(function (x) {
      return '<li><span>' + x.pos + '. ' + esc(x.curto || x.nome) + '</span><b>' + dec1(x.share) + '%</b></li>';
    }).join('');
    caixa.hidden = false;
  }

  /* --------------------------------------------------- crédito na cópia */

  /*
   * Quem copia um trecho do portal leva junto a fonte: "Fonte: SupriPrice —
   * endereço". Não bloqueia nada, de propósito: travar seleção ou o botão
   * direito não impede quem quer copiar (print, código-fonte, outro
   * navegador) e atrapalha leitor de tela e quem só quer citar um número. O
   * crédito, ao contrário, viaja com o número para onde ele for colado.
   */
  function creditoNaCopia() {
    document.addEventListener('copy', function (ev) {
      var sel = window.getSelection && window.getSelection();
      var texto = sel ? String(sel) : '';
      if (!ev.clipboardData || texto.replace(/\s+/g, '').length < 12) return;
      var no = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode);
      if (no && no.closest && no.closest('input, textarea, select, [contenteditable="true"]')) return;

      // Endereço oficial (nunca o de teste), com o filtro da aba se houver.
      var aba = /market-share\.html$/.test(location.pathname);
      var link = 'https://www.supriprice.com.br/' + (aba ? 'market-share.html' + location.hash : '');
      var credito = 'Fonte: SupriPrice — ' + link;

      var html = '';
      try {
        var caixa = document.createElement('div');
        for (var i = 0; i < sel.rangeCount; i++) caixa.appendChild(sel.getRangeAt(i).cloneContents());
        html = caixa.innerHTML;
      } catch (e) { /* sem HTML: vai só o texto */ }

      ev.clipboardData.setData('text/plain', texto + '\n\n' + credito);
      if (html) {
        ev.clipboardData.setData('text/html', html + '<p>Fonte: <a href="' + esc(link) + '">SupriPrice</a> — ' + esc(link) + '</p>');
      }
      ev.preventDefault();
    });
  }

  /* ------------------------------------------------------------ arquivo */

  function montarArquivo() {
    var lista = $('#listaArquivo'), filtros = $('#filtros');
    if (!lista) return;

    var tags = [];
    (D.arquivo || []).forEach(function (e) { if (tags.indexOf(e.tag) < 0) tags.push(e.tag); });

    if (filtros) {
      filtros.innerHTML = ['Todas'].concat(tags).map(function (t, i) {
        return '<button class="filter" type="button" data-filtro="' + esc(t) + '" aria-pressed="' +
               (i === 0) + '">' + esc(t) + '</button>';
      }).join('');
    }

    function desenhar(filtro) {
      var itens = (D.arquivo || []).filter(function (e) {
        return filtro === 'Todas' || e.tag === filtro;
      });
      lista.innerHTML = itens.length ? itens.map(function (e) {
        var idx = D.arquivo.indexOf(e);
        return '' +
          '<article class="archive-card">' +
            '<div class="archive-card__top">' +
              '<span class="archive-card__date">' + esc(e.data) + '</span>' +
              '<span class="tag">' + esc(e.tag) + '</span>' +
            '</div>' +
            '<h3 class="archive-card__head">' +
              '<a href="' + esc(e.arquivo) + '" target="_blank" rel="noopener">' + esc(e.titulo) + '</a>' +
            '</h3>' +
            '<div class="archive-card__actions">' +
              '<button class="chip-btn" type="button" data-arquivo-pdf="' + idx + '">Baixar PDF</button>' +
              '<button class="chip-btn" type="button" data-arquivo-share="' + idx + '">' +
                ICONE_LINK + 'Encaminhar</button>' +
            '</div>' +
          '</article>';
      }).join('') : '<p class="card__note">Nenhuma edição nesta categoria.</p>';
    }

    desenhar('Todas');

    if (filtros) {
      filtros.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-filtro]'); if (!b) return;
        Array.prototype.forEach.call(filtros.querySelectorAll('.filter'), function (f) {
          f.setAttribute('aria-pressed', String(f === b));
        });
        desenhar(b.getAttribute('data-filtro'));
      });
    }
  }

  /* ------------------------------------------------------------ eventos */

  function fecharMenus(exceto) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-abrir-menu]'), function (b) {
      if (b === exceto) return;
      b.setAttribute('aria-expanded', 'false');
      var m = document.getElementById(b.getAttribute('aria-controls'));
      if (m) m.hidden = true;
    });
  }

  function ligarEventos() {
    // Medição (Google Analytics, só com consentimento): nomes em português
    // claro. Não interfere no clique: o link segue normalmente.
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('a[href]');
      if (!a || !window.spEvento) return;
      var noticia = a.closest('.news-item');
      if (noticia) {
        var fonteN = noticia.querySelector('.news-item__source');
        window.spEvento('abriu_noticia', { veiculo: fonteN ? fonteN.textContent.split(' · ')[0].trim() : '' });
      } else if (a.closest('.archive-card')) {
        window.spEvento('abriu_jornal', { titulo: a.textContent.trim().slice(0, 90) });
      } else if (a.classList.contains('share-teaser__previa')) {
        window.spEvento('abriu_previa', {});
      } else if (a.closest('.share-teaser')) {
        window.spEvento('abriu_market_share', {});
      } else if (a.closest('.nav')) {
        window.spEvento('clicou_menu', { destino: a.textContent.trim() });
      }
    }, true);

    document.addEventListener('click', function (ev) {
      var alvo = ev.target;

      // Menu de formatos
      var abrir = alvo.closest('[data-abrir-menu]');
      if (abrir) {
        var menu = document.getElementById(abrir.getAttribute('aria-controls'));
        var aberto = abrir.getAttribute('aria-expanded') === 'true';
        fecharMenus(abrir);
        abrir.setAttribute('aria-expanded', String(!aberto));
        if (menu) menu.hidden = aberto;
        return;
      }

      // Escolha de formato
      var baixar = alvo.closest('[data-baixar]');
      if (baixar) {
        var ed = D.edicoes[+baixar.getAttribute('data-edicao')];
        fecharMenus(null);
        if (ed) {
          var botao = document.querySelector('[data-abrir-menu="' + baixar.getAttribute('data-edicao') + '"]');
          executarDownload(ed, baixar.getAttribute('data-baixar'), botao || baixar);
        }
        return;
      }

      // Compartilhar edição
      var shEd = alvo.closest('[data-compartilhar-edicao]');
      if (shEd) {
        var e1 = D.edicoes[+shEd.getAttribute('data-compartilhar-edicao')];
        if (e1) {
          if (window.spEvento) window.spEvento('encaminhou_jornal', { edicao: e1.data || '' });
          compartilhar({
            titulo: 'SupriPrice — ' + e1.titulo + ' ' + e1.data,
            texto: e1.descricao,
            url: new URL(e1.arquivo, location.href).href
          });
        }
        return;
      }

      // Pelo mundo — encaminhar
      var shN = alvo.closest('[data-share-noticia]');
      if (shN) {
        var n = noticiasPlanas[+shN.getAttribute('data-share-noticia')];
        if (n) {
          if (window.spEvento) window.spEvento('encaminhou_noticia', { veiculo: n.fonte || '' });
          compartilhar({ titulo: n.titulo, texto: n.fonte + ' — ' + n.titulo, url: n.url });
        }
        return;
      }

      // Arquivo
      var arqPdf = alvo.closest('[data-arquivo-pdf]');
      if (arqPdf) {
        var a1 = D.arquivo[+arqPdf.getAttribute('data-arquivo-pdf')];
        if (a1) executarDownload({ titulo: a1.titulo, arquivo: a1.arquivo, slug: a1.slug }, 'pdf', arqPdf);
        return;
      }
      var arqSh = alvo.closest('[data-arquivo-share]');
      if (arqSh) {
        var a2 = D.arquivo[+arqSh.getAttribute('data-arquivo-share')];
        if (a2) {
          if (window.spEvento) window.spEvento('encaminhou_jornal', { edicao: a2.data || '' });
          compartilhar({
            titulo: 'SupriPrice — ' + a2.titulo,
            texto: a2.data + ' · ' + a2.tag,
            url: new URL(a2.arquivo, location.href).href
          });
        }
        return;
      }

      if (!alvo.closest('.dropdown')) fecharMenus(null);
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') fecharMenus(null);
    });

    // Menu mobile
    var toggle = $('#navToggle'), nav = $('#navPrincipal');
    if (toggle && nav) {
      toggle.addEventListener('click', function () {
        var aberto = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(aberto));
      });
      nav.addEventListener('click', function (ev) {
        if (ev.target.tagName === 'A') {
          nav.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Prévias acompanham o redimensionamento
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(ajustarPrevias);
      var cont = $('#edicoes'); if (cont) ro.observe(cont);
    } else {
      window.addEventListener('resize', ajustarPrevias);
    }

    // Destaque do item de menu da seção visível
    if (window.IntersectionObserver) {
      var links = {};
      Array.prototype.forEach.call(document.querySelectorAll('.nav a[href^="#"]'), function (a) {
        links[a.getAttribute('href').slice(1)] = a;
      });
      var io = new IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) {
          var link = links[e.target.id];
          if (link && e.isIntersecting) {
            Object.keys(links).forEach(function (k) { links[k].removeAttribute('aria-current'); });
            link.setAttribute('aria-current', 'true');
          }
        });
      }, { rootMargin: '-72px 0px -70% 0px' });
      ['arbitragem', 'painel', 'jornal', 'noticias', 'arquivo'].forEach(function (id) {
        var el = document.getElementById(id); if (el) io.observe(el);
      });
    }
  }

  /* ------------------------------------------------- novidades do dia */

  // Pop-up "Novo hoje": o robô lista o que saiu de novo no dia (boletim da
  // Abicom, market share da ANP, preço na bomba, jornal). O visitante vê cada
  // item uma vez só: o navegador guarda os ids já vistos. Com a página aberta,
  // o site consulta dados/novidades.json a cada 5 minutos e avisa o que
  // chegar. Sem armazenamento (aba anônima, bloqueio), avisa uma vez por
  // página aberta.
  var NOVIDADES_URL = 'dados/novidades.json';
  var NOVIDADES_INTERVALO = 5 * 60000;
  var CHAVE_VISTAS = 'sp-novidades-vistas';

  function lerVistas() {
    try { return JSON.parse(localStorage.getItem(CHAVE_VISTAS) || '[]') || []; } catch (e) { return []; }
  }
  function gravarVistas(ids) {
    // Só os últimos 40: os ids levam a data, os antigos não voltam mais.
    try { localStorage.setItem(CHAVE_VISTAS, JSON.stringify(ids.slice(-40))); } catch (e) { /* sem armazenamento */ }
  }

  function montarNovidades() {
    var vistasNaPagina = [];
    var noAr = null;
    var naHome = !!document.getElementById('arbitragem');

    function hojeISO() {
      var d = new Date();
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }

    function pendentes(lista) {
      var vistas = lerVistas().concat(vistasNaPagina);
      return (lista || []).filter(function (n) { return n && n.id && vistas.indexOf(n.id) < 0; });
    }

    function marcarVistos(itens) {
      var ids = itens.map(function (n) { return n.id; });
      vistasNaPagina = vistasNaPagina.concat(ids);
      gravarVistas(lerVistas().concat(ids));
    }

    function fechar(itens) {
      if (!noAr) return;
      marcarVistos(itens);
      var el = noAr; noAr = null;
      el.classList.remove('is-on');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
    }

    function destino(link) {
      // Âncoras da página inicial: fora dela, o link leva até lá.
      if (link.charAt(0) === '#' && !naHome) return './' + link;
      return urlSegura(link) || '#';
    }

    function mostrar(itens) {
      if (!itens.length) return;
      if (noAr) { // já tem um aberto: os novos entram no topo dele
        var abertos = JSON.parse(noAr.getAttribute('data-itens') || '[]');
        var ids = itens.map(function (n) { return n.id; });
        itens = itens.concat(abertos.filter(function (n) { return ids.indexOf(n.id) < 0; }));
        if (noAr.parentNode) noAr.parentNode.removeChild(noAr);
        noAr = null;
      }
      var caixa = document.createElement('aside');
      caixa.className = 'novidades';
      caixa.setAttribute('role', 'status');
      caixa.setAttribute('aria-live', 'polite');
      caixa.setAttribute('aria-label', 'Novidades de hoje no SupriPrice');
      caixa.setAttribute('data-itens', JSON.stringify(itens));
      caixa.innerHTML =
        '<div class="novidades__topo">' +
          '<span class="novidades__selo"><i aria-hidden="true"></i>Novo hoje</span>' +
          '<button type="button" class="novidades__fechar" aria-label="Fechar avisos">×</button>' +
        '</div>' +
        '<ul class="novidades__lista">' + itens.map(function (n) {
          return '<li><a class="novidades__item" href="' + esc(destino(n.link || '#')) + '">' +
            '<span class="novidades__tipo">' + esc(n.tipo) + '</span>' +
            '<b>' + esc(n.titulo) + '</b>' +
            (n.texto ? '<span class="novidades__texto">' + esc(n.texto) + '</span>' : '') +
          '</a></li>';
        }).join('') + '</ul>';
      document.body.appendChild(caixa);
      noAr = caixa;
      $('.novidades__fechar', caixa).addEventListener('click', function () { fechar(itens); });
      Array.prototype.forEach.call(caixa.querySelectorAll('.novidades__item'), function (a, i) {
        a.addEventListener('click', function () {
          if (window.spEvento) window.spEvento('clicou_novidade', { tipo: itens[i].tipo });
          fechar(itens);
        });
      });
      requestAnimationFrame(function () { caixa.classList.add('is-on'); });
    }

    function avaliar(lista, atualizadoISO) {
      // Só vale o que é de hoje: quem abre o site de manhã, antes da primeira
      // rodada, não recebe o "novo" de ontem.
      if (atualizadoISO !== hojeISO()) return;
      mostrar(pendentes(lista));
    }

    // Abertura: o que veio no dados.js, depois de a página assentar. Se a
    // barra de cookies estiver no rodapé, espera a pessoa responder.
    function abrir() { avaliar(D.novidades, (D.meta || {}).atualizadoISO); }
    setTimeout(function () {
      if (window.spConsentimentoPendente) {
        document.addEventListener('sp:consentimento-fechado', function () { setTimeout(abrir, 600); }, { once: true });
      } else abrir();
    }, 2500);

    var ultima = Date.now();
    function consultar() {
      if (document.hidden || !window.fetch) return;
      ultima = Date.now();
      fetch(NOVIDADES_URL + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store', credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j) avaliar(j.itens, j.atualizadoISO); })
        .catch(function () { /* sem rede: tenta na próxima */ });
    }
    setInterval(consultar, NOVIDADES_INTERVALO);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - ultima > NOVIDADES_INTERVALO) consultar();
    });
  }

  /* -------------------------------------------------------------- início */

  creditoNaCopia();
  try { ligarTopoAoVivo(); } catch (e) { console.error('[SupriPrice] arbitragem:', e); }
  montarMercado();
  montarSelo();
  montarProdutos();
  montarTicker();
  montarGrafico();
  montarPolos();
  montarBlocos();
  // Seção nova, com dados de outra fonte: se algo nela falhar, o resto da
  // página monta do mesmo jeito.
  try { montarShare(); } catch (e) { console.error('[SupriPrice] market share:', e); }
  montarEdicoes();
  montarNoticias();
  montarArquivo();
  ligarEventos();
  try { montarNovidades(); } catch (e) { console.error('[SupriPrice] novidades:', e); }
  window.addEventListener('load', ajustarPrevias);
})();

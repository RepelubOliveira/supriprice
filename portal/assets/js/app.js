/* ==========================================================================
   SupriPrice — Panorama do Diesel
   Lógica do portal: renderização a partir de assets/js/dados.js, geração de
   arquivos para download e compartilhamento das publicações.

   Não é preciso editar este arquivo na rotina diária — só dados.js.
   ========================================================================== */
(function () {
  'use strict';

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
    var alvo = $('#selo');
    var fonte = $('#heroFonte');
    if (fonte) fonte.textContent = meta.fonte || '';
    if (!alvo || !meta.dataISO) return;

    var partes = meta.dataISO.split('-');
    var d = new Date(+partes[0], +partes[1] - 1, +partes[2]);
    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var dias = Math.round((hoje - d) / 86400000);
    var ddmm = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);

    var texto;
    // Atualização parcial (rodada das 07:00, antes de a Abicom publicar):
    // mercado e notícias são de hoje, a defasagem é do último boletim. O selo
    // diz as duas coisas — "Atualizado ontem" daria a entender que o portal
    // inteiro parou.
    var atu = meta.atualizadoISO;
    var hojeISO = hoje.getFullYear() + '-' + ('0' + (hoje.getMonth() + 1)).slice(-2) + '-' + ('0' + hoje.getDate()).slice(-2);
    // Só a data, sem hora: a data é o que avisa o leitor quando o número não é de hoje.
    if (atu && atu === hojeISO && meta.dataISO < atu) {
      texto = 'Defasagem de ' + ddmm + ' · mercado e notícias de hoje';
    } else if (dias <= 0) texto = 'Atualizado hoje, ' + ddmm;
    else if (dias === 1) texto = 'Atualizado ontem, ' + ddmm;
    else texto = 'Atualizado em ' + ddmm + '/' + d.getFullYear();

    alvo.textContent = texto;
    var ano = $('#ano'); if (ano) ano.textContent = String(new Date().getFullYear());

    // Dado estruturado para buscadores — ajuda o site a aparecer como fonte diária.
    var ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: 'Panorama do Diesel — SupriPrice',
      description: 'Defasagem diária entre o preço da Petrobras e a paridade de importação do diesel.',
      temporalCoverage: meta.dataISO,
      dateModified: meta.dataISO,
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'SupriPrice' }
    });
    document.head.appendChild(ld);
  }

  /* --------------------------------------------------------- arbitragem */

  function montarProdutos() {
    var alvo = $('#produtos'); if (!alvo) return;
    alvo.innerHTML = (D.produtos || []).map(function (p) {
      // Dois formatos aceitos: o gerado pela automação traz `defasagem` e `pct`
      // prontos da Abicom; o antigo, escrito à mão, trazia só petro e ppi.
      var def = (typeof p.defasagem === 'number') ? p.defasagem : (p.ppi - p.petro);
      var pct = (typeof p.pct === 'number') ? p.pct : Math.round(def / p.petro * 100);
      // Sem valor de ontem não há variação a mostrar — inventar um "0,00"
      // daria a entender que o preço ficou parado.
      var temOntem = typeof p.anterior === 'number';
      var delta = temOntem ? def - p.anterior : 0;
      var sinal = delta >= 0 ? '+' : '-';
      // "S10" vira "Diesel S10"; "Diesel A" já vem completo.
      var titulo = /^(S10|S500)$/.test(p.nome) ? 'Diesel ' + p.nome : p.nome;
      return '' +
        '<article class="product">' +
          '<div class="product__top">' +
            '<h2 class="product__name">' + esc(titulo) +
              (p.escopo ? '<span class="product__escopo">' + esc(p.escopo) + '</span>' : '') +
            '</h2>' +
            '<span class="product__pct tnum">' + pct + '%</span>' +
          '</div>' +
          '<p class="product__value"><b class="tnum">' + brl(def) + '</b><span>/litro</span></p>' +
          (temOntem
            ? '<p class="product__prev">Ontem <strong class="tnum">' + brl(p.anterior) + '</strong> ' +
              '<span style="color:' + (delta >= 0 ? '#FFB4A6' : '#9FE0BF') + ';font-weight:700;">' +
              sinal + num(Math.abs(delta)) + '</span></p>'
            : '<p class="product__prev">Primeira leitura registrada</p>') +
          '<div class="product__rows">' +
            '<div class="product__row">' +
              '<span>Petrobras</span>' +
              '<span class="bar"><i style="width:' + (p.petro / p.ppi * 100).toFixed(1) + '%"></i></span>' +
              '<span class="tnum">' + brl(p.petro) + '</span>' +
            '</div>' +
            '<div class="product__row">' +
              '<span>Importação</span>' +
              '<span class="bar"><i class="is-import" style="width:100%"></i></span>' +
              '<span class="tnum">' + brl(p.ppi) + '</span>' +
            '</div>' +
          '</div>' +
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
    var ind = D.indicadores || [];
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
        num(Math.abs(i.variacao)) + '%';
      // Às 08:20 a B3 ainda não abriu: o Ibovespa é o fechamento de ontem.
      // Dizer isso evita que o leitor tome o número como sendo do dia.
      var antigo = hoje && i.dataISO && i.dataISO < hoje;
      var dica = (antigo ? 'Fechamento de ' + i.data : 'Cotação de ' + i.data + ', ' + i.hora) +
        ' · variação sobre o fechamento anterior';
      return '' +
        '<li class="mkt__item" data-ind="' + esc(i.id) + '" title="' + esc(dica) + '"' +
          (eco ? ' aria-hidden="true"' : '') + '>' +
          '<span class="mkt__name">' + esc(i.nome) + '</span>' +
          '<span class="mkt__val tnum">' + esc(valorIndicador(i)) + '</span>' +
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
        .then(function (j) { if (j && j.indicadores && j.indicadores.length) aplicarAoVivo(j.indicadores); })
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

  function montarGrafico() {
    var alvo = $('#grafico'); if (!alvo || !D.serieS10) return;
    var s = D.serieS10, d = s.pontos || [];

    // Com a automação recém-ligada a série começa vazia e enche um ponto por
    // dia útil. Desenhar uma linha com 2 pontos passaria uma ideia falsa de
    // tendência, então até lá o espaço explica o que está acontecendo.
    if (d.length < 5) {
      alvo.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:6px;text-align:center;padding:16px;">' +
          '<span style="font-size:15px;font-weight:600;color:var(--ink-3);">' +
            'Série em formação</span>' +
          '<span style="font-size:13.5px;color:var(--muted);max-width:46ch;line-height:1.45;">' +
            'O gráfico ganha um ponto por dia útil. Já são ' + d.length +
            '. Com cinco ou mais, a curva aparece aqui.</span>' +
        '</div>';
      return;
    }
    var x0 = 44, x1 = 624, y0 = 200, y1 = 18;
    var lo = s.escala.min, hi = s.escala.max;
    var X = function (i) { return x0 + (x1 - x0) * i / (d.length - 1); };
    var Y = function (v) { return y0 - (y0 - y1) * (v - lo) / (hi - lo); };

    var linha = 'M' + d.map(function (p, i) { return X(i).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' L');
    var area = linha + ' L' + x1 + ',' + y0 + ' L' + x0 + ',' + y0 + ' Z';
    var grade = s.escala.linhas.map(function (v) { return { y: Y(v), label: num(v) }; });
    var passo = Math.max(1, Math.round((d.length - 1) / 4));
    var eixoX = [];
    for (var i = 0; i < d.length; i += passo) eixoX.push({ x: X(i), label: d[i][0] });
    if (eixoX[eixoX.length - 1].label !== d[d.length - 1][0]) {
      eixoX.push({ x: X(d.length - 1), label: d[d.length - 1][0] });
    }
    var marcas = (s.marcadores || []).filter(function (m) { return d[m.i]; }).map(function (m) {
      return {
        x: X(m.i), y: Y(d[m.i][1]),
        tx: X(m.i) + (m.ancora === 'end' ? -8 : 8),
        ty: Y(d[m.i][1]) + m.dy,
        texto: m.texto, ancora: m.ancora
      };
    });

    var svg = '<svg viewBox="0 0 640 230" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      grade.map(function (g) {
        return '<line x1="40" x2="632" y1="' + g.y.toFixed(1) + '" y2="' + g.y.toFixed(1) +
               '" stroke="#E6E1D5" stroke-width="1"/>';
      }).join('') +
      '<path d="' + area + '" fill="#B3341F" fill-opacity="0.08"/>' +
      '<path d="' + linha + '" fill="none" stroke="#B3341F" stroke-width="2.2" stroke-linejoin="round"/>' +
      marcas.map(function (m) {
        return '<circle cx="' + m.x.toFixed(1) + '" cy="' + m.y.toFixed(1) +
               '" r="4" fill="#FFFFFF" stroke="#0E2A47" stroke-width="2"/>';
      }).join('') +
      '</svg>';

    function rotulo(x, y, ancora, texto, fs, fw, cor) {
      var tf = ancora === 'end' ? 'translate(-100%,-50%)'
             : ancora === 'middle' ? 'translate(-50%,-50%)' : 'translate(0,-50%)';
      return '<span class="chart__label" style="left:' + (x / 640 * 100).toFixed(2) + '%;top:' +
        (y / 230 * 100).toFixed(2) + '%;transform:' + tf + ';font-size:' + fs +
        ';font-weight:' + fw + ';color:' + cor + ';">' + esc(texto) + '</span>';
    }

    var rotulos =
      grade.map(function (g) { return rotulo(34, g.y, 'end', g.label, '12px', 400, '#55606E'); }).join('') +
      eixoX.map(function (e) { return rotulo(e.x, 218, 'middle', e.label, '12px', 400, '#55606E'); }).join('') +
      marcas.map(function (m) { return rotulo(m.tx, m.ty - 3, m.ancora, m.texto, '13px', 600, '#0E2A47'); }).join('');

    alvo.innerHTML = svg + rotulos;
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

  var LARGURA_A4 = 842, ALTURA_A4 = 1219;

  /** Renderiza o relatório num iframe oculto e devolve o documento pronto. */
  function abrirRelatorioOculto(caminho) {
    return new Promise(function (ok, erro) {
      var frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + LARGURA_A4 +
        'px;height:' + ALTURA_A4 + 'px;border:0;visibility:hidden;';
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
          width: LARGURA_A4,
          height: Math.max(ALTURA_A4, alvo.scrollHeight),
          windowWidth: LARGURA_A4,
          windowHeight: ALTURA_A4,
          scale: 2,
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

  function gerarDownload(edicao, formato) {
    if (formato === 'html') return baixarHtml(edicao);

    return relatorioParaCanvas(edicao.arquivo).then(function (canvas) {
      if (formato === 'png') {
        return canvasParaBlob(canvas, 'image/png')
          .then(function (b) { salvarBlob(b, edicao.slug + '.png'); });
      }
      if (formato === 'jpeg') {
        return canvasParaBlob(canvas, 'image/jpeg', 0.92)
          .then(function (b) { salvarBlob(b, edicao.slug + '.jpg'); });
      }
      // PDF em A4 retrato, página inteira, sem cortes.
      return carregarScript(CDN.jspdf).then(function () {
        var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        if (!jsPDF) throw new Error('Gerador de PDF indisponível.');

        var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
        var pw = pdf.internal.pageSize.getWidth();   // 210
        var ph = pdf.internal.pageSize.getHeight();  // 297
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
    pdf:  { nome: 'PDF',  desc: 'Para imprimir em A4' },
    png:  { nome: 'PNG',  desc: 'Para mandar no WhatsApp' },
    jpeg: { nome: 'JPEG', desc: 'Arquivo mais leve' },
    html: { nome: 'HTML', desc: 'Página original' }
  };

  /** Executa o download com feedback no botão e fallback honesto. */
  function executarDownload(edicao, formato, botao) {
    var textoOriginal = botao.innerHTML;
    botao.setAttribute('aria-busy', 'true');
    botao.innerHTML = '<span>Gerando ' + ROTULOS[formato].nome + '…</span>';
    toast('Gerando ' + ROTULOS[formato].nome + ' de "' + edicao.titulo + '". Pode levar alguns segundos.');

    gerarDownload(edicao, formato)
      .then(function () { toast('Arquivo ' + ROTULOS[formato].nome + ' salvo nos seus downloads.'); })
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
            '<iframe src="' + esc(e.arquivo) + '" title="Prévia da ' + esc(e.titulo) + '" ' +
              'loading="lazy" tabindex="-1" aria-hidden="true" scrolling="no"></iframe>' +
          '</div>' +
          '<div class="edition__meta">' +
            '<h3 class="edition__title">' + esc(e.titulo) + '</h3>' +
            '<span class="edition__date">' + esc(e.data) + '</span>' +
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

  /** Encaixa a prévia A4 (842px) na largura real do cartão. */
  function ajustarPrevias() {
    var previas = document.querySelectorAll('.edition__preview');
    Array.prototype.forEach.call(previas, function (box) {
      var frame = box.querySelector('iframe');
      if (!frame) return;
      var escala = box.clientWidth / LARGURA_A4;
      if (escala > 0) frame.style.transform = 'scale(' + escala.toFixed(4) + ')';
    });
  }

  // Nota: o relatório é desenhado para a caixa A4 de 842x1219 e o conteúdo se
  // ajusta à altura que recebe — por isso a proporção da prévia é fixa. Medir
  // a "altura real" não funciona: doc.body.scrollHeight só devolve a altura do
  // próprio iframe.

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

  /** Lembra a escolha do visitante (estado, período). Sem storage, segue sem. */
  function lembrar(chave, valor) {
    try {
      if (valor === undefined) return window.localStorage.getItem('sp.' + chave);
      window.localStorage.setItem('sp.' + chave, valor);
    } catch (e) { /* aba anônima ou storage bloqueado */ }
    return null;
  }

  function montarShare() {
    var S = D.share, caixa = $('#share');
    if (!caixa || !S || !S.trrs || !S.distribuidoras) {
      // Sem números ainda: o atalho do menu também some, para não levar a nada.
      var atalho = $('.nav a[href="#share"]'); if (atalho) atalho.hidden = true;
      return;
    }
    var M = S.mercado || null;         // mercado total das distribuidoras
    var ref = S.referencia || {};
    var periodo = lembrar('sharePeriodo') === 'ano' ? 'ano' : 'mes';
    var ufs = (S.estados || []).filter(function (e) {
      return (e.mes && e.mes.top && e.mes.top.length) || (e.dist && e.dist.mes && e.dist.mes.top.length);
    });
    var uf = lembrar('shareUf');
    if (!ufs.some(function (e) { return e.uf === uf; })) uf = ufs.length ? ufs[0].uf : null;

    /** Seta de variação: verde sobe, vermelha desce. */
    function seta(v, sufixo, dica) {
      var sentido = v > 0 ? 'up' : (v < 0 ? 'down' : 'flat');
      return '<span class="rank__delta rank__delta--' + sentido + ' tnum"' + (dica ? ' title="' + esc(dica) + '"' : '') + '>' +
        (sentido === 'flat' ? 'estável' :
          '<span aria-hidden="true">' + (sentido === 'up' ? '▲' : '▼') + '</span> ' +
          (sentido === 'up' ? '+' : '−') + dec1(Math.abs(v)) + sufixo) +
        '</span>';
    }

    /*
     * Uma linha do ranking. A barra é proporcional ao LÍDER da lista (o 1º
     * ocupa a largura toda), para as diferenças ficarem visíveis mesmo com
     * participações de 2 ou 3%; o número ao lado é a participação real.
     * Variação em pontos percentuais sobre o mês anterior: ganhar mercado é
     * verde, perder é vermelho.
     */
    function linhas(bloco, mesAnterior) {
      if (!bloco || !bloco.top || !bloco.top.length) {
        return '<li class="rank__vazio">Sem vendas declaradas neste período.</li>';
      }
      var maior = bloco.top[0].share || 1;
      return bloco.top.map(function (x) {
        var delta = '';
        if (periodo === 'mes' && typeof x.deltaPP === 'number') {
          delta = seta(Math.round(x.deltaPP * 10) / 10, ' p.p.',
            'Variação da participação sobre ' + (mesAnterior || 'o mês anterior'));
        }
        return '' +
          '<li class="rank__row">' +
            '<span class="rank__pos tnum">' + x.pos + '</span>' +
            '<div class="rank__body">' +
              '<div class="rank__top">' +
                '<span class="rank__name" title="' + esc(x.nome) + '">' + esc(x.curto || x.nome) + '</span>' +
                '<b class="rank__pct tnum">' + dec1(x.share) + '%</b>' +
              '</div>' +
              '<span class="rank__bar" aria-hidden="true"><i style="width:' +
                Math.max(2, Math.min(100, (x.share / maior) * 100)).toFixed(1) + '%"></i></span>' +
              '<div class="rank__meta">' +
                '<span class="tnum">' + dec1(x.volume) + ' mil m³</span>' + delta +
              '</div>' +
            '</div>' +
          '</li>';
      }).join('');
    }

    /** "Top 5 somam 42,3% de 899,2 mil m³ · 109 distribuidoras". */
    function nota(bloco, quem) {
      if (!bloco || !bloco.top || !bloco.top.length) return '';
      var soma = bloco.top.reduce(function (a, x) { return a + x.share; }, 0);
      return 'Top ' + bloco.top.length + ' somam ' + dec1(soma) + '% de ' + dec1(bloco.total) +
        ' mil m³ · ' + bloco.agentes.toLocaleString('pt-BR') + ' ' + quem;
    }

    /** Barras de composição (produto, canal): a participação de cada parte. */
    function mix(itens) {
      if (!itens || !itens.length) return '<p class="card__note">Sem dados neste período.</p>';
      return itens.map(function (p) {
        return '' +
          '<div class="mix__row">' +
            '<div class="rank__top"><span class="rank__name">' + esc(p.nome) + '</span>' +
              '<b class="rank__pct tnum">' + dec1(p.share) + '%</b></div>' +
            '<span class="rank__bar" aria-hidden="true"><i style="width:' +
              Math.max(1, Math.min(100, p.share)).toFixed(1) + '%"></i></span>' +
            '<div class="rank__meta"><span class="tnum">' + dec1(p.volume) + ' mil m³</span></div>' +
          '</div>';
      }).join('');
    }

    function kpi(rotulo, valor, unidade, rodape) {
      return '<div class="kpi"><p class="kpi__label">' + esc(rotulo) + '</p>' +
        '<p class="kpi__val tnum"><b>' + esc(valor) + '</b>' + (unidade ? ' <span>' + esc(unidade) + '</span>' : '') + '</p>' +
        (rodape ? '<p class="kpi__foot">' + rodape + '</p>' : '') + '</div>';
    }

    function desenhar() {
      var mref = M ? M.referencia : ref;

      // Números do mercado.
      var k = '';
      if (M) {
        var mm = M[periodo];
        var rod = '';
        if (periodo === 'mes') {
          if (typeof M.varMesPct === 'number') {
            rod += seta(M.varMesPct, '%') + ' sobre ' + esc(mref.anterior || 'o mês anterior');
          }
          if (typeof M.varAnoPct === 'number') rod += '<br>' + seta(M.varAnoPct, '%') + ' sobre um ano antes';
        } else {
          rod = esc(M.janela.de + ' a ' + M.janela.ate);
        }
        k += kpi('Vendas das distribuidoras · ' + (periodo === 'mes' ? mref.rotulo : '12 meses'),
          dec1(mm.total), 'mil m³', rod);
        var trrCanal = (mm.canais || []).filter(function (c) { return c.nome === 'TRRs'; })[0];
        if (trrCanal) {
          k += kpi('Canal TRR', dec1(trrCanal.volume), 'mil m³', dec1(trrCanal.share) + '% do volume das distribuidoras');
        }
        k += kpi('Distribuidoras com vendas', mm.agentes.toLocaleString('pt-BR'), '', 'declaradas à ANP no período');
      }
      k += kpi('TRRs com vendas', S.trrs[periodo].agentes.toLocaleString('pt-BR'), '',
        dec1(S.trrs[periodo].total) + ' mil m³ ao consumidor final');
      $('#shareKpis').innerHTML = k;

      $('#shareMerc').innerHTML = M ? linhas(M[periodo], mref.anterior) : '';
      $('#shareMercNota').textContent = M ? nota(M[periodo], 'distribuidoras') : '';
      $('#shareDist').innerHTML = linhas(S.distribuidoras[periodo], ref.anterior);
      $('#shareDistNota').textContent = nota(S.distribuidoras[periodo], 'distribuidoras');
      $('#shareTrr').innerHTML = linhas(S.trrs[periodo], ref.anterior);
      $('#shareTrrNota').textContent = nota(S.trrs[periodo], 'TRRs');
      $('#shareProdutos').innerHTML = M ? mix(M[periodo].produtos) : '';
      $('#shareCanais').innerHTML = M ? mix(M[periodo].canais) : '';

      var e = ufs.filter(function (x) { return x.uf === uf; })[0];
      $('#shareUfTitulo').textContent = 'Por estado' + (e ? ' · ' + e.nome : '');
      $('#shareUfDist').innerHTML = e && e.dist ? linhas(e.dist[periodo], mref.anterior) : '';
      $('#shareUfDistNota').textContent = e && e.dist ? nota(e.dist[periodo], 'distribuidoras venderam no estado') : '';
      $('#shareUf').innerHTML = e ? linhas(e[periodo], ref.anterior) : '';
      $('#shareUfNota').textContent = e ? nota(e[periodo], 'TRRs venderam no estado') : '';

      var lead = 'Volume declarado à ANP pelas distribuidoras e pelos TRRs, ' +
        (periodo === 'mes' ? ref.rotulo : '12 meses, ' + S.janela.de + ' a ' + S.janela.ate) +
        '. Diesel, gasolina, etanol e óleo combustível, em mil m³.';
      if (periodo === 'mes' && ref.preliminar) lead += ' Dados preliminares: a ANP ainda pode revisar este mês.';
      if (periodo === 'mes' && ref.anterior) lead += ' Setas nos rankings: ganho ou perda de participação sobre ' + ref.anterior + '.';
      $('#shareLead').textContent = lead;

      Array.prototype.forEach.call($('#sharePeriodo').children, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-periodo') === periodo ? 'true' : 'false');
      });
      Array.prototype.forEach.call($('#shareUfs').children, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-uf') === uf ? 'true' : 'false');
      });
    }

    $('#sharePeriodo').innerHTML =
      '<button class="filter" type="button" data-periodo="mes">' + esc(ref.rotulo) +
        (ref.preliminar ? ' (prévia)' : '') + '</button>' +
      '<button class="filter" type="button" data-periodo="ano">12 meses</button>';
    $('#sharePeriodo').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-periodo]'); if (!b) return;
      periodo = b.getAttribute('data-periodo'); lembrar('sharePeriodo', periodo); desenhar();
    });

    $('#shareUfs').innerHTML = ufs.map(function (e) {
      return '<button class="filter" type="button" data-uf="' + esc(e.uf) + '" title="' + esc(e.nome) + '">' +
        esc(e.uf) + '</button>';
    }).join('');
    $('#shareUfs').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-uf]'); if (!b) return;
      uf = b.getAttribute('data-uf'); lembrar('shareUf', uf); desenhar();
    });

    // Planilha completa: todas as empresas, Brasil e os 27 estados.
    var csv = S.csv && urlSegura(S.csv), baixar = $('#shareCsv');
    if (baixar && csv && M) {
      baixar.href = csv;
      baixar.setAttribute('download', 'supriprice-market-share-' + (M.referencia.mes || '') + '.csv');
      $('#shareCsvTexto').textContent = 'Todas as ' + M.mes.agentes.toLocaleString('pt-BR') +
        ' distribuidoras e os ' + S.trrs.mes.agentes.toLocaleString('pt-BR') +
        ' TRRs, posição a posição, no Brasil e em cada um dos 27 estados, em ' +
        M.referencia.rotulo + ' e nos últimos 12 meses.';
    } else {
      var cartao = baixar && baixar.closest('.card'); if (cartao) cartao.hidden = true;
    }

    var base = S.baseANP ? S.baseANP.split('-').reverse().join('/') : '';
    var lnk = function (u, t) {
      u = urlSegura(u);
      return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + t + '</a>' : t;
    };
    $('#shareFonte').innerHTML = 'Fonte: ANP, SIMP (volumes declarados pelos agentes), bases dos painéis ' +
      lnk(S.urlPainelLiquidos, 'Mercado Brasileiro de Combustíveis Líquidos') + ' e ' +
      lnk(S.urlPainel, 'Mercado Brasileiro de TRR') + (base ? ', atualizadas em ' + esc(base) : '') +
      '. A ANP publica no dia 1 (mês retrasado, consolidado) e no dia 20 (mês anterior, preliminar); ' +
      'o portal confere uma vez por dia. Empresas do mesmo grupo com CNPJ próprio aparecem separadas, ' +
      'como a ANP as registra.';

    desenhar();
    caixa.hidden = false;
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
        if (n) compartilhar({ titulo: n.titulo, texto: n.fonte + ' — ' + n.titulo, url: n.url });
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
      ['arbitragem', 'painel', 'share', 'noticias', 'jornal', 'arquivo'].forEach(function (id) {
        var el = document.getElementById(id); if (el) io.observe(el);
      });
    }
  }

  /* -------------------------------------------------------------- início */

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
  window.addEventListener('load', ajustarPrevias);
})();

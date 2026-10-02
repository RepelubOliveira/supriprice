/* ==========================================================================
   SupriPrice — aba de Market share (market-share.html)

   Lê a SÉRIE mensal que o robô gera a partir das bases da ANP
   (dados/share-serie-AAAA-MM-DD.json, endereço em D.share.serie) e monta
   tudo no navegador para o período e o recorte escolhidos:
     - números do mercado, com comparação ao período anterior e a um ano antes
     - volume mensal (barras) e evolução da participação (linhas)
     - rankings de distribuidoras, fornecedoras de TRR e TRRs (Top 5/10/20)
     - volume por produto e por canal

   Como a série guarda as 25 maiores empresas de cada mês e o TOTAL exato,
   qualquer período sai certo até o Top 20: participação = volume da empresa
   no período / total do período.

   Não é preciso editar este arquivo na rotina: o robô atualiza os dados.
   ========================================================================== */
(function () {
  'use strict';

  var D = window.DADOS || {};
  var $ = function (s) { return document.querySelector(s); };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function urlSegura(u) {
    try {
      var p = new URL(u, location.href);
      return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
    } catch (e) { return ''; }
  }
  function dec(v, casas) {
    return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }
  function dec1(v) { return dec(v, 1); }

  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
    'setembro', 'outubro', 'novembro', 'dezembro'];
  function rotulo(m) { var p = m.split('-'); return MESES[+p[1] - 1] + '/' + p[0].slice(2); }

  // Paleta categórica (validada para daltonismo, ordem fixa). A cor segue a
  // EMPRESA, não a posição: trocar o período não repinta ninguém.
  var CORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var COR_OUTRA = '#8a8f98';

  var S = D.share;
  var SR = null;                       // a série
  var estado = { de: 0, ate: 0, uf: 'BR', n: 5, evo: 'merc' };

  /* --------------------------------------------------------- dados */

  /** Último mês com dado de verdade (total > 0) num segmento. */
  function ultimoComDado(seg) {
    var t = SR[seg] && SR[seg].BR && SR[seg].BR.t;
    if (!t) return SR.meses.length - 1;
    for (var i = t.length - 1; i >= 0; i--) if (t[i] > 0) return i;
    return t.length - 1;
  }

  /** Soma um segmento/recorte entre dois índices de mês (inclusive). */
  function agregar(seg, rec, ini, fim) {
    var L = SR[seg] && SR[seg][rec];
    if (!L || ini < 0) return null;
    var total = 0, vol = {}, meses = 0;
    for (var i = ini; i <= fim; i++) {
      if (!(L.t[i] > 0)) continue;
      meses++;
      total += L.t[i];
      L.a[i].forEach(function (p) { vol[p[0]] = (vol[p[0]] || 0) + p[1]; });
    }
    if (!meses) return null;
    var itens = Object.keys(vol).map(function (k) {
      return { id: +k, volume: vol[k], share: total ? (vol[k] / total) * 100 : 0 };
    }).sort(function (a, b) { return b.volume - a.volume; });
    return { total: total, itens: itens, n: ini === fim ? L.n[ini] : null, meses: meses };
  }

  /** Soma uma composição (produto/canal) no período. */
  function compor(dim, rec, ini, fim) {
    var L = SR.merc[rec] && SR.merc[rec][dim];
    if (!L) return [];
    var soma = L.nomes.map(function () { return 0; }), total = 0;
    for (var i = ini; i <= fim; i++) {
      (L.v[i] || []).forEach(function (v, j) { soma[j] += v; total += v; });
    }
    return L.nomes.map(function (nome, j) {
      return { nome: nome, volume: soma[j], share: total ? (soma[j] / total) * 100 : 0 };
    }).filter(function (x) { return x.volume > 0; })
      .sort(function (a, b) { return b.volume - a.volume; });
  }

  /** Mapa de cores estável: ordem das empresas no período TODO da série. */
  var coresCache = {};
  function corDe(seg, rec, id) {
    var k = seg + '|' + rec;
    if (!coresCache[k]) {
      var tudo = agregar(seg, rec, 0, SR.meses.length - 1);
      var mapa = {};
      (tudo ? tudo.itens : []).slice(0, CORES.length).forEach(function (x, i) { mapa[x.id] = CORES[i]; });
      coresCache[k] = mapa;
    }
    return coresCache[k][id] || COR_OUTRA;
  }

  /* ----------------------------------------------------- período */

  function periodoTexto(ini, fim) {
    if (ini === fim) {
      var p = SR.meses[ini].split('-');
      return MESES_LONGOS[+p[1] - 1] + ' de ' + p[0];
    }
    return rotulo(SR.meses[ini]) + ' a ' + rotulo(SR.meses[fim]) + ' (' + (fim - ini + 1) + ' meses)';
  }

  /** Atalhos de período: do último mês com dado para trás. */
  function atalhos() {
    var u = ultimoComDado('trr');
    var lista = [
      { rot: 'Último mês', de: u, ate: u },
      { rot: '3 meses', de: u - 2, ate: u },
      { rot: '6 meses', de: u - 5, ate: u },
      { rot: '12 meses', de: u - 11, ate: u }
    ];
    // Anos: o corrente (até o último mês) e os fechados.
    var anos = {};
    SR.meses.forEach(function (m, i) { if (i <= u) { var a = m.slice(0, 4); (anos[a] = anos[a] || []).push(i); } });
    Object.keys(anos).sort().reverse().forEach(function (a) {
      var idx = anos[a];
      lista.push({ rot: idx.length === 12 ? a : a + ' até ' + rotulo(SR.meses[idx[idx.length - 1]]).split('/')[0],
        de: idx[0], ate: idx[idx.length - 1] });
    });
    return lista.filter(function (x) { return x.de >= 0; });
  }

  /* ------------------------------------------------- endereço (#) */

  function lerEndereco() {
    var h = location.hash.replace(/^#/, ''), q = {};
    h.split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) q[kv[0]] = decodeURIComponent(kv[1] || ''); });
    var u = ultimoComDado('trr');
    var de = SR.meses.indexOf(q.de), ate = SR.meses.indexOf(q.ate);
    estado.ate = ate >= 0 ? ate : u;
    estado.de = de >= 0 ? de : estado.ate;
    if (estado.de > estado.ate) { var t = estado.de; estado.de = estado.ate; estado.ate = t; }
    estado.uf = q.uf && (q.uf === 'BR' || SR.estados.some(function (e) { return e.uf === q.uf; })) ? q.uf : 'BR';
    estado.n = [5, 10, 20].indexOf(+q.n) >= 0 ? +q.n : 5;
    estado.evo = q.evo === 'trr' ? 'trr' : 'merc';
  }

  function gravarEndereco() {
    var h = 'de=' + SR.meses[estado.de] + '&ate=' + SR.meses[estado.ate] + '&uf=' + estado.uf +
      (estado.n !== 5 ? '&n=' + estado.n : '') + (estado.evo !== 'merc' ? '&evo=' + estado.evo : '');
    try { history.replaceState(null, '', '#' + h); } catch (e) { /* file:// */ }
  }

  /* ------------------------------------------------------ pedaços */

  function seta(v, sufixo, casas) {
    var r = Math.round(v * Math.pow(10, casas == null ? 1 : casas)) / Math.pow(10, casas == null ? 1 : casas);
    var sentido = r > 0 ? 'up' : (r < 0 ? 'down' : 'flat');
    return '<span class="rank__delta rank__delta--' + sentido + ' tnum">' +
      (sentido === 'flat' ? 'estável' :
        '<span aria-hidden="true">' + (sentido === 'up' ? '▲' : '▼') + '</span> ' +
        (sentido === 'up' ? '+' : '−') + dec(Math.abs(r), casas == null ? 1 : casas) + sufixo) +
      '</span>';
  }

  function kpi(rotuloK, valor, unidade, rodape) {
    return '<div class="kpi"><p class="kpi__label">' + esc(rotuloK) + '</p>' +
      '<p class="kpi__val tnum"><b>' + esc(valor) + '</b>' + (unidade ? ' <span>' + esc(unidade) + '</span>' : '') + '</p>' +
      (rodape ? '<p class="kpi__foot">' + rodape + '</p>' : '') + '</div>';
  }

  /** Lista do ranking, com variação de participação sobre o período anterior. */
  function ranking(atual, anterior, seg, rec, quem) {
    if (!atual || !atual.itens.length) {
      return { html: '<li class="rank__vazio">Sem vendas declaradas neste período.</li>', nota: '' };
    }
    var antes = {};
    if (anterior) anterior.itens.forEach(function (x) { antes[x.id] = x.share; });
    var top = atual.itens.slice(0, estado.n), maior = top[0].share || 1;
    var html = top.map(function (x, i) {
      var nome = SR.nomes[x.id], curto = SR.curtos[x.id] || nome;
      var delta = anterior && antes[x.id] != null ? seta(x.share - antes[x.id], ' p.p.') : '';
      return '' +
        '<li class="rank__row">' +
          '<span class="rank__pos tnum">' + (i + 1) + '</span>' +
          '<div class="rank__body">' +
            '<div class="rank__top">' +
              '<span class="rank__name" title="' + esc(nome) + '">' +
                '<i class="ms-cor" style="background:' + corDe(seg, rec, x.id) + '" aria-hidden="true"></i>' +
                esc(curto) + '</span>' +
              '<b class="rank__pct tnum">' + dec1(x.share) + '%</b>' +
            '</div>' +
            '<span class="rank__bar" aria-hidden="true"><i style="width:' +
              Math.max(2, Math.min(100, (x.share / maior) * 100)).toFixed(1) + '%"></i></span>' +
            '<div class="rank__meta"><span class="tnum">' + dec1(x.volume) + ' mil m³</span>' + delta + '</div>' +
          '</div>' +
        '</li>';
    }).join('');
    var soma = top.reduce(function (a, x) { return a + x.share; }, 0);
    var nota = 'Top ' + top.length + ' somam ' + dec1(soma) + '% de ' + dec1(atual.total) + ' mil m³' +
      (atual.n != null ? ' · ' + atual.n.toLocaleString('pt-BR') + ' ' + quem + ' com vendas' : '');
    return { html: html, nota: nota };
  }

  function mix(itens) {
    if (!itens.length) return '<p class="card__note">Sem dados neste período.</p>';
    return itens.map(function (p) {
      return '<div class="mix__row">' +
        '<div class="rank__top"><span class="rank__name">' + esc(p.nome) + '</span>' +
          '<b class="rank__pct tnum">' + dec1(p.share) + '%</b></div>' +
        '<span class="rank__bar" aria-hidden="true"><i style="width:' + Math.max(1, Math.min(100, p.share)).toFixed(1) + '%"></i></span>' +
        '<div class="rank__meta"><span class="tnum">' + dec1(p.volume) + ' mil m³</span></div>' +
      '</div>';
    }).join('');
  }

  /* ------------------------------------------------------ gráficos */

  var tip = null;
  function dica(alvo, html, x, y) {
    if (!tip) { tip = document.createElement('div'); tip.className = 'ms-tip'; tip.setAttribute('role', 'tooltip'); }
    if (tip.parentNode !== alvo) alvo.appendChild(tip);
    if (html == null) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.innerHTML = html;
    var w = alvo.clientWidth, tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(w - tw, x - tw / 2)) + 'px';
    tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
  }

  /** Escala "redonda" para o eixo: 0 até um teto bonito, 4 divisões. */
  function escala(max) {
    if (!(max > 0)) return { teto: 1, passo: 0.25 };
    var bruto = max / 4, mag = Math.pow(10, Math.floor(Math.log10(bruto)));
    var passo = [1, 2, 2.5, 5, 10].map(function (f) { return f * mag; }).filter(function (p) { return p >= bruto; })[0];
    return { teto: passo * 4, passo: passo };
  }

  /** Barras: volume mensal das distribuidoras no recorte; período em destaque. */
  function desenharBarras() {
    var alvo = $('#msBarras'), L = SR.merc[estado.uf];
    if (!alvo || !L) return;
    var W = alvo.clientWidth || 600, H = 220, mE = 52, mD = 8, mT = 12, mB = 26;
    var n = SR.meses.length, larg = (W - mE - mD) / n;
    var esc_ = escala(Math.max.apply(null, L.t));
    var y = function (v) { return mT + (H - mT - mB) * (1 - v / esc_.teto); };
    var svg = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Volume mensal das distribuidoras, ' +
      esc(estado.uf === 'BR' ? 'Brasil' : estado.uf) + ', de ' + rotulo(SR.meses[0]) + ' a ' + rotulo(SR.meses[n - 1]) + '">';
    for (var g = 0; g <= 4; g++) {
      var v = esc_.passo * g, yy = y(v);
      svg += '<line x1="' + mE + '" x2="' + (W - mD) + '" y1="' + yy + '" y2="' + yy + '" class="ms-grade"/>' +
        '<text x="' + (mE - 8) + '" y="' + (yy + 4) + '" class="ms-eixo" text-anchor="end">' + dec(v, 0) + '</text>';
    }
    L.t.forEach(function (t, i) {
      var x = mE + i * larg, bw = Math.max(1, larg - 2), dentro = i >= estado.de && i <= estado.ate;
      if (t > 0) {
        var yy = y(t), h = Math.max(1, H - mB - yy);
        // Topo arredondado só em cima: a base fica reta no eixo.
        var r = Math.min(4, bw / 2, h);
        svg += '<path class="ms-barra' + (dentro ? ' is-sel' : '') + '" d="M' + x + ',' + (H - mB) + 'V' + (yy + r) +
          'Q' + x + ',' + yy + ' ' + (x + r) + ',' + yy + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + yy + ' ' + (x + bw) + ',' + (yy + r) +
          'V' + (H - mB) + 'Z"/>';
      }
      var m = SR.meses[i];
      if (m.slice(5) === '01' || i === 0 || i === n - 1) {
        svg += '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" class="ms-eixo" text-anchor="middle">' +
          (m.slice(5) === '01' ? m.slice(0, 4) : rotulo(m)) + '</text>';
      }
      // Área de toque maior que a barra.
      svg += '<rect class="ms-alvo" data-i="' + i + '" x="' + x + '" y="' + mT + '" width="' + larg + '" height="' + (H - mT - mB) + '"/>';
    });
    svg += '</svg>';
    alvo.innerHTML = svg;

    alvo.onmousemove = function (ev) {
      var r = ev.target.closest && ev.target.closest('.ms-alvo');
      if (!r) { dica(alvo, null); return; }
      var i = +r.getAttribute('data-i'), t = L.t[i];
      var caixa = alvo.getBoundingClientRect();
      dica(alvo, '<b>' + rotulo(SR.meses[i]) + '</b><br>' + (t > 0 ? dec1(t) + ' mil m³' : 'sem dado'),
        ev.clientX - caixa.left, y(t > 0 ? t : 0));
    };
    alvo.onmouseleave = function () { dica(alvo, null); };
    alvo.onclick = function (ev) {
      var r = ev.target.closest && ev.target.closest('.ms-alvo');
      if (!r || !(L.t[+r.getAttribute('data-i')] > 0)) return;
      estado.de = estado.ate = +r.getAttribute('data-i');
      atualizar();
    };
  }

  /** Linhas: participação mensal das 5 maiores do período. */
  function desenharEvolucao() {
    var alvo = $('#msEvo'), seg = estado.evo, rec = estado.uf, L = SR[seg][rec];
    if (!alvo || !L) return;
    // Com 1 ou 2 meses escolhidos, uma linha não diz nada: mostra os 12 meses
    // até o fim do período.
    var fim = estado.ate, ini = estado.ate - estado.de >= 2 ? estado.de : Math.max(0, estado.ate - 11);
    var top = (agregar(seg, rec, estado.de, estado.ate) || { itens: [] }).itens.slice(0, 5);
    $('#msEvoNota').textContent = (seg === 'merc' ? 'Distribuidoras no mercado total' : 'TRRs, vendas ao consumidor final') +
      ', ' + (rec === 'BR' ? 'Brasil' : nomeUf(rec)) + ': participação mensal das 5 maiores de ' +
      periodoTexto(estado.de, estado.ate).replace(/ \(.*\)$/, '') +
      (ini !== estado.de ? '. Período curto: o gráfico mostra os 12 meses até ' + rotulo(SR.meses[fim]) + '.' : '.');

    var series = top.map(function (x) {
      var pts = [];
      for (var i = ini; i <= fim; i++) {
        var t = L.t[i], v = null;
        if (t > 0) L.a[i].forEach(function (p) { if (p[0] === x.id) v = (p[1] / t) * 100; });
        pts.push(v);
      }
      return { id: x.id, cor: corDe(seg, rec, x.id), nome: SR.curtos[x.id], pts: pts };
    });

    // Legenda sempre presente (identidade nunca só pela cor).
    $('#msEvoLegenda').innerHTML = series.map(function (s) {
      return '<span class="ms-legenda__item"><i style="background:' + s.cor + '"></i>' + esc(s.nome) + '</span>';
    }).join('');

    var W = alvo.clientWidth || 600, H = 260, mE = 44, mD = 12, mT = 14, mB = 26;
    var max = 0;
    series.forEach(function (s) { s.pts.forEach(function (v) { if (v != null && v > max) max = v; }); });
    var e = escala(max * 1.05);
    var nPts = fim - ini + 1;
    var x = function (k) { return mE + (nPts === 1 ? (W - mE - mD) / 2 : k * (W - mE - mD) / (nPts - 1)); };
    var y = function (v) { return mT + (H - mT - mB) * (1 - v / e.teto); };

    var svg = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Evolução da participação das 5 maiores">';
    for (var g = 0; g <= 4; g++) {
      var v = e.passo * g, yy = y(v);
      svg += '<line x1="' + mE + '" x2="' + (W - mD) + '" y1="' + yy + '" y2="' + yy + '" class="ms-grade"/>' +
        '<text x="' + (mE - 8) + '" y="' + (yy + 4) + '" class="ms-eixo" text-anchor="end">' + dec(v, v < 10 && e.passo < 1 ? 1 : 0) + '%</text>';
    }
    var cada = Math.max(1, Math.ceil(nPts / 8));
    for (var k = 0; k < nPts; k++) {
      if (k % cada === 0 || k === nPts - 1) {
        svg += '<text x="' + x(k) + '" y="' + (H - 8) + '" class="ms-eixo" text-anchor="middle">' + rotulo(SR.meses[ini + k]) + '</text>';
      }
    }
    series.forEach(function (s) {
      var d = '', ab = false;
      s.pts.forEach(function (v, k) {
        if (v == null) { ab = false; return; }
        d += (ab ? 'L' : 'M') + x(k).toFixed(1) + ',' + y(v).toFixed(1); ab = true;
      });
      svg += '<path d="' + d + '" fill="none" stroke="' + s.cor + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      // Ponto no último mês, com anel da cor da superfície.
      var ult = s.pts.length - 1;
      if (s.pts[ult] != null) {
        svg += '<circle cx="' + x(ult) + '" cy="' + y(s.pts[ult]) + '" r="4" fill="' + s.cor + '" stroke="#fff" stroke-width="2"/>';
      }
    });
    svg += '<line class="ms-cruz" x1="0" x2="0" y1="' + mT + '" y2="' + (H - mB) + '" hidden/>';
    svg += '<rect class="ms-alvo" x="' + mE + '" y="' + mT + '" width="' + (W - mE - mD) + '" height="' + (H - mT - mB) + '"/>';
    svg += '</svg>';
    alvo.innerHTML = svg;

    var cruz = alvo.querySelector('.ms-cruz');
    alvo.onmousemove = function (ev) {
      var caixa = alvo.getBoundingClientRect(), px = ev.clientX - caixa.left;
      if (px < mE || px > W - mD) { cruz.setAttribute('hidden', ''); dica(alvo, null); return; }
      var k = nPts === 1 ? 0 : Math.round((px - mE) / ((W - mE - mD) / (nPts - 1)));
      k = Math.max(0, Math.min(nPts - 1, k));
      cruz.removeAttribute('hidden');
      cruz.setAttribute('x1', x(k)); cruz.setAttribute('x2', x(k));
      var linhas = series.map(function (s) { return { s: s, v: s.pts[k] }; })
        .sort(function (a, b) { return (b.v || -1) - (a.v || -1); })
        .map(function (o) {
          return '<span class="ms-tip__linha"><i style="background:' + o.s.cor + '"></i>' + esc(o.s.nome) +
            '<b class="tnum">' + (o.v == null ? '—' : dec1(o.v) + '%') + '</b></span>';
        }).join('');
      dica(alvo, '<b>' + rotulo(SR.meses[ini + k]) + '</b>' + linhas, x(k), mT + 40);
    };
    alvo.onmouseleave = function () { cruz.setAttribute('hidden', ''); dica(alvo, null); };

    // A mesma informação em tabela (leitor de tela, impressão, quem prefere).
    var tab = '<table class="tabela-ms"><thead><tr><th>Mês</th>' + series.map(function (s) {
      return '<th class="n">' + esc(s.nome) + '</th>';
    }).join('') + '</tr></thead><tbody>';
    for (var j = 0; j < nPts; j++) {
      tab += '<tr><td>' + rotulo(SR.meses[ini + j]) + '</td>' + series.map(function (s) {
        return '<td class="n tnum">' + (s.pts[j] == null ? '—' : dec1(s.pts[j]) + '%') + '</td>';
      }).join('') + '</tr>';
    }
    $('#msEvoTabela').innerHTML = tab + '</tbody></table>';
  }

  function nomeUf(uf) {
    var e = SR.estados.filter(function (x) { return x.uf === uf; })[0];
    return e ? e.nome : uf;
  }

  /* ------------------------------------------------------ montagem */

  function atualizar() {
    gravarEndereco();
    var de = estado.de, ate = estado.ate, rec = estado.uf, len = ate - de + 1;
    var antIni = de - len, antFim = de - 1;
    // "Um ano antes" só quando é diferente do período anterior (com 12 meses
    // escolhidos, os dois são o mesmo e a comparação sairia em dobro).
    var anoIni = len === 12 ? -1 : de - 12, anoFim = ate - 12;
    var recNome = rec === 'BR' ? 'Brasil' : nomeUf(rec);

    // Filtros refletem o estado.
    $('#msDe').value = String(de);
    $('#msAte').value = String(ate);
    Array.prototype.forEach.call($('#msAtalhos').children, function (b) {
      b.setAttribute('aria-pressed', +b.getAttribute('data-de') === de && +b.getAttribute('data-ate') === ate ? 'true' : 'false');
    });
    Array.prototype.forEach.call($('#msUfs').children, function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-uf') === rec ? 'true' : 'false');
    });
    Array.prototype.forEach.call($('#msTopN').children, function (b) {
      b.setAttribute('aria-pressed', +b.getAttribute('data-n') === estado.n ? 'true' : 'false');
    });
    Array.prototype.forEach.call($('#msEvoSeg').children, function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-evo') === estado.evo ? 'true' : 'false');
    });

    var merc = agregar('merc', rec, de, ate);
    var mercAnt = antIni >= 0 ? agregar('merc', rec, antIni, antFim) : null;
    var mercAno = anoIni >= 0 ? agregar('merc', rec, anoIni, anoFim) : null;
    var trr = agregar('trr', rec, de, ate);
    var trrAnt = antIni >= 0 ? agregar('trr', rec, antIni, antFim) : null;
    var forn = agregar('forn', 'BR', de, ate);
    var fornAnt = antIni >= 0 ? agregar('forn', 'BR', antIni, antFim) : null;
    var canais = compor('canal', rec, de, ate);

    var prelim = [S && S.mercado && S.mercado.referencia, S && S.referencia].some(function (r) {
      return r && r.preliminar && SR.meses.indexOf(r.mes) >= de && SR.meses.indexOf(r.mes) <= ate;
    });
    var compTxt = antIni >= 0 ? ' Comparações com ' + periodoTexto(antIni, antFim).replace(/ \(.*\)$/, '') +
      (anoIni >= 0 ? ' e com o mesmo período um ano antes.' : '.') : '';
    $('#msResumo').innerHTML = '<b>' + esc(recNome) + ' · ' + esc(periodoTexto(de, ate)) + '.</b>' + esc(compTxt) +
      (prelim ? ' <span class="ms-prelim">Inclui mês preliminar: a ANP ainda pode revisar.</span>' : '');

    // Números.
    var k = '';
    if (merc) {
      var rod = [];
      if (mercAnt) rod.push(seta((merc.total / mercAnt.total - 1) * 100, '%') + ' sobre o período anterior');
      if (mercAno) rod.push(seta((merc.total / mercAno.total - 1) * 100, '%') + ' sobre um ano antes');
      k += kpi('Vendas das distribuidoras', dec1(merc.total), 'mil m³', rod.join('<br>'));
      var cTrr = canais.filter(function (c) { return c.nome === 'TRRs'; })[0];
      if (cTrr) k += kpi('Canal TRR', dec1(cTrr.volume), 'mil m³', dec1(cTrr.share) + '% do volume das distribuidoras');
    }
    if (trr) {
      var rodT = trrAnt ? seta((trr.total / trrAnt.total - 1) * 100, '%') + ' sobre o período anterior' : '';
      k += kpi('Vendas dos TRRs', dec1(trr.total), 'mil m³', (rodT ? rodT + '<br>' : '') + 'ao consumidor final');
    }
    if (len === 1 && merc && trr) {
      k += kpi('Empresas com vendas', String(merc.n), 'distribuidoras', (trr.n || 0).toLocaleString('pt-BR') + ' TRRs no mês');
    } else {
      k += kpi('Período', String(len), len === 1 ? 'mês' : 'meses', esc(periodoTexto(de, ate).replace(/ \(.*\)$/, '')));
    }
    $('#msKpis').innerHTML = k;

    // Rankings.
    var r1 = ranking(merc, mercAnt, 'merc', rec, 'distribuidoras');
    $('#msMerc').innerHTML = r1.html; $('#msMercNota').textContent = r1.nota;
    var r2 = ranking(forn, fornAnt, 'forn', 'BR', 'distribuidoras');
    $('#msForn').innerHTML = r2.html;
    $('#msFornNota').textContent = r2.nota + (rec !== 'BR' ? ' · Brasil: a ANP não abre este dado por estado' : '');
    var r3 = ranking(trr, trrAnt, 'trr', rec, 'TRRs');
    $('#msTrr').innerHTML = r3.html; $('#msTrrNota').textContent = r3.nota;
    $('#msMercTitulo').textContent = 'Top ' + estado.n + ' distribuidoras';
    $('#msFornTitulo').textContent = 'Top ' + estado.n + ' fornecedoras de TRR';
    $('#msTrrTitulo').textContent = 'Top ' + estado.n + ' TRRs';

    $('#msProdutos').innerHTML = mix(compor('prod', rec, de, ate));
    $('#msCanais').innerHTML = mix(canais);

    desenharBarras();
    desenharEvolucao();
  }

  function montarFiltros() {
    var opcoes = SR.meses.map(function (m, i) {
      return '<option value="' + i + '"' + (SR.merc.BR.t[i] > 0 || SR.trr.BR.t[i] > 0 ? '' : ' disabled') + '>' +
        rotulo(m) + '</option>';
    }).join('');
    $('#msDe').innerHTML = opcoes;
    $('#msAte').innerHTML = opcoes;
    $('#msDe').addEventListener('change', function () {
      estado.de = +this.value; if (estado.de > estado.ate) estado.ate = estado.de; atualizar();
    });
    $('#msAte').addEventListener('change', function () {
      estado.ate = +this.value; if (estado.ate < estado.de) estado.de = estado.ate; atualizar();
    });

    $('#msAtalhos').innerHTML = atalhos().map(function (a) {
      return '<button class="filter" type="button" data-de="' + a.de + '" data-ate="' + a.ate + '">' + esc(a.rot) + '</button>';
    }).join('');
    $('#msAtalhos').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-de]'); if (!b) return;
      estado.de = +b.getAttribute('data-de'); estado.ate = +b.getAttribute('data-ate'); atualizar();
    });

    $('#msUfs').innerHTML = '<button class="filter" type="button" data-uf="BR">Brasil</button>' +
      SR.estados.map(function (e) {
        return '<button class="filter" type="button" data-uf="' + esc(e.uf) + '" title="' + esc(e.nome) + '">' + esc(e.uf) + '</button>';
      }).join('');
    $('#msUfs').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-uf]'); if (!b) return;
      estado.uf = b.getAttribute('data-uf'); atualizar();
    });

    $('#msTopN').innerHTML = [5, 10, 20].map(function (n) {
      return '<button class="filter" type="button" data-n="' + n + '">Top ' + n + '</button>';
    }).join('');
    $('#msTopN').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-n]'); if (!b) return;
      estado.n = +b.getAttribute('data-n'); atualizar();
    });

    $('#msEvoSeg').innerHTML = '<button class="filter" type="button" data-evo="merc">Distribuidoras</button>' +
      '<button class="filter" type="button" data-evo="trr">TRRs</button>';
    $('#msEvoSeg').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-evo]'); if (!b) return;
      estado.evo = b.getAttribute('data-evo'); atualizar();
    });

    var espera, larguraAntes = window.innerWidth;
    window.addEventListener('resize', function () {
      if (window.innerWidth === larguraAntes) return;
      larguraAntes = window.innerWidth;
      clearTimeout(espera);
      espera = setTimeout(function () { desenharBarras(); desenharEvolucao(); }, 150);
    });
    window.addEventListener('hashchange', function () { lerEndereco(); atualizar(); });
  }

  function montarRodape() {
    var base = SR.base ? SR.base.split('-').reverse().join('/') : '';
    var ref = S && S.referencia;
    $('#msBase').textContent = 'Fonte: ANP, SIMP · base de ' + base +
      (ref ? ' · último mês: ' + rotulo(ref.mes) + (ref.preliminar ? ' (preliminar)' : '') : '');

    var lnk = function (u, t) { u = urlSegura(u); return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + t + '</a>' : t; };
    $('#msFonte').innerHTML = 'Fonte: ANP, SIMP (volumes declarados pelos agentes), bases dos painéis ' +
      lnk(S.urlPainelLiquidos, 'Mercado Brasileiro de Combustíveis Líquidos') + ' e ' +
      lnk(S.urlPainel, 'Mercado Brasileiro de TRR') + (base ? ', atualizadas em ' + esc(base) : '') +
      '. Diesel, gasolina, etanol e óleo combustível, em mil m³. A ANP publica no dia 1 (mês retrasado, consolidado) ' +
      'e no dia 20 (mês anterior, preliminar); o portal confere uma vez por dia. Estados: vendas dentro do estado, ' +
      'de empresas de qualquer origem. Empresas do mesmo grupo com CNPJ próprio aparecem separadas, como a ANP as registra.';

    var csv = S.csv && urlSegura(S.csv), baixar = $('#msCsv');
    if (csv) {
      baixar.href = csv;
      baixar.setAttribute('download', 'supriprice-market-share-' + (S.referencia ? S.referencia.mes : '') + '.csv');
      $('#msCsvTexto').textContent = 'Todas as distribuidoras e TRRs, posição a posição, no Brasil e nos 27 estados, em ' +
        (S.referencia ? S.referencia.rotulo : 'último mês') + ' e nos últimos 12 meses.';
    } else {
      baixar.closest('.card').hidden = true;
    }
  }

  function falhar(msg) {
    var st = $('#msStatus');
    st.textContent = msg;
    st.classList.add('is-erro');
  }

  if (!S || !S.serie) { falhar('Os números de market share ainda não foram carregados pelo robô. Volte em alguns minutos.'); return; }
  var url = urlSegura(S.serie);
  if (!url || !window.fetch) { falhar('Seu navegador não conseguiu carregar os números.'); return; }

  fetch(url, { credentials: 'omit' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (j) {
      if (!j || !j.meses || !j.merc || !j.trr) throw new Error('série inválida');
      SR = j;
      lerEndereco();
      montarFiltros();
      montarRodape();
      $('#msStatus').hidden = true;
      $('#msConteudo').hidden = false;
      atualizar();
    })
    .catch(function (e) {
      console.error('[SupriPrice] market share:', e);
      falhar('Não foi possível carregar os números da ANP agora. Tente recarregar a página.');
    });
})();

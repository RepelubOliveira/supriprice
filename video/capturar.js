/* SupriPrice — capturas do portal para o vídeo de divulgação
   ---------------------------------------------------------------------------
   Roda DENTRO da página do portal servida localmente (servidor "projeto-local",
   raiz = pasta do projeto, portal em /portal/). Fotografa as seções com
   html2canvas em alta resolução, anota onde fica cada destaque (para a câmera
   do vídeo dar zoom nele) e grava tudo em video/capturas/ pelo POST /__gravar
   do servidor de apoio.

   Uso, no console da página:
     capturarPortal('m', 3)    // layout de celular (abra em 375px de largura)
     capturarPortal('d', 1.5)  // layout de computador (abra em 1440px)
   e, na página do jornal:
     capturarJornal(2)
*/
(function () {
  var H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

  function carregar(url) {
    if (window.html2canvas) return Promise.resolve();
    return new Promise(function (ok, erro) {
      var s = document.createElement('script');
      s.src = url; s.onload = ok; s.onerror = function () { erro(new Error('não carregou ' + url)); };
      document.head.appendChild(s);
    });
  }

  function gravar(caminho, corpo) {
    return fetch('/__gravar?path=' + encodeURIComponent(caminho), { method: 'POST', body: corpo })
      .then(function (r) { if (!r.ok) throw new Error('gravar ' + caminho + ': HTTP ' + r.status); return r.text(); });
  }

  function paraPng(canvas) {
    return new Promise(function (ok) { canvas.toBlob(ok, 'image/png'); });
  }

  /** Retângulo de `filho` relativo ao canto de `pai`, em px de CSS. */
  function rel(pai, filho) {
    var a = pai.getBoundingClientRect(), b = filho.getBoundingClientRect();
    return { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height };
  }

  async function foto(nome, el, escala, fundo) {
    var r = el.getBoundingClientRect();
    var canvas = await window.html2canvas(el, {
      scale: escala, backgroundColor: fundo, useCORS: true, logging: false,
      scrollX: 0, scrollY: 0,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight
    });
    await gravar('video/capturas/' + nome + '.png', await paraPng(canvas));
    return { arquivo: nome + '.png', w: r.width, h: r.height, px: [canvas.width, canvas.height] };
  }

  window.capturarPortal = async function (prefixo, escala) {
    await carregar(H2C);
    await document.fonts.ready;
    window.scrollTo(0, 0);

    // Fotografa o letreiro PARADO: o vídeo anima a faixa por conta própria.
    var parar = document.createElement('style');
    parar.textContent = '.mkt__list{animation:none!important;transform:none!important}';
    document.head.appendChild(parar);
    await new Promise(function (r) { setTimeout(r, 300); });

    var BG = '#F7F4EC';
    var mapa = { prefixo: prefixo, escala: escala, largura: document.documentElement.clientWidth, capturas: {} };

    // Topo: cartões de defasagem + painel lateral (inclui a faixa por polo).
    var topo = document.getElementById('topo');
    var c = await foto(prefixo + '_topo', topo, escala, '#0E2A47');
    var polo = Array.prototype.find.call(document.querySelectorAll('.ticker-row'), function (e) {
      return /polo/i.test(e.textContent);
    });
    c.destaques = {
      diesel: rel(topo, document.querySelector('.product')),
      ticker: rel(topo, document.getElementById('ticker')),
      polo: polo ? rel(topo, polo) : null
    };
    mapa.capturas.topo = c;

    // Painel: gráfico, preços por região (ANP), bomba e estados.
    var painel = document.getElementById('painel');
    c = await foto(prefixo + '_painel', painel, escala, BG);
    c.destaques = {
      grafico: rel(painel, document.getElementById('grafico').closest('.card')),
      regioes: rel(painel, document.getElementById('polos').closest('.card')),
      bomba: rel(painel, document.getElementById('bomba').closest('.card')),
      estados: rel(painel, document.getElementById('extremos').closest('.card'))
    };
    mapa.capturas.painel = c;

    // Notícias, com cada editoria anotada.
    var noticias = document.getElementById('noticias');
    c = await foto(prefixo + '_noticias', noticias, escala, BG);
    c.destaques = {};
    Array.prototype.forEach.call(noticias.querySelectorAll('.news-col'), function (col) {
      var nome = (col.querySelector('h3') || {}).textContent || '';
      c.destaques[nome.toLowerCase()] = rel(noticias, col);
    });
    mapa.capturas.noticias = c;

    // Faixa de mercado: UMA volta dos indicadores, fora do contêiner que corta.
    // Uma volta emenda com ela mesma, então o vídeo a repete lado a lado.
    var palco = document.createElement('div');
    palco.className = 'mkt';
    palco.style.cssText = 'position:absolute;left:0;top:0;width:max-content;z-index:9999;border:0;';
    var ul = document.createElement('ul');
    ul.className = 'mkt__list';
    Array.prototype.forEach.call(document.querySelectorAll('#mercadoLista > li:not([aria-hidden])'), function (li) {
      ul.appendChild(li.cloneNode(true));
    });
    palco.appendChild(ul);
    document.body.appendChild(palco);
    // Resolução maior que a das seções: no vídeo a faixa aparece ampliada.
    c = await foto(prefixo + '_faixa', palco, Math.max(escala, 5), '#FFFFFF');
    palco.remove();
    mapa.capturas.faixa = c;

    mapa.meta = {
      data: (window.DADOS && window.DADOS.meta && window.DADOS.meta.dataISO) || null,
      fonte: (window.DADOS && window.DADOS.meta && window.DADOS.meta.fonte) || null
    };
    await gravar('video/capturas/' + prefixo + '_mapa.json', JSON.stringify(mapa, null, 2));
    parar.remove();
    return mapa;
  };

  window.capturarJornal = async function (escala) {
    await carregar(H2C);
    await document.fonts.ready;
    window.scrollTo(0, 0);
    var folha = document.querySelector('.folha');
    var c = await foto('jornal', folha, escala, '#FBF9F4');
    await gravar('video/capturas/jornal_mapa.json', JSON.stringify(c, null, 2));
    return c;
  };
})();

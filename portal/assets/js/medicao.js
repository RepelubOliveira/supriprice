/* ==========================================================================
   SupriPrice — medição de audiência (Google Analytics 4)

   O Google Analytics usa cookies: só é ligado para quem ACEITAR na barra do
   rodapé (LGPD). A resposta fica guardada no navegador; quem recusar não é
   medido e não vê a barra de novo. Sem anúncios e sem sinais do Google
   (allow_google_signals: false): serve só para contar visitas e saber de
   onde vêm (país, estado, cidade, origem).

   Outros scripts registram ações com window.spEvento('nome', { ... }), que
   não faz nada enquanto não houver consentimento.
   ========================================================================== */
(function () {
  'use strict';

  var ID = 'G-8F90TTKC9Y';
  var CHAVE = 'sp-consentimento'; // 'sim' | 'nao'
  // Só mede no endereço do site: testes no computador não entram na conta
  // (para testar: localStorage.setItem('sp-ga-local', '1')).
  var PRODUCAO = /(^|\.)supriprice\.(com\.br|htmly\.com\.br)$/.test(location.hostname);

  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } }

  var ligado = false;
  window.spEvento = function () { /* sem consentimento: não mede */ };

  // Nome curto da página SÓ para o Google Analytics (relatórios e explorações:
  // "Título da página"). O título da aba e o que o Google mostra na busca
  // continuam os do HTML.
  function nomePagina() {
    var p = location.pathname;
    if (/market-share\.html$/.test(p)) return 'Market share';
    var j = p.match(/jornal-(\d{4})-(\d{2})-(\d{2})\.html$/);
    if (j) return 'Jornal ' + j[3] + '/' + j[2] + '/' + j[1];
    return 'Início';
  }

  // Seções vistas (rolou até elas), uma vez por visita à página. Nomes em
  // português, sem acento e sem espaço (regra do Google Analytics).
  var SECOES = {
    painel: 'viu_grafico', share: 'viu_market_share', jornal: 'viu_jornal',
    noticias: 'viu_noticias', arquivo: 'viu_arquivo',
    previa: 'viu_previa', msMerc: 'viu_rankings', msEvo: 'viu_evolucao'
  };
  function observarSecoes() {
    if (!('IntersectionObserver' in window)) return;
    var obs = new IntersectionObserver(function (itens) {
      itens.forEach(function (it) {
        if (!it.isIntersecting) return;
        obs.unobserve(it.target);
        window.spEvento(SECOES[it.target.id], { pagina: nomePagina() });
      });
    }, { threshold: 0.25 });
    Object.keys(SECOES).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  }

  function ligar() {
    // Teste no computador sem mandar nada ao Google:
    // localStorage.setItem('sp-ga-local', 'teste') → os eventos saem no console.
    if (!ligado && !PRODUCAO && ler('sp-ga-local') === 'teste') {
      ligado = true;
      window.spEvento = function (nome, params) { console.info('[GA teste]', nome, params || {}); };
      console.info('[GA teste] page_view', { page_title: nomePagina() });
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observarSecoes);
      else observarSecoes();
      return;
    }
    if (ligado || !(PRODUCAO || ler('sp-ga-local') === '1')) return;
    ligado = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ID, {
      page_title: nomePagina(),
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
    window.spEvento = function (nome, params) {
      try { window.gtag('event', nome, params || {}); } catch (e) { /* nunca quebra a página */ }
    };
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    document.head.appendChild(s);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observarSecoes);
    else observarSecoes();
  }

  /** Apaga os cookies do Google Analytics (_ga, _ga_XXXX) deste site. */
  function apagarCookies() {
    var dominios = ['', location.hostname, '.' + location.hostname.replace(/^www\./, '')];
    document.cookie.split(';').forEach(function (c) {
      var nome = c.split('=')[0].trim();
      if (!/^_ga/.test(nome)) return;
      dominios.forEach(function (d) {
        document.cookie = nome + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
      });
    });
  }

  function fecharBarra(barra, resposta) {
    gravar(CHAVE, resposta);
    if (resposta === 'sim') ligar();
    else if (ligado) { // aceitou antes e agora recusou: desliga de vez
      // Para o Google ANTES de apagar: senão ele regrava o cookie ao sair.
      window['ga-disable-' + ID] = true;
      try { window.gtag('consent', 'update', { analytics_storage: 'denied' }); } catch (e) {}
      apagarCookies();
      location.reload();
      return;
    }
    barra.classList.remove('is-on');
    setTimeout(function () {
      if (barra.parentNode) barra.parentNode.removeChild(barra);
      // O pop-up de novidades espera a barra sair para não disputar o rodapé.
      document.dispatchEvent(new CustomEvent('sp:consentimento-fechado'));
    }, 250);
  }

  function mostrarBarra() {
    var barra = document.createElement('div');
    barra.className = 'consentimento';
    barra.setAttribute('role', 'region');
    barra.setAttribute('aria-label', 'Aviso de cookies');
    // Montada com createElement, sem HTML em texto: o HTMLy recusa um .js
    // que "pareça" HTML (detector de tipo de arquivo).
    function el(tag, attrs, filhos) {
      var e = document.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      (filhos || []).forEach(function (f) { e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
      return e;
    }
    var linkPrivacidade = document.getElementById('privacidade') ? '#privacidade' : './#privacidade';
    barra.appendChild(el('p', {}, [
      'Usamos cookies do Google Analytics só para contar visitas e saber de quais regiões o site é acessado. ' +
      'Não identificamos você nem usamos para anúncios. ',
      el('a', { href: linkPrivacidade }, ['Saiba mais']), '.'
    ]));
    barra.appendChild(el('div', { 'class': 'consentimento__botoes' }, [
      el('button', { type: 'button', 'class': 'btn btn--ghost', 'data-resposta': 'nao' }, ['Recusar']),
      el('button', { type: 'button', 'class': 'btn btn--brand', 'data-resposta': 'sim' }, ['Aceitar'])
    ]));
    barra.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-resposta]');
      if (b) fecharBarra(barra, b.getAttribute('data-resposta'));
    });
    document.body.appendChild(barra);
    window.spConsentimentoPendente = true;
    requestAnimationFrame(function () { barra.classList.add('is-on'); });
  }

  var resposta = ler(CHAVE);
  if (resposta === 'sim') ligar();
  else if (resposta === 'nao') apagarCookies(); // sobra de quando tinha aceitado
  else {
    window.spConsentimentoPendente = true;
    if (document.body) mostrarBarra();
    else document.addEventListener('DOMContentLoaded', mostrarBarra);
  }
  document.addEventListener('sp:consentimento-fechado', function () { window.spConsentimentoPendente = false; });

  // "Rever cookies" no rodapé: mostra a barra de novo.
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-rever-consentimento]');
    if (!b || document.querySelector('.consentimento')) return;
    mostrarBarra();
  });
})();

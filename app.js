/* Mural da Coleta — lógica do site.
   Script clássico, sem módulos, para que o arquivo também abra por duplo clique.
   O Firebase só é carregado quando firebase-config.js estiver preenchido. */

(function () {
  "use strict";

  /* ============================================================
     1. Constantes
     ============================================================ */

  var PADROES = {
    saldoInicial: 15,
    duracaoMax: 40,
    minCodigo: 6,
    maxCredito: 5
  };

  var NIVEIS = [
    "Mestrando ou mestranda",
    "Doutorando ou doutoranda",
    "Graduando em TCC",
    "Docente ou pesquisador",
    "Outro vínculo"
  ];

  // Uma pesquisa de D minutos vale de 1 a 5 créditos: 1 crédito a cada 5
  // minutos arredondados para cima. A mesma conta define o que o
  // respondente ganha e o que a pesquisa paga por resposta recebida.
  // Precisa ser idêntica à função valor() de firestore.rules.
  function valorEmCreditos(minutos) {
    var m = Number(minutos) || 1;
    return Math.min(PADROES.maxCredito, Math.max(1, Math.ceil(m / 5)));
  }

  /* ============================================================
     2. Utilidades
     ============================================================ */

  var $ = function (sel, raiz) { return (raiz || document).querySelector(sel); };
  var alvo = document.getElementById("conteudo");

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function linkSeguro(url) {
    var u = String(url || "").trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (u.indexOf("#/") === 0) return u;
    return "";
  }

  function plural(n, um, muitos) {
    return n === 1 ? n + " " + um : n + " " + muitos;
  }

  function dataCurta(ms) {
    if (!ms) return "—";
    var d = new Date(ms);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function recado(texto, tipo) {
    var caixa = document.getElementById("recados");
    var el = document.createElement("div");
    el.className = "recado" + (tipo ? " recado-" + tipo : "");
    el.textContent = texto;
    caixa.appendChild(el);
    setTimeout(function () { el.remove(); }, tipo === "erro" ? 7000 : 4200);
  }

  function hashCodigo(pesquisaId, codigo) {
    var texto = pesquisaId + ":" + String(codigo || "").trim().toUpperCase();
    var bytes = new TextEncoder().encode(texto);
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error("Este navegador não permite gerar a impressão digital do código. Abra o site por https."));
    }
    return window.crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  function csv(linhas) {
    return "﻿" + linhas.map(function (l) {
      return l.map(function (c) {
        var t = String(c == null ? "" : c);
        return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      }).join(";");
    }).join("\r\n");
  }

  function baixar(nome, texto) {
    var url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
    var a = document.createElement("a");
    a.href = url; a.download = nome; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function semCredito(p) {
    return Number(p.creditos || 0) < valorEmCreditos(p.duracaoMin);
  }

  /* ============================================================
     3. Armazém em modo demonstração (só este navegador)
     ============================================================ */

  function criarArmazemDemo() {
    var CHAVE = "mural-da-coleta/demo";
    var banco = ler();

    function ler() {
      try {
        var b = JSON.parse(localStorage.getItem(CHAVE) || "null");
        if (b && b.pesquisas) return b;
      } catch (e) { /* banco corrompido: recomeça */ }
      return semear();
    }

    function semear() {
      var b = { pesquisas: {}, pesquisadores: {}, participacoes: {}, sessao: null, config: { saldoInicial: PADROES.saldoInicial } };
      (window.EXEMPLOS || []).forEach(function (ex) {
        var p = JSON.parse(JSON.stringify(ex));
        p.autorUid = "exemplo";
        p.codigoHash = "";
        p.criadoEm = Date.now() - (1 + Math.random() * 40) * 86400000;
        p.ultimaParticipacao = p.criadoEm;
        b.pesquisas[p.id] = p;
      });
      return b;
    }

    function salvar() {
      try { localStorage.setItem(CHAVE, JSON.stringify(banco)); }
      catch (e) { recado("Não foi possível salvar neste navegador.", "erro"); }
    }

    // Em modo demonstração o banco vive no navegador, e duas abas abertas
    // teriam cópias diferentes. Antes de ler ou gravar qualquer coisa, a
    // aba busca a versão mais recente e mantém apenas a própria sessão.
    function sincronizar() {
      var sessao = banco ? banco.sessao : null;
      banco = ler();
      banco.sessao = sessao;
    }

    var ouvintes = [];
    function avisar() { ouvintes.forEach(function (f) { f(banco.sessao); }); }

    function espera(v) { return Promise.resolve(v); }

    return {
      modo: "demo",
      iniciar: function () { return espera(); },
      onAuth: function (f) { ouvintes.push(f); f(banco.sessao); },
      usuario: function () { return banco.sessao; },

      cadastrar: function (d) {
        sincronizar();
        var uid = "demo-" + Date.now().toString(36);
        banco.pesquisadores[uid] = {
          uid: uid, nome: d.nome, email: d.email, nivel: d.nivel, programa: d.programa,
          instituicao: d.instituicao, lattes: d.lattes || "", creditos: PADROES.saldoInicial,
          bloqueado: false, criadoEm: Date.now()
        };
        banco.sessao = { uid: uid, email: d.email };
        salvar(); avisar();
        return espera();
      },
      entrar: function (email) {
        sincronizar();
        var achou = null;
        Object.keys(banco.pesquisadores).forEach(function (uid) {
          if (banco.pesquisadores[uid].email === email) achou = uid;
        });
        if (!achou) return Promise.reject(new Error("Em modo demonstração, use o mesmo e-mail que você cadastrou neste navegador, ou crie um cadastro."));
        banco.sessao = { uid: achou, email: email };
        salvar(); avisar();
        return espera();
      },
      sair: function () { banco.sessao = null; salvar(); avisar(); return espera(); },
      recuperarSenha: function () { return Promise.reject(new Error("Em modo demonstração não há envio de e-mail.")); },

      souAdmin: function () { return espera(!!banco.sessao); },
      minhaFicha: function () {
        sincronizar();
        return espera(banco.sessao ? banco.pesquisadores[banco.sessao.uid] : null);
      },
      salvarFicha: function (campos) {
        sincronizar();
        var f = banco.pesquisadores[banco.sessao.uid];
        Object.keys(campos).forEach(function (k) { f[k] = campos[k]; });
        salvar(); return espera();
      },

      novoId: function () { return "p-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
      listarPesquisas: function () {
        sincronizar();
        return espera(Object.keys(banco.pesquisas).map(function (id) { return banco.pesquisas[id]; }));
      },
      obterPesquisa: function (id) {
        sincronizar();
        return espera(banco.pesquisas[id] || null);
      },
      obterParticipacao: function (pesquisaId) {
        sincronizar();
        if (!banco.sessao) return espera(null);
        return espera(banco.participacoes[pesquisaId + "__" + banco.sessao.uid] || null);
      },
      criarPesquisa: function (p) {
        sincronizar();
        banco.pesquisas[p.id] = p;
        banco.pesquisadores[banco.sessao.uid].creditos -= Number(p.creditos || 0);
        salvar(); return espera();
      },
      salvarPesquisa: function (id, campos) {
        sincronizar();
        var p = banco.pesquisas[id];
        if (!p) return Promise.reject(new Error("Pesquisa não encontrada."));
        Object.keys(campos).forEach(function (k) { p[k] = campos[k]; });
        salvar(); return espera();
      },
      excluirPesquisa: function (id) {
        sincronizar();
        delete banco.pesquisas[id];
        Object.keys(banco.participacoes).forEach(function (k) {
          if (banco.participacoes[k].pesquisaId === id) delete banco.participacoes[k];
        });
        salvar(); return espera();
      },
      alocarCreditos: function (id, n) {
        sincronizar();
        var f = banco.pesquisadores[banco.sessao.uid];
        if (f.creditos < n) return Promise.reject(new Error("Saldo insuficiente."));
        f.creditos -= n;
        banco.pesquisas[id].creditos = Number(banco.pesquisas[id].creditos || 0) + n;
        salvar(); return espera();
      },
      registrarParticipacao: function (p, hash) {
        sincronizar();
        var uid = banco.sessao.uid;
        var pid = p.id + "__" + uid;
        if (banco.participacoes[pid]) return Promise.reject(new Error("codigo-errado"));
        if (!p.codigoHash || p.codigoHash !== hash) return Promise.reject(new Error("codigo-errado"));
        var ganho = valorEmCreditos(p.duracaoMin);
        banco.participacoes[pid] = {
          id: pid, pesquisaId: p.id, pesquisaTitulo: p.titulo, respondenteUid: uid,
          autorUid: p.autorUid, creditos: ganho, codigoHash: hash, criadoEm: Date.now()
        };
        banco.pesquisadores[uid].creditos += ganho;
        var ref = banco.pesquisas[p.id];
        ref.respostasRecebidas = Number(ref.respostasRecebidas || 0) + 1;
        ref.creditos = Math.max(0, Number(ref.creditos || 0) - ganho);
        ref.ultimaParticipacao = Date.now();
        salvar();
        return espera(ganho);
      },
      minhasParticipacoes: function () {
        sincronizar();
        var uid = banco.sessao && banco.sessao.uid;
        return espera(Object.keys(banco.participacoes).map(function (k) { return banco.participacoes[k]; })
          .filter(function (x) { return x.respondenteUid === uid; }));
      },
      listarParticipacoes: function () {
        sincronizar();
        return espera(Object.keys(banco.participacoes).map(function (k) { return banco.participacoes[k]; }));
      },
      listarPesquisadores: function () {
        sincronizar();
        return espera(Object.keys(banco.pesquisadores).map(function (k) { return banco.pesquisadores[k]; }));
      },
      salvarPesquisador: function (uid, campos) {
        sincronizar();
        var f = banco.pesquisadores[uid];
        if (f) Object.keys(campos).forEach(function (k) { f[k] = campos[k]; });
        salvar(); return espera();
      },
      obterConfig: function () {
        sincronizar();
        return espera(banco.config);
      },
      salvarConfig: function (c) {
        sincronizar();
        banco.config = c; salvar(); return espera();
      },
      apagarExemplos: function () {
        sincronizar();
        Object.keys(banco.pesquisas).forEach(function (id) {
          if (banco.pesquisas[id].exemplo) delete banco.pesquisas[id];
        });
        salvar(); return espera();
      },
      publicarExemplos: function () {
        sincronizar();
        (window.EXEMPLOS || []).forEach(function (ex) {
          if (!banco.pesquisas[ex.id]) {
            var p = JSON.parse(JSON.stringify(ex));
            p.autorUid = "exemplo"; p.codigoHash = ""; p.criadoEm = Date.now();
            banco.pesquisas[p.id] = p;
          }
        });
        salvar(); return espera();
      },
      zerar: function () { localStorage.removeItem(CHAVE); banco = semear(); salvar(); avisar(); return espera(); }
    };
  }

  /* ============================================================
     4. Armazém no Firebase
     ============================================================ */

  function criarArmazemFirebase() {
    var fb = {};
    var ouvintes = [];
    var usuarioAtual = null;
    var fichaCache = null;
    var ehAdminCache = null;

    function base() { return "https://www.gstatic.com/firebasejs/10.12.2/"; }

    function iniciar() {
      return Promise.all([
        import(base() + "firebase-app.js"),
        import(base() + "firebase-auth.js"),
        import(base() + "firebase-firestore.js")
      ]).then(function (mods) {
        fb.app = mods[0]; fb.auth = mods[1]; fb.fs = mods[2];
        var app = fb.app.initializeApp(window.FIREBASE_CONFIG);
        fb.a = fb.auth.getAuth(app);
        fb.db = fb.fs.getFirestore(app);
        return new Promise(function (resolve) {
          var primeira = true;
          fb.auth.onAuthStateChanged(fb.a, function (u) {
            usuarioAtual = u ? { uid: u.uid, email: u.email } : null;
            fichaCache = null; ehAdminCache = null;
            ouvintes.forEach(function (f) { f(usuarioAtual); });
            if (primeira) { primeira = false; resolve(); }
          });
        });
      });
    }

    function doc(col, id) { return fb.fs.doc(fb.db, col, id); }
    function col(nome) { return fb.fs.collection(fb.db, nome); }

    function pegar(col_, id) {
      return fb.fs.getDoc(doc(col_, id)).then(function (s) {
        return s.exists() ? Object.assign({ id: s.id }, s.data()) : null;
      });
    }

    function pegarTodos(consulta) {
      return fb.fs.getDocs(consulta).then(function (q) {
        return q.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      });
    }

    function traduzErro(e) {
      var c = (e && e.code) || "";
      if (c === "auth/invalid-credential" || c === "auth/wrong-password" || c === "auth/user-not-found") {
        return new Error("E-mail ou senha não conferem.");
      }
      if (c === "auth/email-already-in-use") return new Error("Já existe cadastro com este e-mail. Use a opção de entrar.");
      if (c === "auth/weak-password") return new Error("A senha precisa ter pelo menos seis caracteres.");
      if (c === "auth/invalid-email") return new Error("Esse e-mail não parece válido.");
      if (c === "auth/too-many-requests") return new Error("Muitas tentativas seguidas. Espere alguns minutos.");
      if (c === "permission-denied") return new Error("O banco recusou a operação. Confira se as regras do Firestore foram publicadas.");
      return e instanceof Error ? e : new Error(String(e));
    }

    return {
      modo: "firebase",
      iniciar: iniciar,
      onAuth: function (f) { ouvintes.push(f); f(usuarioAtual); },
      usuario: function () { return usuarioAtual; },

      cadastrar: function (d) {
        return fb.auth.createUserWithEmailAndPassword(fb.a, d.email, d.senha).then(function (cred) {
          return fb.fs.setDoc(doc("pesquisadores", cred.user.uid), {
            nome: d.nome, email: d.email, nivel: d.nivel, programa: d.programa,
            instituicao: d.instituicao, lattes: d.lattes || "",
            creditos: PADROES.saldoInicial, bloqueado: false, criadoEm: Date.now()
          });
        }).catch(function (e) { throw traduzErro(e); });
      },
      entrar: function (email, senha) {
        return fb.auth.signInWithEmailAndPassword(fb.a, email, senha)
          .catch(function (e) { throw traduzErro(e); });
      },
      sair: function () { return fb.auth.signOut(fb.a); },
      recuperarSenha: function (email) {
        return fb.auth.sendPasswordResetEmail(fb.a, email).catch(function (e) { throw traduzErro(e); });
      },

      souAdmin: function () {
        if (!usuarioAtual) return Promise.resolve(false);
        if (ehAdminCache !== null) return Promise.resolve(ehAdminCache);
        return pegar("admins", usuarioAtual.uid).then(function (d) {
          ehAdminCache = !!d; return ehAdminCache;
        }).catch(function () { return false; });
      },
      minhaFicha: function () {
        if (!usuarioAtual) return Promise.resolve(null);
        if (fichaCache) return Promise.resolve(fichaCache);
        return pegar("pesquisadores", usuarioAtual.uid).then(function (d) {
          if (d) { d.uid = usuarioAtual.uid; fichaCache = d; }
          return d;
        });
      },
      salvarFicha: function (campos) {
        campos.atualizadoEm = Date.now();
        fichaCache = null;
        return fb.fs.updateDoc(doc("pesquisadores", usuarioAtual.uid), campos)
          .catch(function (e) { throw traduzErro(e); });
      },

      novoId: function () { return fb.fs.doc(col("pesquisas")).id; },
      listarPesquisas: function () {
        return pegarTodos(col("pesquisas")).catch(function (e) { throw traduzErro(e); });
      },
      obterPesquisa: function (id) { return pegar("pesquisas", id); },
      obterParticipacao: function (pesquisaId) {
        if (!usuarioAtual) return Promise.resolve(null);
        return pegar("participacoes", pesquisaId + "__" + usuarioAtual.uid)
          .catch(function () { return null; });
      },
      criarPesquisa: function (p) {
        var lote = fb.fs.writeBatch(fb.db);
        var copia = Object.assign({}, p);
        delete copia.id;
        lote.set(doc("pesquisas", p.id), copia);
        lote.update(doc("pesquisadores", usuarioAtual.uid), {
          creditos: fb.fs.increment(-Number(p.creditos || 0)), atualizadoEm: Date.now()
        });
        fichaCache = null;
        return lote.commit().catch(function (e) { throw traduzErro(e); });
      },
      salvarPesquisa: function (id, campos) {
        return fb.fs.updateDoc(doc("pesquisas", id), campos).catch(function (e) { throw traduzErro(e); });
      },
      excluirPesquisa: function (id) {
        return fb.fs.deleteDoc(doc("pesquisas", id)).catch(function (e) { throw traduzErro(e); });
      },
      alocarCreditos: function (id, n) {
        var lote = fb.fs.writeBatch(fb.db);
        lote.update(doc("pesquisadores", usuarioAtual.uid), { creditos: fb.fs.increment(-n), atualizadoEm: Date.now() });
        lote.update(doc("pesquisas", id), { creditos: fb.fs.increment(n) });
        fichaCache = null;
        return lote.commit().catch(function (e) { throw traduzErro(e); });
      },
      registrarParticipacao: function (p, hash) {
        var uid = usuarioAtual.uid;
        var pid = p.id + "__" + uid;
        var ganho = valorEmCreditos(p.duracaoMin);
        var lote = fb.fs.writeBatch(fb.db);
        lote.set(doc("participacoes", pid), {
          pesquisaId: p.id, pesquisaTitulo: p.titulo, respondenteUid: uid,
          autorUid: p.autorUid, creditos: ganho, codigoHash: hash, criadoEm: Date.now()
        });
        lote.update(doc("pesquisadores", uid), {
          creditos: fb.fs.increment(ganho), ultimaParticipacao: pid, atualizadoEm: Date.now()
        });
        lote.update(doc("pesquisas", p.id), {
          respostasRecebidas: fb.fs.increment(1),
          creditos: fb.fs.increment(-ganho),
          ultimaParticipacao: Date.now()
        });
        fichaCache = null;
        return lote.commit().then(function () { return ganho; }).catch(function (e) {
          // A regra do Firestore recusa tudo de uma vez; o motivo mais comum
          // é código errado ou participação repetida.
          if (e && e.code === "permission-denied") throw new Error("codigo-errado");
          throw traduzErro(e);
        });
      },
      minhasParticipacoes: function () {
        return pegarTodos(fb.fs.query(col("participacoes"),
          fb.fs.where("respondenteUid", "==", usuarioAtual.uid)));
      },
      listarParticipacoes: function () { return pegarTodos(col("participacoes")); },
      listarPesquisadores: function () {
        return pegarTodos(col("pesquisadores")).then(function (l) {
          return l.map(function (d) { d.uid = d.id; return d; });
        });
      },
      salvarPesquisador: function (uid, campos) {
        return fb.fs.updateDoc(doc("pesquisadores", uid), campos).catch(function (e) { throw traduzErro(e); });
      },
      obterConfig: function () {
        return pegar("config", "geral").then(function (c) { return c || { saldoInicial: PADROES.saldoInicial }; });
      },
      salvarConfig: function (c) {
        return fb.fs.setDoc(doc("config", "geral"), c, { merge: true }).catch(function (e) { throw traduzErro(e); });
      },
      apagarExemplos: function () {
        return pegarTodos(fb.fs.query(col("pesquisas"), fb.fs.where("exemplo", "==", true))).then(function (l) {
          var lote = fb.fs.writeBatch(fb.db);
          l.forEach(function (p) { lote.delete(doc("pesquisas", p.id)); });
          return lote.commit();
        }).catch(function (e) { throw traduzErro(e); });
      },
      publicarExemplos: function () {
        var lote = fb.fs.writeBatch(fb.db);
        (window.EXEMPLOS || []).forEach(function (ex) {
          var p = JSON.parse(JSON.stringify(ex));
          var id = p.id; delete p.id;
          p.autorUid = "exemplo"; p.codigoHash = "";
          p.criadoEm = Date.now();
          lote.set(doc("pesquisas", id), p, { merge: true });
        });
        return lote.commit().catch(function (e) { throw traduzErro(e); });
      }
    };
  }

  /* ============================================================
     5. Estado
     ============================================================ */

  var Dados = null;
  var estado = {
    usuario: null,
    ficha: null,
    admin: false,
    pesquisas: [],
    filtro: { area: "", duracao: "", busca: "" },
    carregadoEm: 0
  };

  function configurado() {
    var c = window.FIREBASE_CONFIG || {};
    return !!c.apiKey && String(c.apiKey).indexOf("COLE_AQUI") !== 0;
  }

  function carregarPesquisas(forcar) {
    if (!forcar && estado.pesquisas.length && Date.now() - estado.carregadoEm < 20000) {
      return Promise.resolve(estado.pesquisas);
    }
    return Dados.listarPesquisas().then(function (l) {
      estado.pesquisas = l;
      estado.carregadoEm = Date.now();
      return l;
    });
  }

  function atualizarFicha() {
    if (!estado.usuario) { estado.ficha = null; estado.admin = false; return Promise.resolve(); }
    return Promise.all([Dados.minhaFicha(), Dados.souAdmin()]).then(function (r) {
      estado.ficha = r[0];
      estado.admin = r[1];
    });
  }

  /* ============================================================
     6. Peças de tela
     ============================================================ */

  function carimboEtica(p) {
    if (p.status === "encerrada") {
      return '<span class="carimbo carimbo-encerrado carimbo-canto">Coleta encerrada</span>';
    }
    if (p.temCaae && p.caae) {
      return '<span class="carimbo carimbo-selo carimbo-canto">Aprovada em CEP' +
        '<span class="linha2">CAAE ' + esc(p.caae) + '</span></span>';
    }
    return "";
  }

  // No mural, cada etiqueta precisa distinguir uma pesquisa das outras.
  // O TCLE, declarado por todas, fica para a ficha; o valor em créditos só
  // aparece para quem está logado, que é quem usa esse número.
  function fichaDados(p) {
    var itens = [];
    itens.push('<span class="dado dado-forte">' + esc(p.duracaoMin) + " min</span>");
    itens.push('<span class="dado">' + esc(p.area) + "</span>");
    itens.push('<span class="dado">' + esc(p.publico) + "</span>");
    if (estado.usuario && p.status === "ativa") {
      itens.push('<span class="dado">' +
        (semCredito(p) ? "sem créditos agora" : "rende " + plural(valorEmCreditos(p.duracaoMin), "crédito", "créditos")) +
        "</span>");
    } else if (p.status === "ativa" && semCredito(p)) {
      itens.push('<span class="dado dado-aviso">sem créditos</span>');
    }
    if (p.exemplo) itens.push('<span class="dado dado-exemplo">exemplo fictício</span>');
    return '<div class="ficha">' + itens.join("") + "</div>";
  }

  function folhaPesquisa(p) {
    var classes = "folha";
    if (p.status === "encerrada") classes += " folha-encerrada";
    else if (semCredito(p)) classes += " folha-sem-credito";
    var meta = Number(p.metaRespostas || 0);
    var recebidas = Number(p.respostasRecebidas || 0);
    var progresso = meta ? recebidas + " de " + meta + " respostas pela plataforma" : plural(recebidas, "resposta", "respostas") + " pela plataforma";

    return '<article class="' + classes + '">' +
      carimboEtica(p) +
      '<h3 class="folha-titulo"><a href="#/pesquisa/' + esc(p.id) + '">' + esc(p.titulo) + "</a></h3>" +
      '<p class="folha-autor">' + esc(p.autorNome || "Pesquisador não identificado") +
        (p.autorInstituicao ? ", " + esc(p.autorInstituicao) : "") + "</p>" +
      '<p class="folha-resumo">' + esc(p.resumo) + "</p>" +
      fichaDados(p) +
      '<div class="folha-pe">' +
        (p.status === "ativa"
          ? '<a class="btn btn-mini btn-vazio" href="#/pesquisa/' + esc(p.id) + '">Ver e responder</a>'
          : '<a class="btn btn-mini btn-discreto" href="#/pesquisa/' + esc(p.id) + '">Ver a ficha</a>') +
        '<span class="contagem">' + esc(progresso) + "</span>" +
      "</div></article>";
  }

  /* ============================================================
     7. Mural
     ============================================================ */

  function verMural() {
    pintar('<p class="sumario">Carregando as pesquisas do mural.</p>');
    carregarPesquisas().then(function (lista) {
      var f = estado.filtro;
      var filtradas = lista.filter(function (p) {
        if (f.area && p.area !== f.area) return false;
        if (f.duracao === "curta" && p.duracaoMin > 10) return false;
        if (f.duracao === "media" && (p.duracaoMin <= 10 || p.duracaoMin > 20)) return false;
        if (f.duracao === "longa" && p.duracaoMin <= 20) return false;
        if (f.busca) {
          var t = (p.titulo + " " + p.resumo + " " + (p.autorInstituicao || "")).toLowerCase();
          if (t.indexOf(f.busca.toLowerCase()) === -1) return false;
        }
        return true;
      });

      var ordem = function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); };
      var destaque = filtradas.filter(function (p) { return p.status === "ativa" && !semCredito(p); }).sort(ordem);
      var fila = filtradas.filter(function (p) { return p.status === "ativa" && semCredito(p); }).sort(ordem);
      var fechadas = filtradas.filter(function (p) { return p.status !== "ativa"; }).sort(ordem);

      var abertas = lista.filter(function (p) { return p.status === "ativa"; }).length;
      var respostas = lista.reduce(function (s, p) { return s + Number(p.respostasRecebidas || 0); }, 0);

      var html = "";
      if (Dados.modo === "demo") {
        html += '<div class="aviso aviso-demo"><p><strong>Modo demonstração.</strong> ' +
          "O Firebase ainda não foi configurado, então tudo aqui fica salvo apenas neste navegador e as pesquisas abaixo são exemplos fictícios. " +
          "O passo a passo para ligar o banco online está no arquivo LEIA-ME.md.</p></div>";
      }

      html += '<div class="cabeca-secao"><h1>Mural de pesquisas abertas</h1>' +
        '<p class="contagem">' + plural(abertas, "pesquisa aberta", "pesquisas abertas") + ", " +
        plural(respostas, "resposta contabilizada", "respostas contabilizadas") + "</p></div>";

      html += '<p class="sumario">Responder não exige cadastro: escolha uma pesquisa, abra o questionário e pronto. ' +
        "Quem deposita o próprio instrumento de coleta entra na troca de créditos e responde ao de outras pessoas.</p>";

      html += '<form class="filtros" id="form-filtros">' +
        '<div class="campo"><label for="f-busca">Buscar no mural</label>' +
        '<input type="text" id="f-busca" name="busca" value="' + esc(f.busca) + '" placeholder="tema, palavra, instituição"></div>' +
        '<div class="campo"><label for="f-area">Área</label><select id="f-area" name="area">' +
        '<option value="">Todas as áreas</option>' +
        (window.AREAS || []).map(function (a) {
          return '<option value="' + esc(a) + '"' + (f.area === a ? " selected" : "") + ">" + esc(a) + "</option>";
        }).join("") + "</select></div>" +
        '<div class="campo"><label for="f-duracao">Tempo de resposta</label><select id="f-duracao" name="duracao">' +
        '<option value="">Qualquer tempo</option>' +
        '<option value="curta"' + (f.duracao === "curta" ? " selected" : "") + ">Até 10 minutos</option>" +
        '<option value="media"' + (f.duracao === "media" ? " selected" : "") + ">De 11 a 20 minutos</option>" +
        '<option value="longa"' + (f.duracao === "longa" ? " selected" : "") + ">Mais de 20 minutos</option>" +
        "</select></div>" +
        '<button class="btn" type="submit">Filtrar</button>' +
        (f.area || f.duracao || f.busca ? '<button class="btn btn-discreto" type="button" id="limpar-filtros">Limpar</button>' : "") +
        "</form>";

      if (!filtradas.length) {
        html += '<div class="vazio"><p>Nenhuma pesquisa corresponde a esse filtro. ' +
          'Tente ampliar a busca ou <a href="#/depositar">deposite a sua</a>.</p></div>';
      }

      if (destaque.length) html += destaque.map(folhaPesquisa).join("");

      if (fila.length) {
        html += '<hr class="divisor"><div class="cabeca-secao"><h2>Sem créditos no momento</h2>' +
          '<p class="contagem">' + plural(fila.length, "pesquisa", "pesquisas") + "</p></div>" +
          '<p class="sumario">Estas pesquisas continuam abertas e qualquer pessoa pode responder. ' +
          "Elas saíram do topo porque o autor gastou os créditos e ainda não respondeu a outras pesquisas para recarregar. " +
          "Respondê-las agora não rende créditos.</p>" +
          fila.map(folhaPesquisa).join("");
      }

      if (fechadas.length) {
        html += '<hr class="divisor"><div class="cabeca-secao"><h2>Coletas encerradas</h2>' +
          '<p class="contagem">' + plural(fechadas.length, "pesquisa", "pesquisas") + "</p></div>" +
          fechadas.map(folhaPesquisa).join("");
      }

      pintar(html);

      var form = $("#form-filtros");
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        estado.filtro = {
          busca: form.busca.value.trim(),
          area: form.area.value,
          duracao: form.duracao.value
        };
        verMural();
      });
      var limpar = $("#limpar-filtros");
      if (limpar) limpar.addEventListener("click", function () {
        estado.filtro = { area: "", duracao: "", busca: "" };
        verMural();
      });
    }).catch(falhou);
  }

  /* ============================================================
     8. Ficha da pesquisa
     ============================================================ */

  function verPesquisa(id) {
    pintar('<p class="sumario">Abrindo a ficha da pesquisa.</p>');
    Promise.all([
      Dados.obterPesquisa(id),
      estado.usuario ? Dados.obterParticipacao(id) : Promise.resolve(null)
    ]).then(function (r) {
      var p = r[0];
      var jaRegistrou = r[1];
      if (!p) {
        pintar('<a class="voltar" href="#/mural">Voltar ao mural</a>' +
          '<div class="vazio"><p>Esta pesquisa não está mais no mural.</p></div>');
        return;
      }
      p.id = p.id || id;
      var custo = valorEmCreditos(p.duracaoMin);
      var link = linkSeguro(p.link);
      var sou = estado.usuario && estado.usuario.uid === p.autorUid;
      var podeGanhar = estado.usuario && !sou && !jaRegistrou &&
        p.status === "ativa" && !semCredito(p) && !p.exemplo;

      var html = '<a class="voltar" href="#/mural">Voltar ao mural</a>';

      html += '<div class="detalhe-topo">' + carimboEtica(p) +
        "<h1>" + esc(p.titulo) + "</h1>" +
        '<p class="folha-autor">' + esc(p.autorNome || "Pesquisador não identificado") +
        (p.autorInstituicao ? ", " + esc(p.autorInstituicao) : "") + "</p></div>";

      html += '<div class="detalhe-corpo"><p>' + esc(p.resumo) + "</p></div>";

      html += '<div class="bloco"><dl class="fichario">' +
        linhaFicha("Tempo estimado", esc(p.duracaoMin) + " minutos") +
        linhaFicha("Quem pode responder", esc(p.publico)) +
        linhaFicha("Área", esc(p.area)) +
        linhaFicha("Situação", p.status === "ativa" ? "Coleta aberta" : "Coleta encerrada") +
        linhaFicha("Ética em pesquisa", p.tcleDeclarado
          ? "O pesquisador declarou que o formulário apresenta o TCLE antes das perguntas." +
            (p.temCaae && p.caae ? " Parecer informado: CAAE " + esc(p.caae) + "." : " Parecer de CEP não informado.")
          : "Não declarado.") +
        linhaFicha("Respostas pela plataforma", plural(Number(p.respostasRecebidas || 0), "resposta", "respostas") +
          (p.metaRespostas ? " de uma meta de " + esc(p.metaRespostas) : "")) +
        linhaFicha("Vale para quem responde", plural(custo, "crédito", "créditos") +
          (p.status !== "ativa" ? " (coleta encerrada)" : semCredito(p) ? " (sem créditos agora)" : "")) +
        linhaFicha("No mural desde", dataCurta(p.criadoEm)) +
        "</dl></div>";

      if (p.exemplo) {
        html += '<div class="aviso aviso-demo"><p><strong>Esta é uma pesquisa de exemplo.</strong> ' +
          "Serve para o mural não nascer vazio. Não existe questionário por trás dela.</p></div>";
      }

      if (p.status === "ativa" && link) {
        html += '<div class="linha-botoes">' +
          '<a class="btn" href="' + esc(link) + '"' +
          (link.indexOf("#/") === 0 ? "" : ' target="_blank" rel="noopener noreferrer"') +
          ">Abrir o questionário</a>";
        if (podeGanhar) html += '<button class="btn btn-vazio" type="button" id="abrir-codigo">Já respondi, quero meus créditos</button>';
        html += "</div>";
        if (jaRegistrou) {
          html += '<div class="bloco"><span class="carimbo carimbo-registrado">Participação registrada</span>' +
            '<p class="sumario" style="margin-top:1rem">Você registrou participação nesta pesquisa em ' +
            dataCurta(jaRegistrou.criadoEm) + " e recebeu " +
            plural(Number(jaRegistrou.creditos || 0), "crédito", "créditos") +
            ". Cada pesquisa conta uma vez por pessoa, então responder de novo não rende créditos.</p></div>";
        } else if (estado.usuario && !sou && !p.exemplo && semCredito(p)) {
          html += '<p class="sumario">Esta pesquisa está sem créditos, então respondê-la agora não rende créditos a você. ' +
            "Ela volta ao topo do mural quando o autor responder às pesquisas de outras pessoas.</p>";
        } else if (!estado.usuario && !p.exemplo) {
          html += '<p class="sumario">Você pode responder sem criar conta. ' +
            'Se também está coletando dados, <a href="#/entrar">crie um cadastro</a> para ganhar créditos ao responder e depositar sua pesquisa aqui.</p>';
        }
      } else if (p.status === "ativa") {
        html += '<div class="aviso aviso-erro"><p>O link do questionário está em branco ou inválido. ' +
          "Procure o pesquisador responsável.</p></div>";
      } else {
        html += '<p class="sumario">Esta coleta foi encerrada e o questionário não aceita mais respostas.</p>';
      }

      if (podeGanhar) {
        html += '<form class="bloco" id="form-codigo" hidden>' +
          "<h3>Registrar participação</h3>" +
          '<p class="sumario">Ao terminar o questionário, o pesquisador mostra um código de conclusão na última tela. ' +
          "Informe esse código para receber " + plural(custo, "crédito", "créditos") + ".</p>" +
          '<div class="campo"><label for="codigo">Código de conclusão</label>' +
          '<input type="text" id="codigo" name="codigo" autocomplete="off" spellcheck="false" required>' +
          '<p class="ajuda">Maiúsculas e minúsculas não importam.</p></div>' +
          '<div class="linha-botoes"><button class="btn" type="submit">Registrar e receber créditos</button></div>' +
          "</form>";
      }

      if (sou) {
        html += '<hr class="divisor"><div class="bloco"><h3>Esta pesquisa é sua</h3>' +
          '<p class="sumario">Créditos nesta pesquisa: <strong>' + esc(Number(p.creditos || 0)) + "</strong>. " +
          "Cada resposta de outro pesquisador consome " + plural(custo, "crédito", "créditos") + ".</p>" +
          '<div class="linha-botoes"><a class="btn btn-vazio" href="#/painel/pesquisas">Abrir meu painel</a>' +
          '<a class="btn btn-discreto" href="#/depositar/' + esc(p.id) + '">Editar a ficha</a></div></div>';
      }

      pintar(html);

      var botao = $("#abrir-codigo");
      var form = $("#form-codigo");
      if (botao && form) {
        botao.addEventListener("click", function () {
          form.hidden = false;
          botao.setAttribute("hidden", "");
          $("#codigo").focus();
        });
        form.addEventListener("submit", function (ev) {
          ev.preventDefault();
          var codigo = form.codigo.value.trim();
          if (codigo.length < 3) { recado("Informe o código de conclusão.", "erro"); return; }
          var enviar = $("button[type=submit]", form);
          enviar.disabled = true;
          hashCodigo(p.id, codigo)
            .then(function (h) { return Dados.registrarParticipacao(p, h); })
            .then(function (ganho) {
              estado.carregadoEm = 0;
              return atualizarFicha().then(function () {
                form.outerHTML = '<div class="bloco"><span class="carimbo carimbo-registrado bate">Participação registrada</span>' +
                  '<p class="sumario" style="margin-top:1rem">Você recebeu ' + plural(ganho, "crédito", "créditos") +
                  ". Saldo atual: <strong>" + esc(estado.ficha ? estado.ficha.creditos : ganho) + "</strong>. " +
                  '<a href="#/painel/extrato">Ver o extrato</a>.</p></div>';
                recado("Participação registrada. " + plural(ganho, "crédito", "créditos") + " na sua conta.", "ok");
              });
            })
            .catch(function (e) {
              enviar.disabled = false;
              if (e && e.message === "codigo-errado") {
                recado("O código não confere, ou você já registrou participação nesta pesquisa.", "erro");
              } else {
                recado(e.message || "Não foi possível registrar.", "erro");
              }
            });
        });
      }
    }).catch(falhou);
  }

  function linhaFicha(rotulo, valor) {
    return "<div><dt>" + rotulo + "</dt><dd>" + valor + "</dd></div>";
  }

  /* ============================================================
     9. Como funciona
     ============================================================ */

  function verComoFunciona() {
    var html = "<h1>Como funciona</h1>" +
      '<p class="sumario">O Mural da Coleta junta, em um só lugar, os questionários de pesquisa que estão abertos a respostas no Brasil. ' +
      "Ele não hospeda questionário nem guarda resposta: cada pesquisa continua no formulário de quem a criou.</p>";

    html += '<div class="bloco"><h2>Para quem só quer ajudar</h2>' +
      "<p>Não é preciso criar conta. Abra o mural, escolha uma pesquisa pelo tema ou pelo tempo que você tem, " +
      "clique em abrir o questionário e responda no formulário do pesquisador. Nada seu fica neste site.</p></div>";

    html += '<div class="bloco"><h2>Para quem está coletando dados</h2>' +
      "<p>Quem deposita um instrumento de coleta cria um cadastro e entra na troca de créditos. " +
      "O cadastro pede o vínculo declarado: nível, programa, instituição e, se quiser, o link do Lattes. " +
      "Não há aprovação manual nem espera de dias.</p>" +
      "<h3>A conta dos créditos</h3>" +
      "<p>Um crédito corresponde a cinco minutos de questionário, arredondados para cima, até o teto de cinco créditos. " +
      "Responder uma pesquisa de dez minutos rende dois créditos; uma de meia hora rende cinco. " +
      "A mesma conta vale na outra ponta: cada resposta que a sua pesquisa recebe de outro pesquisador consome " +
      "o número de créditos correspondente à duração que você declarou. Quem pede mais tempo paga mais.</p>" +
      "<p>No cadastro você recebe um crédito de boas-vindas de " + PADROES.saldoInicial +
      " créditos e pode publicar na hora, antes de responder qualquer coisa. " +
      "Quando os créditos da sua pesquisa acabam, ela não sai do ar: desce para a seção " +
      "<em>sem créditos no momento</em>, no fim do mural, e volta ao topo quando você responder " +
      "às pesquisas de outras pessoas e recarregar.</p>" +
      "<h3>O código de conclusão</h3>" +
      "<p>Quando deposita a pesquisa, você escolhe um código e o coloca na mensagem de confirmação do seu formulário, " +
      "aquela tela que aparece depois de enviar as respostas. Outro pesquisador informa esse código aqui para receber os créditos. " +
      "O código nunca aparece no mural: o site guarda apenas uma impressão digital dele e compara.</p></div>";

    html += '<div class="bloco"><h2>Qualidade das respostas</h2>' +
      "<p>Cada pesquisador registra no máximo uma participação por pesquisa. " +
      "O que a plataforma contabiliza são as respostas de quem está logado e informou o código; " +
      "as respostas de visitantes sem cadastro são bem-vindas e não entram nessa conta, " +
      "justamente para a amostra não ficar restrita ao meio acadêmico.</p>" +
      "<p>Vale dizer com clareza o que este desenho não resolve: um código de conclusão pode ser repassado " +
      "entre conhecidos, e nenhum site detecta sozinho quem clicou em qualquer alternativa para marcar presença. " +
      "As defesas que funcionam ficam no seu formulário: perguntas de controle de atenção, descarte de respostas " +
      "enviadas em tempo muito menor que o declarado e conferência das respostas abertas. " +
      "Troque o código quando desconfiar de algo.</p></div>";

    html += '<div class="bloco"><h2>Ética em pesquisa</h2>' +
      "<p>Para depositar, você declara que o formulário apresenta o Termo de Consentimento Livre e Esclarecido " +
      "antes das perguntas, com a finalidade da pesquisa, os riscos, a possibilidade de desistir e o contato " +
      "do responsável e do comitê de ética. Se o estudo tem parecer aprovado, informe o número do CAAE: " +
      "a pesquisa recebe o carimbo de aprovação no mural, o que costuma aumentar a adesão. " +
      "Estudos dispensados de apreciação pelo CEP também são aceitos.</p>" +
      "<p>A responsabilidade ética e metodológica de cada pesquisa é de quem a depositou. " +
      "O mural não substitui a Plataforma Brasil nem o parecer do seu comitê.</p></div>";

    html += '<div class="bloco"><h2>Dados e privacidade</h2>' +
      "<p>Deste site constam apenas os dados de quem deposita pesquisa: nome, e-mail, vínculo declarado e, se informado, o Lattes. " +
      "Nome e instituição aparecem no mural, porque o respondente tem o direito de saber quem está pedindo seus dados. " +
      "E-mail e Lattes ficam visíveis só para você e para a administração.</p>" +
      "<p>Nenhuma resposta de questionário passa por aqui. Quem responde não cria conta, não informa e-mail " +
      "e não deixa registro neste site, o que reduz bastante a superfície de risco em relação à LGPD. " +
      "O tratamento dos dados coletados é responsabilidade do pesquisador, no formulário dele.</p></div>";

    html += '<div class="linha-botoes"><a class="btn" href="#/depositar">Depositar uma pesquisa</a>' +
      '<a class="btn btn-vazio" href="#/mural">Ver o mural</a></div>';

    pintar(html);
  }

  /* ============================================================
     10. Entrar e cadastrar
     ============================================================ */

  function verEntrar() {
    if (estado.usuario) { ir("#/painel/pesquisas"); return; }

    var html = "<h1>Entrar ou criar cadastro</h1>" +
      '<p class="sumario">O cadastro é só para quem vai depositar um instrumento de coleta. ' +
      "Para responder pesquisas do mural, não é preciso conta.</p>";

    if (Dados.modo === "demo") {
      html += '<div class="aviso aviso-demo"><p><strong>Modo demonstração.</strong> ' +
        "A senha não é verificada e o cadastro fica salvo apenas neste navegador.</p></div>";
    }

    html += '<div class="bloco"><h2>Já tenho cadastro</h2><form id="form-entrar">' +
      '<div class="par"><div class="campo"><label for="e-email">E-mail</label>' +
      '<input type="email" id="e-email" name="email" autocomplete="email" required></div>' +
      '<div class="campo"><label for="e-senha">Senha</label>' +
      '<input type="password" id="e-senha" name="senha" autocomplete="current-password" required></div></div>' +
      '<div class="linha-botoes"><button class="btn" type="submit">Entrar</button>' +
      '<button class="btn btn-discreto" type="button" id="esqueci">Esqueci a senha</button></div></form></div>';

    html += '<div class="bloco"><h2>Criar cadastro</h2>' +
      '<form id="form-cadastro">' +
      '<div class="campo"><label for="c-nome">Nome completo</label>' +
      '<input type="text" id="c-nome" name="nome" autocomplete="name" required>' +
      '<p class="ajuda">Aparece no mural junto da sua pesquisa.</p></div>' +
      '<div class="par"><div class="campo"><label for="c-email">E-mail</label>' +
      '<input type="email" id="c-email" name="email" autocomplete="email" required>' +
      '<p class="ajuda">Qualquer e-mail serve, institucional ou não.</p></div>' +
      '<div class="campo"><label for="c-senha">Senha</label>' +
      '<input type="password" id="c-senha" name="senha" autocomplete="new-password" minlength="6" required>' +
      '<p class="ajuda">Pelo menos seis caracteres.</p></div></div>' +
      '<div class="campo"><label for="c-nivel">Vínculo</label><select id="c-nivel" name="nivel" required>' +
      NIVEIS.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="par"><div class="campo"><label for="c-programa">Programa ou curso</label>' +
      '<input type="text" id="c-programa" name="programa" required placeholder="Programa de Pós-Graduação em Administração"></div>' +
      '<div class="campo"><label for="c-inst">Instituição</label>' +
      '<input type="text" id="c-inst" name="instituicao" required placeholder="PUC-Rio"></div></div>' +
      '<div class="campo"><label for="c-lattes">Currículo Lattes (opcional)</label>' +
      '<input type="url" id="c-lattes" name="lattes" placeholder="http://lattes.cnpq.br/0000000000000000">' +
      '<p class="ajuda">Visível apenas para você e para a administração. Ajuda a resolver dúvidas sobre vínculo.</p></div>' +
      '<div class="caixa-marcar"><input type="checkbox" id="c-aceite" name="aceite" required>' +
      '<label for="c-aceite">Declaro que as informações de vínculo são verdadeiras e que li as ' +
      '<a href="#/como-funciona">regras da casa</a>, inclusive as de ética em pesquisa.</label></div>' +
      '<div class="linha-botoes"><button class="btn" type="submit">Criar cadastro e receber ' +
      PADROES.saldoInicial + " créditos</button></div></form></div>";

    pintar(html);

    $("#form-entrar").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      travar(f, true);
      Dados.entrar(f.email.value.trim(), f.senha.value)
        .then(function () {
          recado("Bem-vindo de volta.", "ok");
          return depoisDeEntrar("#/painel/pesquisas");
        })
        .catch(function (e) { travar(f, false); recado(e.message, "erro"); });
    });

    $("#esqueci").addEventListener("click", function () {
      var email = $("#e-email").value.trim();
      if (!email) { recado("Escreva seu e-mail no campo acima primeiro.", "erro"); return; }
      Dados.recuperarSenha(email)
        .then(function () { recado("Se existir cadastro com esse e-mail, a mensagem de redefinição foi enviada.", "ok"); })
        .catch(function (e) { recado(e.message, "erro"); });
    });

    $("#form-cadastro").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      if (f.nome.value.trim().length < 3) { recado("Escreva seu nome completo.", "erro"); return; }
      travar(f, true);
      Dados.cadastrar({
        nome: f.nome.value.trim(), email: f.email.value.trim(), senha: f.senha.value,
        nivel: f.nivel.value, programa: f.programa.value.trim(),
        instituicao: f.instituicao.value.trim(), lattes: f.lattes.value.trim()
      }).then(function () {
        recado("Cadastro criado. Você tem " + PADROES.saldoInicial + " créditos de boas-vindas.", "ok");
        return depoisDeEntrar("#/depositar");
      }).catch(function (e) { travar(f, false); recado(e.message, "erro"); });
    });
  }

  // Depois de entrar ou se cadastrar, a sessão já existe mas o aviso de
  // mudança de conta chega um instante depois. Aqui a tela só avança
  // quando a ficha do pesquisador já está em mãos.
  function depoisDeEntrar(destino) {
    estado.usuario = Dados.usuario();
    return atualizarFicha().then(function () {
      pintarMenuConta();
      ir(destino);
    });
  }

  function travar(form, sim) {
    Array.prototype.forEach.call(form.querySelectorAll("button, input, select, textarea"), function (c) {
      c.disabled = sim;
    });
  }

  /* ============================================================
     11. Depositar e editar pesquisa
     ============================================================ */

  function verDepositar(id) {
    if (!estado.usuario) {
      pintar("<h1>Depositar uma pesquisa</h1>" +
        '<p class="sumario">Para depositar um instrumento de coleta é preciso ter cadastro. ' +
        "Leva um minuto e você já pode publicar, antes de responder qualquer pesquisa.</p>" +
        '<div class="linha-botoes"><a class="btn" href="#/entrar">Entrar ou criar cadastro</a>' +
        '<a class="btn btn-vazio" href="#/como-funciona">Ler as regras primeiro</a></div>');
      return;
    }
    if (!estado.ficha) {
      pintar('<div class="aviso aviso-erro"><p>Sua ficha de pesquisador não foi encontrada no banco. ' +
        "Saia e entre novamente; se continuar, procure a administração.</p></div>");
      return;
    }
    if (estado.ficha.bloqueado) {
      pintar('<div class="aviso aviso-erro"><p>Seu cadastro está bloqueado para novos depósitos. ' +
        "Procure a administração do mural.</p></div>");
      return;
    }

    var editar = !!id;
    (editar ? Dados.obterPesquisa(id) : Promise.resolve(null)).then(function (p) {
      if (editar && (!p || p.autorUid !== estado.usuario.uid)) {
        pintar('<div class="aviso aviso-erro"><p>Esta pesquisa não é sua ou não existe mais.</p></div>');
        return;
      }
      p = p || {};
      if (editar) p.id = p.id || id;
      var saldo = Number(estado.ficha.creditos || 0);

      var html = '<a class="voltar" href="' + (editar ? "#/painel/pesquisas" : "#/mural") + '">Voltar</a>' +
        "<h1>" + (editar ? "Editar a ficha da pesquisa" : "Depositar uma pesquisa") + "</h1>" +
        '<p class="sumario">O questionário continua onde está, no Google Forms, Qualtrics, LimeSurvey ou no que você usa. ' +
        "O que entra no mural é a ficha abaixo e o link.</p>";

      if (!editar) {
        html += '<div class="saldo"><div class="saldo-item"><div class="saldo-numero">' + saldo + "</div>" +
          '<div class="saldo-rotulo">créditos na sua conta</div></div>' +
          '<div class="saldo-item"><p class="sumario" style="margin:0">Ao publicar, você separa parte do saldo para esta pesquisa. ' +
          "Cada resposta de outro pesquisador consome créditos conforme a duração declarada.</p></div></div>";
      }

      html += '<form id="form-pesquisa">' +
        '<div class="campo" style="max-width:40rem"><label for="p-titulo">Título da pesquisa</label>' +
        '<input type="text" id="p-titulo" name="titulo" required minlength="10" maxlength="180" value="' + esc(p.titulo || "") + '">' +
        '<p class="ajuda">Diga o tema e quem você procura. É a linha que decide se alguém clica.</p></div>' +

        '<div class="campo" style="max-width:40rem"><label for="p-resumo">Resumo para o respondente</label>' +
        '<textarea id="p-resumo" name="resumo" required minlength="40" maxlength="1200" rows="5">' + esc(p.resumo || "") + "</textarea>" +
        '<p class="ajuda">Em linguagem acessível, sem jargão: o que a pessoa vai responder e para quê. De quarenta a mil e duzentos caracteres.</p></div>' +

        '<div class="par"><div class="campo"><label for="p-area">Área</label><select id="p-area" name="area" required>' +
        (window.AREAS || []).map(function (a) {
          return '<option value="' + esc(a) + '"' + (p.area === a ? " selected" : "") + ">" + esc(a) + "</option>";
        }).join("") + "</select></div>" +
        '<div class="campo"><label for="p-publico">Quem pode responder</label><select id="p-publico" name="publico" required>' +
        (window.PUBLICOS || []).map(function (a) {
          return '<option value="' + esc(a) + '"' + (p.publico === a ? " selected" : "") + ">" + esc(a) + "</option>";
        }).join("") + "</select></div></div>" +

        '<div class="par"><div class="campo"><label for="p-duracao">Tempo de resposta, em minutos</label>' +
        '<input type="number" id="p-duracao" name="duracaoMin" min="1" max="' + PADROES.duracaoMax +
        '" required value="' + esc(p.duracaoMin || 10) + '">' +
        '<p class="ajuda" id="aviso-custo"></p></div>' +
        '<div class="campo"><label for="p-meta">Meta de respostas (opcional)</label>' +
        '<input type="number" id="p-meta" name="metaRespostas" min="0" max="100000" value="' + esc(p.metaRespostas || "") + '">' +
        '<p class="ajuda">Aparece no mural como referência de quanto falta.</p></div></div>' +

        '<div class="campo" style="max-width:40rem"><label for="p-link">Link do questionário</label>' +
        '<input type="url" id="p-link" name="link" required placeholder="https://docs.google.com/forms/..." value="' +
        esc(/^https?:/i.test(p.link || "") ? p.link : "") + '">' +
        '<p class="ajuda">Precisa começar com https. Teste o link em uma janela anônima antes de publicar.</p></div>' +

        '<div class="campo"><label for="p-codigo">Código de conclusão</label>' +
        '<input type="text" id="p-codigo" name="codigo" autocomplete="off" spellcheck="false" ' +
        (editar ? 'placeholder="deixe em branco para manter o código atual"' : "required") +
        ' minlength="' + PADROES.minCodigo + '" maxlength="40" value="">' +
        '<p class="ajuda">Escolha uma palavra ou sequência de pelo menos ' + PADROES.minCodigo +
        " caracteres e coloque-a na mensagem de confirmação do seu formulário, aquela tela que aparece depois de enviar. " +
        "Quem respondeu informa esse código aqui para receber os créditos. O código não aparece no mural.</p></div>" +

        '<div class="caixa-marcar"><input type="checkbox" id="p-tcle" name="tcle" required' +
        (p.tcleDeclarado ? " checked" : "") + ">" +
        '<label for="p-tcle">Declaro que o formulário apresenta o Termo de Consentimento Livre e Esclarecido ' +
        "antes das perguntas, com finalidade, riscos, possibilidade de desistir e contato do responsável, " +
        "e que a condução da pesquisa segue as normas de ética vigentes.</label></div>" +

        '<div class="campo"><label for="p-caae">Número do CAAE ou do parecer do CEP (opcional)</label>' +
        '<input type="text" id="p-caae" name="caae" maxlength="40" value="' + esc(p.caae || "") + '">' +
        '<p class="ajuda">Informando o número, a pesquisa recebe o carimbo de aprovação em CEP no mural. ' +
        "Pesquisas dispensadas de apreciação também são aceitas; basta deixar em branco.</p></div>";

      if (!editar) {
        var sugestao = Math.min(saldo, 10);
        html += '<div class="campo"><label for="p-creditos">Créditos para esta pesquisa</label>' +
          '<input type="number" id="p-creditos" name="creditos" min="0" max="' + saldo + '" value="' + sugestao + '">' +
          '<p class="ajuda">Saem do seu saldo de ' + saldo + " e podem ser recarregados depois no painel. " +
          "Com zero crédito a pesquisa ainda é publicada, mas entra direto na seção sem créditos.</p></div>";
      }

      html += '<div class="linha-botoes"><button class="btn" type="submit">' +
        (editar ? "Salvar alterações" : "Publicar no mural") + "</button>" +
        '<a class="btn btn-discreto" href="' + (editar ? "#/painel/pesquisas" : "#/mural") + '">Cancelar</a></div></form>';

      pintar(html);

      var campoDuracao = $("#p-duracao");
      var avisoCusto = $("#aviso-custo");
      function atualizarCusto() {
        var v = valorEmCreditos(campoDuracao.value);
        avisoCusto.textContent = "Rende " + plural(v, "crédito", "créditos") +
          " para quem responder e consome o mesmo a cada resposta recebida.";
      }
      campoDuracao.addEventListener("input", atualizarCusto);
      atualizarCusto();

      $("#form-pesquisa").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var f = ev.target;
        var link = linkSeguro(f.link.value.trim());
        if (!link) { recado("O link precisa começar com https.", "erro"); return; }
        var codigo = f.codigo.value.trim();
        if (!editar && codigo.length < PADROES.minCodigo) {
          recado("O código de conclusão precisa de pelo menos " + PADROES.minCodigo + " caracteres.", "erro");
          return;
        }
        var duracao = Math.max(1, Math.min(PADROES.duracaoMax, parseInt(f.duracaoMin.value, 10) || 1));
        var caae = f.caae.value.trim();
        var campos = {
          titulo: f.titulo.value.trim(),
          resumo: f.resumo.value.trim(),
          area: f.area.value,
          publico: f.publico.value,
          duracaoMin: duracao,
          metaRespostas: parseInt(f.metaRespostas.value, 10) || 0,
          link: link,
          tcleDeclarado: true,
          temCaae: !!caae,
          caae: caae
        };

        travar(f, true);
        var idPesquisa = editar ? p.id : Dados.novoId();
        var passo = codigo ? hashCodigo(idPesquisa, codigo) : Promise.resolve(null);

        passo.then(function (h) {
          if (h) campos.codigoHash = h;
          if (editar) {
            campos.atualizadoEm = Date.now();
            return Dados.salvarPesquisa(idPesquisa, campos);
          }
          var creditos = Math.max(0, Math.min(saldo, parseInt(f.creditos.value, 10) || 0));
          campos.id = idPesquisa;
          campos.autorUid = estado.usuario.uid;
          campos.autorNome = estado.ficha.nome;
          campos.autorInstituicao = estado.ficha.instituicao;
          campos.status = "ativa";
          campos.respostasRecebidas = 0;
          campos.creditos = creditos;
          campos.criadoEm = Date.now();
          campos.exemplo = false;
          return Dados.criarPesquisa(campos);
        }).then(function () {
          estado.carregadoEm = 0;
          return atualizarFicha();
        }).then(function () {
          recado(editar ? "Ficha atualizada." : "Pesquisa publicada no mural.", "ok");
          ir("#/pesquisa/" + idPesquisa);
        }).catch(function (e) {
          travar(f, false);
          recado(e.message || "Não foi possível salvar.", "erro");
        });
      });
    }).catch(falhou);
  }

  /* ============================================================
     12. Painel do pesquisador
     ============================================================ */

  function verPainel(aba) {
    if (!estado.usuario) { ir("#/entrar"); return; }
    aba = aba || "pesquisas";

    var html = "<h1>Meu painel</h1>";
    var saldo = Number(estado.ficha ? estado.ficha.creditos : 0);

    html += '<div class="saldo">' +
      '<div class="saldo-item"><div class="saldo-numero">' + saldo + "</div>" +
      '<div class="saldo-rotulo">créditos livres</div></div>' +
      '<div class="saldo-item"><div class="valor" id="n-pesquisas">—</div>' +
      '<div class="saldo-rotulo">pesquisas suas no mural</div></div>' +
      '<div class="saldo-item"><div class="valor" id="n-respostas">—</div>' +
      '<div class="saldo-rotulo">respostas recebidas</div></div>' +
      '<div class="saldo-item"><div class="valor" id="n-dadas">—</div>' +
      '<div class="saldo-rotulo">pesquisas respondidas</div></div></div>';

    html += '<div class="abas" role="tablist">' +
      aboto("pesquisas", "Minhas pesquisas", aba) +
      aboto("responder", "Responder e ganhar créditos", aba) +
      aboto("extrato", "Extrato", aba) +
      aboto("vinculo", "Meu vínculo", aba) +
      '</div><div id="painel-corpo"><p class="sumario">Carregando.</p></div>';

    pintar(html);

    Array.prototype.forEach.call(document.querySelectorAll(".abas button"), function (b) {
      b.addEventListener("click", function () { ir("#/painel/" + b.dataset.aba); });
    });

    Promise.all([carregarPesquisas(true), Dados.minhasParticipacoes()]).then(function (r) {
      var todas = r[0], minhasPart = r[1];
      var minhas = todas.filter(function (p) { return p.autorUid === estado.usuario.uid; });
      $("#n-pesquisas").textContent = minhas.length;
      $("#n-respostas").textContent = minhas.reduce(function (s, p) { return s + Number(p.respostasRecebidas || 0); }, 0);
      $("#n-dadas").textContent = minhasPart.length;

      var corpo = $("#painel-corpo");
      if (aba === "pesquisas") painelPesquisas(corpo, minhas, saldo);
      else if (aba === "responder") painelResponder(corpo, todas, minhasPart);
      else if (aba === "extrato") painelExtrato(corpo, minhasPart, minhas);
      else painelVinculo(corpo);
    }).catch(falhou);
  }

  function aboto(id, texto, atual) {
    return '<button type="button" role="tab" data-aba="' + id + '" aria-selected="' +
      (atual === id ? "true" : "false") + '">' + texto + "</button>";
  }

  function painelPesquisas(corpo, minhas, saldo) {
    if (!minhas.length) {
      corpo.innerHTML = '<div class="vazio"><p>Você ainda não depositou nenhuma pesquisa. ' +
        'Com o crédito de boas-vindas, pode publicar agora.</p></div>' +
        '<div class="linha-botoes"><a class="btn" href="#/depositar">Depositar uma pesquisa</a></div>';
      return;
    }

    var html = '<div class="linha-botoes" style="margin-top:0;margin-bottom:1.25rem">' +
      '<a class="btn" href="#/depositar">Depositar outra pesquisa</a></div>';

    minhas.sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });

    minhas.forEach(function (p) {
      var custo = valorEmCreditos(p.duracaoMin);
      var creditos = Number(p.creditos || 0);
      var respostasPossiveis = Math.floor(creditos / custo);
      html += '<article class="folha' + (p.status !== "ativa" ? " folha-encerrada" : (semCredito(p) ? " folha-sem-credito" : "")) + '">' +
        '<h3 class="folha-titulo"><a href="#/pesquisa/' + esc(p.id) + '">' + esc(p.titulo) + "</a></h3>" +
        '<div class="ficha">' +
        '<span class="dado dado-forte">' + creditos + " créditos nesta pesquisa</span>" +
        '<span class="dado">' + plural(Number(p.respostasRecebidas || 0), "resposta", "respostas") + " pela plataforma</span>" +
        '<span class="dado">' + esc(p.duracaoMin) + " min, custa " + custo + " por resposta</span>" +
        '<span class="dado' + (p.status === "ativa" ? "" : " dado-aviso") + '">' +
        (p.status === "ativa" ? "no mural" : "encerrada") + "</span>" +
        "</div>" +
        '<p class="sumario" style="margin:0 0 .9rem">' +
        (p.status !== "ativa" ? "Coleta encerrada."
          : respostasPossiveis > 0
            ? "Dá para receber " + plural(respostasPossiveis, "resposta", "respostas") + " de outros pesquisadores antes de recarregar."
            : "Sem créditos: a pesquisa está na seção do fim do mural e respondê-la não rende créditos.") +
        "</p>" +
        '<div class="folha-pe">' +
        '<a class="btn btn-mini btn-vazio" href="#/depositar/' + esc(p.id) + '">Editar ficha</a>' +
        '<button class="btn btn-mini btn-discreto" data-acao="recarregar" data-id="' + esc(p.id) + '">Adicionar créditos</button>' +
        '<button class="btn btn-mini btn-discreto" data-acao="situacao" data-id="' + esc(p.id) + '" data-status="' + esc(p.status) + '">' +
        (p.status === "ativa" ? "Encerrar coleta" : "Reabrir coleta") + "</button>" +
        '<button class="btn btn-mini btn-discreto" data-acao="participantes" data-id="' + esc(p.id) + '">Baixar participações</button>' +
        '<button class="btn btn-mini btn-risco" data-acao="excluir" data-id="' + esc(p.id) + '">Remover do mural</button>' +
        "</div></article>";
    });

    corpo.innerHTML = html;

    Array.prototype.forEach.call(corpo.querySelectorAll("[data-acao]"), function (b) {
      b.addEventListener("click", function () {
        var id = b.dataset.id;
        var acao = b.dataset.acao;

        if (acao === "recarregar") {
          var quanto = prompt("Quantos créditos transferir do seu saldo para esta pesquisa?\nSaldo livre: " + saldo, "5");
          if (quanto === null) return;
          var n = parseInt(quanto, 10);
          if (!n || n < 1) { recado("Informe um número inteiro maior que zero.", "erro"); return; }
          if (n > saldo) { recado("Você tem só " + saldo + " créditos livres. Responda pesquisas do mural para recarregar.", "erro"); return; }
          Dados.alocarCreditos(id, n).then(function () {
            estado.carregadoEm = 0;
            return atualizarFicha();
          }).then(function () {
            recado(plural(n, "crédito", "créditos") + " na pesquisa.", "ok");
            verPainel("pesquisas");
          }).catch(function (e) { recado(e.message, "erro"); });
          return;
        }

        if (acao === "situacao") {
          var novo = b.dataset.status === "ativa" ? "encerrada" : "ativa";
          Dados.salvarPesquisa(id, { status: novo, atualizadoEm: Date.now() }).then(function () {
            estado.carregadoEm = 0;
            recado(novo === "ativa" ? "Coleta reaberta." : "Coleta encerrada.", "ok");
            verPainel("pesquisas");
          }).catch(function (e) { recado(e.message, "erro"); });
          return;
        }

        if (acao === "excluir") {
          if (!confirm("Remover esta pesquisa do mural? Os créditos que estão nela são perdidos e não há como desfazer.")) return;
          Dados.excluirPesquisa(id).then(function () {
            estado.carregadoEm = 0;
            recado("Pesquisa removida.", "ok");
            verPainel("pesquisas");
          }).catch(function (e) { recado(e.message, "erro"); });
          return;
        }

        if (acao === "participantes") {
          Dados.listarParticipacoes().then(function (todas) {
            var linhas = [["pesquisa", "data", "creditos"]];
            todas.filter(function (x) { return x.pesquisaId === id; }).forEach(function (x) {
              linhas.push([x.pesquisaTitulo || id, dataCurta(x.criadoEm), x.creditos]);
            });
            if (linhas.length === 1) { recado("Nenhuma participação registrada nesta pesquisa.", "erro"); return; }
            baixar("participacoes-" + id + ".csv", csv(linhas));
          }).catch(function (e) { recado(e.message, "erro"); });
        }
      });
    });
  }

  function painelResponder(corpo, todas, minhasPart) {
    var jaRespondi = {};
    minhasPart.forEach(function (x) { jaRespondi[x.pesquisaId] = true; });

    var fila = todas.filter(function (p) {
      return p.status === "ativa" && p.autorUid !== estado.usuario.uid &&
        !semCredito(p) && !jaRespondi[p.id] && !p.exemplo;
    }).sort(function (a, b) { return valorEmCreditos(b.duracaoMin) - valorEmCreditos(a.duracaoMin); });

    var html = '<p class="sumario">Cada pesquisa respondida rende créditos conforme a duração declarada. ' +
      "Abra o questionário, responda de verdade e volte com o código de conclusão. " +
      "Cada pesquisa conta uma vez por pessoa.</p>";

    if (!fila.length) {
      html += '<div class="vazio"><p>Não há pesquisas de outras pessoas disponíveis para créditos agora. ' +
        "Isso acontece quando você já respondeu às que estão no mural, ou quando as demais estão sem créditos. " +
        'Você ainda pode responder qualquer pesquisa do <a href="#/mural">mural</a> por vontade própria.</p></div>';
    } else {
      html += fila.map(folhaPesquisa).join("");
    }

    var exemplosNaFila = todas.some(function (p) { return p.exemplo && p.status === "ativa"; });
    if (exemplosNaFila) {
      html += '<div class="aviso aviso-demo"><p>As pesquisas de exemplo não entram nesta fila: ' +
        "não há questionário por trás delas, então não rendem créditos.</p></div>";
    }

    corpo.innerHTML = html;
  }

  function painelExtrato(corpo, minhasPart, minhas) {
    var html = "";
    var ganho = minhasPart.reduce(function (s, x) { return s + Number(x.creditos || 0); }, 0);
    var alocado = minhas.reduce(function (s, p) { return s + Number(p.creditos || 0); }, 0);
    var consumido = minhas.reduce(function (s, p) {
      return s + Number(p.respostasRecebidas || 0) * valorEmCreditos(p.duracaoMin);
    }, 0);

    html += '<div class="rolagem"><table><caption class="sr">Resumo dos créditos</caption><thead><tr>' +
      "<th>Movimento</th><th>Créditos</th></tr></thead><tbody>" +
      "<tr><td>Crédito de boas-vindas</td><td class=\"num\">+" + PADROES.saldoInicial + "</td></tr>" +
      "<tr><td>Ganhos respondendo pesquisas</td><td class=\"num\">+" + ganho + "</td></tr>" +
      "<tr><td>Separados para as suas pesquisas</td><td class=\"num\">" + alocado + " parados nelas</td></tr>" +
      "<tr><td>Consumidos por respostas que você recebeu</td><td class=\"num\">" + consumido + "</td></tr>" +
      "<tr><td><strong>Saldo livre agora</strong></td><td class=\"num\"><strong>" +
      Number(estado.ficha ? estado.ficha.creditos : 0) + "</strong></td></tr>" +
      "</tbody></table></div>";

    html += "<h3>Pesquisas que você respondeu</h3>";
    if (!minhasPart.length) {
      html += '<div class="vazio"><p>Nenhuma participação registrada ainda. ' +
        'A aba <em>responder e ganhar créditos</em> mostra a fila.</p></div>';
    } else {
      minhasPart.sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });
      html += '<div class="rolagem"><table><thead><tr><th>Pesquisa</th><th>Data</th><th>Créditos</th></tr></thead><tbody>' +
        minhasPart.map(function (x) {
          return "<tr><td>" + esc(x.pesquisaTitulo || x.pesquisaId) + "</td><td>" + dataCurta(x.criadoEm) +
            '</td><td class="num">+' + esc(x.creditos) + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<div class="linha-botoes"><button class="btn btn-discreto" id="baixar-extrato">Baixar extrato em CSV</button></div>';
    }

    corpo.innerHTML = html;

    var b = $("#baixar-extrato");
    if (b) b.addEventListener("click", function () {
      var linhas = [["pesquisa", "data", "creditos"]];
      minhasPart.forEach(function (x) { linhas.push([x.pesquisaTitulo || x.pesquisaId, dataCurta(x.criadoEm), x.creditos]); });
      baixar("extrato-mural-da-coleta.csv", csv(linhas));
    });
  }

  function painelVinculo(corpo) {
    var f = estado.ficha || {};
    corpo.innerHTML = '<form id="form-vinculo" class="bloco">' +
      "<h3>Vínculo declarado</h3>" +
      '<p class="sumario">Nome e instituição aparecem no mural junto das suas pesquisas. ' +
      "E-mail e Lattes ficam visíveis só para você e para a administração.</p>" +
      '<div class="campo"><label for="v-nome">Nome completo</label>' +
      '<input type="text" id="v-nome" name="nome" required value="' + esc(f.nome || "") + '"></div>' +
      '<div class="campo"><label for="v-nivel">Vínculo</label><select id="v-nivel" name="nivel">' +
      NIVEIS.map(function (n) {
        return '<option value="' + esc(n) + '"' + (f.nivel === n ? " selected" : "") + ">" + esc(n) + "</option>";
      }).join("") + "</select></div>" +
      '<div class="par"><div class="campo"><label for="v-programa">Programa ou curso</label>' +
      '<input type="text" id="v-programa" name="programa" value="' + esc(f.programa || "") + '"></div>' +
      '<div class="campo"><label for="v-inst">Instituição</label>' +
      '<input type="text" id="v-inst" name="instituicao" value="' + esc(f.instituicao || "") + '"></div></div>' +
      '<div class="campo"><label for="v-lattes">Currículo Lattes</label>' +
      '<input type="url" id="v-lattes" name="lattes" value="' + esc(f.lattes || "") + '"></div>' +
      '<div class="campo"><span class="rotulo">E-mail do cadastro</span>' +
      "<p class=\"ajuda\">" + esc(f.email || (estado.usuario && estado.usuario.email) || "—") +
      ". Para trocar de e-mail, procure a administração.</p></div>" +
      '<div class="linha-botoes"><button class="btn" type="submit">Salvar vínculo</button>' +
      '<button class="btn btn-discreto" type="button" id="sair-conta">Sair da conta</button></div></form>';

    $("#form-vinculo").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var fo = ev.target;
      travar(fo, true);
      Dados.salvarFicha({
        nome: fo.nome.value.trim(), nivel: fo.nivel.value,
        programa: fo.programa.value.trim(), instituicao: fo.instituicao.value.trim(),
        lattes: fo.lattes.value.trim()
      }).then(function () {
        return atualizarFicha();
      }).then(function () {
        recado("Vínculo salvo. Pesquisas já publicadas mantêm o nome de antes na ficha.", "ok");
        verPainel("vinculo");
      }).catch(function (e) { travar(fo, false); recado(e.message, "erro"); });
    });

    $("#sair-conta").addEventListener("click", function () {
      Dados.sair().then(function () {
        estado.usuario = null; estado.ficha = null; estado.admin = false;
        pintarMenuConta();
        recado("Você saiu da conta.", "ok");
        ir("#/mural");
      });
    });
  }

  /* ============================================================
     13. Painel do administrador
     ============================================================ */

  function verAdmin(aba) {
    if (!estado.usuario) { ir("#/entrar"); return; }
    if (!estado.admin) {
      pintar('<div class="aviso aviso-erro"><p>Esta área é da administração do mural. ' +
        "O acesso é dado criando um documento na coleção <code>admins</code> do Firestore, " +
        "com o identificador igual ao UID da pessoa.</p></div>");
      return;
    }
    aba = aba || "pesquisas";

    var html = "<h1>Administração</h1>" +
      '<div class="abas" role="tablist">' +
      aboto("pesquisas", "Pesquisas", aba) +
      aboto("pesquisadores", "Pesquisadores", aba) +
      aboto("economia", "Créditos e exemplos", aba) +
      '</div><div id="admin-corpo"><p class="sumario">Carregando.</p></div>';

    pintar(html);

    Array.prototype.forEach.call(document.querySelectorAll(".abas button"), function (b) {
      b.addEventListener("click", function () { ir("#/admin/" + b.dataset.aba); });
    });

    var corpo = $("#admin-corpo");

    if (aba === "pesquisas") {
      carregarPesquisas(true).then(function (todas) {
        todas.sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });
        var html2 = '<p class="sumario">' + plural(todas.length, "pesquisa", "pesquisas") +
          " no banco. Encerrar tira a pesquisa do ar sem apagar o histórico.</p>" +
          '<div class="linha-botoes" style="margin-top:0"><button class="btn btn-discreto" id="baixar-pesquisas">Baixar tudo em CSV</button></div>' +
          '<div class="rolagem"><table><thead><tr><th>Título</th><th>Autor</th><th>Ética</th>' +
          "<th>Créditos</th><th>Respostas</th><th>Situação</th><th></th></tr></thead><tbody>" +
          todas.map(function (p) {
            return "<tr><td><a href=\"#/pesquisa/" + esc(p.id) + "\">" + esc(p.titulo) + "</a>" +
              (p.exemplo ? ' <span class="dado dado-exemplo">exemplo</span>' : "") + "</td>" +
              "<td>" + esc(p.autorNome || "—") + "<br><span class=\"contagem\">" + esc(p.autorInstituicao || "") + "</span></td>" +
              "<td>" + (p.temCaae && p.caae ? "CAAE " + esc(p.caae) : p.tcleDeclarado ? "TCLE declarado" : "—") + "</td>" +
              '<td class="num">' + esc(Number(p.creditos || 0)) + "</td>" +
              '<td class="num">' + esc(Number(p.respostasRecebidas || 0)) + "</td>" +
              "<td>" + (p.status === "ativa" ? "no mural" : "encerrada") + "</td>" +
              '<td><button class="btn btn-mini btn-discreto" data-adm="situacao" data-id="' + esc(p.id) +
              '" data-status="' + esc(p.status) + '">' + (p.status === "ativa" ? "Encerrar" : "Reabrir") + "</button> " +
              '<button class="btn btn-mini btn-risco" data-adm="excluir" data-id="' + esc(p.id) + '">Apagar</button></td></tr>';
          }).join("") + "</tbody></table></div>";
        corpo.innerHTML = html2;

        $("#baixar-pesquisas").addEventListener("click", function () {
          var linhas = [["titulo", "autor", "instituicao", "area", "publico", "duracao_min", "caae",
            "creditos", "respostas", "meta", "situacao", "link", "criada_em"]];
          todas.forEach(function (p) {
            linhas.push([p.titulo, p.autorNome, p.autorInstituicao, p.area, p.publico, p.duracaoMin,
              p.caae, p.creditos, p.respostasRecebidas, p.metaRespostas, p.status, p.link, dataCurta(p.criadoEm)]);
          });
          baixar("pesquisas-mural-da-coleta.csv", csv(linhas));
        });

        Array.prototype.forEach.call(corpo.querySelectorAll("[data-adm]"), function (b) {
          b.addEventListener("click", function () {
            var id = b.dataset.id;
            if (b.dataset.adm === "situacao") {
              var novo = b.dataset.status === "ativa" ? "encerrada" : "ativa";
              Dados.salvarPesquisa(id, { status: novo }).then(function () {
                estado.carregadoEm = 0; verAdmin("pesquisas");
              }).catch(function (e) { recado(e.message, "erro"); });
            } else {
              if (!confirm("Apagar esta pesquisa do banco? Não há como desfazer.")) return;
              Dados.excluirPesquisa(id).then(function () {
                estado.carregadoEm = 0; recado("Pesquisa apagada.", "ok"); verAdmin("pesquisas");
              }).catch(function (e) { recado(e.message, "erro"); });
            }
          });
        });
      }).catch(falhou);
      return;
    }

    if (aba === "pesquisadores") {
      Promise.all([Dados.listarPesquisadores(), Dados.listarParticipacoes()]).then(function (r) {
        var gente = r[0], parts = r[1];
        var porPessoa = {};
        parts.forEach(function (x) { porPessoa[x.respondenteUid] = (porPessoa[x.respondenteUid] || 0) + 1; });
        gente.sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });

        corpo.innerHTML = '<p class="sumario">' + plural(gente.length, "cadastro", "cadastros") +
          ". O vínculo é declarado por quem se cadastra, sem conferência automática. " +
          "Bloquear impede novos depósitos e novas participações, sem apagar o que já existe.</p>" +
          '<div class="linha-botoes" style="margin-top:0"><button class="btn btn-discreto" id="baixar-gente">Baixar em CSV</button></div>' +
          '<div class="rolagem"><table><thead><tr><th>Nome</th><th>Vínculo declarado</th><th>Contato</th>' +
          "<th>Créditos</th><th>Respondeu</th><th></th></tr></thead><tbody>" +
          gente.map(function (g) {
            return "<tr><td>" + esc(g.nome || "—") + (g.bloqueado ? ' <span class="dado dado-aviso">bloqueado</span>' : "") +
              "<br><span class=\"contagem\">desde " + dataCurta(g.criadoEm) + "</span></td>" +
              "<td>" + esc(g.nivel || "—") + "<br><span class=\"contagem\">" + esc(g.programa || "") +
              (g.instituicao ? ", " + esc(g.instituicao) : "") + "</span></td>" +
              "<td>" + esc(g.email || "—") +
              (g.lattes && linkSeguro(g.lattes) ? '<br><a href="' + esc(linkSeguro(g.lattes)) +
                '" target="_blank" rel="noopener noreferrer">Lattes</a>' : "") + "</td>" +
              '<td class="num">' + esc(Number(g.creditos || 0)) + "</td>" +
              '<td class="num">' + (porPessoa[g.uid] || 0) + "</td>" +
              '<td><button class="btn btn-mini btn-discreto" data-adm="bloqueio" data-uid="' + esc(g.uid) +
              '" data-bloq="' + (g.bloqueado ? "1" : "0") + '">' +
              (g.bloqueado ? "Desbloquear" : "Bloquear") + "</button></td></tr>";
          }).join("") + "</tbody></table></div>";

        $("#baixar-gente").addEventListener("click", function () {
          var linhas = [["nome", "email", "nivel", "programa", "instituicao", "lattes", "creditos", "bloqueado", "desde"]];
          gente.forEach(function (g) {
            linhas.push([g.nome, g.email, g.nivel, g.programa, g.instituicao, g.lattes,
              g.creditos, g.bloqueado ? "sim" : "não", dataCurta(g.criadoEm)]);
          });
          baixar("pesquisadores-mural-da-coleta.csv", csv(linhas));
        });

        Array.prototype.forEach.call(corpo.querySelectorAll("[data-adm=bloqueio]"), function (b) {
          b.addEventListener("click", function () {
            Dados.salvarPesquisador(b.dataset.uid, { bloqueado: b.dataset.bloq !== "1" })
              .then(function () { verAdmin("pesquisadores"); })
              .catch(function (e) { recado(e.message, "erro"); });
          });
        });
      }).catch(falhou);
      return;
    }

    Dados.obterConfig().then(function (cfg) {
      corpo.innerHTML = '<div class="bloco"><h3>A conta dos créditos</h3>' +
        '<p class="sumario">A regra está no código do site e nas regras do Firestore, nos dois lugares, ' +
        "para que ninguém mude pelo navegador: um crédito a cada cinco minutos de questionário, " +
        "arredondado para cima, com teto de " + PADROES.maxCredito + " créditos. " +
        "Para alterar a conta, mude a função <code>valorEmCreditos</code> em <code>app.js</code> " +
        "e a função <code>valor</code> em <code>firestore.rules</code>.</p>" +
        '<div class="rolagem"><table><thead><tr><th>Duração</th><th>Créditos</th></tr></thead><tbody>' +
        [3, 8, 12, 18, 30].map(function (m) {
          return "<tr><td>" + m + " minutos</td><td class=\"num\">" + valorEmCreditos(m) + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<form id="form-config"><div class="campo"><label for="cfg-saldo">Crédito de boas-vindas</label>' +
        '<input type="number" id="cfg-saldo" name="saldoInicial" min="0" max="20" value="' +
        esc(cfg.saldoInicial != null ? cfg.saldoInicial : PADROES.saldoInicial) + '">' +
        '<p class="ajuda">Quanto cada cadastro novo recebe. As regras do Firestore recusam valores acima de vinte. ' +
        "Vale apenas para quem se cadastrar daqui para frente.</p></div>" +
        '<div class="linha-botoes"><button class="btn" type="submit">Salvar</button></div></form></div>';

      corpo.innerHTML += '<div class="bloco"><h3>Pesquisas de exemplo</h3>' +
        '<p class="sumario">Os dez exemplos de fábrica servem para o mural não nascer vazio. ' +
        "Apague-os quando houver pesquisas de verdade suficientes.</p>" +
        '<div class="linha-botoes" style="margin-top:0">' +
        '<button class="btn btn-vazio" id="pub-exemplos">Publicar os exemplos</button>' +
        '<button class="btn btn-risco" id="apagar-exemplos">Apagar todos os exemplos</button></div></div>';

      $("#form-config").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var n = parseInt(ev.target.saldoInicial.value, 10);
        if (isNaN(n) || n < 0 || n > 20) { recado("Escolha um número de zero a vinte.", "erro"); return; }
        Dados.salvarConfig({ saldoInicial: n })
          .then(function () { recado("Configuração salva.", "ok"); })
          .catch(function (e) { recado(e.message, "erro"); });
      });

      $("#pub-exemplos").addEventListener("click", function () {
        Dados.publicarExemplos().then(function () {
          estado.carregadoEm = 0; recado("Exemplos publicados no mural.", "ok");
        }).catch(function (e) { recado(e.message, "erro"); });
      });

      $("#apagar-exemplos").addEventListener("click", function () {
        if (!confirm("Apagar todas as pesquisas marcadas como exemplo?")) return;
        Dados.apagarExemplos().then(function () {
          estado.carregadoEm = 0; recado("Exemplos apagados.", "ok"); verAdmin("pesquisas");
        }).catch(function (e) { recado(e.message, "erro"); });
      });
    }).catch(falhou);
  }

  /* ============================================================
     14. Página de exemplo
     ============================================================ */

  function verExemplo() {
    pintar('<a class="voltar" href="#/mural">Voltar ao mural</a>' +
      "<h1>Esta é uma pesquisa de exemplo</h1>" +
      '<p class="sumario">O mural vem de fábrica com dez fichas fictícias, só para você ver como as pesquisas ' +
      "aparecem antes de haver pesquisa de verdade. Não existe questionário por trás delas, " +
      "e elas não valem créditos.</p>" +
      '<p class="sumario">Na administração, em <em>créditos e exemplos</em>, há o botão para apagar todas de uma vez.</p>' +
      '<div class="linha-botoes"><a class="btn" href="#/depositar">Depositar uma pesquisa de verdade</a>' +
      '<a class="btn btn-vazio" href="#/mural">Ver o mural</a></div>');
  }

  /* ============================================================
     15. Roteador
     ============================================================ */

  function pintar(html) {
    alvo.innerHTML = html;
    window.scrollTo(0, 0);
  }

  function falhou(e) {
    console.error(e);
    pintar('<div class="aviso aviso-erro"><p><strong>Algo não funcionou.</strong> ' +
      esc(e && e.message ? e.message : "Erro desconhecido.") + "</p>" +
      "<p>Se o problema persistir, confira a configuração do Firebase e se as regras do Firestore foram publicadas.</p></div>" +
      '<div class="linha-botoes"><a class="btn btn-vazio" href="#/mural">Voltar ao mural</a></div>');
  }

  function ir(hash) {
    if (location.hash === hash) rotear();
    else location.hash = hash;
  }

  function marcarMenu(rota) {
    Array.prototype.forEach.call(document.querySelectorAll("nav.menu a[data-rota]"), function (a) {
      if (a.dataset.rota === rota) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function pintarMenuConta() {
    var vao = document.getElementById("menu-conta");
    if (estado.usuario) {
      vao.innerHTML = '<a href="#/painel/pesquisas" data-rota="painel">Meu painel</a>' +
        (estado.admin ? ' <a href="#/admin/pesquisas" data-rota="admin">Administração</a>' : "");
    } else {
      vao.innerHTML = '<a href="#/entrar" data-rota="entrar">Entrar</a>';
    }
  }

  function rotear() {
    var partes = (location.hash || "#/mural").replace(/^#\/?/, "").split("/");
    var rota = partes[0] || "mural";
    marcarMenu(rota);

    if (rota === "mural" || rota === "") verMural();
    else if (rota === "pesquisa") verPesquisa(partes[1]);
    else if (rota === "como-funciona") verComoFunciona();
    else if (rota === "entrar") verEntrar();
    else if (rota === "depositar") verDepositar(partes[1]);
    else if (rota === "painel") verPainel(partes[1]);
    else if (rota === "admin") verAdmin(partes[1]);
    else if (rota === "exemplo") verExemplo();
    else pintar("<h1>Página não encontrada</h1>" +
      '<p class="sumario">O endereço digitado não existe neste site.</p>' +
      '<div class="linha-botoes"><a class="btn" href="#/mural">Ir para o mural</a></div>');
  }

  /* ============================================================
     16. Início
     ============================================================ */

  function comecar() {
    Dados = configurado() ? criarArmazemFirebase() : criarArmazemDemo();

    Dados.iniciar().then(function () {
      estado.usuario = Dados.usuario();
      return atualizarFicha();
    }).then(function () {
      pintarMenuConta();
      rotear();
      window.addEventListener("hashchange", rotear);

      // Daqui para frente, qualquer entrada ou saída de conta recarrega a tela.
      var primeiraChamada = true;
      Dados.onAuth(function (u) {
        if (primeiraChamada) { primeiraChamada = false; return; }
        var trocou = (estado.usuario && estado.usuario.uid) !== (u && u.uid);
        estado.usuario = u;
        atualizarFicha().then(function () {
          pintarMenuConta();
          if (trocou) rotear();
        });
      });
    }).catch(function (e) {
      console.error(e);
      alvo.innerHTML = '<div class="aviso aviso-erro"><p><strong>O Firebase não carregou.</strong> ' +
        esc(e && e.message ? e.message : "") + "</p>" +
        "<p>Confira os valores em <code>firebase-config.js</code> e se o site está sendo aberto por https. " +
        "Para apagar a configuração e voltar ao modo demonstração, coloque <code>COLE_AQUI_A_API_KEY</code> " +
        "no campo <code>apiKey</code>.</p></div>";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", comecar);
  else comecar();

})();

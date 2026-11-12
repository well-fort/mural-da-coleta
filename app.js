/* Mural da Coleta — lógica do site.
   Script clássico, sem módulos, para que o arquivo também abra por duplo clique.
   O Firebase só é carregado quando firebase-config.js estiver preenchido. */

(function () {
  "use strict";

  /* ============================================================
     1. Configuração do projeto
     ============================================================ */

  // Administrador fundador: este e-mail é sempre administrador, mesmo que o
  // banco esteja vazio. Precisa ser igual em app.js e em firestore.rules.
  var ADMIN_FUNDADOR = "wellington1989fortunato@gmail.com";

  // A economia de créditos está desligada enquanto o site busca tração.
  // Virando esta chave para true, a troca volta: saldo de boas-vindas,
  // custo por resposta recebida e a fila de quem está sem crédito.
  // As regras do Firestore aceitam os dois modos sem precisar de alteração.
  var CREDITOS_LIGADOS = false;

  var PADROES = {
    saldoInicial: 15,
    duracaoMax: 40,
    minCodigo: 6,
    maxCredito: 5,
    metaPadrao: 100,
    diasNovidade: 7,
    larguraCapa: 1000,
    larguraMiniatura: 320,
    limiteCapa: 500000,
    limiteMiniatura: 45000
  };

  // A pergunta que todo respondente faz antes de clicar, e que "TCLE
  // declarado" não responde para quem não é da academia.
  var IDENTIFICACAO = [
    { valor: "anonimo", curto: "respostas anônimas",
      longo: "O questionário não pede nada que identifique quem responde." },
    { valor: "contato", curto: "pede e-mail ou telefone",
      longo: "O questionário pede e-mail ou telefone, por exemplo para sorteio ou para enviar o resultado." },
    { valor: "identificado", curto: "pede identificação",
      longo: "O questionário pede dados que identificam quem responde, como nome ou matrícula." }
  ];

  function textoIdentificacao(p, campo) {
    var achado = null;
    IDENTIFICACAO.forEach(function (i) { if (i.valor === p.identificacao) achado = i; });
    if (!achado) return campo === "curto" ? "" : "O pesquisador não informou se o questionário identifica quem responde.";
    return achado[campo];
  }

  var MOTIVOS_DENUNCIA = [
    "O link não funciona ou leva a outro lugar",
    "Não apresenta o TCLE antes das perguntas",
    "Pede dados pessoais sem necessidade",
    "Não parece pesquisa acadêmica",
    "Conteúdo ofensivo ou enganoso",
    "Outro motivo"
  ];

  var NIVEIS = [
    "Mestrando ou mestranda",
    "Doutorando ou doutoranda",
    "Graduando em TCC",
    "Docente ou pesquisador",
    "Outro vínculo"
  ];

  // Uma pesquisa de D minutos vale de 1 a 5 créditos: 1 crédito a cada 5
  // minutos arredondados para cima. Mantida mesmo com a economia desligada,
  // porque as regras do Firestore conferem esse número quando ela voltar.
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

  function imagemSegura(dado) {
    var d = String(dado || "");
    return /^data:image\/(jpeg|png|webp);base64,/.test(d) ? d : "";
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

  function diasDesde(ms) {
    if (!ms) return 9999;
    return Math.floor((Date.now() - ms) / 86400000);
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

  // Dia no fuso de Brasília, no formato AAAA-MM-DD, que é como as métricas
  // ficam guardadas e ordenadas.
  function diaDeHoje() {
    try {
      return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function diaLegivel(dia) {
    var p = String(dia || "").split("-");
    return p.length === 3 ? p[2] + "/" + p[1] : dia;
  }

  // Evita contar a mesma coisa duas vezes na mesma aba: recarregar a página
  // ou voltar para a ficha não inventa visita nova.
  function primeiraVezNaSessao(chave) {
    try {
      if (sessionStorage.getItem(chave)) return false;
      sessionStorage.setItem(chave, "1");
      return true;
    } catch (e) {
      return true;
    }
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
    if (!CREDITOS_LIGADOS) return false;
    return Number(p.creditos || 0) < valorEmCreditos(p.duracaoMin);
  }

  // Quanto falta para a meta, em proporção. É o que decide a ordem do mural:
  // quem está mais longe de fechar a amostra aparece primeiro.
  function faltaParaMeta(p) {
    var meta = Number(p.metaRespostas || 0) || PADROES.metaPadrao;
    var tem = Number(p.respostasRecebidas || 0);
    return Math.max(0, Math.min(1, (meta - tem) / meta));
  }

  // Lê os números da pesquisa e diz, em uma frase, o que está travando a
  // coleta. Sem isso o painel mostra dados e deixa a conclusão por conta
  // de quem olha, que é justamente a parte difícil.
  function diagnostico(p) {
    var vis = Number(p.visualizacoes || 0);
    var cli = Number(p.cliques || 0);
    var resp = Number(p.respostasRecebidas || 0);
    var meta = Number(p.metaRespostas || 0);
    var qtd = Number(p.notaQtd || 0);
    var media = mediaNota(p);

    if (p.status === "rascunho") {
      return { tom: "aviso", texto: "Rascunho: ninguém vê esta pesquisa enquanto você não publicar." };
    }
    if (p.status === "oculta") {
      return {
        tom: "aviso",
        texto: "A administração retirou esta pesquisa do mural" +
          (p.motivoOcultacao ? ": " + esc(p.motivoOcultacao) : ".") +
          " Corrija o que foi apontado e fale com a administração para voltar ao mural."
      };
    }
    if (p.status === "encerrada") {
      return { tom: "neutro", texto: "Coleta encerrada." };
    }
    if (meta && resp >= meta) {
      return { tom: "bom", texto: "Meta atingida. Vale encerrar a coleta para liberar espaço no mural." };
    }
    if (qtd >= 3 && Number(p.tempoMais || 0) > qtd / 2) {
      return {
        tom: "aviso",
        texto: "A maioria de quem respondeu diz que levou mais que os " + esc(p.duracaoMin) +
          " minutos declarados. Corrija o tempo: declarar a menos faz a pessoa desistir no meio."
      };
    }
    if (qtd >= 3 && media !== null && media < 3) {
      return {
        tom: "aviso",
        texto: "A clareza das perguntas está mal avaliada (" + media.toFixed(1).replace(".", ",") +
          " de 5). Vale reler o questionário com olhos de quem não conhece o tema."
      };
    }
    if (cli >= 10 && resp / cli < 0.2) {
      return {
        tom: "aviso",
        texto: "Muita gente abre o questionário e pouca informa o código. " +
          "Confira se o código está mesmo na tela de confirmação do formulário, e se ele não ficou longo demais."
      };
    }
    if (vis >= 10 && cli / vis < 0.25) {
      return {
        tom: "aviso",
        texto: "Gente chega à ficha e não clica no questionário. O que decide isso é o título e o resumo: " +
          "diga logo quem você procura e o que a pessoa vai responder."
      };
    }
    if (vis < 10) {
      return {
        tom: "neutro",
        texto: "Pouca gente chegou à ficha ainda. Divulgue o endereço dela nos seus grupos; " +
          "o mural sozinho traz pouca visita no começo."
      };
    }
    return { tom: "bom", texto: "Coleta andando sem sinal de problema." };
  }

  function mediaNota(p) {
    var qtd = Number(p.notaQtd || 0);
    if (!qtd) return null;
    return Number(p.notaSoma || 0) / qtd;
  }

  // O pesquisador declara o tempo; quem responde diz se bateu. Quando a
  // maioria diz que demorou mais, o mural avisa.
  function avisoDeTempo(p) {
    var qtd = Number(p.notaQtd || 0);
    var mais = Number(p.tempoMais || 0);
    if (qtd >= 3 && mais > qtd / 2) return "costuma levar mais que os " + esc(p.duracaoMin) + " min declarados";
    return "";
  }

  // Reduz a imagem no próprio navegador. Não há serviço de arquivos no plano
  // gratuito do Firebase, então a imagem vai comprimida dentro do banco:
  // uma miniatura leve no documento da pesquisa, que o mural carrega, e a
  // capa maior em documento separado, carregada só na ficha.
  function comprimirImagem(arquivo, larguraMax, limiteBytes) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(arquivo.type)) {
        reject(new Error("Escolha um arquivo de imagem.")); return;
      }
      var leitor = new FileReader();
      leitor.onerror = function () { reject(new Error("Não consegui ler esse arquivo.")); };
      leitor.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("Esse arquivo não parece ser uma imagem válida.")); };
        img.onload = function () {
          var l = img.width, a = img.height;
          if (!l || !a) { reject(new Error("Imagem sem dimensões.")); return; }
          if (l > larguraMax) { a = Math.round(a * larguraMax / l); l = larguraMax; }
          var tela = document.createElement("canvas");
          tela.width = l; tela.height = a;
          var ctx = tela.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, l, a);
          ctx.drawImage(img, 0, 0, l, a);
          var q = 0.75;
          var url = tela.toDataURL("image/jpeg", q);
          while (url.length > limiteBytes && q > 0.3) {
            q = Math.round((q - 0.1) * 100) / 100;
            url = tela.toDataURL("image/jpeg", q);
          }
          if (url.length > limiteBytes) {
            reject(new Error("A imagem continua pesada demais mesmo comprimida. Tente uma com menos detalhe."));
            return;
          }
          resolve(url);
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arquivo);
    });
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
        if (b && b.pesquisas) {
          if (!b.imagens) b.imagens = {};
          if (!b.admins) b.admins = {};
          return b;
        }
      } catch (e) { /* banco corrompido: recomeça */ }
      return semear();
    }

    function semear() {
      var b = {
        pesquisas: {}, pesquisadores: {}, participacoes: {}, imagens: {},
        admins: {}, sessao: null, config: { saldoInicial: PADROES.saldoInicial }
      };
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
          instituicao: d.instituicao, lattes: d.lattes || "",
          creditos: CREDITOS_LIGADOS ? PADROES.saldoInicial : 0,
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

      // Mesma regra da produção, para o modo demonstração não enganar:
      // administra quem é o fundador ou quem foi promovido.
      souAdmin: function () {
        sincronizar();
        if (!banco.sessao) return espera(false);
        if (banco.sessao.email === ADMIN_FUNDADOR) return espera(true);
        return espera(!!banco.admins[banco.sessao.uid]);
      },
      listarAdmins: function () {
        sincronizar();
        return espera(Object.keys(banco.admins).map(function (uid) {
          return Object.assign({ uid: uid }, banco.admins[uid]);
        }));
      },
      promoverAdmin: function (uid, dados) {
        sincronizar();
        banco.admins[uid] = dados; salvar(); return espera();
      },
      removerAdmin: function (uid) {
        sincronizar();
        delete banco.admins[uid]; salvar(); return espera();
      },

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
      obterCapa: function (id) {
        sincronizar();
        return espera(banco.imagens[id] ? banco.imagens[id].imagem : null);
      },
      salvarCapa: function (id, dataUrl) {
        sincronizar();
        if (dataUrl) banco.imagens[id] = { imagem: dataUrl, autorUid: banco.sessao.uid };
        else delete banco.imagens[id];
        salvar(); return espera();
      },
      criarPesquisa: function (p) {
        sincronizar();
        banco.pesquisas[p.id] = p;
        if (CREDITOS_LIGADOS) {
          banco.pesquisadores[banco.sessao.uid].creditos -= Number(p.creditos || 0);
        }
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
        delete banco.imagens[id];
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

      registrarParticipacao: function (p, hash, avaliacao) {
        sincronizar();
        var uid = banco.sessao.uid;
        var pid = p.id + "__" + uid;
        if (banco.participacoes[pid]) return Promise.reject(new Error("codigo-errado"));
        if (!p.codigoHash || p.codigoHash !== hash) return Promise.reject(new Error("codigo-errado"));
        var ganho = CREDITOS_LIGADOS ? valorEmCreditos(p.duracaoMin) : 0;
        banco.participacoes[pid] = {
          id: pid, pesquisaId: p.id, pesquisaTitulo: p.titulo, respondenteUid: uid,
          autorUid: p.autorUid, creditos: ganho, codigoHash: hash,
          nota: avaliacao.nota, tempo: avaliacao.tempo, criadoEm: Date.now()
        };
        if (ganho) banco.pesquisadores[uid].creditos += ganho;
        if (!banco.reputacao) banco.reputacao = {};
        var rep = banco.reputacao[uid] || { respondidas: 0 };
        rep.respondidas = Number(rep.respondidas || 0) + 1;
        banco.reputacao[uid] = rep;
        var ref = banco.pesquisas[p.id];
        ref.respostasRecebidas = Number(ref.respostasRecebidas || 0) + 1;
        ref.creditos = Math.max(0, Number(ref.creditos || 0) - ganho);
        ref.ultimaParticipacao = Date.now();
        ref.notaSoma = Number(ref.notaSoma || 0) + avaliacao.nota;
        ref.notaQtd = Number(ref.notaQtd || 0) + 1;
        if (avaliacao.tempo === "mais") ref.tempoMais = Number(ref.tempoMais || 0) + 1;
        if (avaliacao.tempo === "menos") ref.tempoMenos = Number(ref.tempoMenos || 0) + 1;
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

      contar: function (campo, pesquisaId) {
        sincronizar();
        if (!banco.metricas) banco.metricas = {};
        var dia = diaDeHoje();
        if (!banco.metricas[dia]) banco.metricas[dia] = { dia: dia, visitas: 0, aberturas: 0, cliques: 0 };
        banco.metricas[dia][campo] = Number(banco.metricas[dia][campo] || 0) + 1;
        if (pesquisaId && banco.pesquisas[pesquisaId]) {
          var alvoCampo = campo === "aberturas" ? "visualizacoes" : "cliques";
          var p = banco.pesquisas[pesquisaId];
          p[alvoCampo] = Number(p[alvoCampo] || 0) + 1;
        }
        salvar(); return espera();
      },
      listarMetricas: function () {
        sincronizar();
        var m = banco.metricas || {};
        return espera(Object.keys(m).map(function (d) { return m[d]; }));
      },
      obterReputacao: function (uid) {
        sincronizar();
        return espera((banco.reputacao && banco.reputacao[uid]) || null);
      },

      denunciar: function (d) {
        sincronizar();
        if (!banco.denuncias) banco.denuncias = {};
        var id = "d-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        banco.denuncias[id] = Object.assign({ id: id }, d);
        var p = banco.pesquisas[d.pesquisaId];
        if (p) p.denuncias = Number(p.denuncias || 0) + 1;
        salvar(); return espera();
      },
      listarDenuncias: function () {
        sincronizar();
        var d = banco.denuncias || {};
        return espera(Object.keys(d).map(function (k) { return d[k]; }));
      },
      resolverDenuncia: function (id, campos) {
        sincronizar();
        if (banco.denuncias && banco.denuncias[id]) {
          Object.keys(campos).forEach(function (k) { banco.denuncias[id][k] = campos[k]; });
        }
        salvar(); return espera();
      },

      registrar: function (acao, alvo, detalhe) {
        sincronizar();
        if (!banco.registro) banco.registro = {};
        var id = "r-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        banco.registro[id] = {
          id: id, quando: Date.now(),
          quem: banco.sessao ? banco.sessao.email : "?",
          acao: acao, alvo: alvo, detalhe: detalhe || ""
        };
        salvar(); return espera();
      },
      listarRegistro: function () {
        sincronizar();
        var r = banco.registro || {};
        return espera(Object.keys(r).map(function (k) { return r[k]; }));
      },

      apagarPessoa: function (uid) {
        sincronizar();
        delete banco.pesquisadores[uid];
        if (banco.reputacao) delete banco.reputacao[uid];
        if (banco.admins) delete banco.admins[uid];
        Object.keys(banco.pesquisas).forEach(function (id) {
          if (banco.pesquisas[id].autorUid === uid) {
            delete banco.pesquisas[id];
            if (banco.imagens) delete banco.imagens[id];
          }
        });
        Object.keys(banco.participacoes).forEach(function (k) {
          if (banco.participacoes[k].respondenteUid === uid) delete banco.participacoes[k];
        });
        salvar(); return espera();
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
      }
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
            creditos: CREDITOS_LIGADOS ? PADROES.saldoInicial : 0,
            bloqueado: false, criadoEm: Date.now()
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

      // O fundador é administrador pelo e-mail, sem depender do banco.
      // Os demais entram pela coleção admins, criada pela tela de administração.
      souAdmin: function () {
        if (!usuarioAtual) return Promise.resolve(false);
        if (usuarioAtual.email === ADMIN_FUNDADOR) return Promise.resolve(true);
        if (ehAdminCache !== null) return Promise.resolve(ehAdminCache);
        return pegar("admins", usuarioAtual.uid).then(function (d) {
          ehAdminCache = !!d; return ehAdminCache;
        }).catch(function () { return false; });
      },
      listarAdmins: function () { return pegarTodos(col("admins")).catch(function () { return []; }); },
      promoverAdmin: function (uid, dados) {
        return fb.fs.setDoc(doc("admins", uid), dados).catch(function (e) { throw traduzErro(e); });
      },
      removerAdmin: function (uid) {
        return fb.fs.deleteDoc(doc("admins", uid)).catch(function (e) { throw traduzErro(e); });
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
      obterCapa: function (id) {
        return pegar("imagens", id).then(function (d) { return d ? d.imagem : null; })
          .catch(function () { return null; });
      },
      salvarCapa: function (id, dataUrl) {
        if (!dataUrl) {
          return fb.fs.deleteDoc(doc("imagens", id)).catch(function () { return null; });
        }
        return fb.fs.setDoc(doc("imagens", id), {
          imagem: dataUrl, autorUid: usuarioAtual.uid, atualizadoEm: Date.now()
        }).catch(function (e) { throw traduzErro(e); });
      },
      criarPesquisa: function (p) {
        var copia = Object.assign({}, p);
        delete copia.id;
        if (!CREDITOS_LIGADOS) {
          return fb.fs.setDoc(doc("pesquisas", p.id), copia).catch(function (e) { throw traduzErro(e); });
        }
        var lote = fb.fs.writeBatch(fb.db);
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
        var lote = fb.fs.writeBatch(fb.db);
        lote.delete(doc("pesquisas", id));
        lote.delete(doc("imagens", id));
        return lote.commit().catch(function (e) { throw traduzErro(e); });
      },
      alocarCreditos: function (id, n) {
        var lote = fb.fs.writeBatch(fb.db);
        lote.update(doc("pesquisadores", usuarioAtual.uid), { creditos: fb.fs.increment(-n), atualizadoEm: Date.now() });
        lote.update(doc("pesquisas", id), { creditos: fb.fs.increment(n) });
        fichaCache = null;
        return lote.commit().catch(function (e) { throw traduzErro(e); });
      },

      registrarParticipacao: function (p, hash, avaliacao) {
        var uid = usuarioAtual.uid;
        var pid = p.id + "__" + uid;
        var ganho = CREDITOS_LIGADOS ? valorEmCreditos(p.duracaoMin) : 0;
        var lote = fb.fs.writeBatch(fb.db);
        lote.set(doc("participacoes", pid), {
          pesquisaId: p.id, pesquisaTitulo: p.titulo, respondenteUid: uid,
          autorUid: p.autorUid, creditos: ganho, codigoHash: hash,
          nota: avaliacao.nota, tempo: avaliacao.tempo, criadoEm: Date.now()
        });
        var mudancasPesquisa = {
          respostasRecebidas: fb.fs.increment(1),
          creditos: fb.fs.increment(-ganho),
          ultimaParticipacao: Date.now(),
          notaSoma: fb.fs.increment(avaliacao.nota),
          notaQtd: fb.fs.increment(1)
        };
        if (avaliacao.tempo === "mais") mudancasPesquisa.tempoMais = fb.fs.increment(1);
        if (avaliacao.tempo === "menos") mudancasPesquisa.tempoMenos = fb.fs.increment(1);
        lote.update(doc("pesquisas", p.id), mudancasPesquisa);
        // Reciprocidade visível: quantas pesquisas de colegas esta pessoa
        // respondeu. É o reconhecimento que substitui a moeda.
        lote.set(doc("reputacao", uid), {
          respondidas: fb.fs.increment(1), ultimaEm: Date.now()
        }, { merge: true });
        if (ganho) {
          lote.update(doc("pesquisadores", uid), {
            creditos: fb.fs.increment(ganho), ultimaParticipacao: pid, atualizadoEm: Date.now()
          });
        }
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

      // Contagem agregada por dia, sem cookie e sem identificar ninguém.
      // Falha em silêncio: medir nunca pode atrapalhar quem está usando.
      contar: function (campo, pesquisaId) {
        var dia = diaDeHoje();
        var mudanca = { dia: dia };
        mudanca[campo] = fb.fs.increment(1);
        var tarefas = [
          fb.fs.setDoc(doc("metricas", "dia-" + dia), mudanca, { merge: true })
        ];
        if (pesquisaId) {
          var campoPesquisa = {};
          campoPesquisa[campo === "aberturas" ? "visualizacoes" : "cliques"] = fb.fs.increment(1);
          tarefas.push(fb.fs.updateDoc(doc("pesquisas", pesquisaId), campoPesquisa));
        }
        return Promise.all(tarefas.map(function (t) {
          return t.catch(function () { return null; });
        }));
      },
      listarMetricas: function () {
        return pegarTodos(col("metricas")).catch(function () { return []; });
      },
      obterReputacao: function (uid) {
        return pegar("reputacao", uid).catch(function () { return null; });
      },

      denunciar: function (d) {
        var lote = fb.fs.writeBatch(fb.db);
        lote.set(fb.fs.doc(col("denuncias")), d);
        lote.update(doc("pesquisas", d.pesquisaId), { denuncias: fb.fs.increment(1) });
        return lote.commit().catch(function (e) { throw traduzErro(e); });
      },
      listarDenuncias: function () {
        return pegarTodos(col("denuncias")).catch(function () { return []; });
      },
      resolverDenuncia: function (id, campos) {
        return fb.fs.updateDoc(doc("denuncias", id), campos).catch(function (e) { throw traduzErro(e); });
      },

      // Registro imutável do que a administração faz. Existe para proteger
      // quem administra tanto quanto quem é administrado.
      registrar: function (acao, alvo, detalhe) {
        return fb.fs.setDoc(fb.fs.doc(col("registro")), {
          quando: Date.now(),
          quem: usuarioAtual ? usuarioAtual.email : "?",
          acao: acao, alvo: alvo || "", detalhe: detalhe || ""
        }).catch(function () { return null; });
      },
      listarRegistro: function () {
        return pegarTodos(col("registro")).catch(function () { return []; });
      },

      apagarPessoa: function (uid) {
        return Promise.all([
          pegarTodos(fb.fs.query(col("pesquisas"), fb.fs.where("autorUid", "==", uid))),
          pegarTodos(fb.fs.query(col("participacoes"), fb.fs.where("respondenteUid", "==", uid)))
        ]).then(function (r) {
          var lote = fb.fs.writeBatch(fb.db);
          r[0].forEach(function (p) {
            lote.delete(doc("pesquisas", p.id));
            lote.delete(doc("imagens", p.id));
          });
          r[1].forEach(function (x) { lote.delete(doc("participacoes", x.id)); });
          lote.delete(doc("pesquisadores", uid));
          lote.delete(doc("reputacao", uid));
          lote.delete(doc("admins", uid));
          return lote.commit();
        }).catch(function (e) { throw traduzErro(e); });
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
    carregadoEm: 0,
    // O código de conclusão existe em texto apenas aqui, entre o momento em
    // que a pessoa o escolhe e a tela que manda instalá-lo no formulário.
    // O banco guarda só a impressão digital, então ninguém o recupera depois.
    codigoRecem: null
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

  // Medição: três eventos, todos anônimos e agregados por dia.
  //   visitas   — alguém abriu o site nesta aba
  //   aberturas — alguém abriu a ficha de uma pesquisa
  //   cliques   — alguém clicou para abrir o questionário
  // O que acontece dentro do formulário é do Google Forms, não daqui.
  function contar(campo, pesquisaId, chaveSessao) {
    if (chaveSessao && !primeiraVezNaSessao(chaveSessao)) return;
    try {
      var r = Dados.contar(campo, pesquisaId);
      if (r && r.catch) r.catch(function () { /* medir nunca atrapalha */ });
    } catch (e) { /* idem */ }
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

  // No mural o carimbo aparece pequeno, então leva só o veredito. O número
  // do CAAE, que ali ficaria ilegível, fica para a ficha.
  function carimboEtica(p, comCaae) {
    var canto = comCaae ? "" : " carimbo-canto";
    if (p.status === "encerrada") {
      return '<span class="carimbo carimbo-encerrado' + canto + '">Coleta encerrada</span>';
    }
    if (p.temCaae && p.caae) {
      return '<span class="carimbo carimbo-selo' + canto + '">Aprovada em CEP' +
        (comCaae ? '<span class="linha2">CAAE ' + esc(p.caae) + "</span>" : "") +
        "</span>";
    }
    return "";
  }

  // Sem imagem não há moldura vazia: o texto ocupa a folha inteira.
  function miniatura(p) {
    var img = imagemSegura(p.miniatura);
    if (!img) return "";
    return '<div class="capa"><img src="' + esc(img) + '" alt="" loading="lazy"></div>';
  }

  // A barra mostra o que decide a ordem do mural: quanto falta para a meta.
  function barraMeta(p) {
    var meta = Number(p.metaRespostas || 0);
    var tem = Number(p.respostasRecebidas || 0);
    if (!meta) {
      return '<p class="progresso-texto">' + plural(tem, "resposta", "respostas") + " pela plataforma</p>";
    }
    var pct = Math.min(100, Math.round(tem / meta * 100));
    return '<div class="progresso"><div class="progresso-trilho">' +
      '<div class="progresso-feito" style="width:' + pct + '%"></div></div>' +
      '<p class="progresso-texto">' + tem + " de " + meta + " respostas" +
      (tem >= meta ? ", meta atingida" : ", faltam " + (meta - tem)) + "</p></div>";
  }

  function fichaDados(p) {
    var itens = [];
    itens.push('<span class="dado dado-forte">' + esc(p.duracaoMin) + " min</span>");
    var ident = textoIdentificacao(p, "curto");
    if (ident) {
      itens.push('<span class="dado' + (p.identificacao === "anonimo" ? " dado-selo" : "") + '">' +
        esc(ident) + "</span>");
    }
    itens.push('<span class="dado">' + esc(p.area) + "</span>");
    itens.push('<span class="dado">' + esc(p.publico) + "</span>");
    var m = mediaNota(p);
    if (m !== null) {
      itens.push('<span class="dado dado-nota">clareza ' + m.toFixed(1).replace(".", ",") +
        " de 5, " + plural(Number(p.notaQtd), "avaliação", "avaliações") + "</span>");
    }
    var aviso = avisoDeTempo(p);
    if (aviso) itens.push('<span class="dado dado-aviso">' + aviso + "</span>");
    if (CREDITOS_LIGADOS && estado.usuario && p.status === "ativa") {
      itens.push('<span class="dado">' +
        (semCredito(p) ? "sem créditos agora" : "rende " + plural(valorEmCreditos(p.duracaoMin), "crédito", "créditos")) +
        "</span>");
    }
    if (diasDesde(p.criadoEm) <= PADROES.diasNovidade && p.status === "ativa") {
      itens.push('<span class="dado dado-novo">nova no mural</span>');
    }
    if (p.exemplo) itens.push('<span class="dado dado-exemplo">exemplo fictício</span>');
    return '<div class="ficha">' + itens.join("") + "</div>";
  }

  function mensagemWhatsApp(p, url) {
    return "Pesquisa acadêmica aberta a respostas: " + p.titulo +
      " (" + p.duracaoMin + " minutos). " + url;
  }

  function enderecoDaPesquisa(id) {
    return location.origin + location.pathname + "#/pesquisa/" + id;
  }

  function botaoWhatsApp(p, classe) {
    var texto = encodeURIComponent(mensagemWhatsApp(p, enderecoDaPesquisa(p.id)));
    return '<a class="' + classe + '" href="https://wa.me/?text=' + texto +
      '" target="_blank" rel="noopener noreferrer">Compartilhar no WhatsApp</a>';
  }

  function folhaPesquisa(p) {
    var capa = miniatura(p);
    var classes = "folha" + (capa ? " folha-com-capa" : "");
    if (p.status === "encerrada") classes += " folha-encerrada";
    else if (semCredito(p)) classes += " folha-sem-credito";

    return '<article class="' + classes + '">' +
      capa +
      '<div class="folha-corpo">' +
      carimboEtica(p, false) +
      '<h3 class="folha-titulo"><a href="#/pesquisa/' + esc(p.id) + '">' + esc(p.titulo) + "</a></h3>" +
      '<p class="folha-autor">' + esc(p.autorNome || "Pesquisador não identificado") +
        (p.autorInstituicao ? ", " + esc(p.autorInstituicao) : "") + "</p>" +
      '<p class="folha-resumo">' + esc(p.resumo) + "</p>" +
      fichaDados(p) +
      barraMeta(p) +
      '<div class="folha-pe">' +
        (p.status === "ativa"
          ? '<a class="btn btn-mini btn-vazio" href="#/pesquisa/' + esc(p.id) + '">Ver e responder</a>' +
            botaoWhatsApp(p, "btn btn-mini btn-discreto")
          : '<a class="btn btn-mini btn-discreto" href="#/pesquisa/' + esc(p.id) + '">Ver a ficha</a>') +
      "</div></div></article>";
  }

  /* ============================================================
     7. Mural
     ============================================================ */

  function verMural() {
    pintar('<p class="sumario">Carregando as pesquisas do mural.</p>');
    carregarPesquisas().then(function (lista) {
      var f = estado.filtro;
      var filtradas = lista.filter(function (p) {
        if (p.status === "rascunho" || p.status === "oculta") return false;
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

      // Quem está mais longe da meta vem primeiro; empate, a mais recente.
      var porNecessidade = function (a, b) {
        var d = faltaParaMeta(b) - faltaParaMeta(a);
        if (Math.abs(d) > 0.001) return d;
        return (b.criadoEm || 0) - (a.criadoEm || 0);
      };
      var porData = function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); };

      var abertas = filtradas.filter(function (p) { return p.status === "ativa" && !semCredito(p); }).sort(porNecessidade);
      var fila = filtradas.filter(function (p) { return p.status === "ativa" && semCredito(p); }).sort(porData);
      var fechadas = filtradas.filter(function (p) { return p.status !== "ativa"; }).sort(porData);

      var totalAbertas = lista.filter(function (p) { return p.status === "ativa"; }).length;
      var totalRespostas = lista.reduce(function (s, p) {
        return s + (p.status === "ativa" || p.status === "encerrada" ? Number(p.respostasRecebidas || 0) : 0);
      }, 0);

      var html = "";
      if (Dados.modo === "demo") {
        html += '<div class="aviso aviso-demo"><p><strong>Modo demonstração.</strong> ' +
          "O Firebase ainda não foi configurado, então tudo aqui fica salvo apenas neste navegador e as pesquisas abaixo são exemplos fictícios. " +
          "O passo a passo para ligar o banco online está no arquivo LEIA-ME.md.</p></div>";
      }

      html += '<div class="cabeca-secao"><h1>Mural de pesquisas abertas</h1>' +
        '<p class="contagem">' + plural(totalAbertas, "pesquisa aberta", "pesquisas abertas") + ", " +
        plural(totalRespostas, "resposta contabilizada", "respostas contabilizadas") + "</p></div>";

      html += '<p class="sumario">Responder não exige cadastro: escolha uma pesquisa, abra o questionário e pronto. ' +
        "As que estão mais longe de fechar a amostra aparecem primeiro.</p>";

      // Os filtros vinham antes da lista e ocupavam a primeira tela inteira
      // no celular. Recolhidos, quem só quer escolher uma pesquisa já a vê.
      var temFiltro = !!(f.area || f.duracao || f.busca);
      html += '<details class="filtros-caixa"' + (temFiltro ? " open" : "") + ">" +
        "<summary>Filtrar por tema, área ou tempo" +
        (temFiltro ? " (filtro ativo)" : "") + "</summary>" +
        '<form class="filtros" id="form-filtros">' +
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
        (temFiltro ? '<button class="btn btn-discreto" type="button" id="limpar-filtros">Limpar</button>' : "") +
        "</form></details>";

      if (!filtradas.length) {
        html += '<div class="vazio"><p>Nenhuma pesquisa corresponde a esse filtro. ' +
          'Tente ampliar a busca ou <a href="#/depositar">deposite a sua</a>.</p></div>';
      }

      if (abertas.length) html += abertas.map(folhaPesquisa).join("");

      if (fila.length) {
        html += '<hr class="divisor"><div class="cabeca-secao"><h2>Sem créditos no momento</h2>' +
          '<p class="contagem">' + plural(fila.length, "pesquisa", "pesquisas") + "</p></div>" +
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
      if (p && p.autorUid) {
        Dados.obterReputacao(p.autorUid).then(function (rep) {
          var n = rep ? Number(rep.respondidas || 0) : 0;
          var caixa = document.getElementById("reciprocidade");
          if (caixa && n > 0) {
            caixa.innerHTML = '<span class="dado dado-nota">já respondeu ' +
              plural(n, "pesquisa de colega", "pesquisas de colegas") + "</span>";
          }
        }).catch(function () { /* sem reputação, a ficha segue igual */ });
      }
      if (!p) {
        pintar('<a class="voltar" href="#/mural">Voltar ao mural</a>' +
          '<div class="vazio"><p>Esta pesquisa não está mais no mural.</p></div>');
        return;
      }
      p.id = p.id || id;
      var link = linkSeguro(p.link);
      var sou = estado.usuario && estado.usuario.uid === p.autorUid;
      var podeRegistrar = estado.usuario && !sou && !jaRegistrou &&
        p.status === "ativa" && !semCredito(p) && !p.exemplo;

      var html = '<a class="voltar" href="#/mural">Voltar ao mural</a>';

      var carimbo = carimboEtica(p, true);
      html += '<div class="detalhe-topo">' +
        "<h1>" + esc(p.titulo) + "</h1>" +
        '<p class="folha-autor">' + esc(p.autorNome || "Pesquisador não identificado") +
        (p.autorInstituicao ? ", " + esc(p.autorInstituicao) : "") + "</p>" +
        '<div class="ficha" id="reciprocidade"></div>' +
        (carimbo ? '<div class="carimbo-linha">' + carimbo + "</div>" : "") +
        "</div>";

      if (p.status === "oculta") {
        html += '<div class="aviso aviso-erro"><p><strong>Esta pesquisa foi retirada do mural pela administração.</strong>' +
          (p.motivoOcultacao ? " Motivo: " + esc(p.motivoOcultacao) + "." : "") +
          " Ela continua aqui para quem tem o endereço, mas não aparece nas listas e não recebe novas participações.</p></div>";
      } else if (p.status === "rascunho") {
        html += '<div class="aviso"><p><strong>Rascunho.</strong> ' +
          "Esta ficha ainda não foi publicada: ela não aparece no mural nem na fila de respostas.</p></div>";
      }

      if (p.exemplo) {
        html += '<div class="aviso aviso-demo"><p><strong>Esta é uma pesquisa de exemplo.</strong> ' +
          "Serve para o mural não nascer vazio. Não existe questionário por trás dela.</p></div>";
      }

      html += '<div class="detalhe-corpo"><p>' + esc(p.resumo) + "</p></div>";

      // O bloco de ação vem antes de tudo que é detalhe. Quem chega por um
      // link de WhatsApp já decidiu ajudar: o que ele precisa é do tempo,
      // da resposta sobre anonimato e do botão, sem rolar a tela.
      if (p.status === "ativa" && link) {
        html += '<div class="chamada">' +
          '<ul class="essenciais">' +
          "<li><strong>" + esc(p.duracaoMin) + " minutos</strong>" +
          (avisoDeTempo(p) ? ", mas " + avisoDeTempo(p) : " para responder") + "</li>" +
          "<li>" + esc(textoIdentificacao(p, "longo")) + "</li>" +
          "<li>Sem cadastro: você responde e pronto.</li>" +
          "</ul>" +
          '<a class="btn btn-grande" href="' + esc(link) + '"' +
          (link.indexOf("#/") === 0 ? "" : ' target="_blank" rel="noopener noreferrer"') +
          ">Responder o questionário</a>" +
          barraMeta(p) +
          "</div>";
        html += '<div id="depois-do-clique"></div>';
      } else if (p.status === "ativa") {
        html += '<div class="aviso aviso-erro"><p>O link do questionário está em branco ou inválido. ' +
          "Procure o pesquisador responsável.</p></div>";
      } else {
        html += '<p class="sumario">Esta coleta foi encerrada e o questionário não aceita mais respostas.</p>' +
          '<div class="bloco">' + barraMeta(p) + "</div>";
      }

      html += '<div id="capa-grande"></div>';

      html += '<div class="bloco"><h2 class="titulo-detalhes">Detalhes da pesquisa</h2><dl class="fichario">' +
        linhaFicha("Tempo estimado", esc(p.duracaoMin) + " minutos" +
          (avisoDeTempo(p) ? ", mas " + avisoDeTempo(p) : "")) +
        linhaFicha("Identificação", esc(textoIdentificacao(p, "longo"))) +
        linhaFicha("Quem pode responder", esc(p.publico)) +
        linhaFicha("Área", esc(p.area)) +
        linhaFicha("Situação", p.status === "ativa" ? "Coleta aberta" : "Coleta encerrada") +
        linhaFicha("Consentimento", p.tcleDeclarado
          ? "O pesquisador declarou que o questionário explica a pesquisa e pede sua autorização " +
            "antes das perguntas, como manda a norma de ética. " +
            (p.temCaae && p.caae
              ? "O estudo foi aprovado por um comitê de ética em pesquisa, sob o número " + esc(p.caae) + "."
              : "O número de aprovação em comitê de ética não foi informado.")
          : "Não declarado.") +
        (mediaNota(p) !== null
          ? linhaFicha("Avaliação de quem respondeu", "Clareza " +
              mediaNota(p).toFixed(1).replace(".", ",") + " de 5, em " +
              plural(Number(p.notaQtd), "avaliação", "avaliações") + ".")
          : "") +
        (CREDITOS_LIGADOS
          ? linhaFicha("Vale para quem responde", plural(valorEmCreditos(p.duracaoMin), "crédito", "créditos"))
          : "") +
        linhaFicha("No mural desde", dataCurta(p.criadoEm)) +
        "</dl></div>";

      if (p.status === "ativa" && link) {
        html += '<div class="linha-botoes">' +
          botaoWhatsApp(p, "btn btn-vazio") +
          (podeRegistrar ? '<button class="btn btn-discreto" type="button" id="abrir-codigo">Já respondi esta pesquisa</button>' : "") +
          "</div>";
      }

      if (jaRegistrou) {
        html += '<div class="bloco"><span class="carimbo carimbo-registrado">Participação registrada</span>' +
          '<p class="sumario" style="margin-top:1rem">Você registrou participação nesta pesquisa em ' +
          dataCurta(jaRegistrou.criadoEm) +
          (CREDITOS_LIGADOS && jaRegistrou.creditos
            ? " e recebeu " + plural(Number(jaRegistrou.creditos), "crédito", "créditos") : "") +
          ". Cada pesquisa conta uma vez por pessoa.</p></div>";
      } else if (!estado.usuario && p.status === "ativa" && !p.exemplo) {
        html += '<p class="sumario">Você pode responder sem criar conta. ' +
          'Se também está coletando dados, <a href="#/entrar">crie um cadastro</a> para depositar sua pesquisa aqui.</p>';
      }

      if (podeRegistrar) {
        html += '<form class="bloco" id="form-codigo" hidden>' +
          "<h3>Registrar participação</h3>" +
          '<p class="sumario">Ao terminar o questionário, o pesquisador mostra um código de conclusão na última tela. ' +
          "Informe o código e avalie a pesquisa: é a avaliação que orienta quem vem depois.</p>" +
          '<div class="campo"><label for="codigo">Código de conclusão</label>' +
          '<input type="text" id="codigo" name="codigo" autocomplete="off" spellcheck="false" required>' +
          '<p class="ajuda">Maiúsculas e minúsculas não importam.</p></div>' +
          '<div class="campo"><span class="rotulo">As perguntas estavam claras?</span>' +
          '<div class="notas" role="radiogroup" aria-label="Clareza das perguntas">' +
          [1, 2, 3, 4, 5].map(function (n) {
            return '<label class="nota"><input type="radio" name="nota" value="' + n + '"' +
              (n === 4 ? " checked" : "") + "><span>" + n + "</span></label>";
          }).join("") +
          '</div><p class="ajuda">1 é confuso, 5 é muito claro.</p></div>' +
          '<div class="campo"><span class="rotulo">O tempo bateu com os ' + esc(p.duracaoMin) + ' minutos declarados?</span>' +
          '<div class="notas" role="radiogroup" aria-label="Tempo de resposta">' +
          '<label class="nota nota-larga"><input type="radio" name="tempo" value="menos"><span>levei menos</span></label>' +
          '<label class="nota nota-larga"><input type="radio" name="tempo" value="bateu" checked><span>bateu</span></label>' +
          '<label class="nota nota-larga"><input type="radio" name="tempo" value="mais"><span>levei mais</span></label>' +
          "</div></div>" +
          '<div class="linha-botoes"><button class="btn" type="submit">Registrar participação</button></div>' +
          "</form>";
      }

      // Canal de denúncia, aberto a qualquer pessoa. Sem ele, a declaração
      // de ética que o site exibe não tem como ser contestada por quem
      // encontra o problema, que é justamente quem responde.
      if (!p.exemplo && !sou) {
        html += '<hr class="divisor">' +
          '<details class="denuncia"><summary>Há algo errado com esta pesquisa?</summary>' +
          '<form id="form-denuncia">' +
          '<p class="sumario">Use este espaço se o link não funcionar, se o questionário não apresentar o ' +
          "Termo de Consentimento, se pedir dados pessoais sem necessidade ou se não parecer pesquisa acadêmica. " +
          "A administração do mural lê todas as mensagens. Você não precisa se identificar.</p>" +
          '<div class="campo"><label for="d-motivo">Motivo</label><select id="d-motivo" name="motivo" required>' +
          MOTIVOS_DENUNCIA.map(function (m) {
            return '<option value="' + esc(m) + '">' + esc(m) + "</option>";
          }).join("") + "</select></div>" +
          '<div class="campo"><label for="d-texto">O que você viu (opcional)</label>' +
          '<textarea id="d-texto" name="texto" rows="3" maxlength="600"></textarea>' +
          '<p class="ajuda">Não escreva dados pessoais seus nem de outras pessoas aqui.</p></div>' +
          '<div class="linha-botoes" style="margin-top:0">' +
          '<button class="btn btn-vazio" type="submit">Enviar à administração</button></div>' +
          "</form></details>";
      }

      if (sou) {
        html += '<hr class="divisor"><div class="bloco"><h3>Esta pesquisa é sua</h3>' +
          (CREDITOS_LIGADOS
            ? '<p class="sumario">Créditos nesta pesquisa: <strong>' + esc(Number(p.creditos || 0)) + "</strong>. " +
              "Cada resposta de outro pesquisador consome " +
              plural(valorEmCreditos(p.duracaoMin), "crédito", "créditos") + ".</p>"
            : '<p class="sumario">Divulgue o endereço desta ficha, e não o link cru do formulário: ' +
              "quem chegar por aqui vê o TCLE declarado, o tempo e a avaliação de quem já respondeu.</p>") +
          '<div class="linha-botoes"><a class="btn btn-vazio" href="#/painel/pesquisas">Abrir meu painel</a>' +
          '<a class="btn btn-discreto" href="#/depositar/' + esc(p.id) + '">Editar a ficha</a></div></div>';
      }

      pintar(html);

      // O autor abrindo a própria ficha não é visita: inflaria o número
      // que ele usa justamente para avaliar a divulgação.
      if (!p.exemplo && !sou) contar("aberturas", p.id, "abriu:" + p.id);

      // O questionário abre em outra aba. Nesta, que fica para trás, o
      // clique revela o convite para responder a próxima: é o único momento
      // em que a pessoa está disposta e ainda está aqui.
      var irAoQuestionario = $(".chamada a.btn-grande");
      if (irAoQuestionario && p.status === "ativa") {
        irAoQuestionario.addEventListener("click", function () {
          if (!p.exemplo) contar("cliques", p.id, "clicou:" + p.id);
          var caixa = $("#depois-do-clique");
          if (!caixa || caixa.innerHTML) return;
          caixa.innerHTML = '<div class="bloco bloco-volta">' +
            "<h2>Obrigado por ajudar</h2>" +
            '<p class="sumario">O questionário abriu em outra aba. Quando terminar, ' +
            (podeRegistrar
              ? "volte aqui e informe o código de conclusão para a participação entrar na contagem desta pesquisa."
              : "você pode escolher outra pesquisa: a maioria leva menos de dez minutos, " +
                "e quase toda coleta que fecha a amostra no Brasil depende de gente que respondeu sem precisar.") +
            "</p>" +
            '<div class="linha-botoes" style="margin-top:0">' +
            '<a class="btn btn-vazio" href="#/mural">Ver outras pesquisas</a>' +
            botaoWhatsApp(p, "btn btn-discreto") +
            "</div></div>";
        });
      }

      // A capa grande fica em documento separado e só é buscada aqui, para
      // o mural não carregar imagem grande de pesquisa nenhuma.
      Dados.obterCapa(p.id).then(function (capa) {
        var img = imagemSegura(capa);
        var caixa = $("#capa-grande");
        if (img && caixa) {
          caixa.innerHTML = '<figure class="capa-grande"><img src="' + esc(img) +
            '" alt="Imagem da pesquisa ' + esc(p.titulo) + '"></figure>';
        }
      }).catch(function () { /* sem capa, segue sem imagem */ });

      var formDenuncia = $("#form-denuncia");
      if (formDenuncia) {
        formDenuncia.addEventListener("submit", function (ev) {
          ev.preventDefault();
          if (!primeiraVezNaSessao("denunciou:" + p.id)) {
            recado("Você já enviou uma mensagem sobre esta pesquisa.", "erro");
            return;
          }
          travar(formDenuncia, true);
          Dados.denunciar({
            pesquisaId: p.id,
            pesquisaTitulo: String(p.titulo || "").slice(0, 180),
            motivo: formDenuncia.motivo.value,
            texto: formDenuncia.texto.value.trim().slice(0, 600),
            status: "aberta",
            criadoEm: Date.now()
          }).then(function () {
            formDenuncia.outerHTML = '<p class="sumario">Mensagem enviada. Obrigado: ' +
              "é assim que o mural consegue manter a régua de ética.</p>";
            recado("Mensagem enviada à administração.", "ok");
          }).catch(function (e) {
            travar(formDenuncia, false);
            recado(e.message || "Não foi possível enviar.", "erro");
          });
        });
      }

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
          var avaliacao = {
            nota: parseInt(form.nota.value, 10) || 4,
            tempo: form.tempo.value || "bateu"
          };
          var enviar = $("button[type=submit]", form);
          enviar.disabled = true;
          hashCodigo(p.id, codigo)
            .then(function (h) { return Dados.registrarParticipacao(p, h, avaliacao); })
            .then(function (ganho) {
              estado.carregadoEm = 0;
              return atualizarFicha().then(function () {
                form.outerHTML = '<div class="bloco"><span class="carimbo carimbo-registrado bate">Participação registrada</span>' +
                  '<p class="sumario" style="margin-top:1rem">Obrigado. Sua participação entrou na contagem desta pesquisa' +
                  (ganho ? " e você recebeu " + plural(ganho, "crédito", "créditos") : "") +
                  '. <a href="#/mural">Ver outras pesquisas</a>.</p></div>';
                recado("Participação registrada.", "ok");
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
     8b. Depois de publicar: instalar o código no formulário
     ============================================================ */

  // Esta tela existe porque o passo mais fácil de esquecer é o que faz o
  // resto funcionar: colar o código na tela de confirmação do formulário.
  // Sem ele ninguém registra participação e a pesquisa parece parada.
  function verPublicada(id) {
    var recem = estado.codigoRecem && estado.codigoRecem.id === id ? estado.codigoRecem : null;
    pintar('<p class="sumario">Abrindo.</p>');

    Dados.obterPesquisa(id).then(function (p) {
      if (!p) { ir("#/mural"); return; }
      p.id = p.id || id;
      var endereco = enderecoDaPesquisa(p.id);
      var codigo = recem ? recem.codigo : null;
      var mensagem = "Obrigado por participar!\n\n" +
        "Se você veio pelo Mural da Coleta, registre sua participação com o código abaixo:\n\n" +
        (codigo ? codigo : "SEU-CÓDIGO") + "\n\n" + endereco;

      var html = "<h1>" + (recem && recem.novo === false ? "Código trocado" : "Pesquisa publicada") + "</h1>" +
        '<p class="sumario">Falta um passo, e é o que faz a contagem funcionar: ' +
        "colar o código de conclusão na tela que seu formulário mostra depois que a pessoa envia as respostas.</p>";

      if (codigo) {
        html += '<div class="bloco bloco-codigo">' +
          '<span class="rotulo">Seu código de conclusão</span>' +
          '<p class="codigo-grande">' + esc(codigo) + "</p>" +
          '<div class="linha-botoes" style="margin-top:.75rem">' +
          '<button class="btn btn-vazio btn-mini" type="button" data-copiar="' + esc(codigo) + '">Copiar o código</button>' +
          "</div></div>";

        html += '<div class="aviso"><p><strong>Anote esse código agora.</strong> ' +
          "Para que ninguém o descubra espiando o site, o banco guarda apenas uma impressão digital dele, " +
          "e nem o Mural consegue recuperá-lo depois. Se você esquecer, dá para trocar por outro no painel, " +
          "mas não dá para consultar o atual.</p></div>";
      } else {
        html += '<div class="aviso aviso-erro"><p>Esta página foi recarregada, então o código não está mais à mão: ' +
          "ele só existe em texto no momento em que você o escolhe. " +
          'Se não tiver anotado, abra <a href="#/painel/pesquisas">seu painel</a> e troque por um novo.</p></div>';
      }

      html += '<div class="bloco"><h2>Mensagem pronta para a tela de confirmação</h2>' +
        '<p class="sumario">Copie o texto abaixo e cole na mensagem que aparece ao fim do seu questionário.</p>' +
        '<pre class="trecho">' + esc(mensagem) + "</pre>" +
        '<div class="linha-botoes" style="margin-top:.75rem">' +
        '<button class="btn" type="button" data-copiar="' + esc(mensagem) + '">Copiar a mensagem</button></div></div>';

      html += '<div class="bloco"><h2>Onde colar, no Google Forms</h2>' +
        '<ol class="passos">' +
        "<li>Abra o formulário e clique na engrenagem de <strong>Configurações</strong>.</li>" +
        "<li>Abra a seção <strong>Apresentação</strong>.</li>" +
        "<li>Em <strong>Mensagem de confirmação</strong>, clique em editar e cole o texto acima.</li>" +
        "<li>Salve e envie uma resposta de teste para conferir que a mensagem aparece.</li>" +
        "</ol>" +
        '<p class="sumario">Em outras ferramentas o caminho muda de nome, mas a ideia é a mesma: ' +
        "procure a tela final, de agradecimento, que o respondente vê depois de enviar.</p></div>";

      html += '<div class="linha-botoes">' +
        '<a class="btn" href="#/pesquisa/' + esc(p.id) + '">Ver a ficha no mural</a>' +
        botaoWhatsApp(p, "btn btn-vazio") +
        '<a class="btn btn-discreto" href="#/painel/pesquisas">Ir para o painel</a></div>';

      pintar(html);

      Array.prototype.forEach.call(document.querySelectorAll("[data-copiar]"), function (b) {
        b.addEventListener("click", function () {
          var texto = b.getAttribute("data-copiar");
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(texto)
              .then(function () { recado("Copiado.", "ok"); })
              .catch(function () { recado("Seu navegador não deixou copiar. Selecione o texto à mão.", "erro"); });
          } else {
            recado("Seu navegador não deixou copiar. Selecione o texto à mão.", "erro");
          }
        });
      });
    }).catch(falhou);
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
      "<p>Crie um cadastro, preencha a ficha da sua pesquisa e publique. Não há fila de aprovação, " +
      "não há espera e não há nada a pagar: é só declarar o vínculo e as condições de ética.</p>" +
      "<h3>A ordem do mural</h3>" +
      "<p>As pesquisas aparecem na ordem de quem mais precisa: quanto mais longe da meta de respostas, " +
      "mais perto do topo. Quem acabou de publicar recebe a etiqueta de nova no mural. " +
      "A ideia é simples: atenção vai para quem ainda não fechou a amostra, e não para quem já tem volume.</p>" +
      "<h3>O código de conclusão</h3>" +
      "<p>Ao depositar, você escolhe um código e o coloca na mensagem de confirmação do seu formulário, " +
      "aquela tela que aparece depois de enviar as respostas. Outro pesquisador cadastrado informa esse código aqui, " +
      "e a participação entra na contagem pública da sua pesquisa. " +
      "O código nunca aparece no mural: o site guarda apenas uma impressão digital dele e compara.</p>" +
      "<h3>Reciprocidade sem moeda</h3>" +
      "<p>Este site já teve uma economia de créditos, em que responder rendia saldo e cada resposta recebida " +
      "custava. Ela está desligada enquanto a comunidade é pequena, porque cobrar antes de haver o que trocar " +
      "só afasta quem chega. O que sustenta a troca agora é mais simples: a ordem do mural favorece quem " +
      "precisa, e responder a pesquisa de outra pessoa é o que faz o mural existir. " +
      "A mecânica continua pronta no código e pode voltar quando houver movimento suficiente.</p></div>";

    html += '<div class="bloco"><h2>A avaliação de quem respondeu</h2>' +
      "<p>Ao registrar participação, a pessoa avalia duas coisas: se as perguntas estavam claras, de um a cinco, " +
      "e se o tempo bateu com o declarado. As duas notas aparecem na ficha da pesquisa.</p>" +
      "<p>O segundo número é o mais útil. Quase todo pesquisador subestima a duração do próprio instrumento, " +
      "e quem responde desiste no meio quando os dez minutos prometidos viram vinte. " +
      "Quando a maioria diz que levou mais tempo, o mural avisa — o que pressiona, de um jeito saudável, " +
      "a declarar o tempo de verdade.</p></div>";

    html += '<div class="bloco"><h2>Qualidade das respostas</h2>' +
      "<p>Cada pesquisador registra no máximo uma participação por pesquisa. " +
      "O que a plataforma contabiliza são as respostas de quem está cadastrado e informou o código; " +
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
      '<div class="linha-botoes"><button class="btn" type="submit">Criar cadastro</button></div></form></div>';

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
        recado("Cadastro criado.", "ok");
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
        "Leva um minuto, não há aprovação e você publica na hora.</p>" +
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
    Promise.all([
      editar ? Dados.obterPesquisa(id) : Promise.resolve(null),
      editar ? Dados.obterCapa(id) : Promise.resolve(null)
    ]).then(function (r) {
      var p = r[0];
      var capaAtual = imagemSegura(r[1]);
      if (editar && (!p || p.autorUid !== estado.usuario.uid)) {
        pintar('<div class="aviso aviso-erro"><p>Esta pesquisa não é sua ou não existe mais.</p></div>');
        return;
      }
      p = p || {};
      if (editar) p.id = p.id || id;
      var saldo = Number(estado.ficha.creditos || 0);
      var novaCapa = null;     // data URL grande, quando a pessoa escolhe imagem
      var novaMini = null;     // miniatura correspondente
      var removerCapa = false;

      var html = '<a class="voltar" href="' + (editar ? "#/painel/pesquisas" : "#/mural") + '">Voltar</a>' +
        "<h1>" + (editar ? "Editar a ficha da pesquisa" : "Depositar uma pesquisa") + "</h1>" +
        '<p class="sumario">O questionário continua onde está, no Google Forms, Qualtrics, LimeSurvey ou no que você usa. ' +
        "O que entra no mural é a ficha abaixo e o link.</p>";

      if (!editar && CREDITOS_LIGADOS) {
        html += '<div class="saldo"><div class="saldo-item"><div class="saldo-numero">' + saldo + "</div>" +
          '<div class="saldo-rotulo">créditos na sua conta</div></div></div>';
      }

      html += '<form id="form-pesquisa">' +
        '<div class="campo" style="max-width:40rem"><label for="p-titulo">Título da pesquisa</label>' +
        '<input type="text" id="p-titulo" name="titulo" required minlength="10" maxlength="180" value="' + esc(p.titulo || "") + '">' +
        '<p class="ajuda">Diga o tema e quem você procura. É a linha que decide se alguém clica.</p></div>' +

        '<div class="campo" style="max-width:40rem"><label for="p-resumo">Resumo para o respondente</label>' +
        '<textarea id="p-resumo" name="resumo" required minlength="40" maxlength="1200" rows="5">' + esc(p.resumo || "") + "</textarea>" +
        '<p class="ajuda">Em linguagem acessível, sem jargão: o que a pessoa vai responder e para quê. De quarenta a mil e duzentos caracteres.</p></div>' +

        '<div class="campo" style="max-width:40rem"><label for="p-imagem">Imagem da pesquisa (opcional)</label>' +
        '<input type="file" id="p-imagem" name="imagem" accept="image/*">' +
        '<p class="ajuda">Uma foto ou arte que diga do que se trata. O site reduz e comprime a imagem no seu navegador antes de enviar, ' +
        "então pode escolher o arquivo original. Evite imagem com texto pequeno, porque no mural ela aparece em miniatura.</p>" +
        '<div id="previa-capa">' +
        (capaAtual
          ? '<figure class="previa"><img src="' + esc(capaAtual) + '" alt="Imagem atual da pesquisa">' +
            '<figcaption><button class="btn btn-mini btn-risco" type="button" id="tirar-capa">Remover imagem</button></figcaption></figure>'
          : "") +
        "</div></div>" +

        '<div class="par"><div class="campo"><label for="p-area">Área</label><select id="p-area" name="area" required>' +
        (window.AREAS || []).map(function (a) {
          return '<option value="' + esc(a) + '"' + (p.area === a ? " selected" : "") + ">" + esc(a) + "</option>";
        }).join("") + "</select></div>" +
        '<div class="campo"><label for="p-publico">Quem pode responder</label><select id="p-publico" name="publico" required>' +
        (window.PUBLICOS || []).map(function (a) {
          return '<option value="' + esc(a) + '"' + (p.publico === a ? " selected" : "") + ">" + esc(a) + "</option>";
        }).join("") + "</select></div></div>" +

        '<div class="campo" style="max-width:40rem"><label for="p-identificacao">O questionário identifica quem responde?</label>' +
        '<select id="p-identificacao" name="identificacao" required>' +
        IDENTIFICACAO.map(function (i) {
          return '<option value="' + esc(i.valor) + '"' +
            (p.identificacao === i.valor ? " selected" : "") + ">" + esc(i.longo) + "</option>";
        }).join("") + "</select>" +
        '<p class="ajuda">Aparece em destaque na ficha, em letras claras. É a primeira coisa que quem responde quer saber, ' +
        "e responder isso com honestidade aumenta a adesão em vez de diminuir.</p></div>" +

        '<div class="par"><div class="campo"><label for="p-duracao">Tempo de resposta, em minutos</label>' +
        '<input type="number" id="p-duracao" name="duracaoMin" min="1" max="' + PADROES.duracaoMax +
        '" required value="' + esc(p.duracaoMin || 10) + '">' +
        '<p class="ajuda" id="aviso-custo"></p></div>' +
        '<div class="campo"><label for="p-meta">Meta de respostas</label>' +
        '<input type="number" id="p-meta" name="metaRespostas" min="0" max="100000" value="' + esc(p.metaRespostas || "") + '">' +
        '<p class="ajuda">Quantas respostas você precisa. É o que coloca a pesquisa mais perto do topo do mural: ' +
        "quanto mais longe da meta, mais atenção. Em branco, o mural assume " + PADROES.metaPadrao + ".</p></div></div>" +

        '<div class="campo" style="max-width:40rem"><label for="p-link">Link do questionário</label>' +
        '<input type="url" id="p-link" name="link" required placeholder="https://docs.google.com/forms/..." value="' +
        esc(/^https?:/i.test(p.link || "") ? p.link : "") + '">' +
        '<p class="ajuda">Precisa começar com https. Teste o link em uma janela anônima antes de publicar.</p></div>' +

        '<div class="campo"><label for="p-codigo">Código de conclusão</label>' +
        '<input type="text" id="p-codigo" name="codigo" autocomplete="off" spellcheck="false" ' +
        (editar ? 'placeholder="deixe em branco para manter o código atual"' : "required") +
        ' minlength="' + PADROES.minCodigo + '" maxlength="40" value="">' +
        '<p class="ajuda">Escolha uma palavra ou sequência de pelo menos ' + PADROES.minCodigo +
        " caracteres. Depois de salvar, o site mostra onde colá-la no seu formulário. " +
        "Anote o que escolher: o banco guarda só uma impressão digital do código, então ele não pode ser consultado depois, " +
        "apenas trocado.</p></div>" +

        '<div class="caixa-marcar"><input type="checkbox" id="p-tcle" name="tcle" required' +
        (p.tcleDeclarado ? " checked" : "") + ">" +
        '<label for="p-tcle">Declaro que o formulário apresenta o Termo de Consentimento Livre e Esclarecido ' +
        "antes das perguntas, com finalidade, riscos, possibilidade de desistir e contato do responsável, " +
        "e que a condução da pesquisa segue as normas de ética vigentes.</label></div>" +

        '<div class="campo"><label for="p-caae">Número do CAAE ou do parecer do CEP (opcional)</label>' +
        '<input type="text" id="p-caae" name="caae" maxlength="40" value="' + esc(p.caae || "") + '">' +
        '<p class="ajuda">Informando o número, a pesquisa recebe o carimbo de aprovação em CEP no mural. ' +
        "Pesquisas dispensadas de apreciação também são aceitas; basta deixar em branco.</p></div>";

      if (!editar && CREDITOS_LIGADOS) {
        var sugestao = Math.min(saldo, 10);
        html += '<div class="campo"><label for="p-creditos">Créditos para esta pesquisa</label>' +
          '<input type="number" id="p-creditos" name="creditos" min="0" max="' + saldo + '" value="' + sugestao + '">' +
          '<p class="ajuda">Saem do seu saldo de ' + saldo + " e podem ser recarregados depois no painel.</p></div>";
      }

      var eraRascunho = p.status === "rascunho";
      html += '<div class="linha-botoes"><button class="btn" type="submit" name="acao" value="publicar">' +
        (editar && !eraRascunho ? "Salvar alterações" : "Publicar no mural") + "</button>" +
        (!editar || eraRascunho
          ? '<button class="btn btn-vazio" type="submit" name="acao" value="rascunho">Guardar como rascunho</button>'
          : "") +
        '<a class="btn btn-discreto" href="' + (editar ? "#/painel/pesquisas" : "#/mural") + '">Cancelar</a></div>' +
        (!editar || eraRascunho
          ? '<p class="ajuda" style="max-width:40rem">O rascunho fica guardado só para você, fora do mural. ' +
            "Útil quando o questionário ainda está sendo montado e você não tem o link definitivo: " +
            "nesse caso, preencha o link com qualquer endereço e corrija antes de publicar.</p>"
          : "") +
        "</form>";

      pintar(html);

      var campoDuracao = $("#p-duracao");
      var avisoCusto = $("#aviso-custo");
      function atualizarCusto() {
        if (CREDITOS_LIGADOS) {
          var v = valorEmCreditos(campoDuracao.value);
          avisoCusto.textContent = "Rende " + plural(v, "crédito", "créditos") +
            " para quem responder e consome o mesmo a cada resposta recebida.";
        } else {
          avisoCusto.textContent = "Declare o tempo real. Quem responde avalia se bateu, " +
            "e o mural avisa quando a maioria diz que levou mais.";
        }
      }
      campoDuracao.addEventListener("input", atualizarCusto);
      atualizarCusto();

      var campoImagem = $("#p-imagem");
      var previa = $("#previa-capa");

      function ligarRemover() {
        var btn = $("#tirar-capa");
        if (!btn) return;
        btn.addEventListener("click", function () {
          novaCapa = null; novaMini = null; removerCapa = true;
          campoImagem.value = "";
          previa.innerHTML = '<p class="ajuda">A imagem será removida ao salvar.</p>';
        });
      }
      ligarRemover();

      campoImagem.addEventListener("change", function () {
        var arquivo = campoImagem.files && campoImagem.files[0];
        if (!arquivo) return;
        previa.innerHTML = '<p class="ajuda">Comprimindo a imagem.</p>';
        Promise.all([
          comprimirImagem(arquivo, PADROES.larguraCapa, PADROES.limiteCapa),
          comprimirImagem(arquivo, PADROES.larguraMiniatura, PADROES.limiteMiniatura)
        ]).then(function (res) {
          novaCapa = res[0]; novaMini = res[1]; removerCapa = false;
          var kb = Math.round(novaCapa.length / 1024);
          previa.innerHTML = '<figure class="previa"><img src="' + esc(novaCapa) + '" alt="Prévia da imagem escolhida">' +
            '<figcaption><span class="contagem">imagem pronta, cerca de ' + kb + ' KB</span> ' +
            '<button class="btn btn-mini btn-risco" type="button" id="tirar-capa">Remover imagem</button></figcaption></figure>';
          ligarRemover();
        }).catch(function (e) {
          novaCapa = null; novaMini = null;
          campoImagem.value = "";
          previa.innerHTML = "";
          recado(e.message, "erro");
        });
      });

      var acaoEscolhida = "publicar";
      Array.prototype.forEach.call(document.querySelectorAll("#form-pesquisa button[type=submit]"), function (b) {
        b.addEventListener("click", function () { acaoEscolhida = b.value; });
      });

      $("#form-pesquisa").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var f = ev.target;
        var comoRascunho = acaoEscolhida === "rascunho";
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
          identificacao: f.identificacao.value,
          metaRespostas: parseInt(f.metaRespostas.value, 10) || 0,
          link: link,
          tcleDeclarado: true,
          temCaae: !!caae,
          caae: caae
        };
        if (novaMini) campos.miniatura = novaMini;
        if (removerCapa) campos.miniatura = "";

        travar(f, true);
        var idPesquisa = editar ? p.id : Dados.novoId();
        var passo = codigo ? hashCodigo(idPesquisa, codigo) : Promise.resolve(null);

        passo.then(function (h) {
          if (h) campos.codigoHash = h;
          if (editar) {
            campos.atualizadoEm = Date.now();
            // Um rascunho vira pesquisa viva ao ser publicado; uma pesquisa
            // já publicada não volta a rascunho por engano ao ser editada.
            if (eraRascunho) campos.status = comoRascunho ? "rascunho" : "ativa";
            return Dados.salvarPesquisa(idPesquisa, campos);
          }
          campos.id = idPesquisa;
          campos.autorUid = estado.usuario.uid;
          campos.autorNome = estado.ficha.nome;
          campos.autorInstituicao = estado.ficha.instituicao;
          campos.status = comoRascunho ? "rascunho" : "ativa";
          campos.respostasRecebidas = 0;
          campos.notaSoma = 0;
          campos.notaQtd = 0;
          campos.tempoMais = 0;
          campos.tempoMenos = 0;
          campos.creditos = CREDITOS_LIGADOS
            ? Math.max(0, Math.min(saldo, parseInt(f.creditos.value, 10) || 0))
            : 0;
          campos.criadoEm = Date.now();
          campos.exemplo = false;
          if (!campos.miniatura) campos.miniatura = "";
          return Dados.criarPesquisa(campos);
        }).then(function () {
          if (novaCapa) return Dados.salvarCapa(idPesquisa, novaCapa);
          if (removerCapa) return Dados.salvarCapa(idPesquisa, null);
          return null;
        }).then(function () {
          estado.carregadoEm = 0;
          return atualizarFicha();
        }).then(function () {
          if (comoRascunho) {
            recado("Rascunho guardado. Ele não aparece no mural.", "ok");
            ir("#/painel/pesquisas");
            return;
          }
          recado(editar ? "Ficha atualizada." : "Pesquisa publicada no mural.", "ok");
          // Com código novo em mãos, a próxima tela ensina a instalá-lo.
          if (codigo) {
            estado.codigoRecem = { id: idPesquisa, codigo: codigo, novo: !editar };
            ir("#/publicada/" + idPesquisa);
          } else {
            ir("#/pesquisa/" + idPesquisa);
          }
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

    html += '<div class="saldo">' +
      (CREDITOS_LIGADOS
        ? '<div class="saldo-item"><div class="saldo-numero">' +
          Number(estado.ficha ? estado.ficha.creditos : 0) + "</div>" +
          '<div class="saldo-rotulo">créditos livres</div></div>'
        : "") +
      '<div class="saldo-item"><div class="valor" id="n-pesquisas">—</div>' +
      '<div class="saldo-rotulo">pesquisas suas no mural</div></div>' +
      '<div class="saldo-item"><div class="valor" id="n-respostas">—</div>' +
      '<div class="saldo-rotulo">respostas recebidas</div></div>' +
      '<div class="saldo-item"><div class="valor" id="n-dadas">—</div>' +
      '<div class="saldo-rotulo">pesquisas respondidas</div></div></div>';

    html += '<div class="abas" role="tablist">' +
      aboto("pesquisas", "Minhas pesquisas", aba) +
      aboto("responder", "Responder pesquisas", aba) +
      aboto("participacoes", "Minhas participações", aba) +
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
      if (aba === "pesquisas") painelPesquisas(corpo, minhas);
      else if (aba === "responder") painelResponder(corpo, todas, minhasPart);
      else if (aba === "participacoes") painelParticipacoes(corpo, minhasPart, minhas);
      else painelVinculo(corpo);
    }).catch(falhou);
  }

  function aboto(id, texto, atual) {
    return '<button type="button" role="tab" data-aba="' + id + '" aria-selected="' +
      (atual === id ? "true" : "false") + '">' + texto + "</button>";
  }

  function painelPesquisas(corpo, minhas) {
    if (!minhas.length) {
      corpo.innerHTML = '<div class="vazio"><p>Você ainda não depositou nenhuma pesquisa. ' +
        "Não há fila de aprovação: publique agora e ela entra no mural na hora.</p></div>" +
        '<div class="linha-botoes"><a class="btn" href="#/depositar">Depositar uma pesquisa</a></div>';
      return;
    }

    var html = '<div class="linha-botoes" style="margin-top:0;margin-bottom:1.25rem">' +
      '<a class="btn" href="#/depositar">Depositar outra pesquisa</a></div>';

    minhas.sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });

    minhas.forEach(function (p) {
      var m = mediaNota(p);
      var vis = Number(p.visualizacoes || 0);
      var cli = Number(p.cliques || 0);
      var dg = diagnostico(p);
      var situacao = p.status === "ativa" ? "no mural"
        : p.status === "rascunho" ? "rascunho"
        : p.status === "oculta" ? "retirada do mural" : "encerrada";
      html += '<article class="folha' + (p.status !== "ativa" ? " folha-encerrada" : "") + '">' +
        '<h3 class="folha-titulo"><a href="#/pesquisa/' + esc(p.id) + '">' + esc(p.titulo) + "</a></h3>" +
        barraMeta(p) +
        '<p class="progresso-texto" style="margin-bottom:.75rem">' +
        "Ficha aberta " + plural(vis, "vez", "vezes") +
        ", questionário aberto " + plural(cli, "vez", "vezes") +
        (vis ? " (" + Math.round(cli / vis * 100) + "%)" : "") +
        ", código informado " + plural(Number(p.respostasRecebidas || 0), "vez", "vezes") + "</p>" +
        '<p class="leitura leitura-' + dg.tom + '">' + dg.texto + "</p>" +
        '<div class="ficha">' +
        '<span class="dado' + (p.status === "ativa" ? "" : " dado-aviso") + '">' + situacao + "</span>" +
        '<span class="dado">' + esc(p.duracaoMin) + " min</span>" +
        (m !== null ? '<span class="dado dado-nota">clareza ' + m.toFixed(1).replace(".", ",") + " de 5</span>" : "") +
        (CREDITOS_LIGADOS ? '<span class="dado dado-forte">' + Number(p.creditos || 0) + " créditos</span>" : "") +
        "</div>" +
        '<div class="folha-pe">' +
        (p.status === "rascunho"
          ? '<button class="btn btn-mini" data-acao="publicar" data-id="' + esc(p.id) + '">Publicar no mural</button>'
          : "") +
        '<a class="btn btn-mini btn-vazio" href="#/depositar/' + esc(p.id) + '">Editar ficha</a>' +
        '<button class="btn btn-mini btn-discreto" data-acao="codigo" data-id="' + esc(p.id) + '">Trocar código</button>' +
        (p.status === "ativa" ? botaoWhatsApp(p, "btn btn-mini btn-discreto") : "") +
        (CREDITOS_LIGADOS
          ? '<button class="btn btn-mini btn-discreto" data-acao="recarregar" data-id="' + esc(p.id) + '">Adicionar créditos</button>'
          : "") +
        (p.status === "rascunho" || p.status === "oculta" ? ""
          : '<button class="btn btn-mini btn-discreto" data-acao="situacao" data-id="' + esc(p.id) +
            '" data-status="' + esc(p.status) + '">' +
            (p.status === "ativa" ? "Encerrar coleta" : "Reabrir coleta") + "</button>") +
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
          var saldo = Number(estado.ficha ? estado.ficha.creditos : 0);
          var quanto = prompt("Quantos créditos transferir do seu saldo para esta pesquisa?\nSaldo livre: " + saldo, "5");
          if (quanto === null) return;
          var n = parseInt(quanto, 10);
          if (!n || n < 1) { recado("Informe um número inteiro maior que zero.", "erro"); return; }
          if (n > saldo) { recado("Você tem só " + saldo + " créditos livres.", "erro"); return; }
          Dados.alocarCreditos(id, n).then(function () {
            estado.carregadoEm = 0;
            return atualizarFicha();
          }).then(function () {
            recado(plural(n, "crédito", "créditos") + " na pesquisa.", "ok");
            verPainel("pesquisas");
          }).catch(function (e) { recado(e.message, "erro"); });
          return;
        }

        if (acao === "publicar") {
          Dados.salvarPesquisa(id, { status: "ativa", atualizadoEm: Date.now() }).then(function () {
            estado.carregadoEm = 0;
            recado("Pesquisa publicada no mural.", "ok");
            verPainel("pesquisas");
          }).catch(function (e) { recado(e.message, "erro"); });
          return;
        }

        if (acao === "codigo") {
          var novoCodigo = prompt(
            "Escolha um novo código de conclusão, com pelo menos " + PADROES.minCodigo + " caracteres.\n\n" +
            "As participações já registradas continuam valendo. A partir da troca, só o código novo funciona, " +
            "então atualize a mensagem de confirmação do seu formulário.", "");
          if (novoCodigo === null) return;
          novoCodigo = novoCodigo.trim();
          if (novoCodigo.length < PADROES.minCodigo) {
            recado("O código precisa de pelo menos " + PADROES.minCodigo + " caracteres.", "erro");
            return;
          }
          hashCodigo(id, novoCodigo).then(function (h) {
            return Dados.salvarPesquisa(id, { codigoHash: h, atualizadoEm: Date.now() });
          }).then(function () {
            estado.carregadoEm = 0;
            estado.codigoRecem = { id: id, codigo: novoCodigo, novo: false };
            recado("Código trocado.", "ok");
            ir("#/publicada/" + id);
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
          if (!confirm("Remover esta pesquisa do mural? Não há como desfazer.")) return;
          Dados.excluirPesquisa(id).then(function () {
            estado.carregadoEm = 0;
            recado("Pesquisa removida.", "ok");
            verPainel("pesquisas");
          }).catch(function (e) { recado(e.message, "erro"); });
          return;
        }

        if (acao === "participantes") {
          Dados.listarParticipacoes().then(function (todas) {
            var linhas = [["pesquisa", "data", "clareza", "tempo"]];
            todas.filter(function (x) { return x.pesquisaId === id; }).forEach(function (x) {
              linhas.push([x.pesquisaTitulo || id, dataCurta(x.criadoEm), x.nota || "", x.tempo || ""]);
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
    }).sort(function (a, b) { return faltaParaMeta(b) - faltaParaMeta(a); });

    var html = '<p class="sumario">Estas são as pesquisas de outras pessoas que ainda precisam de respostas, ' +
      "das mais longe da meta para as mais perto. Responda de verdade e volte com o código de conclusão: " +
      "sua participação entra na contagem e sua avaliação orienta quem vem depois.</p>";

    if (!fila.length) {
      html += '<div class="vazio"><p>Não há pesquisas de outras pessoas na fila agora. ' +
        "Isso acontece quando você já respondeu a todas as que estão no mural. " +
        'Vale olhar o <a href="#/mural">mural</a> de novo em alguns dias.</p></div>';
    } else {
      html += fila.map(folhaPesquisa).join("");
    }

    corpo.innerHTML = html;
  }

  function painelParticipacoes(corpo, minhasPart, minhas) {
    var html = "";

    if (CREDITOS_LIGADOS) {
      var ganho = minhasPart.reduce(function (s, x) { return s + Number(x.creditos || 0); }, 0);
      var alocado = minhas.reduce(function (s, p) { return s + Number(p.creditos || 0); }, 0);
      html += '<div class="rolagem"><table><thead><tr><th>Movimento</th><th>Créditos</th></tr></thead><tbody>' +
        "<tr><td>Ganhos respondendo pesquisas</td><td class=\"num\">+" + ganho + "</td></tr>" +
        "<tr><td>Separados para as suas pesquisas</td><td class=\"num\">" + alocado + "</td></tr>" +
        "<tr><td><strong>Saldo livre agora</strong></td><td class=\"num\"><strong>" +
        Number(estado.ficha ? estado.ficha.creditos : 0) + "</strong></td></tr>" +
        "</tbody></table></div>";
    }

    html += "<h3>Pesquisas que você respondeu</h3>";
    if (!minhasPart.length) {
      html += '<div class="vazio"><p>Nenhuma participação registrada ainda. ' +
        "A aba <em>responder pesquisas</em> mostra quem está precisando.</p></div>";
    } else {
      minhasPart.sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });
      var rotuloTempo = { menos: "levei menos", bateu: "bateu", mais: "levei mais" };
      html += '<div class="rolagem"><table><thead><tr><th>Pesquisa</th><th>Data</th>' +
        "<th>Clareza</th><th>Tempo</th></tr></thead><tbody>" +
        minhasPart.map(function (x) {
          return "<tr><td>" + esc(x.pesquisaTitulo || x.pesquisaId) + "</td><td>" + dataCurta(x.criadoEm) +
            '</td><td class="num">' + (x.nota ? esc(x.nota) + " de 5" : "—") + "</td><td>" +
            esc(rotuloTempo[x.tempo] || "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<div class="linha-botoes"><button class="btn btn-discreto" id="baixar-extrato">Baixar em CSV</button></div>';
    }

    corpo.innerHTML = html;

    var b = $("#baixar-extrato");
    if (b) b.addEventListener("click", function () {
      var linhas = [["pesquisa", "data", "clareza", "tempo"]];
      minhasPart.forEach(function (x) {
        linhas.push([x.pesquisaTitulo || x.pesquisaId, dataCurta(x.criadoEm), x.nota || "", x.tempo || ""]);
      });
      baixar("participacoes-mural-da-coleta.csv", csv(linhas));
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
        "Entre com a conta de administrador, ou peça a quem administra o site para incluir você " +
        "pela aba de administradores.</p></div>");
      return;
    }
    aba = aba || "pesquisas";

    var html = "<h1>Administração</h1>" +
      '<div class="abas" role="tablist">' +
      aboto("pesquisas", "Pesquisas", aba) +
      aboto("moderacao", "Moderação", aba) +
      aboto("pesquisadores", "Pesquisadores", aba) +
      aboto("trafego", "Tráfego", aba) +
      aboto("registro", "Registro", aba) +
      aboto("admins", "Administradores", aba) +
      aboto("economia", "Ajustes e exemplos", aba) +
      '</div><div id="admin-corpo"><p class="sumario">Carregando.</p></div>';

    pintar(html);

    Array.prototype.forEach.call(document.querySelectorAll(".abas button"), function (b) {
      b.addEventListener("click", function () { ir("#/admin/" + b.dataset.aba); });
    });

    var corpo = $("#admin-corpo");

    if (aba === "pesquisas") { adminPesquisas(corpo); return; }
    if (aba === "moderacao") { adminModeracao(corpo); return; }
    if (aba === "pesquisadores") { adminPesquisadores(corpo); return; }
    if (aba === "trafego") { adminTrafego(corpo); return; }
    if (aba === "registro") { adminRegistro(corpo); return; }
    if (aba === "admins") { adminAdministradores(corpo); return; }
    adminAjustes(corpo);
  }

  /* ---------- Moderação ---------- */

  // Lê os dados que o site já tem e aponta o que merece olhar. Sem isso, a
  // lista de pesquisas é só ordem cronológica, e em trezentas fichas o
  // problema some no meio.
  function sinaisDeAtencao(pesquisas) {
    var sinais = [];
    pesquisas.forEach(function (p) {
      if (p.exemplo || p.status === "rascunho") return;
      var vis = Number(p.visualizacoes || 0);
      var cli = Number(p.cliques || 0);
      var resp = Number(p.respostasRecebidas || 0);
      var dias = diasDesde(p.criadoEm);
      var qtd = Number(p.notaQtd || 0);
      var media = mediaNota(p);

      if (Number(p.denuncias || 0) > 0 && p.status === "ativa") {
        sinais.push({ p: p, peso: 1, texto: plural(Number(p.denuncias), "denúncia recebida", "denúncias recebidas") });
      }
      if (p.status === "ativa" && cli >= 5 && resp === 0 && dias >= 14) {
        sinais.push({
          p: p, peso: 2,
          texto: "houve " + cli + " cliques e nenhum código informado em " + dias +
            " dias: o código provavelmente não está na tela de confirmação do formulário"
        });
      }
      if (p.status === "ativa" && vis >= 15 && cli === 0) {
        sinais.push({ p: p, peso: 2, texto: "a ficha foi aberta " + vis + " vezes e ninguém clicou no questionário: vale conferir o link" });
      }
      if (qtd >= 3 && media !== null && media < 3) {
        sinais.push({ p: p, peso: 3, texto: "clareza avaliada em " + media.toFixed(1).replace(".", ",") + " de 5" });
      }
      if (Number(p.metaRespostas || 0) > 5000) {
        sinais.push({ p: p, peso: 4, texto: "meta de " + p.metaRespostas + " respostas, fora do comum para coleta acadêmica" });
      }
      if (p.status === "ativa" && !p.temCaae &&
          /sa[úu]de|enfermagem|psicologia/i.test(String(p.area || ""))) {
        sinais.push({ p: p, peso: 4, texto: "área de saúde sem número de CAAE informado" });
      }
    });
    return sinais.sort(function (a, b) { return a.peso - b.peso; });
  }

  function adminModeracao(corpo) {
    Promise.all([Dados.listarDenuncias(), carregarPesquisas(true)]).then(function (r) {
      var denuncias = r[0], pesquisas = r[1];
      var porId = {};
      pesquisas.forEach(function (p) { porId[p.id] = p; });

      var abertas = denuncias.filter(function (d) { return d.status !== "arquivada"; })
        .sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });

      var html = '<p class="sumario">Aqui chegam as mensagens de quem responde e os sinais que o próprio site ' +
        "levanta a partir dos números. Retirar do mural é reversível e fica registrado; apagar não.</p>";

      html += "<h3>Mensagens recebidas" + (abertas.length ? " (" + abertas.length + ")" : "") + "</h3>";
      if (!abertas.length) {
        html += '<div class="vazio"><p>Nenhuma mensagem em aberto.</p></div>';
      } else {
        html += abertas.map(function (d) {
          var p = porId[d.pesquisaId];
          return '<article class="folha">' +
            '<h3 class="folha-titulo">' +
            (p ? '<a href="#/pesquisa/' + esc(d.pesquisaId) + '">' + esc(d.pesquisaTitulo || d.pesquisaId) + "</a>"
               : esc(d.pesquisaTitulo || d.pesquisaId) + " (pesquisa apagada)") + "</h3>" +
            '<div class="ficha"><span class="dado dado-aviso">' + esc(d.motivo) + "</span>" +
            '<span class="dado">' + dataCurta(d.criadoEm) + "</span>" +
            (p ? '<span class="dado">' + esc(p.status) + "</span>" : "") + "</div>" +
            (d.texto ? '<p class="folha-resumo">' + esc(d.texto) + "</p>" : "") +
            '<div class="folha-pe">' +
            (p && p.status === "ativa"
              ? '<button class="btn btn-mini btn-risco" data-mod="ocultar" data-id="' + esc(d.pesquisaId) + '">Retirar do mural</button>'
              : "") +
            '<button class="btn btn-mini btn-discreto" data-mod="arquivar" data-id="' + esc(d.id) + '">Arquivar mensagem</button>' +
            "</div></article>";
        }).join("");
      }

      var sinais = sinaisDeAtencao(pesquisas);
      html += '<hr class="divisor"><h3>Sinais levantados pelo site' + (sinais.length ? " (" + sinais.length + ")" : "") + "</h3>";
      if (!sinais.length) {
        html += '<div class="vazio"><p>Nada fora do comum nas pesquisas do mural.</p></div>';
      } else {
        html += '<div class="rolagem"><table><thead><tr><th>Pesquisa</th><th>O que chamou atenção</th>' +
          "<th>Autor</th><th></th></tr></thead><tbody>" +
          sinais.map(function (s) {
            return "<tr><td><a href=\"#/pesquisa/" + esc(s.p.id) + "\">" + esc(s.p.titulo) + "</a></td>" +
              "<td>" + esc(s.texto) + "</td>" +
              "<td>" + esc(s.p.autorNome || "—") + "</td>" +
              '<td><button class="btn btn-mini btn-discreto" data-mod="nota" data-id="' + esc(s.p.id) +
              '" data-nota="' + esc(s.p.notaInterna || "") + '">Anotar</button></td></tr>';
          }).join("") + "</tbody></table></div>";
      }

      var ocultas = pesquisas.filter(function (p) { return p.status === "oculta"; });
      if (ocultas.length) {
        html += '<hr class="divisor"><h3>Retiradas do mural (' + ocultas.length + ")</h3>" +
          '<div class="rolagem"><table><thead><tr><th>Pesquisa</th><th>Motivo</th><th>Nota interna</th><th></th></tr></thead><tbody>' +
          ocultas.map(function (p) {
            return "<tr><td><a href=\"#/pesquisa/" + esc(p.id) + "\">" + esc(p.titulo) + "</a></td>" +
              "<td>" + esc(p.motivoOcultacao || "—") + "</td><td>" + esc(p.notaInterna || "—") + "</td>" +
              '<td><button class="btn btn-mini btn-vazio" data-mod="devolver" data-id="' + esc(p.id) + '">Devolver ao mural</button></td></tr>';
          }).join("") + "</tbody></table></div>";
      }

      corpo.innerHTML = html;

      Array.prototype.forEach.call(corpo.querySelectorAll("[data-mod]"), function (b) {
        b.addEventListener("click", function () {
          var id = b.dataset.id;
          var acao = b.dataset.mod;

          if (acao === "ocultar") {
            var motivo = prompt(
              "Por que esta pesquisa está sendo retirada do mural?\n\n" +
              "O autor vê este texto na ficha e no painel dele. Seja específico: " +
              "é o que permite a ele corrigir.", "");
            if (motivo === null) return;
            motivo = motivo.trim().slice(0, 300);
            if (!motivo) { recado("Escreva o motivo: retirar sem explicação não ajuda ninguém.", "erro"); return; }
            Dados.salvarPesquisa(id, {
              status: "oculta", motivoOcultacao: motivo, ocultadaEm: Date.now()
            }).then(function () {
              return Dados.registrar("retirou do mural", id, motivo);
            }).then(function () {
              estado.carregadoEm = 0;
              recado("Pesquisa retirada do mural.", "ok");
              verAdmin("moderacao");
            }).catch(function (e) { recado(e.message, "erro"); });
            return;
          }

          if (acao === "devolver") {
            if (!confirm("Devolver esta pesquisa ao mural?")) return;
            Dados.salvarPesquisa(id, { status: "ativa", motivoOcultacao: "" }).then(function () {
              return Dados.registrar("devolveu ao mural", id, "");
            }).then(function () {
              estado.carregadoEm = 0;
              recado("Pesquisa de volta ao mural.", "ok");
              verAdmin("moderacao");
            }).catch(function (e) { recado(e.message, "erro"); });
            return;
          }

          if (acao === "arquivar") {
            Dados.resolverDenuncia(id, { status: "arquivada", arquivadaEm: Date.now() })
              .then(function () { return Dados.registrar("arquivou mensagem", id, ""); })
              .then(function () { recado("Mensagem arquivada.", "ok"); verAdmin("moderacao"); })
              .catch(function (e) { recado(e.message, "erro"); });
            return;
          }

          if (acao === "nota") {
            var nota = prompt("Nota interna sobre esta pesquisa. Só a administração vê.", b.dataset.nota || "");
            if (nota === null) return;
            Dados.salvarPesquisa(id, { notaInterna: nota.trim().slice(0, 500) })
              .then(function () { return Dados.registrar("anotou", id, nota.trim().slice(0, 120)); })
              .then(function () {
                estado.carregadoEm = 0;
                recado("Nota salva.", "ok");
                verAdmin("moderacao");
              }).catch(function (e) { recado(e.message, "erro"); });
          }
        });
      });
    }).catch(falhou);
  }

  /* ---------- Registro de ações ---------- */

  function adminRegistro(corpo) {
    Dados.listarRegistro().then(function (linhas) {
      linhas.sort(function (a, b) { return (b.quando || 0) - (a.quando || 0); });
      var html = '<p class="sumario">Tudo que a administração faz fica registrado aqui, e o registro não pode ser ' +
        "editado nem apagado pelo site. Serve para o caso de haver mais de um administrador, e serve principalmente " +
        "para quem administra poder mostrar o que fez e o que não fez.</p>";

      if (!linhas.length) {
        html += '<div class="vazio"><p>Nenhuma ação registrada ainda.</p></div>';
      } else {
        html += '<div class="rolagem"><table><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th>' +
          "<th>Sobre</th><th>Detalhe</th></tr></thead><tbody>" +
          linhas.slice(0, 300).map(function (l) {
            var d = new Date(l.quando);
            return "<tr><td>" + dataCurta(l.quando) + " " +
              (isNaN(d) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })) + "</td>" +
              "<td>" + esc(l.quem) + "</td><td>" + esc(l.acao) + "</td>" +
              "<td>" + esc(l.alvo) + "</td><td>" + esc(l.detalhe) + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<div class="linha-botoes"><button class="btn btn-discreto" id="baixar-registro">Baixar registro em CSV</button></div>';
      }

      corpo.innerHTML = html;

      var b = $("#baixar-registro");
      if (b) b.addEventListener("click", function () {
        var l = [["quando", "quem", "acao", "alvo", "detalhe"]];
        linhas.forEach(function (x) {
          l.push([new Date(x.quando).toISOString(), x.quem, x.acao, x.alvo, x.detalhe]);
        });
        baixar("registro-mural-da-coleta.csv", csv(l));
      });
    }).catch(falhou);
  }

  /* ---------- Tráfego ---------- */

  // Gráfico de barras em SVG, sem biblioteca. Uma barra por dia, com os
  // três números empilhados lado a lado.
  function grafico(dias) {
    if (!dias.length) return "";
    var larg = 760, alt = 190, base = alt - 26, topo = 12;
    var maximo = 1;
    dias.forEach(function (d) {
      maximo = Math.max(maximo, d.visitas || 0, d.aberturas || 0, d.cliques || 0);
    });
    var passo = larg / dias.length;
    var largBarra = Math.max(2, Math.min(10, passo / 4.2));
    var series = [
      { campo: "visitas", cor: "var(--caneta)" },
      { campo: "aberturas", cor: "var(--carimbo)" },
      { campo: "cliques", cor: "var(--selo)" }
    ];
    var barras = "";
    dias.forEach(function (d, i) {
      series.forEach(function (s, j) {
        var v = Number(d[s.campo] || 0);
        if (!v) return;
        var altura = Math.max(2, (v / maximo) * (base - topo));
        var x = i * passo + passo / 2 - (largBarra * 1.6) + j * (largBarra * 1.15);
        barras += '<rect x="' + x.toFixed(1) + '" y="' + (base - altura).toFixed(1) +
          '" width="' + largBarra.toFixed(1) + '" height="' + altura.toFixed(1) +
          '" fill="' + s.cor + '" rx="1"><title>' + diaLegivel(d.dia) + ", " +
          v + " " + s.campo + "</title></rect>";
      });
    });
    var rotulos = dias.map(function (d, i) {
      if (dias.length > 12 && i % Math.ceil(dias.length / 10) !== 0) return "";
      return '<text x="' + (i * passo + passo / 2).toFixed(1) + '" y="' + (alt - 8) +
        '" text-anchor="middle" font-size="10" fill="rgba(22,32,47,.55)">' +
        diaLegivel(d.dia) + "</text>";
    }).join("");

    return '<div class="gráfico-caixa"><svg viewBox="0 0 ' + larg + " " + alt +
      '" width="100%" height="' + alt + '" role="img" aria-label="Movimento por dia">' +
      '<line x1="0" y1="' + base + '" x2="' + larg + '" y2="' + base +
      '" stroke="rgba(22,32,47,.14)" stroke-width="1"/>' + barras + rotulos + "</svg>" +
      '<p class="legenda">' +
      '<span class="chave chave-visitas"></span> visitas ' +
      '<span class="chave chave-aberturas"></span> fichas abertas ' +
      '<span class="chave chave-cliques"></span> cliques no questionário' +
      "</p></div>";
  }

  function adminTrafego(corpo) {
    Promise.all([Dados.listarMetricas(), carregarPesquisas(true), Dados.listarParticipacoes()])
      .then(function (r) {
        var metricas = r[0], pesquisas = r[1], parts = r[2];

        metricas.forEach(function (m) {
          if (!m.dia && m.id) m.dia = String(m.id).replace(/^dia-/, "");
        });
        metricas.sort(function (a, b) { return String(a.dia).localeCompare(String(b.dia)); });

        function somar(lista, campo) {
          return lista.reduce(function (s, d) { return s + Number(d[campo] || 0); }, 0);
        }
        var ultimos = function (n) { return metricas.slice(-n); };
        var d7 = ultimos(7), d30 = ultimos(30);

        var totalRespostas = pesquisas.reduce(function (s, p) {
          return s + Number(p.respostasRecebidas || 0);
        }, 0);
        var cliquesTotais = somar(metricas, "cliques");
        // A taxa só faz sentido com base suficiente, e nunca passa de cem:
        // a contagem de cliques começou depois das primeiras respostas.
        var taxa = cliquesTotais >= 20
          ? Math.min(100, Math.round(totalRespostas / cliquesTotais * 100))
          : null;

        var html = '<p class="sumario">Contagem feita pelo próprio site, sem cookie e sem identificar ninguém: ' +
          "só três somas por dia. Cada aba conta uma visita uma vez, e cada ficha ou clique uma vez por aba, " +
          "para recarregar a página não inflar o número.</p>";

        html += '<div class="saldo">' +
          '<div class="saldo-item"><div class="saldo-numero">' + somar(d7, "visitas") + "</div>" +
          '<div class="saldo-rotulo">visitas nos últimos 7 dias</div></div>' +
          '<div class="saldo-item"><div class="valor">' + somar(d7, "aberturas") + "</div>" +
          '<div class="saldo-rotulo">fichas abertas</div></div>' +
          '<div class="saldo-item"><div class="valor">' + somar(d7, "cliques") + "</div>" +
          '<div class="saldo-rotulo">cliques no questionário</div></div>' +
          '<div class="saldo-item"><div class="valor">' + totalRespostas + "</div>" +
          '<div class="saldo-rotulo">respostas registradas, desde sempre</div></div></div>';

        if (!metricas.length) {
          html += '<div class="vazio"><p>Ainda não há movimento registrado. ' +
            "Os números começam a aparecer assim que alguém abrir o site.</p></div>";
        } else {
          html += "<h3>Movimento por dia</h3>" + grafico(d30) +
            '<div class="rolagem"><table><thead><tr><th>Período</th><th>Visitas</th>' +
            "<th>Fichas abertas</th><th>Cliques</th></tr></thead><tbody>" +
            "<tr><td>Últimos 7 dias</td><td class=\"num\">" + somar(d7, "visitas") +
            '</td><td class="num">' + somar(d7, "aberturas") + '</td><td class="num">' + somar(d7, "cliques") + "</td></tr>" +
            "<tr><td>Últimos 30 dias</td><td class=\"num\">" + somar(d30, "visitas") +
            '</td><td class="num">' + somar(d30, "aberturas") + '</td><td class="num">' + somar(d30, "cliques") + "</td></tr>" +
            "<tr><td><strong>Desde o começo</strong></td><td class=\"num\"><strong>" + somar(metricas, "visitas") +
            '</strong></td><td class="num"><strong>' + somar(metricas, "aberturas") +
            '</strong></td><td class="num"><strong>' + cliquesTotais + "</strong></td></tr>" +
            "</tbody></table></div>";
        }

        html += "<h3>Desempenho por pesquisa</h3>";
        var comDados = pesquisas.slice().sort(function (a, b) {
          return Number(b.visualizacoes || 0) - Number(a.visualizacoes || 0);
        });
        html += '<div class="rolagem"><table><thead><tr><th>Pesquisa</th><th>Fichas abertas</th>' +
          "<th>Cliques</th><th>Do clique ao questionário</th><th>Respostas registradas</th></tr></thead><tbody>" +
          comDados.map(function (p) {
            var vis = Number(p.visualizacoes || 0);
            var cli = Number(p.cliques || 0);
            var resp = Number(p.respostasRecebidas || 0);
            return "<tr><td><a href=\"#/pesquisa/" + esc(p.id) + "\">" + esc(p.titulo) + "</a></td>" +
              '<td class="num">' + vis + '</td><td class="num">' + cli + "</td>" +
              '<td class="num">' + (vis ? Math.round(cli / vis * 100) + "%" : "—") + "</td>" +
              '<td class="num">' + resp + "</td></tr>";
          }).join("") + "</tbody></table></div>";

        html += '<div class="aviso"><p><strong>O que estes números não dizem.</strong> ' +
          "O site vê o clique que leva ao questionário, mas não vê o que acontece dentro dele: " +
          "quem desistiu na terceira pergunta conta como clique, e quem respondeu sem informar o código " +
          "não conta como resposta. Então a coluna de respostas registradas é sempre menor que a coleta real, " +
          "e o número verdadeiro está no seu formulário." +
          (taxa !== null ? " Hoje, " + taxa + " em cada 100 cliques terminam em código informado." : "") +
          "</p><p>A contagem também é simples por dentro: qualquer pessoa que abra o site soma um, " +
          "e alguém mal-intencionado com um script conseguiria inflar os números. " +
          "Serve para acompanhar tendência, não para relatar em artigo.</p></div>";

        html += '<div class="linha-botoes"><button class="btn btn-discreto" id="baixar-trafego">Baixar tráfego em CSV</button></div>';

        corpo.innerHTML = html;

        $("#baixar-trafego").addEventListener("click", function () {
          var linhas = [["dia", "visitas", "fichas_abertas", "cliques"]];
          metricas.forEach(function (d) {
            linhas.push([d.dia, d.visitas || 0, d.aberturas || 0, d.cliques || 0]);
          });
          linhas.push([]);
          linhas.push(["pesquisa", "fichas_abertas", "cliques", "respostas_registradas"]);
          comDados.forEach(function (p) {
            linhas.push([p.titulo, p.visualizacoes || 0, p.cliques || 0, p.respostasRecebidas || 0]);
          });
          baixar("trafego-mural-da-coleta.csv", csv(linhas));
        });
      }).catch(falhou);
  }

  // Campo de busca que filtra a tabela sem recarregar nada. Com trezentas
  // linhas, rolar deixa de ser uma opção.
  function ligarBusca(corpo, rotulo) {
    var campo = $("#busca-tabela", corpo);
    if (!campo) return;
    campo.addEventListener("input", function () {
      var termo = campo.value.trim().toLowerCase();
      var linhas = corpo.querySelectorAll("tbody tr");
      var visiveis = 0;
      Array.prototype.forEach.call(linhas, function (tr) {
        var bate = !termo || tr.textContent.toLowerCase().indexOf(termo) !== -1;
        tr.hidden = !bate;
        if (bate) visiveis++;
      });
      var conta = $("#conta-busca", corpo);
      if (conta) conta.textContent = termo ? visiveis + " de " + linhas.length + " " + rotulo : "";
    });
  }

  function caixaDeBusca(texto) {
    return '<div class="filtros" style="margin-bottom:1rem">' +
      '<div class="campo"><label for="busca-tabela">' + texto + "</label>" +
      '<input type="text" id="busca-tabela" placeholder="parte do nome, instituição ou título"></div>' +
      '<span class="contagem" id="conta-busca"></span></div>';
  }

  function adminPesquisas(corpo) {
    carregarPesquisas(true).then(function (todas) {
      todas.sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });
      corpo.innerHTML = '<p class="sumario">' + plural(todas.length, "pesquisa", "pesquisas") +
        " no banco. Encerrar tira do ar sem apagar o histórico; retirar do mural, na aba de moderação, " +
        "é reversível e registra o motivo. Apagar não tem volta.</p>" +
        caixaDeBusca("Buscar pesquisa") +
        '<div class="linha-botoes" style="margin-top:0"><button class="btn btn-discreto" id="baixar-pesquisas">Baixar tudo em CSV</button></div>' +
        '<div class="rolagem"><table><thead><tr><th>Título</th><th>Autor</th><th>Ética</th>' +
        "<th>Clareza</th><th>Respostas</th><th>Situação</th><th></th></tr></thead><tbody>" +
        todas.map(function (p) {
          var m = mediaNota(p);
          return "<tr><td><a href=\"#/pesquisa/" + esc(p.id) + "\">" + esc(p.titulo) + "</a>" +
            (p.exemplo ? ' <span class="dado dado-exemplo">exemplo</span>' : "") + "</td>" +
            "<td>" + esc(p.autorNome || "—") + "<br><span class=\"contagem\">" + esc(p.autorInstituicao || "") + "</span></td>" +
            "<td>" + (p.temCaae && p.caae ? "CAAE " + esc(p.caae) : p.tcleDeclarado ? "TCLE declarado" : "—") + "</td>" +
            '<td class="num">' + (m !== null ? m.toFixed(1).replace(".", ",") : "—") + "</td>" +
            '<td class="num">' + esc(Number(p.respostasRecebidas || 0)) +
            (p.metaRespostas ? " de " + esc(p.metaRespostas) : "") + "</td>" +
            "<td>" + esc(p.status === "ativa" ? "no mural"
              : p.status === "rascunho" ? "rascunho"
              : p.status === "oculta" ? "retirada" : "encerrada") + "</td>" +
            '<td><button class="btn btn-mini btn-discreto" data-adm="situacao" data-id="' + esc(p.id) +
            '" data-status="' + esc(p.status) + '">' + (p.status === "ativa" ? "Encerrar" : "Reabrir") + "</button> " +
            '<button class="btn btn-mini btn-risco" data-adm="excluir" data-id="' + esc(p.id) +
            '" data-titulo="' + esc(p.titulo) + '">Apagar</button></td></tr>';
        }).join("") + "</tbody></table></div>";

      $("#baixar-pesquisas").addEventListener("click", function () {
        var linhas = [["titulo", "autor", "instituicao", "area", "publico", "duracao_min", "caae",
          "respostas", "meta", "clareza", "avaliacoes", "situacao", "link", "criada_em"]];
        todas.forEach(function (p) {
          var m = mediaNota(p);
          linhas.push([p.titulo, p.autorNome, p.autorInstituicao, p.area, p.publico, p.duracaoMin,
            p.caae, p.respostasRecebidas, p.metaRespostas, m !== null ? m.toFixed(2) : "",
            p.notaQtd || 0, p.status, p.link, dataCurta(p.criadoEm)]);
        });
        baixar("pesquisas-mural-da-coleta.csv", csv(linhas));
      });

      ligarBusca(corpo, "pesquisas");

      Array.prototype.forEach.call(corpo.querySelectorAll("[data-adm]"), function (b) {
        b.addEventListener("click", function () {
          var id = b.dataset.id;
          if (b.dataset.adm === "situacao") {
            var novo = b.dataset.status === "ativa" ? "encerrada" : "ativa";
            Dados.salvarPesquisa(id, { status: novo }).then(function () {
              return Dados.registrar(novo === "ativa" ? "reabriu coleta" : "encerrou coleta", id, "");
            }).then(function () {
              estado.carregadoEm = 0; verAdmin("pesquisas");
            }).catch(function (e) { recado(e.message, "erro"); });
          } else {
            // Apagar é definitivo. Retirar do mural, na moderação, resolve
            // quase todos os casos e pode ser desfeito.
            var titulo = b.dataset.titulo || "";
            var dito = prompt(
              "Apagar apaga para sempre a ficha, a imagem e os números desta pesquisa.\n" +
              "Na maioria dos casos o certo é retirar do mural, na aba de moderação, que é reversível.\n\n" +
              "Para confirmar, escreva: APAGAR", "");
            if (dito === null) return;
            if (dito.trim().toUpperCase() !== "APAGAR") {
              recado("Nada foi apagado.", "ok");
              return;
            }
            Dados.excluirPesquisa(id).then(function () {
              return Dados.registrar("apagou pesquisa", id, titulo.slice(0, 120));
            }).then(function () {
              estado.carregadoEm = 0; recado("Pesquisa apagada.", "ok"); verAdmin("pesquisas");
            }).catch(function (e) { recado(e.message, "erro"); });
          }
        });
      });
    }).catch(falhou);
  }

  function adminPesquisadores(corpo) {
    Promise.all([Dados.listarPesquisadores(), Dados.listarParticipacoes(), Dados.listarAdmins()])
      .then(function (r) {
        var gente = r[0], parts = r[1], admins = r[2];
        var ehAdmin = {};
        admins.forEach(function (a) { ehAdmin[a.id || a.uid] = true; });
        var porPessoa = {};
        parts.forEach(function (x) { porPessoa[x.respondenteUid] = (porPessoa[x.respondenteUid] || 0) + 1; });
        gente.sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });

        corpo.innerHTML = '<p class="sumario">' + plural(gente.length, "cadastro", "cadastros") +
          ". O vínculo é declarado por quem se cadastra, sem conferência automática. " +
          "Bloquear impede novos depósitos e novas participações, sem apagar o que já existe.</p>" +
          '<p class="sumario">Os dois últimos botões de cada linha atendem a LGPD: ' +
          "<em>dados da pessoa</em> entrega a cópia que ela tem direito de pedir, e " +
          "<em>apagar cadastro</em> atende ao pedido de exclusão.</p>" +
          caixaDeBusca("Buscar pessoa") +
          '<div class="linha-botoes" style="margin-top:0"><button class="btn btn-discreto" id="baixar-gente">Baixar em CSV</button></div>' +
          '<div class="rolagem"><table><thead><tr><th>Nome</th><th>Vínculo declarado</th><th>Contato</th>' +
          "<th>Respondeu</th><th></th></tr></thead><tbody>" +
          gente.map(function (g) {
            var fundador = g.email === ADMIN_FUNDADOR;
            return "<tr><td>" + esc(g.nome || "—") +
              (g.bloqueado ? ' <span class="dado dado-aviso">bloqueado</span>' : "") +
              (fundador ? ' <span class="dado dado-nota">fundador</span>'
                : ehAdmin[g.uid] ? ' <span class="dado dado-nota">administrador</span>' : "") +
              "<br><span class=\"contagem\">desde " + dataCurta(g.criadoEm) + "</span></td>" +
              "<td>" + esc(g.nivel || "—") + "<br><span class=\"contagem\">" + esc(g.programa || "") +
              (g.instituicao ? ", " + esc(g.instituicao) : "") + "</span></td>" +
              "<td>" + esc(g.email || "—") +
              (g.lattes && linkSeguro(g.lattes) ? '<br><a href="' + esc(linkSeguro(g.lattes)) +
                '" target="_blank" rel="noopener noreferrer">Lattes</a>' : "") + "</td>" +
              '<td class="num">' + (porPessoa[g.uid] || 0) + "</td>" +
              "<td>" +
              // Exportar vale para qualquer cadastro, inclusive o fundador:
              // o direito de receber a própria cópia não tem exceção.
              '<button class="btn btn-mini btn-discreto" data-adm="dados" data-uid="' + esc(g.uid) +
              '" data-nome="' + esc(g.nome || "") + '">Dados da pessoa</button> ' +
              (fundador ? '<span class="contagem">conta fundadora</span>' :
                '<button class="btn btn-mini btn-discreto" data-adm="bloqueio" data-uid="' + esc(g.uid) +
                '" data-bloq="' + (g.bloqueado ? "1" : "0") + '">' +
                (g.bloqueado ? "Desbloquear" : "Bloquear") + "</button> " +
                '<button class="btn btn-mini ' + (ehAdmin[g.uid] ? "btn-risco" : "btn-vazio") +
                '" data-adm="admin" data-uid="' + esc(g.uid) + '" data-nome="' + esc(g.nome || "") +
                '" data-email="' + esc(g.email || "") + '" data-tem="' + (ehAdmin[g.uid] ? "1" : "0") + '">' +
                (ehAdmin[g.uid] ? "Tirar administração" : "Tornar administrador") + "</button> " +
                '<button class="btn btn-mini btn-risco" data-adm="apagar-pessoa" data-uid="' + esc(g.uid) +
                '" data-nome="' + esc(g.nome || "") + '" data-email="' + esc(g.email || "") + '">Apagar cadastro</button>') +
              "</td></tr>";
          }).join("") + "</tbody></table></div>";

        $("#baixar-gente").addEventListener("click", function () {
          var linhas = [["nome", "email", "nivel", "programa", "instituicao", "lattes", "bloqueado", "desde"]];
          gente.forEach(function (g) {
            linhas.push([g.nome, g.email, g.nivel, g.programa, g.instituicao, g.lattes,
              g.bloqueado ? "sim" : "não", dataCurta(g.criadoEm)]);
          });
          baixar("pesquisadores-mural-da-coleta.csv", csv(linhas));
        });

        ligarBusca(corpo, "cadastros");

        Array.prototype.forEach.call(corpo.querySelectorAll("[data-adm]"), function (b) {
          b.addEventListener("click", function () {
            if (b.dataset.adm === "bloqueio") {
              var bloquear = b.dataset.bloq !== "1";
              Dados.salvarPesquisador(b.dataset.uid, { bloqueado: bloquear })
                .then(function () {
                  return Dados.registrar(bloquear ? "bloqueou cadastro" : "desbloqueou cadastro",
                    b.dataset.uid, "");
                })
                .then(function () { verAdmin("pesquisadores"); })
                .catch(function (e) { recado(e.message, "erro"); });
              return;
            }

            // LGPD, direito de acesso: a cópia de tudo que o site guarda
            // sobre a pessoa, num arquivo que pode ser entregue a ela.
            if (b.dataset.adm === "dados") {
              var uid = b.dataset.uid;
              var pessoa = null;
              gente.forEach(function (g) { if (g.uid === uid) pessoa = g; });
              Promise.all([carregarPesquisas(true), Dados.listarParticipacoes()]).then(function (rr) {
                var linhas = [["campo", "valor"]];
                if (pessoa) {
                  ["nome", "email", "nivel", "programa", "instituicao", "lattes"].forEach(function (c) {
                    linhas.push([c, pessoa[c] || ""]);
                  });
                  linhas.push(["cadastro em", dataCurta(pessoa.criadoEm)]);
                  linhas.push(["bloqueado", pessoa.bloqueado ? "sim" : "não"]);
                }
                linhas.push([]);
                linhas.push(["pesquisas depositadas", "", ""]);
                linhas.push(["titulo", "situacao", "respostas"]);
                rr[0].filter(function (p) { return p.autorUid === uid; }).forEach(function (p) {
                  linhas.push([p.titulo, p.status, p.respostasRecebidas || 0]);
                });
                linhas.push([]);
                linhas.push(["participações registradas", "", ""]);
                linhas.push(["pesquisa", "data", "clareza"]);
                rr[1].filter(function (x) { return x.respondenteUid === uid; }).forEach(function (x) {
                  linhas.push([x.pesquisaTitulo || x.pesquisaId, dataCurta(x.criadoEm), x.nota || ""]);
                });
                baixar("dados-" + uid + ".csv", csv(linhas));
                return Dados.registrar("exportou dados da pessoa", uid, b.dataset.nome || "");
              }).catch(function (e) { recado(e.message, "erro"); });
              return;
            }

            // LGPD, direito de exclusão.
            if (b.dataset.adm === "apagar-pessoa") {
              var nome = b.dataset.nome || "esta pessoa";
              var dito = prompt(
                "Apagar o cadastro de " + nome + " remove a ficha, as pesquisas dela, " +
                "as imagens e as participações que ela registrou. Não há como desfazer.\n\n" +
                "Para confirmar, escreva: APAGAR", "");
              if (dito === null) return;
              if (dito.trim().toUpperCase() !== "APAGAR") { recado("Nada foi apagado.", "ok"); return; }
              Dados.apagarPessoa(b.dataset.uid).then(function () {
                return Dados.registrar("apagou cadastro", b.dataset.uid, b.dataset.email || "");
              }).then(function () {
                estado.carregadoEm = 0;
                recado("Cadastro apagado. Falta remover o login no console do Firebase.", "ok");
                verAdmin("pesquisadores");
              }).catch(function (e) { recado(e.message, "erro"); });
              return;
            }
            if (b.dataset.tem === "1") {
              if (!confirm("Tirar a administração de " + (b.dataset.nome || "esta pessoa") + "?")) return;
              Dados.removerAdmin(b.dataset.uid)
                .then(function () { return Dados.registrar("tirou administração", b.dataset.uid, b.dataset.email || ""); })
                .then(function () { recado("Administração removida.", "ok"); verAdmin("pesquisadores"); })
                .catch(function (e) { recado(e.message, "erro"); });
            } else {
              if (!confirm("Tornar " + (b.dataset.nome || "esta pessoa") +
                " administrador? Essa pessoa vai poder apagar pesquisas e bloquear cadastros.")) return;
              Dados.promoverAdmin(b.dataset.uid, {
                papel: "admin", nome: b.dataset.nome, email: b.dataset.email,
                criadoEm: Date.now(), promovidoPor: estado.usuario.email
              }).then(function () { return Dados.registrar("tornou administrador", b.dataset.uid, b.dataset.email || ""); })
                .then(function () { recado("Agora é administrador.", "ok"); verAdmin("pesquisadores"); })
                .catch(function (e) { recado(e.message, "erro"); });
            }
          });
        });
      }).catch(falhou);
  }

  function adminAdministradores(corpo) {
    Dados.listarAdmins().then(function (admins) {
      var html = '<div class="bloco"><h3>Quem administra o mural</h3>' +
        '<p class="sumario">O endereço <strong>' + esc(ADMIN_FUNDADOR) + "</strong> é administrador permanente: " +
        "está escrito no código do site e nas regras do banco, então a administração nunca fica sem dono, " +
        "mesmo com o banco vazio.</p>" +
        '<p class="sumario">Para incluir outra pessoa, ela primeiro cria um cadastro normal no site. ' +
        "Depois, na aba <em>pesquisadores</em>, use o botão de tornar administrador.</p></div>";

      if (!admins.length) {
        html += '<div class="vazio"><p>Nenhum administrador além da conta fundadora.</p></div>';
      } else {
        html += '<div class="rolagem"><table><thead><tr><th>Nome</th><th>E-mail</th>' +
          "<th>Desde</th><th>Incluído por</th><th></th></tr></thead><tbody>" +
          admins.map(function (a) {
            return "<tr><td>" + esc(a.nome || "—") + "</td><td>" + esc(a.email || "—") + "</td>" +
              "<td>" + dataCurta(a.criadoEm) + "</td><td>" + esc(a.promovidoPor || "—") + "</td>" +
              '<td><button class="btn btn-mini btn-risco" data-tirar="' + esc(a.id || a.uid) + '">Remover</button></td></tr>';
          }).join("") + "</tbody></table></div>";
      }

      corpo.innerHTML = html;

      Array.prototype.forEach.call(corpo.querySelectorAll("[data-tirar]"), function (b) {
        b.addEventListener("click", function () {
          if (!confirm("Remover esta pessoa da administração?")) return;
          Dados.removerAdmin(b.dataset.tirar)
            .then(function () { recado("Administração removida.", "ok"); verAdmin("admins"); })
            .catch(function (e) { recado(e.message, "erro"); });
        });
      });
    }).catch(falhou);
  }

  function adminAjustes(corpo) {
    var html = '<div class="bloco"><h3>Economia de créditos</h3>' +
      '<p class="sumario">A troca de créditos está <strong>' +
      (CREDITOS_LIGADOS ? "ligada" : "desligada") + "</strong>. " +
      (CREDITOS_LIGADOS
        ? "Responder rende créditos e cada resposta recebida consome os créditos da pesquisa."
        : "Cadastro e depósito são livres, e a ordem do mural é dada por quem está mais longe da meta. " +
          "Para religar a troca, mude <code>CREDITOS_LIGADOS</code> para <code>true</code> em <code>app.js</code>; " +
          "as regras do Firestore já aceitam os dois modos.") + "</p>" +
      '<div class="rolagem"><table><thead><tr><th>Duração</th><th>Créditos, quando ligado</th></tr></thead><tbody>' +
      [3, 8, 12, 18, 30].map(function (m) {
        return "<tr><td>" + m + " minutos</td><td class=\"num\">" + valorEmCreditos(m) + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";

    html += '<div class="bloco"><h3>Pesquisas de exemplo</h3>' +
      '<p class="sumario">Os dez exemplos de fábrica servem para o mural não nascer vazio. ' +
      "Apague-os quando houver pesquisas de verdade suficientes.</p>" +
      '<div class="linha-botoes" style="margin-top:0">' +
      '<button class="btn btn-vazio" id="pub-exemplos">Publicar os exemplos</button>' +
      '<button class="btn btn-risco" id="apagar-exemplos">Apagar todos os exemplos</button></div></div>';

    corpo.innerHTML = html;

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
  }

  /* ============================================================
     14. Página de exemplo
     ============================================================ */

  function verExemplo() {
    pintar('<a class="voltar" href="#/mural">Voltar ao mural</a>' +
      "<h1>Esta é uma pesquisa de exemplo</h1>" +
      '<p class="sumario">O mural vem de fábrica com dez fichas fictícias, só para você ver como as pesquisas ' +
      "aparecem antes de haver pesquisa de verdade. Não existe questionário por trás delas.</p>" +
      '<p class="sumario">Na administração, em <em>ajustes e exemplos</em>, há o botão para apagar todas de uma vez.</p>' +
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
    else if (rota === "publicada") verPublicada(partes[1]);
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
      contar("visitas", null, "visitou");
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

(function () {
  'use strict';

  /* ---------- 1. Découverte des discussions en localStorage ---------- */

  // Prend un objet "message" inconnu et renvoie {who, text} ou null.
  function extractMessage(m) {
    if (!m || typeof m !== 'object') return null;
    var text =
      (typeof m.text === 'string' && m.text) ||
      (typeof m.content === 'string' && m.content) ||
      (typeof m.spoken === 'string' && m.spoken) ||
      (typeof m.message === 'string' && m.message) ||
      (m.parts && m.parts.map(function (p) { return (p && typeof p.text === 'string') ? p.text : ''; }).join('')) ||
      '';
    if (!text.trim()) return null;
    var role = m.role || m.who || m.sender || '';
    var isUser = ('' + role).toLowerCase().indexOf('user') !== -1;
    var isModel = ('' + role).toLowerCase().indexOf('model') !== -1 ||
                  ('' + role).toLowerCase().indexOf('assistant') !== -1 ||
                  ('' + role).toLowerCase().indexOf('jarvis') !== -1;
    return { who: isUser ? 'user' : (isModel ? 'jarvis' : (role ? '' + role : 'user')), text: text };
  }

  // Renvoie la liste des messages d'une conversation, quel que soit le nom du champ.
  function convMessages(conv) {
    if (!conv || typeof conv !== 'object') return [];
    var candidates = [conv.messages, conv.history, conv.contents, conv.msgs, conv.turns];
    for (var i = 0; i < candidates.length; i++) {
      var arr = candidates[i];
      if (Array.isArray(arr)) {
        var out = [];
        for (var j = 0; j < arr.length; j++) {
          var mm = extractMessage(arr[j]);
          if (mm) out.push(mm);
        }
        if (out.length) return out;
      }
    }
    // La valeur elle-même est peut-être un simple message.
    var single = extractMessage(conv);
    return single ? [single] : [];
  }

  function convTitle(conv, messages) {
    var t = (typeof conv.title === 'string' && conv.title) ||
            (typeof conv.name === 'string' && conv.name) || '';
    if (!t && messages.length) {
      t = messages[0].text.replace(/\s+/g, ' ').slice(0, 60);
    }
    return t || 'Discussion';
  }

  function convDate(conv) {
    var d = conv.createdAt || conv.updatedAt || conv.date || conv.updated_at || null;
    if (!d) return '';
    try {
      var dt = new Date(d);
      if (isNaN(dt.getTime())) return '';
      return dt.toLocaleDateString('fr-FR');
    } catch (e) { return ''; }
  }

  // Scanne TOUT le localStorage et renvoie les discussions trouvées.
  function findDiscussions() {
    var found = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key === 'jarvis_cards_history_v1' || key === 'assistant_files_v1') continue;
        var raw = localStorage.getItem(key);
        if (!raw) continue;
        var data;
        try { data = JSON.parse(raw); } catch (e) { continue; }
        var arrays = [];
        if (Array.isArray(data)) arrays.push(data);
        else if (data && typeof data === 'object') {
          for (var k in data) {
            if (Object.prototype.hasOwnProperty.call(data, k) && Array.isArray(data[k])) {
              arrays.push(data[k]);
            }
          }
        }
        for (var a = 0; a < arrays.length; a++) {
          var arr = arrays[a];
          if (!arr.length || arr.length > 2000) continue;
          var convs = [];
          var allLookLikeConvs = true;
          for (var n = 0; n < arr.length; n++) {
            var item = arr[n];
            var msgs = convMessages(item);
            if (msgs.length) {
              convs.push({ key: key, title: convTitle(item, msgs), date: convDate(item), messages: msgs });
            } else if (item && typeof item === 'object') {
              // pas une conversation : peut-être un simple stockage -> on ignore
              allLookLikeConvs = false;
            }
          }
          // On ne garde ce tableau que s'il ressemblait vraiment à des discussions.
          if (convs.length && allLookLikeConvs) found = found.concat(convs);
        }
      }
    } catch (e) { /* localStorage indisponible : on rend la main */ }
    return found;
  }

  /* ---------- 2. Recherche de souvenirs pertinents ---------- */

  var STOPWORDS = {
    'avec': 1, 'alors': 1, 'autre': 1, 'aussi': 1, 'bien': 1, 'cela': 1, 'cette': 1, 'comme': 1,
    'dans': 1, 'donc': 1, 'dont': 1, 'elle': 1, 'encore': 1, 'etre': 1, 'fait': 1, 'fais': 1,
    'juste': 1, 'leur': 1, 'mais': 1, 'meme': 1, 'moins': 1, 'nous': 1, 'peux': 1, 'plus': 1,
    'pour': 1, 'pourquoi': 1, 'quand': 1, 'quel': 1, 'quelle': 1, 'quoi': 1, 'sans': 1, 'sous': 1,
    'suis': 1, 'tous': 1, 'tout': 1, 'toute': 1, 'tres': 1, 'veux': 1, 'vous': 1, 'elles': 1,
    'eux': 1, 'avant': 1, 'apres': 1, 'chez': 1, 'comment': 1, 'est': 1, 'the': 1,
    'what': 1, 'that': 1, 'this': 1, 'have': 1, 'about': 1, 'des': 1, 'les': 1, 'une': 1,
    'que': 1, 'qui': 1, 'sur': 1, 'pas': 1, 'mon': 1, 'ma': 1, 'mes': 1, 'son': 1,
    'sa': 1, 'ses': 1, 'jai': 1, 'jad': 1, 'peut': 1, 'dois': 1, 'doit': 1
  };

  function normalize(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function keywords(text, max) {
    var words = normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
    var seen = {};
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 4 || STOPWORDS[w] || seen[w]) continue;
      seen[w] = 1;
      out.push(w);
      if (out.length >= (max || 8)) break;
    }
    return out;
  }

  // Cherche dans les discussions les extraits les plus proches de la question.
  function findMemories(question, discussions) {
    var kws = keywords(question, 8);
    if (!kws.length) return { block: '', titles: [] };

    var titles = [];
    var scored = []; // {score, title, date, who, text}
    discussions.forEach(function (conv) {
      var titleNorm = normalize(conv.title);
      var titleHits = 0;
      kws.forEach(function (k) { if (titleNorm.indexOf(k) !== -1) titleHits++; });
      titles.push({ title: conv.title, date: conv.date });
      for (var i = 0; i < conv.messages.length; i++) {
        var m = conv.messages[i];
        var norm = normalize(m.text);
        var score = titleHits * 0.5;
        for (var j = 0; j < kws.length; j++) {
          if (norm.indexOf(kws[j]) !== -1) score += 1;
        }
        if (score >= 2) {
          scored.push({ score: score, title: conv.title, date: conv.date, who: m.who, text: m.text });
        }
      }
    });

    if (!scored.length) return { block: '', titles: titles.slice(0, 15) };

    scored.sort(function (a, b) { return b.score - a.score; });
    var picked = [];
    var usedText = {};
    for (var s = 0; s < scored.length && picked.length < 6; s++) {
      var item = scored[s];
      var fingerprint = normalize(item.text).slice(0, 80);
      if (usedText[fingerprint]) continue;
      usedText[fingerprint] = 1;
      picked.push(item);
    }

    var lines = picked.map(function (p) {
      var t = p.text.replace(/\s+/g, ' ').slice(0, 220);
      var label = p.who === 'user' ? "l'utilisateur" : 'Jarvis';
      return '- (' + p.title + (p.date ? ', ' + p.date : '') + ') ' + label + ' : ' + t;
    });

    var block =
      "[MÉMOIRE INTERDISCUSSIONS — extraits d'anciennes discussions, donnés à titre indicatif. " +
      "Utilise-les seulement si c'est pertinent pour répondre. Si l'utilisateur demande ce qui a été dit " +
      "sur un sujet, appuie-toi sur ces extraits et cite la discussion concernée. N'invente jamais de " +
      "discussion qui n'y figure pas.]\n" + lines.join('\n');
    if (block.length > 1800) block = block.slice(0, 1800) + '\n- [...]';
    return { block: block, titles: titles.slice(0, 15) };
  }

  /* ---------- 3. Injection dans les appels au backend ---------- */

  function lastUserQuestion(contents) {
    if (!Array.isArray(contents)) return '';
    for (var i = contents.length - 1; i >= 0; i--) {
      var c = contents[i];
      if (c && c.role === 'user' && Array.isArray(c.parts)) {
        var t = c.parts.map(function (p) { return (p && typeof p.text === 'string') ? p.text : ''; }).join('');
        if (t.trim()) return t;
      }
    }
    return '';
  }

  function appendToSystemInstruction(si, text) {
    if (!si) return { parts: [{ text: text }] };
    if (typeof si === 'string') return { parts: [{ text: si + '\n\n' + text }] };
    if (Array.isArray(si.parts)) {
      var parts = si.parts.slice();
      parts.push({ text: text });
      return { parts: parts };
    }
    return si;
  }

  var patched = false;
  function patchFetch() {
    if (patched || typeof window.fetch !== 'function') return;
    patched = true;
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method === 'POST' && url.indexOf('/api/gemini') !== -1 && init && typeof init.body === 'string') {
          var body = JSON.parse(init.body);
          var question = lastUserQuestion(body.contents);
          if (question) {
            var memories = findMemories(question, findDiscussions());
            var extra = '';
            if (memories.titles.length) {
              var titlesList = memories.titles.map(function (t) {
                return '- ' + t.title + (t.date ? ' (' + t.date + ')' : '');
              }).join('\n');
              extra =
                "[HISTORIQUE DES DISCUSSIONS de l'utilisateur (titres seulement, pour situer) :]\n" +
                titlesList.slice(0, 900);
            }
            if (memories.block) {
              extra += (extra ? '\n\n' : '') + memories.block;
            }
            if (extra) {
              body.systemInstruction = appendToSystemInstruction(body.systemInstruction, extra);
              init = Object.assign({}, init, { body: JSON.stringify(body) });
            }
          }
        }
      } catch (e) { /* en cas de doute : on envoie la requête originale */ }
      return originalFetch.call(window, input, init);
    };
  }

  /* ---------- 4. Panneau de partage ---------- */

  function buildTranscript(conv) {
    var lines = ['Discussion "' + conv.title + '"' + (conv.date ? ' — ' + conv.date : '')];
    conv.messages.forEach(function (m) {
      lines.push((m.who === 'user' ? 'Moi : ' : 'Jarvis : ') + m.text);
    });
    var t = lines.join('\n');
    return t.length > 30000 ? t.slice(0, 30000) + '\n[...]' : t;
  }

  function shareDiscussion(conv, btn) {
    var transcript = buildTranscript(conv);
    var done = function (msg) {
      var old = btn.textContent;
      btn.textContent = msg;
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (navigator.share) {
      navigator.share({ title: conv.title, text: transcript })
        .then(function () { done('Partagé'); })
        .catch(function () { done('Annulé'); });
    } else {
      var ok = function () { done('Copié'); };
      var fail = function () { done('Erreur'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(transcript).then(ok, fail);
      } else {
        var ta = document.createElement('textarea');
        ta.value = transcript;
        document.body.appendChild(ta);
        ta.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done(copied ? 'Copié' : 'Erreur');
      }
    }
  }

  function buildPanel(discussions) {
    var overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(4,10,8,.82);backdrop-filter:blur(4px);z-index:99999;' +
      'display:flex;align-items:flex-end;justify-content:center;font-family:system-ui,sans-serif;';
    var sheet = document.createElement('div');
    sheet.style.cssText =
      'width:100%;max-width:560px;max-height:78vh;overflow-y:auto;background:#0b1512;color:#e8fff5;' +
      'border:1px solid #1d3a2e;border-radius:18px 18px 0 0;padding:18px 16px 26px;box-sizing:border-box;';

    var h = document.createElement('div');
    h.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
    var title = document.createElement('div');
    title.textContent = 'Discussions (' + discussions.length + ')';
    title.style.cssText = 'font-size:17px;font-weight:600;color:#39e0a4;';
    var close = document.createElement('button');
    close.textContent = 'Fermer';
    close.style.cssText =
      'background:none;border:1px solid #2a5a45;color:#39e0a4;border-radius:8px;padding:6px 12px;font-size:13px;';
    close.onclick = function () { document.body.removeChild(overlay); };
    h.appendChild(title);
    h.appendChild(close);
    sheet.appendChild(h);

    var hint = document.createElement('div');
    hint.textContent = 'Partage une discussion vers une autre app ou un autre appareil (partage natif, sinon copie).';
    hint.style.cssText = 'font-size:12px;opacity:.65;margin-bottom:14px;';
    sheet.appendChild(hint);

    if (!discussions.length) {
      var empty = document.createElement('div');
      empty.textContent = 'Aucune discussion sauvegardée trouvée.';
      empty.style.cssText = 'opacity:.6;font-size:14px;';
      sheet.appendChild(empty);
    }

    var search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Filtrer les discussions...';
    search.style.cssText =
      'width:100%;box-sizing:border-box;background:#0f1d17;border:1px solid #1d3a2e;color:#e8fff5;' +
      'border-radius:10px;padding:9px 12px;font-size:14px;margin-bottom:14px;outline:none;';
    sheet.appendChild(search);

    var list = document.createElement('div');
    sheet.appendChild(list);

    function render(filter) {
      list.innerHTML = '';
      var f = normalize(filter || '');
      discussions.forEach(function (conv) {
        if (f && normalize(conv.title).indexOf(f) === -1 &&
            !conv.messages.some(function (m) { return normalize(m.text).indexOf(f) !== -1; })) return;
        var row = document.createElement('div');
        row.style.cssText =
          'border:1px solid #1d3a2e;border-radius:12px;padding:10px 12px;margin-bottom:8px;background:#0e1c15;';
        var info = document.createElement('div');
        info.style.cssText = 'display:flex;justify-content:space-between;gap:10px;margin-bottom:8px;';
        var name = document.createElement('div');
        name.textContent = conv.title;
        name.style.cssText = 'font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        var meta = document.createElement('div');
        meta.textContent = (conv.date ? conv.date + ' — ' : '') + conv.messages.length + ' messages';
        meta.style.cssText = 'font-size:11px;opacity:.6;flex-shrink:0;';
        info.appendChild(name);
        info.appendChild(meta);
        row.appendChild(info);
        var btn = document.createElement('button');
        btn.textContent = 'Partager';
        btn.style.cssText =
          'background:#39e0a4;color:#06251a;border:none;border-radius:8px;padding:8px 14px;' +
          'font-size:13px;font-weight:600;width:100%;';
        btn.onclick = function () { shareDiscussion(conv, btn); };
        row.appendChild(btn);
        list.appendChild(row);
      });
      if (!list.children.length) {
        var none = document.createElement('div');
        none.textContent = 'Rien ne correspond au filtre.';
        none.style.cssText = 'opacity:.6;font-size:13px;';
        list.appendChild(none);
      }
    }
    render('');
    search.oninput = function () { render(search.value); };

    overlay.appendChild(sheet);
    overlay.onclick = function (ev) { if (ev.target === overlay) document.body.removeChild(overlay); };
    return overlay;
  }

  function mountButton() {
    if (!document.body) return;
    var btn = document.createElement('button');
    btn.textContent = '⇄';
    btn.title = 'Discussions : mémoire et partage';
    btn.setAttribute('aria-label', 'Discussions');
    btn.style.cssText =
      'position:fixed;top:14px;right:14px;z-index:9998;width:42px;height:42px;border-radius:50%;' +
      'border:1px solid #2a5a45;background:rgba(10,26,20,.85);color:#39e0a4;font-size:20px;' +
      'line-height:1;cursor:pointer;backdrop-filter:blur(3px);';
    btn.onclick = function () {
      var discussions = findDiscussions();
      var overlay = buildPanel(discussions);
      document.body.appendChild(overlay);
    };
    document.body.appendChild(btn);
  }

  /* ---------- 5. Démarrage ---------- */
  patchFetch();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountButton);
  } else {
    mountButton();
  }
})();

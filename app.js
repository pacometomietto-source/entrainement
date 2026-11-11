/* =========================================================================
   app.js — Entraînement : timers CrossFit + suivi de musculation
   Tout fonctionne hors ligne ; les données restent dans le téléphone
   (localStorage). Aucune bibliothèque externe.
   ========================================================================= */
(function () {
  'use strict';

  var TE = window.TimerEngine;
  var fmt = TE.fmt, fmtSec = TE.fmtSec;

  /* ======================= Petits utilitaires ======================== */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var app = $('#app');
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function norm(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function num(v) { // accepte « 82,5 » ou « 82.5 »
    var x = parseFloat(String(v).replace(',', '.'));
    return isFinite(x) ? x : null;
  }
  function fmtKg(x) {
    if (x == null || !isFinite(x)) return '–';
    return String(Math.round(x * 10) / 10).replace('.', ',');
  }
  function fmtShort(s) {
    if (s < 60) return s + ' s';
    if (s % 60 === 0) return (s / 60) + ' min';
    return fmtSec(s);
  }
  function dateFr(ts, withYear) {
    var d = new Date(ts), opts = { weekday: 'short', day: 'numeric', month: 'short' };
    if (withYear || d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('fr-FR', opts);
  }
  function e1rm(kg, reps) { // formule d'Epley
    if (!(kg > 0) || !(reps > 0)) return 0;
    return reps === 1 ? kg : kg * (1 + reps / 30);
  }

  /* ============================ Données ============================== */
  var KEY = 'entrainement-donnees-v1';
  var DEFAULT_EXERCISES = [
    'Développé couché', 'Développé incliné haltères', 'Développé militaire', 'Push press',
    'Squat', 'Front squat', 'Overhead squat', 'Soulevé de terre', 'Soulevé de terre roumain',
    'Tractions', 'Rowing barre', 'Rowing haltère', 'Tirage vertical', 'Dips', 'Pompes',
    'Fentes', 'Hip thrust', 'Presse à cuisses', 'Leg curl', 'Leg extension', 'Mollets debout',
    'Curl biceps', 'Curl marteau', 'Extension triceps', 'Élévations latérales', 'Oiseau', 'Face pull',
    'Power clean', 'Clean & jerk', 'Snatch', 'Thruster', 'Kettlebell swing', 'Wall ball',
    'Box jump', 'Burpees', 'Toes to bar', 'Muscle-up', 'Gainage'
  ];
  function defaults() {
    return {
      settings: { countdown: 10 },
      timerCfg: {},          // derniers réglages utilisés par mode
      favorites: [],
      exercises: DEFAULT_EXERCISES.slice(),
      templates: [
        { id: uid(), name: 'Push', exercises: ['Développé couché', 'Développé militaire', 'Dips', 'Élévations latérales', 'Extension triceps'] },
        { id: uid(), name: 'Pull', exercises: ['Tractions', 'Rowing barre', 'Face pull', 'Curl biceps'] },
        { id: uid(), name: 'Legs', exercises: ['Squat', 'Soulevé de terre roumain', 'Fentes', 'Leg curl', 'Mollets debout'] }
      ],
      sessions: [],
      activeSessionId: null
    };
  }
  function load() {
    var d = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var x = JSON.parse(raw);
        Object.keys(d).forEach(function (k) { if (x[k] !== undefined) d[k] = x[k]; });
        d.settings = Object.assign(defaults().settings, x.settings || {});
      }
    } catch (e) { /* données illisibles : on repart des valeurs par défaut */ }
    return d;
  }
  var db = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { toast('Impossible d’enregistrer (mémoire pleine ?)'); }
  }
  // Demande au navigateur de ne pas effacer les données automatiquement
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  /* ============================== Sons ================================
     Bips générés par la Web Audio API (aucun fichier audio). Sur iPhone,
     le son doit être « débloqué » par un appui : c'est fait à chaque appui
     (au plus tard sur « Démarrer »).                                     */
  var snd = {
    ctx: null,
    unlock: function () {
      try {
        var C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        if (!this.ctx) this.ctx = new C();
        if (this.ctx.state !== 'running') {
          this.ctx.resume();
          var b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
          s.buffer = b; s.connect(this.ctx.destination); s.start(0);
        }
      } catch (e) {}
    },
    resume: function () { try { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); } catch (e) {} },
    tone: function (freq, dur, delay, vol, type) {
      var c = this.ctx; if (!c) return;
      this.resume();
      try {
        var t = c.currentTime + 0.01 + (delay || 0), v = vol || 0.35;
        var o = c.createOscillator(), g = c.createGain();
        o.type = type || 'square';
        o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(v, t + 0.012);
        g.gain.setValueAtTime(v, t + Math.max(0.02, dur - 0.04));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + dur + 0.05);
      } catch (e) {}
    },
    tick: function () { this.tone(880, 0.15); },                 // 3, 2, 1
    go: function () { this.tone(1320, 0.6); },                    // début travail
    rest: function () { this.tone(560, 0.6); },                   // début repos
    end: function () { this.tone(1320, 0.25); this.tone(1320, 0.25, 0.32); this.tone(1760, 0.9, 0.64); },
    blip: function () { this.tone(1040, 0.08, 0, 0.3); },          // +1 round
    fanfare: function () {
      var self = this;
      [523, 659, 784, 1047].forEach(function (f, i) { self.tone(f, i === 3 ? 0.5 : 0.14, i * 0.13, 0.4, 'triangle'); });
    }
  };

  /* ===================== Écran toujours allumé ======================= */
  var wake = {
    reasons: {}, lock: null, supported: 'wakeLock' in navigator,
    acquire: function () {
      var self = this;
      if (!this.supported) return Promise.resolve(false);
      if (this.lock) return Promise.resolve(true);
      if (document.visibilityState !== 'visible') return Promise.resolve(false);
      return navigator.wakeLock.request('screen').then(function (l) {
        self.lock = l;
        l.addEventListener('release', function () { self.lock = null; });
        return true;
      }).catch(function () { return false; });
    },
    on: function (r) { this.reasons[r] = true; return this.acquire(); },
    off: function (r) {
      delete this.reasons[r];
      if (!Object.keys(this.reasons).length && this.lock) { try { this.lock.release(); } catch (e) {} this.lock = null; }
    }
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (Object.keys(wake.reasons).length) wake.acquire();
      snd.resume();
      if (swReg) swReg.update().catch(function () {});
    }
  });

  /* ======================= Fenêtres / messages ======================= */
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 2200);
    setTimeout(function () { t.remove(); }, 2700);
  }
  /* boîte de dialogue ; renvoie la valeur du bouton choisi */
  function modal(opts) {
    return new Promise(function (res) {
      var ov = document.createElement('div');
      ov.className = 'modal-ov';
      ov.innerHTML = '<div class="modal" role="dialog"><h2>' + esc(opts.title) + '</h2>' + (opts.html || '') +
        '<div class="modal-btns">' + opts.buttons.map(function (b, i) {
          return '<button class="btn ' + (b.cls || '') + '" data-i="' + i + '">' + esc(b.label) + '</button>';
        }).join('') + '</div></div>';
      document.body.appendChild(ov);
      var inp = ov.querySelector('input');
      function close(v) { ov.remove(); res(inp ? { v: v, text: inp.value.trim() } : v); }
      ov.addEventListener('click', function (e) {
        e.stopPropagation();
        var b = e.target.closest('[data-i]');
        if (b) close(opts.buttons[+b.dataset.i].value);
      });
      if (inp) {
        inp.focus(); inp.select();
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') close(opts.buttons[0].value); });
      }
    });
  }
  function confirmBox(title, yes, no, danger) {
    return modal({ title: title, buttons: [
      { label: yes, value: true, cls: danger ? 'btn-danger' : 'btn-go' },
      { label: no || 'Annuler', value: false }
    ] });
  }
  function promptBox(title, value) {
    return modal({
      title: title,
      html: '<input type="text" class="m-input" value="' + esc(value || '') + '" autocomplete="off" autocapitalize="sentences">',
      buttons: [{ label: 'Valider', value: true, cls: 'btn-go' }, { label: 'Annuler', value: false }]
    }).then(function (r) { return r.v && r.text ? r.text : null; });
  }

  /* ========================= Navigation ============================== */
  var stack = [], current = { name: 'home', params: {} }, cleanups = [];
  function onLeave(fn) { cleanups.push(fn); }
  function render(keepScroll) {
    var y = window.scrollY;
    cleanups.splice(0).forEach(function (f) { try { f(); } catch (e) {} });
    var s = SCREENS[current.name];
    app.className = 'scr-' + current.name;
    app.innerHTML = s.html(current.params || {});
    if (s.after) s.after(current.params || {});
    window.scrollTo(0, keepScroll ? y : 0);
  }
  function go(name, params, replace) {
    if (!replace) stack.push(current);
    current = { name: name, params: params || {} };
    render();
  }
  function back() { current = stack.pop() || { name: 'home', params: {} }; render(); }
  function home() { stack = []; current = { name: 'home', params: {} }; render(); }
  function refresh() { render(true); }

  function header(title, right, noBack) {
    return '<header class="bar">' +
      (noBack ? '<span class="bar-l"></span>' : '<button class="back" data-act="back" aria-label="Retour">‹ Retour</button>') +
      '<h1>' + esc(title) + '</h1><div class="bar-r">' + (right || '') + '</div></header>';
  }

  /* ======================= Définition des timers ===================== */
  var MODES = {
    tabata: {
      title: 'Tabata / Intervalles', icon: '⚡',
      fields: [
        { k: 'work', label: 'Travail', min: 5, max: 3600, step: 'a', f: 'time' },
        { k: 'rest', label: 'Repos', min: 0, max: 3600, step: 'a', f: 'time' },
        { k: 'rounds', label: 'Rounds', min: 1, max: 99, step: 1, f: 'int' }
      ],
      def: { work: 20, rest: 10, rounds: 8 }
    },
    fortime: {
      title: 'For Time', icon: '🏁',
      fields: [{ k: 'cap', label: 'Time cap (facultatif)', min: 0, max: 7200, step: 60, f: 'cap' }],
      def: { cap: 0 },
      info: 'Le chrono monte. Touchez « +1 round » à chaque tour et « Arrêter » quand vous avez fini.'
    },
    amrap: {
      title: 'AMRAP', icon: '🔁',
      fields: [{ k: 'dur', label: 'Durée', min: 30, max: 7200, step: 'a', f: 'time' }],
      def: { dur: 720 },
      info: 'Le plus de rounds possible dans le temps imparti. Touchez « +1 round » à chaque tour.'
    },
    emom: {
      title: 'EMOM', icon: '⏰',
      fields: [
        { k: 'every', label: 'Un signal toutes les', min: 15, max: 600, step: 15, f: 'time' },
        { k: 'total', label: 'Pendant', min: 60, max: 7200, step: 60, f: 'time' }
      ],
      def: { every: 60, total: 600 }
    },
    chrono: {
      title: 'Chrono', icon: '⏱️', fields: [], def: {},
      info: 'Chronomètre libre : démarrer, pause, reprendre, arrêter.'
    },
    minuteur: {
      title: 'Minuteur', icon: '⏳',
      fields: [{ k: 'dur', label: 'Durée', min: 5, max: 7200, step: 'a', f: 'time' }],
      def: { dur: 300 }
    }
  };
  var SPLIT_MODES = { fortime: true, amrap: true };

  /* pas variable : 5 s sous 1 min, 15 s sous 10 min, 1 min au-delà */
  function stepValue(f, v, dir) {
    var st = f.step;
    if (st === 'a') { var x = dir > 0 ? v : v - 1; st = x < 60 ? 5 : x < 600 ? 15 : 60; }
    var nv = v + dir * st;
    if (f.step === 'a') nv = Math.round(nv / st) * st;
    return Math.min(f.max, Math.max(f.min, nv));
  }
  function fieldText(f, v) {
    if (f.f === 'int') return String(v);
    if (f.f === 'cap' && v === 0) return 'Aucun';
    return fmtSec(v);
  }
  function defaultName(mode, c) {
    var sh = function (s) { return s < 60 ? String(s) : fmtSec(s); };
    switch (mode) {
      case 'tabata': return (c.work === 20 && c.rest === 10 ? 'Tabata ' : 'Intervalles ') + c.rounds + '×' + sh(c.work) + '/' + sh(c.rest);
      case 'fortime': return c.cap ? 'For Time cap ' + fmtShort(c.cap) : 'For Time';
      case 'amrap': return 'AMRAP ' + fmtShort(c.dur);
      case 'emom': return 'EMOM ' + fmtShort(c.total) + (c.every !== 60 ? ' (/' + fmtShort(c.every) + ')' : '');
      case 'chrono': return 'Chrono';
      default: return 'Minuteur ' + fmtShort(c.dur);
    }
  }
  function summaryOf(mode, c) {
    var s;
    switch (mode) {
      case 'tabata': s = c.rounds + ' × ' + fmtShort(c.work) + ' travail / ' + fmtShort(c.rest) + ' repos'; break;
      case 'fortime': s = c.cap ? 'Time cap ' + fmtSec(c.cap) : 'Sans time cap'; break;
      case 'amrap': s = fmtSec(c.dur); break;
      case 'emom': s = 'Toutes les ' + fmtShort(c.every) + ' pendant ' + fmtShort(c.total); break;
      case 'chrono': s = 'Chronomètre libre'; break;
      default: s = fmtSec(c.dur);
    }
    return MODES[mode].title + ' · ' + s + ' · départ ' + (c.countdown || 0) + ' s';
  }

  /* ===================== Écran de réglage d'un timer ================= */
  var draft = null; // { mode, cfg, favId, favName }
  function openSetup(mode, fav) {
    if (fav) draft = { mode: fav.mode, cfg: Object.assign({}, fav.cfg), favId: fav.id, favName: fav.name };
    else draft = {
      mode: mode,
      cfg: Object.assign({}, MODES[mode].def, db.timerCfg[mode] || {}, { countdown: db.settings.countdown }),
      favId: null
    };
    go('setup');
  }
  function setupSummary() {
    var t = new TE.Timer(draft.mode, draft.cfg), cd = (draft.cfg.countdown || 0) * 1000;
    if (!isFinite(t.total)) return draft.mode === 'fortime' ? 'Pas de limite de temps' : 'Durée libre';
    var s = 'Durée totale : ' + fmt(t.total - cd);
    if (draft.mode === 'emom') s += ' · ' + t.phases.filter(function (p) { return p.kind === 'work'; }).length + ' intervalles';
    return s;
  }
  function readFavName() { var i = $('#fav-name'); if (i && draft) draft.favName = i.value.trim(); }

  /* ======================= Écran du timer en cours =================== */
  var run = null;
  function startRun(p) {
    var t = new TE.Timer(p.mode, p.cfg);
    run = { p: p, timer: t, raf: 0, ended: false, lastPlus: 0, el: {
      root: $('#run'), time: $('#r-time'), phase: $('#r-phase'), round: $('#r-round'),
      sub: $('#r-sub'), pause: $('#r-pause'), count: $('#r-count'), last: $('#r-last'), plus: $('#r-plus')
    }, cache: {} };
    t.start(Date.now());
    wake.on('run').then(function (ok) {
      if (!ok && run && !run.ended) {
        var n = $('#r-note');
        if (n) n.textContent = 'Astuce : Réglages iPhone › Luminosité › Verrouillage auto › Jamais, pour que l’écran reste allumé.';
      }
    });
    onLeave(function () { if (run) { cancelAnimationFrame(run.raf); run.ended = true; } wake.off('run'); run = null; });
    loop();
  }
  function loop() {
    if (!run || run.ended) return;
    var r = run.timer.poll(Date.now());
    r.events.forEach(function (ev) {
      if (r.raw - ev.at > 1500) return; // signal trop ancien (app en arrière-plan) : on ne bipe pas
      if (ev.type === 'tick') snd.tick();
      else if (ev.type === 'start') { if (ev.kind === 'rest') snd.rest(); else snd.go(); }
      else if (ev.type === 'end') snd.end();
    });
    paint(r.state);
    if (r.state.done) { endRun(false); return; }
    run.raf = requestAnimationFrame(loop);
  }
  function setText(el, key, v) {
    if (el && run.cache[key] !== v) { run.cache[key] = v; el.textContent = v; }
  }
  function paint(st) {
    var d = TE.describe(run.timer, st), E = run.el, paused = run.timer.isPaused();
    var timeKey = d.big + '|' + d.tenths;
    if (run.cache.time !== timeKey) {
      run.cache.time = timeKey;
      E.time.innerHTML = esc(d.big) + (d.tenths != null ? '<span class="ds">,' + d.tenths + '</span>' : '');
      E.time.classList.toggle('long', d.big.length > 5);
      E.time.classList.toggle('cd', st.phase.kind === 'countdown');
    }
    setText(E.phase, 'phase', paused ? 'PAUSE' : d.phase);
    setText(E.round, 'round', d.round);
    setText(E.sub, 'sub', d.sub);
    setText(E.pause, 'pausebtn', paused ? 'REPRENDRE' : 'PAUSE');
    var cls = 'run ' + d.cls + (paused ? ' paused' : '');
    if (E.root.className !== cls) E.root.className = cls;
    if (E.plus) E.plus.classList.toggle('dim', st.phase.kind !== 'work' || paused);
  }
  function paintSplits() {
    var t = run.timer, E = run.el;
    if (!E.count) return;
    E.count.textContent = t.splits.length;
    var s = t.splits[t.splits.length - 1];
    E.last.innerHTML = s
      ? 'Round ' + s.n + ' : <b>' + fmt(s.lap, true) + '</b> (total ' + fmt(s.at, true) + ') <button class="link" data-act="undoSplit">annuler</button>'
      : '';
  }
  function endRun(byUser) {
    var t = run.timer;
    run.ended = true;
    cancelAnimationFrame(run.raf);
    wake.off('run');
    var m = run.p.mode, c = run.p.cfg;
    var work = Math.max(0, t.elapsed(Date.now()) - t.workStart);
    var lines = [];
    if (m === 'fortime') {
      if (!byUser) lines.push('Time cap atteint (' + fmtSec(c.cap) + ')');
      else lines.push('Temps : <b>' + fmt(work, true) + '</b>');
    } else if (m === 'chrono') {
      lines.push('Temps : <b>' + fmt(work, true) + ',' + Math.floor((work % 1000) / 100) + '</b>');
    } else if (m === 'tabata' || m === 'emom') {
      var st = t.stateAt(t.elapsed(Date.now()));
      var doneRounds = byUser ? (st.phase.round || 1) - 1 : (st.phase.rounds || 0);
      if (byUser) lines.push('Arrêté pendant le ' + (m === 'emom' ? 'n° ' : 'round ') + (st.phase.round || 1) + ' / ' + (st.phase.rounds || '?'));
      else lines.push((m === 'emom' ? 'Intervalles terminés : ' : 'Rounds terminés : ') + '<b>' + doneRounds + '</b>');
      lines.push('Durée : ' + fmt(work, true));
    } else {
      lines.push('Durée : <b>' + fmt(work, true) + '</b>');
    }
    if (SPLIT_MODES[m]) lines.push('Rounds : <b>' + t.splits.length + '</b>');
    var table = '';
    if (t.splits.length) {
      table = '<table class="splits"><thead><tr><th>Round</th><th>Temps du round</th><th>Cumul</th></tr></thead><tbody>' +
        t.splits.map(function (s) {
          return '<tr><td>' + s.n + '</td><td>' + fmt(s.lap, true) + '</td><td>' + fmt(s.at, true) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    run.el.root.className = 'run ph-done';
    run.el.root.innerHTML =
      '<div class="end">' +
      '<div class="end-title">' + (byUser ? 'ARRÊTÉ' : 'TERMINÉ !') + '</div>' +
      '<div class="end-name">' + esc(run.p.name) + '</div>' +
      '<div class="end-lines">' + lines.map(function (l) { return '<p>' + l + '</p>'; }).join('') + '</div>' +
      table +
      '<div class="end-btns">' +
      '<button class="btn btn-go" data-act="restart">Recommencer</button>' +
      (run.p.favId ? '' : '<button class="btn" data-act="saveFavRun">★ Enregistrer en favori</button>') +
      '<button class="btn" data-act="home">Accueil</button>' +
      '</div></div>';
  }

  /* ========================= Musculation : outils ===================== */
  function activeSession() {
    if (!db.activeSessionId) return null;
    return db.sessions.filter(function (s) { return s.id === db.activeSessionId; })[0] || null;
  }
  function doneSets(name, exceptSessionId) {
    var k = norm(name), out = [];
    db.sessions.forEach(function (s) {
      if (s.id === exceptSessionId) return;
      s.exercises.forEach(function (ex) {
        if (norm(ex.name) !== k) return;
        ex.sets.forEach(function (st) { if (st.done && st.reps > 0) out.push({ s: s, st: st }); });
      });
    });
    return out;
  }
  function records(name) {
    var list = doneSets(name);
    if (!list.length) return null;
    var r = { kg: 0, kgDate: 0, e1: 0, e1Date: 0, e1Set: null, n: list.length, last: 0 };
    list.forEach(function (x) {
      var kg = x.st.kg || 0, e = e1rm(kg, x.st.reps);
      if (kg > r.kg) { r.kg = kg; r.kgDate = x.s.start; }
      if (e > r.e1) { r.e1 = e; r.e1Date = x.s.start; r.e1Set = x.st; }
      if (x.s.start > r.last) r.last = x.s.start;
    });
    return r;
  }
  /* séries de la dernière séance (hors séance en cours) pour un exercice */
  function lastSets(name, exceptSessionId) {
    var k = norm(name), best = null;
    db.sessions.forEach(function (s) {
      if (s.id === exceptSessionId) return;
      s.exercises.forEach(function (ex) {
        if (norm(ex.name) !== k) return;
        var d = ex.sets.filter(function (st) { return st.done; });
        if (d.length && (!best || s.start > best.s.start)) best = { s: s, sets: d };
      });
    });
    return best;
  }
  function fmtSet(st) {
    var w = st.kg > 0 ? fmtKg(st.kg) + ' kg × ' + st.reps : st.reps + ' reps';
    return w + (st.rpe ? ' @' + st.rpe : '') + (st.pr ? ' 🏆' : '');
  }
  /* Records battus par cette série (comparée à toutes les autres) */
  function checkPR(name, set) {
    var others = doneSets(name).filter(function (x) { return x.st !== set; });
    if (!others.length) return [];
    var bestKg = 0, bestE = 0, msgs = [];
    others.forEach(function (x) { bestKg = Math.max(bestKg, x.st.kg || 0); bestE = Math.max(bestE, e1rm(x.st.kg || 0, x.st.reps)); });
    var kg = set.kg || 0, e = e1rm(kg, set.reps);
    if (kg > 0 && kg > bestKg) msgs.push('Poids max : <b>' + fmtKg(kg) + ' kg</b> (avant ' + fmtKg(bestKg) + ' kg)');
    if (kg > 0 && e > bestE + 0.05) msgs.push('1RM estimé : <b>' + fmtKg(e) + ' kg</b> (avant ' + fmtKg(bestE) + ' kg)');
    if (!msgs.length) {
      var same = others.filter(function (x) { return (x.st.kg || 0) === kg; });
      if (same.length) {
        var maxR = Math.max.apply(null, same.map(function (x) { return x.st.reps; }));
        if (set.reps > maxR) msgs.push('Répétitions à ' + (kg > 0 ? fmtKg(kg) + ' kg' : 'poids du corps') + ' : <b>' + set.reps + '</b> (avant ' + maxR + ')');
      }
    }
    return msgs;
  }
  function celebrate(name, msgs) {
    snd.fanfare();
    var colors = ['#37d67a', '#ffa94d', '#4dabf7', '#ff6b6b', '#ffd43b', '#da77f2'], conf = '';
    for (var i = 0; i < 40; i++) {
      conf += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + colors[i % colors.length] +
        ';animation-delay:' + (Math.random() * 0.6).toFixed(2) + 's;animation-duration:' + (1.6 + Math.random() * 1.2).toFixed(2) + 's"></i>';
    }
    var ov = document.createElement('div');
    ov.className = 'pr-ov';
    ov.innerHTML = '<div class="confetti">' + conf + '</div><div class="pr-box"><div class="pr-trophy">🏆</div>' +
      '<h2>NOUVEAU RECORD !</h2><div class="pr-ex">' + esc(name) + '</div>' +
      msgs.map(function (m) { return '<p>' + m + '</p>'; }).join('') +
      '<button class="btn btn-go">Super !</button></div>';
    document.body.appendChild(ov);
    var close = function () { ov.remove(); };
    ov.addEventListener('click', function (e) { e.stopPropagation(); close(); });
    setTimeout(close, 6000);
  }
  function addToLibrary(name) {
    var k = norm(name);
    var found = db.exercises.filter(function (n) { return norm(n) === k; })[0];
    if (found) return found;
    db.exercises.push(name); save();
    return name;
  }
  /* Choix d'un exercice avec autocomplétion */
  function pickExercise(title) {
    return new Promise(function (res) {
      var ov = document.createElement('div');
      ov.className = 'modal-ov';
      ov.innerHTML = '<div class="modal modal-tall"><h2>' + esc(title || 'Ajouter un exercice') + '</h2>' +
        '<input type="text" class="m-input" id="ex-q" placeholder="Rechercher ou créer…" autocomplete="off" autocapitalize="sentences">' +
        '<div class="sugg-list" id="ex-sugg"></div>' +
        '<div class="modal-btns"><button class="btn" data-x="1">Annuler</button></div></div>';
      document.body.appendChild(ov);
      var q = ov.querySelector('#ex-q'), box = ov.querySelector('#ex-sugg');
      function draw() {
        var v = q.value.trim(), nv = norm(v);
        var list = db.exercises.filter(function (n) { return !nv || norm(n).indexOf(nv) >= 0; });
        list.sort(function (a, b) {
          var sa = norm(a).indexOf(nv) === 0 ? 0 : 1, sb = norm(b).indexOf(nv) === 0 ? 0 : 1;
          return sa - sb || a.localeCompare(b, 'fr');
        });
        var exact = db.exercises.some(function (n) { return norm(n) === nv; });
        box.innerHTML = (v && !exact ? '<button class="sugg new" data-name="' + esc(v) + '">+ Créer « ' + esc(v) + ' »</button>' : '') +
          list.slice(0, 60).map(function (n) { return '<button class="sugg" data-name="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') +
          (!list.length && !v ? '<p class="empty">Aucun exercice.</p>' : '');
      }
      function pick(name) { ov.remove(); res(addToLibrary(name)); }
      q.addEventListener('input', draw);
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { var f = box.querySelector('[data-name]'); if (f) pick(f.dataset.name); }
      });
      ov.addEventListener('click', function (e) {
        e.stopPropagation();
        var b = e.target.closest('[data-name]');
        if (b) pick(b.dataset.name);
        else if (e.target.closest('[data-x]')) { ov.remove(); res(null); }
      });
      draw();
      q.focus();
    });
  }
  function startSession(name, exNames) {
    var s = {
      id: uid(), start: Date.now(), end: null, name: name,
      exercises: exNames.map(function (n) {
        var prev = lastSets(n);
        return {
          name: n,
          sets: prev ? prev.sets.map(function (p) { return { reps: p.reps, kg: p.kg, rpe: p.rpe || null, done: false }; })
                     : [{ reps: null, kg: null, rpe: null, done: false }]
        };
      })
    };
    db.sessions.push(s);
    db.activeSessionId = s.id;
    save();
    go('session');
  }
  function guardActive() {
    if (!activeSession()) return Promise.resolve(true);
    return modal({ title: 'Une séance est déjà en cours', buttons: [
      { label: 'Reprendre la séance en cours', value: 'resume', cls: 'btn-go' },
      { label: 'Annuler', value: null }
    ] }).then(function (v) { if (v === 'resume') go('session'); return false; });
  }

  /* ========================== Timer de repos ========================== */
  var rest = { timer: null, iv: 0 };
  function restStart(sec) {
    rest.timer = new TE.Timer('minuteur', { dur: sec, countdown: 0 });
    rest.timer.start(Date.now());
    rest.timer.poll(Date.now()); // pas de bip au lancement
    wake.on('rest');
    clearInterval(rest.iv);
    rest.iv = setInterval(restTick, 100);
    paintRestBar();
    restTick();
  }
  function restTick() {
    if (!rest.timer) return;
    var r = rest.timer.poll(Date.now());
    r.events.forEach(function (ev) {
      if (r.raw - ev.at > 1500) return;
      if (ev.type === 'tick') snd.tick(); else if (ev.type === 'end') snd.end();
    });
    var el = $('#rest-time');
    if (el) el.textContent = fmt(r.state.remaining);
    if (r.state.done) { restStop(); toast('Repos terminé : au boulot !'); }
  }
  function restStop() {
    clearInterval(rest.iv); rest.timer = null; wake.off('rest'); paintRestBar();
  }
  function restBarHtml() {
    if (rest.timer) {
      return '<div class="rest-run"><span class="rest-l">Repos</span><b id="rest-time">' + fmt(rest.timer.stateAt(rest.timer.elapsed(Date.now())).remaining) + '</b>' +
        '<button data-act="restAdd">+15 s</button><button data-act="restStop">Stop</button></div>';
    }
    return '<div class="rest-pick"><span class="rest-l">Repos</span>' + [60, 90, 120, 180].map(function (s) {
      return '<button data-act="restGo" data-v="' + s + '">' + (s < 120 ? s + ' s' : s / 60 + ' min') + '</button>';
    }).join('') + '</div>';
  }
  function paintRestBar() { var b = $('#restbar'); if (b) b.innerHTML = restBarHtml(); }

  /* ============================ Graphique ============================= */
  function chart(pts) {
    if (!pts.length) return '';
    var W = 340, H = 210, L = 42, R = 12, T = 16, B = 30;
    var x0 = pts[0].x, x1 = pts[pts.length - 1].x;
    if (x1 === x0) { x0 -= 86400000; x1 += 86400000; }
    var ys = [];
    pts.forEach(function (p) { ys.push(p.kg, p.e1); });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    // graduations « rondes » (1, 2, 2,5, 5, 10, 20… kg)
    var rawStep = Math.max(hi - lo, 5) * 1.25 / 4;
    var step = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200].filter(function (s) { return s >= rawStep; })[0] || 500;
    var y0 = Math.max(0, Math.floor((lo - rawStep * 0.3) / step) * step);
    var y1 = Math.ceil((hi + rawStep * 0.3) / step) * step;
    if (y1 <= y0) y1 = y0 + step;
    var X = function (x) { return L + (x - x0) / (x1 - x0) * (W - L - R); };
    var Y = function (y) { return T + (1 - (y - y0) / (y1 - y0)) * (H - T - B); };
    var g = '';
    for (var v = y0; v <= y1 + 1e-9; v += step) {
      var yy = Y(v).toFixed(1);
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" class="grid"/>' +
        '<text x="' + (L - 6) + '" y="' + (+yy + 4) + '" class="ylab">' + fmtKg(v) + '</text>';
    }
    var d = function (p) { return new Date(p).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }); };
    var xl = [pts[0]];
    if (pts.length > 2) xl.push(pts[Math.floor((pts.length - 1) / 2)]);
    if (pts.length > 1) xl.push(pts[pts.length - 1]);
    xl.forEach(function (p, i) {
      var anchor = i === 0 ? 'start' : (i === xl.length - 1 && xl.length > 1 ? 'end' : 'middle');
      g += '<text x="' + X(p.x).toFixed(1) + '" y="' + (H - 8) + '" class="xlab" text-anchor="' + anchor + '">' + d(p.x) + '</text>';
    });
    function series(key, cls) {
      var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p[key]).toFixed(1); }).join(' ');
      return '<path d="' + path + '" class="ln ' + cls + '"/>' + pts.map(function (p) {
        return '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p[key]).toFixed(1) + '" r="3.5" class="dt ' + cls + '"/>';
      }).join('');
    }
    return '<div class="legend"><span class="lg c-e1">1RM estimé</span><span class="lg c-kg">Poids max</span></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Progression">' + g + series('e1', 'c-e1') + series('kg', 'c-kg') + '</svg>';
  }

  /* ============================== Écrans ============================== */
  var TILES = [
    { k: 'tabata', label: 'Tabata / Intervalles', icon: '⚡' },
    { k: 'fortime', label: 'For Time', icon: '🏁' },
    { k: 'amrap', label: 'AMRAP', icon: '🔁' },
    { k: 'emom', label: 'EMOM', icon: '⏰' },
    { k: 'chrono', label: 'Chrono', icon: '⏱️' },
    { k: 'minuteur', label: 'Minuteur', icon: '⏳' },
    { k: 'muscu', label: 'Muscu', icon: '🏋️' },
    { k: 'favoris', label: 'Favoris', icon: '⭐' }
  ];

  var tplDraft = null;
  var SCREENS = {
    /* ---------------------------- Accueil --------------------------- */
    home: {
      html: function () {
        var act = activeSession();
        return '<div class="home">' +
          '<div class="home-h"><h1>Entraînement</h1><button class="icon-btn" data-act="nav" data-to="settings" aria-label="Réglages">⚙︎</button></div>' +
          (act ? '<button class="live-pill" data-act="openSession">● Séance de muscu en cours — reprendre ›</button>' : '') +
          '<div class="tiles">' + TILES.map(function (t) {
            return '<button class="tile t-' + t.k + '" data-act="tile" data-k="' + t.k + '"><span class="ti">' + t.icon + '</span><span class="tl">' + t.label + '</span></button>';
          }).join('') + '</div></div>';
      }
    },

    /* ------------------------ Réglage d'un timer -------------------- */
    setup: {
      html: function () {
        var M = MODES[draft.mode], c = draft.cfg;
        return header(draft.favId ? 'Modifier le favori' : M.title) + '<div class="pad setup">' +
          (draft.favId ? '<label class="flabel" for="fav-name">Nom du favori</label><input id="fav-name" type="text" value="' + esc(draft.favName) + '" autocomplete="off">' +
            '<p class="hint">' + esc(M.title) + '</p>' : '') +
          M.fields.map(function (f) {
            return '<div class="field"><div class="flabel">' + f.label + '</div><div class="stepper">' +
              '<button data-step="' + f.k + '" data-dir="-1" aria-label="Moins">−</button>' +
              '<div class="val" id="val-' + f.k + '">' + fieldText(f, c[f.k]) + '</div>' +
              '<button data-step="' + f.k + '" data-dir="1" aria-label="Plus">+</button></div></div>';
          }).join('') +
          (M.info ? '<p class="hint">' + M.info + '</p>' : '') +
          '<div class="field"><div class="flabel">Compte à rebours de départ</div><div class="seg">' +
          [0, 3, 5, 10, 15].map(function (s) {
            return '<button data-act="cd" data-v="' + s + '" class="' + (c.countdown === s ? 'on' : '') + '">' + s + ' s</button>';
          }).join('') + '</div></div>' +
          '<p class="summary" id="setup-sum">' + setupSummary() + '</p>' +
          '<button class="btn btn-go btn-xl" data-act="startTimer">DÉMARRER</button>' +
          (draft.favId ? '<button class="btn" data-act="saveFav">Enregistrer les modifications</button>'
                       : '<button class="btn btn-ghost" data-act="saveFav">★ Enregistrer en favori</button>') +
          '</div>';
      }
    },

    /* --------------------------- Timer en cours --------------------- */
    run: {
      html: function (p) {
        return '<div class="run ph-countdown" id="run">' +
          '<div class="run-head"><span class="run-name">' + esc(p.name) + '</span><span id="r-round" class="run-round"></span></div>' +
          '<div class="run-mid"><div class="run-phase" id="r-phase"></div>' +
          '<div class="run-time" id="r-time"></div>' +
          '<div class="run-sub" id="r-sub"></div></div>' +
          (SPLIT_MODES[p.mode] ? '<button class="btn-plus dim" data-act="plus" id="r-plus"><b>+1 ROUND</b><span id="r-count">0</span></button>' +
            '<div class="run-last" id="r-last"></div>' : '') +
          '<div class="run-ctrl"><button class="btn" data-act="pause" id="r-pause">PAUSE</button>' +
          '<button class="btn" data-act="stop">ARRÊTER</button></div>' +
          '<div class="run-note" id="r-note"></div></div>';
      },
      after: function (p) { startRun(p); }
    },

    /* ------------------------------ Favoris ------------------------- */
    favorites: {
      html: function () {
        return header('Favoris') + '<div class="pad">' +
          (db.favorites.length ? db.favorites.map(function (f) {
            return '<div class="card fav"><button class="fav-go" data-act="favGo" data-id="' + f.id + '">' +
              '<span class="fav-play">▶</span><span><b>' + esc(f.name) + '</b><small>' + esc(summaryOf(f.mode, f.cfg)) + '</small></span></button>' +
              '<div class="row-btns"><button class="btn btn-sm" data-act="favEdit" data-id="' + f.id + '">✎ Modifier</button>' +
              '<button class="btn btn-sm btn-danger-ghost" data-act="favDel" data-id="' + f.id + '">Supprimer</button></div></div>';
          }).join('') : '<p class="empty">Aucun favori pour l’instant.<br>Réglez un timer puis touchez « ★ Enregistrer en favori ».</p>') +
          '</div>';
      }
    },

    /* --------------------------- Muscu : menu ------------------------ */
    muscu: {
      html: function () {
        var act = activeSession();
        return header('Musculation') + '<div class="pad">' +
          (act ? '<button class="card live" data-act="openSession"><b>● Séance en cours : ' + esc(act.name) + '</b><small>Touchez pour reprendre</small></button>'
               : '<button class="btn btn-go btn-xl" data-act="startFree">Démarrer une séance libre</button>') +
          '<h2 class="h2">Séances modèles</h2>' +
          db.templates.map(function (t) {
            return '<div class="card tpl"><button class="tpl-go" data-act="startTpl" data-id="' + t.id + '"><b>▶ ' + esc(t.name) + '</b>' +
              '<small>' + esc(t.exercises.join(' · ') || 'Aucun exercice') + '</small></button>' +
              '<button class="tpl-edit" data-act="editTpl" data-id="' + t.id + '" aria-label="Modifier">✎</button></div>';
          }).join('') +
          '<button class="btn btn-ghost" data-act="newTpl">+ Nouveau modèle</button>' +
          '<div class="grid3">' +
          '<button class="tile-s" data-act="nav" data-to="history"><span>📅</span>Historique</button>' +
          '<button class="tile-s" data-act="nav" data-to="progress"><span>📈</span>Progrès & records</button>' +
          '<button class="tile-s" data-act="nav" data-to="exercises"><span>📋</span>Exercices</button>' +
          '</div></div>';
      }
    },

    /* ------------------------ Muscu : séance en cours --------------- */
    session: {
      html: function () {
        var s = activeSession();
        if (!s) return header('Séance') + '<div class="pad"><p class="empty">Aucune séance en cours.</p></div>';
        return header(s.name, '<span class="clock" id="sess-clock"></span>') +
          '<div class="pad sess">' +
          s.exercises.map(function (ex, ei) { return exCard(s, ex, ei); }).join('') +
          '<button class="btn btn-ghost" data-act="addEx">+ Ajouter un exercice</button>' +
          '<button class="btn btn-go" data-act="finishSession">Terminer la séance</button>' +
          '<button class="link danger" data-act="cancelSession">Abandonner la séance</button>' +
          '</div><div class="restbar" id="restbar">' + restBarHtml() + '</div>';
      },
      after: function () {
        var s = activeSession();
        if (!s) return;
        var tick = function () { var c = $('#sess-clock'); if (c) c.textContent = fmt(Date.now() - s.start, true); };
        tick();
        var iv = setInterval(tick, 1000);
        onLeave(function () { clearInterval(iv); });
      }
    },

    /* --------------------- Muscu : éditeur de modèle ---------------- */
    tpl: {
      html: function () {
        var t = tplDraft;
        return header(t.isNew ? 'Nouveau modèle' : 'Modifier le modèle') + '<div class="pad">' +
          '<label class="flabel" for="tpl-name">Nom de la séance</label>' +
          '<input id="tpl-name" type="text" value="' + esc(t.name) + '" placeholder="ex. Push" autocomplete="off" autocapitalize="sentences">' +
          '<h2 class="h2">Exercices</h2>' +
          (t.exercises.length ? t.exercises.map(function (n, i) {
            return '<div class="card row"><span class="row-t">' + (i + 1) + '. ' + esc(n) + '</span>' +
              '<button class="sq" data-act="tplMove" data-i="' + i + '" data-d="-1" aria-label="Monter">↑</button>' +
              '<button class="sq" data-act="tplMove" data-i="' + i + '" data-d="1" aria-label="Descendre">↓</button>' +
              '<button class="sq danger" data-act="tplRemove" data-i="' + i + '" aria-label="Retirer">✕</button></div>';
          }).join('') : '<p class="empty">Aucun exercice.</p>') +
          '<button class="btn btn-ghost" data-act="tplAddEx">+ Ajouter un exercice</button>' +
          '<button class="btn btn-go" data-act="tplSave">Enregistrer le modèle</button>' +
          (t.isNew ? '' : '<button class="link danger" data-act="tplDelete">Supprimer ce modèle</button>') +
          '</div>';
      }
    },

    /* --------------------------- Historique -------------------------- */
    history: {
      html: function () {
        var list = db.sessions.filter(function (s) { return s.end; }).sort(function (a, b) { return b.start - a.start; });
        return header('Historique') + '<div class="pad">' +
          (list.length ? list.map(function (s) {
            var n = 0, vol = 0;
            s.exercises.forEach(function (ex) { ex.sets.forEach(function (st) { n++; vol += (st.kg || 0) * (st.reps || 0); }); });
            return '<details class="card hist"><summary><b>' + esc(dateFr(s.start)) + ' · ' + esc(s.name) + '</b>' +
              '<small>' + s.exercises.length + ' exercice' + (s.exercises.length > 1 ? 's' : '') + ' · ' + n + ' séries · ' +
              Math.max(1, Math.round((s.end - s.start) / 60000)) + ' min' + (vol ? ' · ' + Math.round(vol).toLocaleString('fr-FR') + ' kg soulevés' : '') + '</small></summary>' +
              s.exercises.map(function (ex) {
                return '<div class="h-ex"><b>' + esc(ex.name) + '</b><ol>' + ex.sets.map(function (st) { return '<li>' + esc(fmtSet(st)) + '</li>'; }).join('') + '</ol></div>';
              }).join('') +
              '<button class="link danger" data-act="delSession" data-id="' + s.id + '">Supprimer cette séance</button></details>';
          }).join('') : '<p class="empty">Aucune séance terminée pour l’instant.</p>') +
          '</div>';
      }
    },

    /* ----------------------- Progrès & records ----------------------- */
    progress: {
      html: function (p) {
        if (p.ex) return progressDetail(p.ex);
        var names = {};
        db.sessions.forEach(function (s) { s.exercises.forEach(function (ex) {
          if (ex.sets.some(function (st) { return st.done; })) names[norm(ex.name)] = ex.name;
        }); });
        var rows = Object.keys(names).map(function (k) { return { name: names[k], r: records(names[k]) }; })
          .filter(function (x) { return x.r; })
          .sort(function (a, b) { return b.r.last - a.r.last; });
        return header('Progrès & records') + '<div class="pad">' +
          (rows.length ? '<p class="hint">Records personnels. Touchez un exercice pour voir sa courbe.</p>' + rows.map(function (x) {
            return '<button class="card pr-row" data-act="nav" data-to="progress" data-ex="' + esc(x.name) + '"><b>' + esc(x.name) + '</b>' +
              '<span>' + (x.r.kg > 0 ? 'Max <b>' + fmtKg(x.r.kg) + ' kg</b> · 1RM est. <b>' + fmtKg(x.r.e1) + ' kg</b>' : 'Poids du corps') + ' ›</span></button>';
          }).join('') : '<p class="empty">Validez des séries pendant vos séances pour voir vos records et vos courbes ici.</p>') +
          '</div>';
      }
    },

    /* ---------------------------- Exercices -------------------------- */
    exercises: {
      html: function () {
        var list = db.exercises.slice().sort(function (a, b) { return a.localeCompare(b, 'fr'); });
        return header('Exercices', '<button class="btn btn-sm btn-go" data-act="exAdd">+ Ajouter</button>') + '<div class="pad">' +
          '<input type="search" id="ex-filter" placeholder="Rechercher…" autocomplete="off">' +
          '<div id="ex-list">' + list.map(function (n) {
            return '<div class="card row ex-row" data-n="' + esc(norm(n)) + '"><span class="row-t">' + esc(n) + '</span>' +
              '<button class="sq danger" data-act="exDel" data-name="' + esc(n) + '" aria-label="Supprimer">✕</button></div>';
          }).join('') + '</div>' +
          '<p class="hint">Supprimer un exercice de la liste ne touche pas à votre historique.</p></div>';
      }
    },

    /* ----------------------------- Réglages -------------------------- */
    settings: {
      html: function () {
        return header('Réglages') + '<div class="pad">' +
          '<div class="field"><div class="flabel">Compte à rebours de départ par défaut</div><div class="seg">' +
          [0, 3, 5, 10, 15].map(function (s) {
            return '<button data-act="setCd" data-v="' + s + '" class="' + (db.settings.countdown === s ? 'on' : '') + '">' + s + ' s</button>';
          }).join('') + '</div></div>' +
          '<h2 class="h2">Sauvegarde</h2>' +
          '<p class="hint">Vos données sont uniquement dans ce téléphone. Exportez-les de temps en temps (vers Fichiers, iCloud Drive…) pour ne rien perdre.</p>' +
          '<button class="btn" data-act="exportData">⬆︎ Exporter mes données</button>' +
          '<button class="btn" data-act="importData">⬇︎ Importer une sauvegarde</button>' +
          '<input type="file" id="import-file" accept=".json,application/json" hidden>' +
          '<h2 class="h2">À propos</h2>' +
          '<p class="hint">Version : <span id="app-version">…</span><br>' +
          db.sessions.filter(function (s) { return s.end; }).length + ' séance(s), ' + db.favorites.length + ' favori(s), ' + db.exercises.length + ' exercices.</p>' +
          '<button class="link danger" data-act="wipe">Effacer toutes les données</button>' +
          '</div>';
      },
      after: function () {
        var el = $('#app-version');
        if (window.caches) caches.keys().then(function (keys) {
          var k = keys.filter(function (x) { return x.indexOf('entrainement-') === 0; })[0];
          if (el) el.textContent = k ? k.replace('entrainement-', '') : 'non installée (pas de cache)';
        }).catch(function () { if (el) el.textContent = '?'; });
        else if (el) el.textContent = '?';
      }
    }
  };

  function exCard(s, ex, ei) {
    var r = records(ex.name), prev = lastSets(ex.name, s.id);
    var info = r && r.kg > 0 ? 'Record ' + fmtKg(r.kg) + ' kg · 1RM est. ' + fmtKg(r.e1) + ' kg' : (r ? 'Déjà pratiqué' : 'Premier essai : pas encore de record');
    if (prev) info += '<br>Dernière fois (' + esc(dateFr(prev.s.start)) + ') : ' + prev.sets.slice(0, 5).map(function (st) {
      return st.kg > 0 ? fmtKg(st.kg) + '×' + st.reps : st.reps + ' reps';
    }).join(', ');
    return '<section class="card ex"><div class="ex-h"><h3>' + esc(ex.name) + '</h3>' +
      '<button class="sq" data-act="exMenu" data-ei="' + ei + '" aria-label="Options">⋯</button></div>' +
      '<div class="ex-info">' + info + '</div>' +
      (ex.sets.length ? '<div class="set set-head"><span>#</span><span>Reps</span><span>kg</span><span>RPE</span><span></span><span></span></div>' : '') +
      ex.sets.map(function (st, si) {
        var a = ' data-ei="' + ei + '" data-si="' + si + '"';
        return '<div class="set' + (st.done ? ' done' : '') + '">' +
          '<span class="sn">' + (st.pr ? '🏆' : si + 1) + '</span>' +
          '<input type="number" inputmode="numeric" pattern="[0-9]*" min="0" placeholder="reps" value="' + (st.reps == null ? '' : st.reps) + '" data-f="reps"' + a + '>' +
          '<input type="text" inputmode="decimal" placeholder="kg" value="' + (st.kg == null ? '' : fmtKg(st.kg)) + '" data-f="kg"' + a + '>' +
          '<select data-f="rpe"' + a + '><option value="">–</option>' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (v) {
            return '<option value="' + v + '"' + (st.rpe === v ? ' selected' : '') + '>' + v + '</option>';
          }).join('') + '</select>' +
          '<button class="ok" data-act="toggleSet"' + a + ' aria-label="Valider la série">✓</button>' +
          '<button class="del" data-act="delSet"' + a + ' aria-label="Supprimer la série">✕</button></div>';
      }).join('') +
      '<button class="btn-add" data-act="addSet" data-ei="' + ei + '">+ Série</button></section>';
  }

  function progressDetail(name) {
    var r = records(name);
    var pts = [];
    db.sessions.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (s) {
      var kg = 0, e1 = 0, best = null, any = false;
      s.exercises.forEach(function (ex) {
        if (norm(ex.name) !== norm(name)) return;
        ex.sets.forEach(function (st) {
          if (!st.done || !(st.reps > 0)) return;
          any = true;
          kg = Math.max(kg, st.kg || 0);
          var e = e1rm(st.kg || 0, st.reps);
          if (e >= e1) { e1 = e; best = st; }
        });
      });
      if (any) pts.push({ x: s.start, kg: kg, e1: e1, best: best });
    });
    var weighted = pts.some(function (p) { return p.kg > 0; });
    return header(name) + '<div class="pad">' +
      (r ? '<div class="pr-cards">' +
        '<div class="pr-card"><small>Poids max</small><b>' + fmtKg(r.kg) + ' kg</b><small>' + (r.kgDate ? esc(dateFr(r.kgDate, true)) : '') + '</small></div>' +
        '<div class="pr-card"><small>1RM estimé (Epley)</small><b>' + fmtKg(r.e1) + ' kg</b><small>' + (r.e1Set ? esc(fmtKg(r.e1Set.kg) + ' kg × ' + r.e1Set.reps) : '') + '</small></div>' +
        '</div>' : '') +
      (weighted ? (pts.length > 1 ? chart(pts) : '<p class="hint">La courbe apparaîtra après une deuxième séance.</p>') : '<p class="hint">Exercice au poids du corps : pas de courbe de charge.</p>') +
      '<h2 class="h2">Séances</h2>' +
      '<table class="splits"><thead><tr><th>Date</th><th>Meilleure série</th><th>1RM est.</th></tr></thead><tbody>' +
      pts.slice().reverse().slice(0, 30).map(function (p) {
        return '<tr><td>' + esc(dateFr(p.x)) + '</td><td>' + (p.best ? esc(fmtSet(p.best)) : '–') + '</td><td>' + (p.e1 ? fmtKg(p.e1) : '–') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="hint">1RM estimé = poids × (1 + reps ÷ 30) (formule d’Epley ; pour 1 rep, c’est le poids soulevé).</p></div>';
  }

  /* ============================== Actions ============================= */
  function sessSet(el) {
    var s = activeSession(); if (!s) return null;
    var ex = s.exercises[+el.dataset.ei]; if (!ex) return null;
    return { s: s, ex: ex, st: el.dataset.si != null ? ex.sets[+el.dataset.si] : null };
  }

  var A = {
    back: back,
    home: home,
    nav: function (el) { go(el.dataset.to, el.dataset.ex ? { ex: el.dataset.ex } : {}); },
    tile: function (el) {
      var k = el.dataset.k;
      if (k === 'muscu') go('muscu');
      else if (k === 'favoris') go('favorites');
      else openSetup(k);
    },

    /* --- réglages de timer --- */
    cd: function (el) {
      var v = +el.dataset.v;
      draft.cfg.countdown = v;
      db.settings.countdown = v; save(); // on mémorise le dernier choix
      el.parentNode.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === el); });
      $('#setup-sum').textContent = setupSummary();
    },
    startTimer: function () {
      readFavName();
      if (!draft.favId) { db.timerCfg[draft.mode] = Object.assign({}, draft.cfg); save(); }
      go('run', { mode: draft.mode, cfg: Object.assign({}, draft.cfg), name: draft.favId ? (draft.favName || defaultName(draft.mode, draft.cfg)) : MODES[draft.mode].title, favId: draft.favId });
    },
    saveFav: function () {
      readFavName();
      if (draft.favId) {
        var f = db.favorites.filter(function (x) { return x.id === draft.favId; })[0];
        if (f) { f.name = draft.favName || defaultName(draft.mode, draft.cfg); f.cfg = Object.assign({}, draft.cfg); save(); }
        toast('Favori modifié');
        back();
        return;
      }
      promptBox('Nom du favori', defaultName(draft.mode, draft.cfg)).then(function (name) {
        if (!name) return;
        db.favorites.push({ id: uid(), name: name, mode: draft.mode, cfg: Object.assign({}, draft.cfg) });
        save(); toast('★ « ' + name + ' » ajouté aux favoris');
      });
    },

    /* --- timer en cours --- */
    pause: function () {
      if (!run || run.ended) return;
      var t = run.timer, now = Date.now();
      if (t.isPaused()) t.resume(now); else t.pause(now);
    },
    stop: function () {
      if (!run || run.ended) return;
      var at = Date.now(), r = run; // l'heure d'arrêt est celle du premier appui
      confirmBox('Arrêter le timer ?', 'Oui, arrêter', 'Non, continuer', true).then(function (ok) {
        if (!ok || run !== r || r.ended) return;
        r.timer.stop(at);
        endRun(true);
      });
    },
    plus: function () {
      if (!run || run.ended) return;
      var now = Date.now();
      if (now - run.lastPlus < 800) return; // anti double appui
      var s = run.timer.addSplit(now);
      if (!s) return;
      run.lastPlus = now;
      snd.blip();
      paintSplits();
      var b = run.el.plus; b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
    },
    undoSplit: function () { if (run && !run.ended) { run.timer.undoSplit(); paintSplits(); } },
    restart: function () { if (run) go('run', run.p, true); },
    saveFavRun: function () {
      if (!run) return;
      var p = run.p;
      promptBox('Nom du favori', defaultName(p.mode, p.cfg)).then(function (name) {
        if (!name) return;
        db.favorites.push({ id: uid(), name: name, mode: p.mode, cfg: Object.assign({}, p.cfg) });
        save(); toast('★ « ' + name + ' » ajouté aux favoris');
      });
    },

    /* --- favoris --- */
    favGo: function (el) {
      var f = db.favorites.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (f) go('run', { mode: f.mode, cfg: Object.assign({}, f.cfg), name: f.name, favId: f.id });
    },
    favEdit: function (el) {
      var f = db.favorites.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (f) openSetup(null, f);
    },
    favDel: function (el) {
      var f = db.favorites.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!f) return;
      confirmBox('Supprimer « ' + f.name + ' » ?', 'Supprimer', 'Annuler', true).then(function (ok) {
        if (!ok) return;
        db.favorites = db.favorites.filter(function (x) { return x !== f; });
        save(); refresh();
      });
    },

    /* --- muscu : séances --- */
    openSession: function () { go('session'); },
    startFree: function () { guardActive().then(function (ok) { if (ok) startSession('Séance libre', []); }); },
    startTpl: function (el) {
      var t = db.templates.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (t) guardActive().then(function (ok) { if (ok) startSession(t.name, t.exercises); });
    },
    addEx: function () {
      pickExercise().then(function (name) {
        var s = activeSession(); if (!name || !s) return;
        var prev = lastSets(name, s.id);
        var p = prev ? prev.sets[0] : null;
        s.exercises.push({ name: name, sets: [{ reps: p ? p.reps : null, kg: p ? p.kg : null, rpe: p ? p.rpe || null : null, done: false }] });
        save(); refresh();
        window.scrollTo(0, document.body.scrollHeight);
      });
    },
    addSet: function (el) {
      var x = sessSet(el); if (!x) return;
      var src = x.ex.sets[x.ex.sets.length - 1];
      if (!src) { var prev = lastSets(x.ex.name, x.s.id); src = prev ? prev.sets[0] : null; }
      x.ex.sets.push({ reps: src ? src.reps : null, kg: src ? src.kg : null, rpe: src ? src.rpe || null : null, done: false });
      save(); refresh();
    },
    delSet: function (el) {
      var x = sessSet(el); if (!x || !x.st) return;
      var doIt = function () { x.ex.sets.splice(+el.dataset.si, 1); save(); refresh(); };
      if (!x.st.done) doIt();
      else confirmBox('Supprimer cette série validée ?', 'Supprimer', 'Annuler', true).then(function (ok) { if (ok) doIt(); });
    },
    toggleSet: function (el) {
      var x = sessSet(el); if (!x || !x.st) return;
      var st = x.st;
      if (st.done) { st.done = false; delete st.pr; save(); refresh(); return; }
      if (!(st.reps > 0)) { toast('Indiquez le nombre de répétitions'); return; }
      if (st.kg == null) st.kg = 0;
      st.done = true;
      var msgs = checkPR(x.ex.name, st);
      if (msgs.length) st.pr = true;
      save(); refresh();
      if (msgs.length) celebrate(x.ex.name, msgs);
    },
    exMenu: function (el) {
      var x = sessSet(el); if (!x) return;
      var ei = +el.dataset.ei, list = x.s.exercises;
      modal({ title: x.ex.name, buttons: [
        { label: '↑ Monter', value: 'up' }, { label: '↓ Descendre', value: 'down' },
        { label: 'Retirer de la séance', value: 'del', cls: 'btn-danger' }, { label: 'Annuler', value: null }
      ] }).then(function (v) {
        if (v === 'up' && ei > 0) list.splice(ei - 1, 0, list.splice(ei, 1)[0]);
        else if (v === 'down' && ei < list.length - 1) list.splice(ei + 1, 0, list.splice(ei, 1)[0]);
        else if (v === 'del') list.splice(ei, 1);
        else return;
        save(); refresh();
      });
    },
    finishSession: function () {
      var s = activeSession(); if (!s) return;
      confirmBox('Terminer la séance ?', 'Terminer', 'Continuer').then(function (ok) {
        if (!ok) return;
        var nSets = 0, vol = 0, nPR = 0;
        s.exercises.forEach(function (ex) {
          ex.sets = ex.sets.filter(function (st) { return st.done; }); // les séries non validées sont ignorées
          ex.sets.forEach(function (st) { nSets++; vol += (st.kg || 0) * st.reps; if (st.pr) nPR++; });
        });
        s.exercises = s.exercises.filter(function (ex) { return ex.sets.length; });
        if (!nSets) {
          db.sessions = db.sessions.filter(function (x) { return x !== s; });
          db.activeSessionId = null; save();
          toast('Aucune série validée : séance non enregistrée');
          go('muscu', {}, true); stack = [{ name: 'home', params: {} }];
          return;
        }
        s.end = Date.now(); db.activeSessionId = null; save();
        restStop();
        stack = [{ name: 'home', params: {} }];
        go('muscu', {}, true);
        modal({ title: 'Bravo ! 💪', html: '<p class="m-txt">' + s.exercises.length + ' exercice(s) · ' + nSets + ' séries' +
          (vol ? ' · ' + Math.round(vol).toLocaleString('fr-FR') + ' kg soulevés' : '') +
          (nPR ? '<br>🏆 ' + nPR + ' record(s) battu(s) !' : '') + '</p>', buttons: [{ label: 'OK', value: true, cls: 'btn-go' }] });
      });
    },
    cancelSession: function () {
      var s = activeSession(); if (!s) return;
      confirmBox('Abandonner la séance ? Les séries saisies seront perdues.', 'Abandonner', 'Continuer', true).then(function (ok) {
        if (!ok) return;
        db.sessions = db.sessions.filter(function (x) { return x !== s; });
        db.activeSessionId = null; save(); restStop();
        stack = [{ name: 'home', params: {} }];
        go('muscu', {}, true);
      });
    },

    /* --- muscu : repos --- */
    restGo: function (el) { restStart(+el.dataset.v); },
    restAdd: function () {
      if (!rest.timer) return;
      var rem = rest.timer.stateAt(rest.timer.elapsed(Date.now())).remaining;
      restStart(Math.ceil(rem / 1000) + 15);
    },
    restStop: function () { restStop(); },

    /* --- muscu : modèles --- */
    newTpl: function () { tplDraft = { id: null, isNew: true, name: '', exercises: [] }; go('tpl'); },
    editTpl: function (el) {
      var t = db.templates.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (t) { tplDraft = { id: t.id, isNew: false, name: t.name, exercises: t.exercises.slice() }; go('tpl'); }
    },
    tplAddEx: function () {
      pickExercise().then(function (n) { if (n) { tplDraft.exercises.push(n); refresh(); } });
    },
    tplMove: function (el) {
      var i = +el.dataset.i, j = i + (+el.dataset.d), L = tplDraft.exercises;
      if (j < 0 || j >= L.length) return;
      L.splice(j, 0, L.splice(i, 1)[0]); refresh();
    },
    tplRemove: function (el) { tplDraft.exercises.splice(+el.dataset.i, 1); refresh(); },
    tplSave: function () {
      var name = tplDraft.name.trim();
      if (!name) { toast('Donnez un nom à la séance'); $('#tpl-name').focus(); return; }
      if (tplDraft.isNew) db.templates.push({ id: uid(), name: name, exercises: tplDraft.exercises.slice() });
      else {
        var t = db.templates.filter(function (x) { return x.id === tplDraft.id; })[0];
        if (t) { t.name = name; t.exercises = tplDraft.exercises.slice(); }
      }
      save(); toast('Modèle enregistré'); back();
    },
    tplDelete: function () {
      confirmBox('Supprimer le modèle « ' + tplDraft.name + ' » ?', 'Supprimer', 'Annuler', true).then(function (ok) {
        if (!ok) return;
        db.templates = db.templates.filter(function (x) { return x.id !== tplDraft.id; });
        save(); back();
      });
    },

    /* --- historique / exercices --- */
    delSession: function (el) {
      confirmBox('Supprimer définitivement cette séance ?', 'Supprimer', 'Annuler', true).then(function (ok) {
        if (!ok) return;
        db.sessions = db.sessions.filter(function (s) { return s.id !== el.dataset.id; });
        save(); refresh();
      });
    },
    exAdd: function () {
      promptBox('Nouvel exercice', '').then(function (n) { if (n) { addToLibrary(n); refresh(); toast('« ' + n + ' » ajouté'); } });
    },
    exDel: function (el) {
      var n = el.dataset.name;
      confirmBox('Retirer « ' + n + ' » de la liste ?', 'Retirer', 'Annuler', true).then(function (ok) {
        if (!ok) return;
        db.exercises = db.exercises.filter(function (x) { return x !== n; });
        save(); refresh();
      });
    },

    /* --- réglages --- */
    setCd: function (el) { db.settings.countdown = +el.dataset.v; save(); refresh(); },
    exportData: function () {
      var json = JSON.stringify(db), name = 'entrainement-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
      try {
        var file = new File([json], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: 'Sauvegarde Entraînement' }).catch(function () {});
          return;
        }
      } catch (e) {}
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    },
    importData: function () { $('#import-file').click(); },
    wipe: function () {
      confirmBox('Effacer TOUTES les données (séances, favoris, modèles) ?', 'Tout effacer', 'Annuler', true).then(function (ok) {
        if (!ok) return;
        return confirmBox('Vraiment ? C’est définitif.', 'Oui, tout effacer', 'Annuler', true).then(function (ok2) {
          if (!ok2) return;
          db = defaults(); save(); toast('Données effacées'); home();
        });
      });
    }
  };

  /* ===================== Écouteurs globaux ============================ */
  document.addEventListener('click', function (e) {
    snd.unlock(); // iOS : le son doit être activé par un appui
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var fn = A[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  /* Boutons − / + : appui maintenu = défilement rapide */
  var repT = 0;
  function stopRepeat() { clearTimeout(repT); repT = 0; }
  function stepOnce(b) {
    var k = b.dataset.step, f = MODES[draft.mode].fields.filter(function (x) { return x.k === k; })[0];
    draft.cfg[k] = stepValue(f, draft.cfg[k], +b.dataset.dir);
    $('#val-' + k).textContent = fieldText(f, draft.cfg[k]);
    $('#setup-sum').textContent = setupSummary();
  }
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest('[data-step]');
    if (!b) return;
    e.preventDefault();
    snd.unlock();
    stopRepeat();
    stepOnce(b);
    var n = 0;
    var rep = function () { stepOnce(b); n++; repT = setTimeout(rep, n > 8 ? 60 : 120); };
    repT = setTimeout(rep, 450);
  });
  ['pointerup', 'pointercancel'].forEach(function (t) { document.addEventListener(t, stopRepeat); });
  window.addEventListener('blur', stopRepeat);

  /* Saisie des séries, nom de modèle, filtre d'exercices */
  function onInput(e) {
    var el = e.target;
    if (el.dataset && el.dataset.f) {
      var x = sessSet(el); if (!x || !x.st) return;
      var f = el.dataset.f;
      if (f === 'reps') { var r = parseInt(el.value, 10); x.st.reps = isFinite(r) && r >= 0 ? r : null; }
      else if (f === 'kg') { var k = num(el.value); x.st.kg = k != null && k >= 0 ? k : null; }
      else if (f === 'rpe') x.st.rpe = el.value ? +el.value : null;
      save();
    } else if (el.id === 'tpl-name' && tplDraft) {
      tplDraft.name = el.value;
    } else if (el.id === 'ex-filter') {
      var q = norm(el.value);
      document.querySelectorAll('.ex-row').forEach(function (r) { r.hidden = q && r.dataset.n.indexOf(q) < 0; });
    }
  }
  document.addEventListener('input', onInput);
  document.addEventListener('change', function (e) {
    if (e.target.id === 'import-file') {
      var file = e.target.files[0]; if (!file) return;
      file.text().then(function (txt) {
        var d = JSON.parse(txt);
        if (!d || !Array.isArray(d.sessions) || !Array.isArray(d.favorites)) throw new Error('format');
        return confirmBox('Remplacer toutes vos données actuelles par cette sauvegarde ?', 'Remplacer', 'Annuler', true).then(function (ok) {
          if (!ok) return;
          var nd = defaults();
          Object.keys(nd).forEach(function (k) { if (d[k] !== undefined) nd[k] = d[k]; });
          db = nd; save(); toast('Sauvegarde importée'); home();
        });
      }).catch(function () { toast('Fichier de sauvegarde invalide'); });
      e.target.value = '';
    } else onInput(e);
  });

  /* ======================= Service worker (hors ligne) ================ */
  var swReg = null;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
      .then(function (reg) { swReg = reg; })
      .catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || $('.update')) return;
      var b = document.createElement('div');
      b.className = 'update';
      b.innerHTML = 'Nouvelle version installée <button class="btn btn-sm btn-go">Recharger</button>';
      b.querySelector('button').addEventListener('click', function (e) {
        e.stopPropagation();
        if (run && !run.ended) { toast('Terminez d’abord le timer'); return; }
        location.reload();
      });
      document.body.appendChild(b);
    });
  }

  /* Petit accès pour les tests automatiques (sans effet sur l'utilisation) */
  window.__app = { A: A, go: go, home: home, db: function () { return db; }, run: function () { return run; }, checkPR: checkPR, e1rm: e1rm, current: function () { return current; } };

  render();
})();

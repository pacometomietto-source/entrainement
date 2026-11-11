/* =========================================================================
   timer-engine.js — Moteur des timers (logique pure, sans interface)
   -------------------------------------------------------------------------
   Principe : on ne compte jamais les secondes avec setInterval.
   On mémorise l'heure de départ (Date.now) et le temps passé en pause ;
   à chaque image, l'état (phase, round, temps restant) est RECALCULÉ à
   partir de l'heure actuelle. Si l'écran se verrouille ou si l'app passe
   en arrière-plan, l'affichage est juste dès le retour : aucune dérive.
   ========================================================================= */
(function (global) {
  'use strict';

  var S = 1000; // une seconde en millisecondes

  /* --- Construction de la liste des phases pour chaque mode ------------ */
  function buildPhases(mode, cfg) {
    var phases = [];
    var cd = Math.max(0, Math.round(cfg.countdown || 0));
    if (cd > 0) phases.push({ kind: 'countdown', dur: cd * S });

    switch (mode) {
      case 'tabata': {
        var w = cfg.work * S, r = cfg.rest * S, n = cfg.rounds;
        for (var i = 1; i <= n; i++) {
          phases.push({ kind: 'work', dur: w, round: i, rounds: n });
          // pas de repos après le dernier round : la séance est finie
          if (r > 0 && i < n) phases.push({ kind: 'rest', dur: r, round: i, rounds: n });
        }
        break;
      }
      case 'fortime':
        phases.push({ kind: 'work', dur: cfg.cap > 0 ? cfg.cap * S : Infinity, up: true });
        break;
      case 'amrap':
        phases.push({ kind: 'work', dur: cfg.dur * S });
        break;
      case 'emom': {
        var every = cfg.every * S, total = cfg.total * S;
        var k = Math.ceil(total / every);
        for (var j = 1; j <= k; j++) {
          // le dernier intervalle est raccourci si la durée totale n'est pas un multiple
          phases.push({ kind: 'work', dur: Math.min(every, total - (j - 1) * every), round: j, rounds: k });
        }
        break;
      }
      case 'chrono':
        phases.push({ kind: 'work', dur: Infinity, up: true });
        break;
      case 'minuteur':
        phases.push({ kind: 'work', dur: cfg.dur * S });
        break;
      default:
        throw new Error('Mode inconnu : ' + mode);
    }

    var t = 0;
    phases.forEach(function (p, idx) { p.index = idx; p.start = t; t += p.dur; });
    return phases;
  }

  /* --- Liste des signaux sonores (calculée une fois pour toutes) -------
     start : début d'une phase de travail ou de repos (bip long)
     tick  : 3, 2, 1 secondes avant la fin de chaque phase (bips courts)
     end   : fin du timer                                                 */
  function buildEvents(phases) {
    var ev = [];
    phases.forEach(function (p) {
      if (p.kind !== 'countdown') ev.push({ at: p.start, type: 'start', kind: p.kind, phase: p.index });
      if (isFinite(p.dur)) {
        [3, 2, 1].forEach(function (n) {
          var at = p.start + p.dur - n * S;
          // pendant le compte à rebours, le « 3 » peut tomber pile au départ
          if (at > p.start || (at === p.start && p.kind === 'countdown')) {
            ev.push({ at: at, type: 'tick', n: n, phase: p.index });
          }
        });
      }
    });
    var last = phases[phases.length - 1];
    if (last && isFinite(last.start + last.dur)) ev.push({ at: last.start + last.dur, type: 'end' });
    // tri stable par instant
    return ev.map(function (e, i) { e._i = i; return e; })
      .sort(function (a, b) { return a.at - b.at || a._i - b._i; });
  }

  /* --- Le timer lui-même ----------------------------------------------- */
  function Timer(mode, cfg) {
    this.mode = mode;
    this.cfg = Object.assign({}, cfg);
    this.phases = buildPhases(mode, this.cfg);
    this.events = buildEvents(this.phases);
    var last = this.phases[this.phases.length - 1];
    this.total = last.start + last.dur; // Infinity pour chrono / For Time sans cap
    var firstWork = this.phases.filter(function (p) { return p.kind !== 'countdown'; })[0];
    this.workStart = firstWork ? firstWork.start : 0;
    this.startAt = null;     // Date.now() au départ
    this.pausedAt = null;    // Date.now() au début de la pause en cours
    this.pausedTotal = 0;    // durée cumulée des pauses terminées
    this.stoppedAt = null;   // Date.now() à l'arrêt
    this.lastT = -1;         // dernier instant déjà traité (pour les bips)
    this.splits = [];        // temps des rounds (For Time / AMRAP)
  }

  Timer.prototype.isRunning = function () { return this.startAt !== null && this.stoppedAt === null; };
  Timer.prototype.isPaused = function () { return this.pausedAt !== null; };

  Timer.prototype.start = function (now) {
    this.startAt = now; this.pausedAt = null; this.pausedTotal = 0;
    this.stoppedAt = null; this.lastT = -1; this.splits = [];
  };
  Timer.prototype.pause = function (now) {
    if (this.isRunning() && !this.isPaused()) this.pausedAt = now;
  };
  Timer.prototype.resume = function (now) {
    if (this.isRunning() && this.isPaused()) { this.pausedTotal += now - this.pausedAt; this.pausedAt = null; }
  };
  Timer.prototype.stop = function (now) {
    if (this.startAt === null || this.stoppedAt !== null) return;
    this.stoppedAt = this.isPaused() ? this.pausedAt : now;
  };

  /* Temps écoulé « utile » (pauses déduites), borné à la durée totale */
  Timer.prototype.elapsed = function (now) {
    if (this.startAt === null) return 0;
    var ref = this.stoppedAt !== null ? this.stoppedAt : (this.pausedAt !== null ? this.pausedAt : now);
    var t = ref - this.startAt - this.pausedTotal;
    return Math.max(0, Math.min(t, this.total));
  };

  /* État complet à l'instant t (ms depuis le départ) */
  Timer.prototype.stateAt = function (t) {
    var ph = this.phases, i = ph.length - 1;
    for (var k = 0; k < ph.length; k++) {
      if (t < ph[k].start + ph[k].dur) { i = k; break; }
    }
    var p = ph[i];
    var inPhase = Math.min(Math.max(0, t - p.start), p.dur);
    return {
      t: t,
      index: i,
      phase: p,
      inPhase: inPhase,
      remaining: isFinite(p.dur) ? p.dur - inPhase : Infinity,
      totalRemaining: isFinite(this.total) ? this.total - t : Infinity,
      work: Math.max(0, t - this.workStart), // temps depuis la fin du compte à rebours
      done: t >= this.total
    };
  };

  /* Appelé à chaque image : renvoie l'état + les signaux franchis depuis
     le dernier appel (chacun n'est renvoyé qu'une seule fois). */
  Timer.prototype.poll = function (now) {
    var t = this.elapsed(now), last = this.lastT;
    var events = this.events.filter(function (e) { return e.at > last && e.at <= t; });
    if (t > this.lastT) this.lastT = t;
    // raw : temps écoulé NON borné, pour savoir de combien un signal est en retard
    var raw = this.startAt === null ? 0 : (this.stoppedAt !== null ? this.stoppedAt : (this.pausedAt !== null ? this.pausedAt : now)) - this.startAt - this.pausedTotal;
    return { state: this.stateAt(t), events: events, raw: raw };
  };

  /* « +1 round » : enregistre le temps intermédiaire */
  Timer.prototype.addSplit = function (now) {
    if (!this.isRunning() || this.isPaused()) return null;
    var st = this.stateAt(this.elapsed(now));
    if (st.phase.kind !== 'work' || st.done) return null;
    var prev = this.splits.length ? this.splits[this.splits.length - 1].at : 0;
    var s = { n: this.splits.length + 1, at: st.work, lap: st.work - prev };
    this.splits.push(s);
    return s;
  };
  Timer.prototype.undoSplit = function () { return this.splits.pop() || null; };

  /* --- Mise en forme ---------------------------------------------------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ms -> « m:ss » ou « h:mm:ss ». Un temps qui DÉCROÎT est arrondi à la
     seconde supérieure (0:20 s'affiche dès le départ, 0:00 seulement à la
     fin) ; un temps qui CROÎT est arrondi à la seconde inférieure. */
  function fmt(ms, up) {
    if (!isFinite(ms)) return '∞';
    ms = Math.max(0, ms);
    var s = up ? Math.floor(ms / S) : Math.ceil(ms / S);
    return fmtSec(s);
  }
  function fmtSec(s) {
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec);
  }

  var PHASE_NAMES = { fortime: 'FOR TIME', amrap: 'AMRAP', emom: 'EMOM', chrono: 'CHRONO', minuteur: 'MINUTEUR' };

  /* Textes à afficher pour un état donné */
  function describe(timer, st) {
    var p = st.phase, m = timer.mode, c = timer.cfg;
    var d = { cls: 'ph-' + p.kind, big: '', phase: '', round: '', sub: '', tenths: null };
    if (p.kind === 'countdown') {
      d.big = String(Math.max(1, Math.ceil(st.remaining / S)));
      d.phase = 'PRÊT ?';
      d.sub = 'Départ dans…';
    } else {
      d.big = p.up ? fmt(st.inPhase, true) : fmt(st.remaining, false);
      d.phase = m === 'tabata' ? (p.kind === 'rest' ? 'REPOS' : 'TRAVAIL') : PHASE_NAMES[m];
      if (p.round) {
        var lab = m === 'emom' ? (c.every === 60 ? 'Minute ' : 'Intervalle ') : 'Round ';
        d.round = lab + p.round + ' / ' + p.rounds;
      }
      if (m === 'tabata' || m === 'emom') d.sub = 'Reste ' + fmt(st.totalRemaining, false);
      else if (m === 'fortime' && c.cap > 0) d.sub = 'Time cap ' + fmtSec(c.cap);
      else if (m === 'amrap') d.sub = 'Écoulé ' + fmt(st.work, true);
      if (m === 'chrono') d.tenths = Math.floor((st.inPhase % S) / 100);
    }
    if (st.done) d.cls = 'ph-done';
    return d;
  }

  var api = { Timer: Timer, buildPhases: buildPhases, buildEvents: buildEvents, fmt: fmt, fmtSec: fmtSec, describe: describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.TimerEngine = api;
})(typeof window !== 'undefined' ? window : this);

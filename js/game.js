// Game rules, word picking, saving and stats. No graphics in here.
import { ANSWERS } from './data/words.js';

export const MAX_GUESSES = 6;
export const LENGTHS = [5, 6, 7];
export const DIFFS = ['easy', 'normal', 'hard'];
const STORE_KEY = 'jackpotWords.v1';

const lists = {};
export function answerList(len, diff) {
  const k = `${len}-${diff}`;
  return (lists[k] ||= ANSWERS[len][diff].split(' '));
}

/** Score a guess: 'hit' = right spot (green), 'near' = in word (blue), 'miss' = not in word (red). */
export function evaluate(guess, answer) {
  const n = answer.length;
  const res = new Array(n).fill('miss');
  const left = {};
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) res[i] = 'hit';
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < n; i++) {
    if (res[i] === 'hit') continue;
    const c = guess[i];
    if (left[c] > 0) { res[i] = 'near'; left[c]--; }
  }
  return res;
}

// ---------------------------------------------------------------- dictionary
let dict = null;
let dictLoading = null;
export function loadDict() {
  if (dict) return Promise.resolve();
  return (dictLoading ||= import('./data/dict.js').then(({ DICT }) => {
    const sets = {};
    for (const [len, packed] of Object.entries(DICT)) {
      const L = +len;
      const set = new Set();
      for (let i = 0; i < packed.length; i += L) set.add(packed.slice(i, i + L));
      sets[L] = set;
    }
    dict = sets;
  }));
}
const has = (w) => !!dict && !!dict[w.length] && dict[w.length].has(w);

/** True if the word is in the dictionary, or is a regular plural / -ed / -ing / -er / -ly form of one. */
export function isValidWord(w) {
  if (!dict) return true; // still loading: be generous
  if (has(w)) return true;
  const n = w.length;
  const cut = (k) => w.slice(0, n - k);
  const dbl = (b) => b.length >= 3 && b[b.length - 1] === b[b.length - 2] && has(b.slice(0, -1));
  if (w.endsWith('ies') && has(cut(3) + 'y')) return true;
  if (w.endsWith('es')) { const b = cut(2); if (/(s|x|z|ch|sh|o)$/.test(b) && has(b)) return true; }
  if (w.endsWith('s') && !w.endsWith('ss') && has(cut(1))) return true;
  if (w.endsWith('ied') && has(cut(3) + 'y')) return true;
  if (w.endsWith('ed')) { const b = cut(2); if (has(b) || has(cut(1)) || dbl(b)) return true; }
  if (w.endsWith('ing')) { const b = cut(3); if (has(b) || has(b + 'e') || dbl(b)) return true; }
  if (w.endsWith('ier') && has(cut(3) + 'y')) return true;
  if (w.endsWith('iest') && has(cut(4) + 'y')) return true;
  if (w.endsWith('er')) { const b = cut(2); if (has(b) || has(cut(1)) || dbl(b)) return true; }
  if (w.endsWith('est')) { const b = cut(3); if (has(b) || has(cut(2)) || dbl(b)) return true; }
  if (w.endsWith('ily') && has(cut(3) + 'y')) return true;
  if (w.endsWith('ly') && has(cut(2))) return true;
  return false;
}

// ---------------------------------------------------------------- dates
export function todayKey(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000);
}
export function msUntilTomorrow() {
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return t - now;
}

// ---------------------------------------------------------------- store
const blankStats = () => ({ played: 0, won: 0, streak: 0, best: 0, dist: new Array(MAX_GUESSES).fill(0) });

function defaults() {
  return {
    settings: { len: 5, diff: 'normal', mode: 'free', strict: true, sfx: true, music: true, quality: 'auto' },
    free: null,
    daily: {},
    stats: { 5: blankStats(), 6: blankStats(), 7: blankStats() },
    recent: {},
    seenHelp: false,
  };
}

export class Store {
  constructor() {
    this.data = defaults();
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const d = defaults();
        this.data = { ...d, ...saved, settings: { ...d.settings, ...(saved.settings || {}) }, stats: { ...d.stats, ...(saved.stats || {}) } };
      }
    } catch (e) { /* private mode or corrupt: start fresh */ }
  }
  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }
  get settings() { return this.data.settings; }

  /** The game for the current settings (creating one if needed). */
  currentGame() {
    const s = this.settings;
    if (s.mode === 'daily') {
      const key = `${todayKey()}|${s.len}|${s.diff}`;
      if (!this.data.daily[key]) {
        const list = answerList(s.len, s.diff);
        const idx = ((dayNumber(todayKey()) % list.length) + list.length) % list.length;
        this.data.daily[key] = newGame(s.len, s.diff, 'daily', list[idx]);
        this.pruneDaily();
      }
      return this.data.daily[key];
    }
    const g = this.data.free;
    if (!g || g.len !== s.len || g.diff !== s.diff) {
      this.data.free = newGame(s.len, s.diff, 'free', this.pickAnswer(s.len, s.diff));
    }
    return this.data.free;
  }

  /** Throw away the current free game and pick a new word. */
  newFreeGame() {
    const s = this.settings;
    this.data.free = newGame(s.len, s.diff, 'free', this.pickAnswer(s.len, s.diff));
    this.save();
    return this.data.free;
  }

  pickAnswer(len, diff) {
    const list = answerList(len, diff);
    const k = `${len}-${diff}`;
    const recent = (this.data.recent[k] ||= []);
    const avoid = new Set(recent);
    let pick;
    for (let tries = 0; tries < 50; tries++) {
      pick = list[Math.floor(Math.random() * list.length)];
      if (!avoid.has(pick)) break;
    }
    recent.push(pick);
    const keep = Math.floor(list.length * 0.75);
    if (recent.length > keep) recent.splice(0, recent.length - keep);
    return pick;
  }

  pruneDaily() {
    const keys = Object.keys(this.data.daily).sort();
    while (keys.length > 60) delete this.data.daily[keys.shift()];
  }

  recordResult(game) {
    const st = (this.data.stats[game.len] ||= blankStats());
    st.played++;
    if (game.status === 'won') {
      st.won++;
      st.streak++;
      st.best = Math.max(st.best, st.streak);
      st.dist[game.guesses.length - 1]++;
    } else {
      st.streak = 0;
    }
    this.save();
  }
}

function newGame(len, diff, mode, answer) {
  return { len, diff, mode, answer, guesses: [], results: [], status: 'playing', draft: new Array(len).fill(''), cursor: 0 };
}

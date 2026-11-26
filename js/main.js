// Jackpot Words: wires the 3D board, sound, keyboard, lever and game rules together.
import * as THREE from 'three';
import { Stage } from './stage.js';
import { Board, ROWS, BLANK, letterIndex, makeGlyphAtlas } from './board.js';
import { Particles } from './particles.js';
import { Sound } from './audio.js';
import { Keyboard, Lever, toast, banner, showModal, closeModal, isModalOpen, miniTiles, segHtml, switchHtml, statsHtml, growBars } from './ui.js';
import { Store, evaluate, isValidWord, loadDict, MAX_GUESSES, msUntilTomorrow } from './game.js';

const $ = (s) => document.querySelector(s);
const store = new Store();
const S = store.settings;
const sound = new Sound();
sound.sfxOn = S.sfx;
sound.musicOn = S.music;

let stage, board, particles, keyboard, lever;
let game;
let busy = false;
let started = false;

const WIN_NAMES = ['MEGA JACKPOT!!!', 'SUPER JACKPOT!!', 'JACKPOT!', 'BIG WIN!', 'NICE WIN!', 'PHEW!'];
const BURST = {
  hit: { colors: ['#1dff7a', '#b8ffd6', '#ffffff', '#ffd319'], count: 46, speed: 6.5, life: 0.95 },
  near: { colors: ['#3a7bff', '#a9c4ff', '#22e8ff', '#ffffff'], count: 28, speed: 5, life: 0.8 },
  miss: { colors: ['#ff2e4d', '#ff8c42'], count: 10, speed: 2.4, life: 0.5 },
};

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('900 84px Orbitron'), document.fonts.load('700 20px Orbitron'), document.fonts.load('400 40px "Mr Dafoe"')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* fall back to system fonts */ }

  const quality = S.quality === 'low' ? 'low' : 'high';
  stage = new Stage($('#scene'), quality);
  const atlas = makeGlyphAtlas(stage.renderer);
  board = new Board(stage.boardScene, atlas, stage.boardScene.environment);
  particles = new Particles(board.root);
  keyboard = new Keyboard($('#keyboard'), { onLetter: typeLetter, onBack: backspace });
  lever = new Lever($('#lever'), { onPull: submit, onGrab: () => sound.unlock() });
  game = store.currentGame();

  wireUI();
  updateChrome();
  onResize();
  window.addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  requestAnimationFrame(loop);
  loadDict();

  const btn = $('#btn-start');
  btn.disabled = false;
  btn.textContent = 'TAP TO PLAY';
  btn.addEventListener('click', start);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function start() {
  if (started) return;
  started = true;
  sound.unlock();
  sound.startMusic();
  sound.whoosh();
  $('#splash').classList.add('gone');
  setTimeout(() => $('#splash') && $('#splash').remove(), 800);
  board.build(game.len, { animate: true });
  onResize();
  restoreBoard();
  stage.pulse(0.7);
  stage.setSpeed(420);
  setTimeout(() => stage.setSpeed(70), 1300);
  if (!store.data.seenHelp) {
    store.data.seenHelp = true;
    store.save();
    setTimeout(openHelp, 1200);
  } else if (game.status !== 'playing') {
    setTimeout(showEnd, 1300);
  }
}

// ---------------------------------------------------------------- frame loop
let last = performance.now();
let clock = 0;
const perf = { t: 0, frames: 0, done: false };
function loop(now) {
  requestAnimationFrame(loop);
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, raw);
  clock += dt;
  board.update(dt);
  particles.update(dt);
  lever.update(dt);
  stage.render(dt, clock);
  autoQuality(raw);
}

/** If the device struggles with full glow, quietly switch to the lighter renderer. */
function autoQuality(raw) {
  if (perf.done || S.quality !== 'auto' || !started || document.hidden) return;
  if (raw > 0.25) return; // tab switch or hiccup
  perf.t += raw;
  perf.frames++;
  if (perf.t > 5) {
    perf.done = true;
    const fps = perf.frames / perf.t;
    if (fps < 40 && stage.quality !== 'low') {
      stage.setQuality('low');
      onResize();
    }
  }
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  stage.resize(w, h);
  const rect = $('#board-area').getBoundingClientRect();
  board.layout(w, h, rect, stage.boardCam, stage.renderer.getPixelRatio());
  particles.setScale(board.pointScale);
  stage.setHorizon(Math.min(0.85, (rect.top + rect.height * 0.62) / h));
  lever.measure();
  lever.draw();
}

// ---------------------------------------------------------------- board state
function currentRow() { return game.guesses.length; }

function restoreBoard() {
  keyboard.reset();
  for (let r = 0; r < game.guesses.length; r++) {
    const w = game.guesses[r];
    board.setRow(r, [...w].map(letterIndex), game.results[r]);
    [...w].forEach((ch, i) => keyboard.mark(ch.toUpperCase(), game.results[r][i], false));
  }
  if (game.status === 'playing') {
    const row = currentRow();
    board.setRow(row, game.draft.map(letterIndex), null);
    board.setCursor(row, game.cursor);
    board.setActiveRow(row);
  } else {
    board.setCursor(-1, -1);
    board.setActiveRow(ROWS);
  }
  updateChrome();
  updateLeverReady();
}

function canType() { return started && !busy && game.status === 'playing' && !isModalOpen(); }

function nextSlot(c) {
  const n = game.len;
  for (let i = c + 1; i < n; i++) if (!game.draft[i]) return i;
  for (let i = 0; i < c; i++) if (!game.draft[i]) return i;
  return Math.min(c + 1, n - 1);
}

function typeLetter(ch) {
  sound.unlock();
  if (!canType()) return;
  const row = currentRow();
  const c = game.cursor;
  game.draft[c] = ch;
  board.tile(row, c).setTyped(letterIndex(ch));
  sound.key(letterIndex(ch));
  game.cursor = nextSlot(c);
  board.setCursor(row, game.cursor);
  updateLeverReady();
  store.save();
}

function backspace() {
  sound.unlock();
  if (!canType()) return;
  const row = currentRow();
  let c = game.cursor;
  if (!game.draft[c] && c > 0) c--;
  game.cursor = c;
  board.setCursor(row, c);
  if (!game.draft[c]) return;
  game.draft[c] = '';
  board.tile(row, c).setTyped(BLANK);
  sound.del();
  updateLeverReady();
  store.save();
}

function moveCursor(d) {
  if (!canType()) return;
  game.cursor = (game.cursor + d + game.len) % game.len;
  board.setCursor(currentRow(), game.cursor);
  sound.select();
}

function updateLeverReady() {
  lever.setReady(game.status === 'playing' && game.draft.every(Boolean));
}

// ---------------------------------------------------------------- the spin
async function submit() {
  sound.unlock();
  if (!canType()) return;
  const row = currentRow();
  const missing = game.draft.filter((x) => !x).length;
  if (missing) {
    toast(missing === game.len ? 'Tap letters to make a guess' : `Fill all ${game.len} spots first`);
    board.shakeRow(row);
    sound.invalid();
    return;
  }
  const word = game.draft.join('').toLowerCase();
  if (S.strict && !isValidWord(word)) {
    toast(`${word.toUpperCase()} isn't in the word list`);
    board.shakeRow(row);
    sound.invalid();
    return;
  }

  busy = true;
  lever.setBusy(true);
  board.setCursor(-1, -1);
  const results = evaluate(word, game.answer);
  const won = results.every((r) => r === 'hit');
  const tease = results.slice(0, -1).every((r) => r === 'hit');
  const letters = game.draft.slice();

  sound.lever();
  const spin = sound.spinLoop();
  stage.setSpeed(300);
  stage.pulse(0.3);
  if (tease) {
    const at = 0.85 + (game.len - 2) * 0.3;
    setTimeout(() => { sound.riser(2.3); toast('Here it comes…', 1500); }, at * 1000);
  }
  let landed = 0;
  await board.spinRow(row, letters.map(letterIndex), results, {
    tease,
    onTick: (tile, speed) => sound.tick(tile.col, speed),
    onLand: (i, res) => {
      landed++;
      if (spin.level) spin.level(1 - landed / game.len);
      sound.land(res, i);
      keyboard.mark(letters[i], res);
      burst(row, i, res);
      if (res === 'hit') stage.pulse(0.18);
    },
  });
  spin();
  stage.setSpeed(70);

  game.guesses.push(word);
  game.results.push(results);
  if (won) game.status = 'won';
  else if (game.guesses.length >= MAX_GUESSES) game.status = 'lost';
  else { game.draft = new Array(game.len).fill(''); game.cursor = 0; }
  if (game.status !== 'playing') store.recordResult(game);
  else store.save();

  if (won) await celebrate(row);
  else if (game.status === 'lost') await gameOver();
  else { board.setActiveRow(row + 1); board.setCursor(row + 1, 0); }

  busy = false;
  lever.setBusy(false);
  updateLeverReady();
  updateChrome();
}

function burst(row, col, res) {
  const p = board.tilePos(row, col);
  const b = BURST[res];
  particles.emit({ x: p.x, y: p.y, z: 0.7, count: b.count, colors: b.colors, speed: b.speed, spread: 1, gravity: -7, life: b.life, size: 0.24, drag: 1.7, jitter: 0.8 });
}

async function celebrate(row) {
  const n = game.guesses.length;
  board.celebrate(row);
  stage.pulse(1.2);
  stage.setSpeed(700);
  setTimeout(() => stage.setSpeed(70), 2600);
  sound.win(7 - n);
  const shots = 8 + (7 - n) * 4;
  for (let i = 0; i < shots; i++) {
    setTimeout(() => {
      const x = (Math.random() - 0.5) * board.size.w * 1.3;
      particles.emit({
        x, y: -board.size.h / 2 - 0.4, z: 1.2, count: 44,
        colors: ['#ff2bd6', '#22e8ff', '#ffd319', '#1dff7a', '#ffffff'],
        speed: 12, spread: 0.32, dir: [(Math.random() - 0.5) * 0.5, 1, 0.25], gravity: -10, life: 1.7, size: 0.28, drag: 0.55,
      });
      if (i % 3 === 0) stage.pulse(0.5);
    }, 200 + i * 130);
  }
  for (let c = 0; c < game.len; c++) setTimeout(() => burst(row, c, 'hit'), c * 90);
  await banner(`${WIN_NAMES[n - 1]}<small>${n} ${n === 1 ? 'SPIN' : 'SPINS'}</small>`, '', 2300);
  showEnd();
}

async function gameOver() {
  sound.lose();
  board.setActiveRow(ROWS);
  await banner(`GAME OVER<small>THE WORD WAS ${game.answer.toUpperCase()}</small>`, 'lose', 2600);
  showEnd();
}

// ---------------------------------------------------------------- new games & settings
async function newWord() {
  if (busy || !started) return;
  if (S.mode === 'daily') { toast('Daily mode has one word a day'); return; }
  const go = async () => {
    if (game.status === 'playing' && game.guesses.length) toast(`Skipped. The word was ${game.answer.toUpperCase()}`, 2200);
    busy = true;
    lever.setBusy(true);
    sound.whoosh();
    stage.setSpeed(350);
    await board.clearAll();
    stage.setSpeed(70);
    game = store.newFreeGame();
    restoreBoard();
    busy = false;
    lever.setBusy(false);
    updateLeverReady();
  };
  if (game.status === 'playing' && game.guesses.length) confirmSkip(go);
  else go();
}

function confirmSkip(go) {
  const m = showModal('NEW WORD?', `<p style="text-align:center">You're in the middle of a word. Skip it and start a new one?</p>
    <div class="btn-row"><button class="btn" data-act="no">KEEP PLAYING</button><button class="btn primary" data-act="yes">NEW WORD</button></div>`);
  m.querySelector('[data-act=no]').addEventListener('click', () => closeModal());
  m.querySelector('[data-act=yes]').addEventListener('click', () => { closeModal(); go(); });
}

/** Change length / difficulty / mode and load the matching game. */
async function changeGame(changes) {
  if (busy || !started) return;
  const same = Object.entries(changes).every(([k, v]) => S[k] === v);
  if (same) return;
  const discarding = game.mode === 'free' && game.status === 'playing' && game.guesses.length > 0 && S.mode === 'free' &&
    ((changes.len && changes.len !== S.len) || (changes.diff && changes.diff !== S.diff));
  const go = async () => {
    if (discarding) { toast(`Skipped. The word was ${game.answer.toUpperCase()}`, 2200); store.data.free = null; }
    Object.assign(S, changes);
    store.save();
    busy = true;
    lever.setBusy(true);
    sound.whoosh();
    stage.setSpeed(350);
    const next = store.currentGame();
    if (next.len !== board.cols) {
      await board.leave();
      game = next;
      board.build(game.len, { animate: true });
      onResize();
    } else {
      await board.clearAll();
      game = next;
    }
    store.save();
    restoreBoard();
    stage.setSpeed(70);
    busy = false;
    lever.setBusy(false);
    updateLeverReady();
    if (game.status !== 'playing') setTimeout(showEnd, 700);
  };
  if (discarding) confirmSkip(go);
  else go();
}

function updateChrome() {
  document.querySelectorAll('#seg-len button').forEach((b) => b.classList.toggle('active', +b.dataset.len === S.len));
  document.querySelectorAll('#seg-diff button').forEach((b) => b.classList.toggle('active', b.dataset.diff === S.diff));
  $('#btn-new').hidden = S.mode === 'daily';
  $('#badge-daily').hidden = S.mode !== 'daily';
  $('#btn-sound').classList.toggle('off', !S.sfx && !S.music);
}

// ---------------------------------------------------------------- screens
function openHelp() {
  sound.whoosh();
  const ex = (w, r) => miniTiles(w, r);
  showModal('HOW TO PLAY', `
    <p>Guess the secret word in <b>6 spins</b>. Tap letters on the keyboard to fill the row, then <b>pull the lever</b> (or press Enter) to spin the reels.</p>
    <p>Tap any square in the row to choose which spot your next letter goes in.</p>
    <div class="legend">
      <div class="legend-row">${ex('s', ['hit'])}<p><b>Green</b>: right letter, right spot.</p></div>
      <div class="legend-row">${ex('s', ['near'])}<p><b>Blue</b>: the letter is in the word, but in a different spot.</p></div>
      <div class="legend-row">${ex('s', ['miss'])}<p><b>Red</b>: the letter is not in the word. Its key turns gray.</p></div>
    </div>
    <div class="legend-row" style="justify-content:center;margin:14px 0 4px">${ex('spark', ['hit', 'near', 'miss', 'miss', 'hit'])}</div>
    <p>Pick <b>5, 6 or 7 letters</b> and <b>Easy, Normal or Hard</b> words at the top. Settings has a Daily mode with one word a day.</p>
    <div class="btn-row"><button class="btn primary" data-act="go">LET'S SPIN</button></div>`)
    .querySelector('[data-act=go]').addEventListener('click', () => closeModal());
}

function openStats(len = game.len) {
  sound.whoosh();
  const render = (L) => statsHtml(store.data.stats[L], 0);
  const m = showModal('STATS', `<div class="stat-tabs">${segHtml('slen', [[5, '5 LETTERS'], [6, '6'], [7, '7']], len)}</div><div class="stats-body">${render(len)}</div>`);
  const body = m.querySelector('.stats-body');
  growBars(body);
  m.querySelectorAll('[data-seg=slen] button').forEach((b) => b.addEventListener('click', () => {
    m.querySelectorAll('[data-seg=slen] button').forEach((x) => x.classList.toggle('active', x === b));
    body.innerHTML = render(+b.dataset.v);
    growBars(body);
    sound.ui();
  }));
}

function openSettings() {
  sound.whoosh();
  const q = S.quality === 'low' ? 'low' : 'high';
  const m = showModal('SETTINGS', `<div class="settings">
    <div class="setting"><div class="label">WORD LENGTH</div>${segHtml('len', [[5, '5'], [6, '6'], [7, '7']], S.len)}</div>
    <div class="setting"><div class="label">DIFFICULTY</div>${segHtml('diff', [['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']], S.diff)}</div>
    <div class="setting"><div><div class="label">MODE</div><span class="hint">Daily gives one word a day for each length and difficulty.</span></div>${segHtml('mode', [['free', 'FREE PLAY'], ['daily', 'DAILY']], S.mode)}</div>
    <div class="setting"><div><div class="label">REAL WORDS ONLY</div><span class="hint">Turn off to allow any letters as a guess.</span></div>${switchHtml('strict', S.strict)}</div>
    <div class="setting"><div class="label">SOUND EFFECTS</div>${switchHtml('sfx', S.sfx)}</div>
    <div class="setting"><div class="label">MUSIC</div>${switchHtml('music', S.music)}</div>
    <div class="setting"><div><div class="label">GRAPHICS</div><span class="hint">Light mode turns off the glow for older iPads.</span></div>${segHtml('quality', [['high', 'FULL GLOW'], ['low', 'LIGHT']], q)}</div>
  </div>`);
  m.querySelectorAll('[data-seg] button').forEach((b) => b.addEventListener('click', () => {
    const seg = b.parentElement.dataset.seg;
    const raw = b.dataset.v;
    sound.ui();
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    if (seg === 'quality') {
      S.quality = raw;
      store.save();
      stage.setQuality(raw);
      onResize();
      return;
    }
    const v = seg === 'len' ? +raw : raw;
    closeModal();
    changeGame({ [seg]: v });
  }));
  m.querySelectorAll('[data-switch]').forEach((sw) => sw.addEventListener('click', () => {
    const k = sw.dataset.switch;
    S[k] = !S[k];
    sw.classList.toggle('on', S[k]);
    sw.setAttribute('aria-checked', S[k]);
    if (k === 'sfx') sound.setSfx(S.sfx);
    if (k === 'music') sound.setMusic(S.music);
    store.save();
    updateChrome();
    sound.ui();
  }));
}

let countdownTimer = null;
function showEnd() {
  if (isModalOpen()) return;
  const won = game.status === 'won';
  const n = game.guesses.length;
  const st = store.data.stats[game.len];
  let html = `<div class="end-word">${miniTiles(game.answer, won ? [...game.answer].map(() => 'hit') : null, true)}</div>
    <div class="end-sub">${won ? `SOLVED IN ${n} ${n === 1 ? 'SPIN' : 'SPINS'}` : 'BETTER LUCK NEXT SPIN'}</div>
    ${statsHtml(st, won ? n : 0)}`;
  if (game.mode === 'daily') {
    html += `<div class="countdown">NEXT DAILY WORD IN<b id="cd">--:--:--</b></div>
      <div class="btn-row"><button class="btn primary" data-act="free">PLAY FREE MODE</button></div>`;
  } else {
    html += `<div class="btn-row"><button class="btn" data-act="close">VIEW BOARD</button><button class="btn primary" data-act="new">SPIN A NEW WORD</button></div>`;
  }
  const m = showModal(won ? 'YOU WIN!' : 'SO CLOSE', html, { onClose: () => clearInterval(countdownTimer) });
  growBars(m);
  const act = (name, fn) => { const b = m.querySelector(`[data-act=${name}]`); if (b) b.addEventListener('click', fn); };
  act('new', () => { closeModal(); newWord(); });
  act('close', () => closeModal());
  act('free', () => { closeModal(); changeGame({ mode: 'free' }); });
  if (game.mode === 'daily') {
    const tick = () => {
      const ms = msUntilTomorrow();
      const p = (x) => String(Math.floor(x)).padStart(2, '0');
      const el = m.querySelector('#cd');
      if (el) el.textContent = `${p(ms / 3600000)}:${p((ms / 60000) % 60)}:${p((ms / 1000) % 60)}`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
}

// ---------------------------------------------------------------- wiring
function wireUI() {
  $('#btn-help').addEventListener('click', openHelp);
  $('#btn-stats').addEventListener('click', () => openStats());
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-new').addEventListener('click', () => { sound.ui(); newWord(); });
  $('#btn-sound').addEventListener('click', () => {
    sound.unlock();
    const muted = !S.sfx && !S.music;
    S.sfx = S.music = muted;
    sound.setSfx(S.sfx);
    sound.setMusic(S.music);
    store.save();
    updateChrome();
    toast(muted ? 'Sound on' : 'Sound off', 1000);
  });
  document.querySelectorAll('#seg-len button').forEach((b) => b.addEventListener('click', () => { sound.ui(); changeGame({ len: +b.dataset.len }); }));
  document.querySelectorAll('#seg-diff button').forEach((b) => b.addEventListener('click', () => { sound.ui(); changeGame({ diff: b.dataset.diff }); }));

  const area = $('#board-area');
  area.addEventListener('pointerdown', (e) => {
    sound.unlock();
    if (!started) return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    const t = board.pick(ndc, stage.boardCam);
    if (t && canType() && t.row === currentRow()) {
      game.cursor = t.col;
      board.setCursor(t.row, t.col);
      t.scaleV += 3;
      sound.select();
      store.save();
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    board.tilt.x = (e.clientX / window.innerWidth - 0.5) * 2;
    board.tilt.y = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (!started) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } return; }
    if (isModalOpen()) return;
    if (/^[a-zA-Z]$/.test(e.key)) { keyboard.press(e.key.toUpperCase()); typeLetter(e.key.toUpperCase()); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); keyboard.press('BACK'); backspace(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (canType()) lever.pull(); }
    else if (e.key === 'ArrowLeft') moveCursor(-1);
    else if (e.key === 'ArrowRight') moveCursor(1);
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) sound.suspend(); else if (started) sound.resume(); });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

boot();

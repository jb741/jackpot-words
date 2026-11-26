# Jackpot Words

A neon, synthwave slot-machine word game. Guess the secret word in 6 spins: fill a row, pull the lever, and watch the reels land.

**Play it:** https://jb741.github.io/jackpot-words/

- **Green**: right letter, right spot
- **Blue**: letter is in the word, wrong spot
- **Red**: letter is not in the word (its key turns gray)

5, 6 or 7 letter words · Easy / Normal / Hard · Free play or one Daily word · No ads · Works offline once installed.

## Play it on this computer

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. (Opening `index.html` straight from the Finder won't work, because browsers block the 3D modules on `file://` pages.)

## Put it on GitHub Pages

1. Create a new **public** repository on github.com (for example `jackpot-words`).
2. Upload everything in this folder: either `git push`, or on the repo page use **Add file → Upload files** and drag the folder contents in.
3. In the repo: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** and save.
4. After a minute, the game is live at `https://<your-username>.github.io/jackpot-words/`.

## Install on the iPad (offline play)

1. Open the GitHub Pages address in **Safari** while online, and tap Play once so everything downloads.
2. Tap **Share → Add to Home Screen**.
3. Launch it from the Home Screen icon. It now runs full screen and without internet.

When you publish a new version, the installed app picks it up the next time it's opened online.

## Change the words

Secret words live in `words/<length>-<difficulty>.txt` (one big space-separated list each). After editing, rebuild:

```bash
node tools/build.mjs
```

That checks every word has the right length, rebuilds `js/data/words.js`, rebuilds the allowed-guess dictionary `js/data/dict.js` (from macOS's built-in word list plus `words/extra-valid.txt`), and refreshes the offline cache list in `sw.js`. Add any real word the game wrongly rejects to `words/extra-valid.txt`.

`node tools/icons.mjs` redraws the app icons.

## What's inside

| Path | What it does |
| --- | --- |
| `index.html`, `css/` | Page layout, keyboard, lever, menus |
| `js/stage.js` | Three.js renderer, synthwave sky, striped sun, scrolling neon grid and mountains, bloom glow |
| `js/board.js` | The 3D board; each square is a slot reel drawn by a shader |
| `js/particles.js` | Sparks and fireworks |
| `js/audio.js` | All sound effects and the music, synthesized live (no audio files) |
| `js/game.js` | Rules, scoring, saving, stats, daily word |
| `js/main.js` | Wires it all together |
| `sw.js`, `manifest.webmanifest` | Offline support and Home Screen install |

## Credits

- [Three.js](https://threejs.org) (MIT), in `vendor/three/`
- Fonts: Orbitron and Mr Dafoe (SIL Open Font License), in `fonts/`
- Allowed-guess list built from Webster's Second International word list (public domain) shipped with macOS

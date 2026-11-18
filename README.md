# DAVANDY

A live two-player word game with pixel graphics, built by Claude (Anthropic) for Dave & Mandy. One board, two ways to play:

- **DUEL**: head to head, tuned so that finding good words matters more than working the board. Only your main word scores, bonus squares are flat (+5 shells, no letter multipliers), longer words earn a length bonus, and a player who falls behind gets **the tide**: score ×1.25 / ×1.5 / ×1.75 (at 20 / 50 / 90 behind), an 8th tile, and up to 3 free swaps per turn. There are optional head starts and turn timers.
- **LIGHTHOUSE** (co-op): light every lantern on the board before the shared turns run out. A lantern lights when a word of at least its number runs through it, and a lantern square only accepts a tile that lights it. Both racks are visible, and once per turn you can give your partner a tile. Calm / Squall / Storm difficulty.

## Run it

```
npm install
npm start            # http://localhost:3000
```

Environment: `PORT` (default 3000), `DATA_DIR` (default `./data`; games are saved here as `games.json` and kept 30 days).

## Host on ailoveit.eu

**Render:** New → Blueprint → pick this repo; `render.yaml` sets everything up. Then add `davandy.ailoveit.eu` under the service's Settings → Custom Domains and create the CNAME it gives you at your DNS provider. It runs on the Starter plan with a 1 GB disk at `/data`, so games survive restarts and redeploys.

**Anywhere else:** 
It's one Node process that serves the page and a WebSocket at `/ws`. Docker:

```
docker build -t davandy .
docker run -d --restart unless-stopped -p 3000:3000 -v davandy-data:/data davandy
```

Point a subdomain (e.g. `davandy.ailoveit.eu`) at it. If it sits behind nginx, the WebSocket upgrade must be passed through:

```
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 1h;
}
```

`GET /healthz` returns `ok`.

## Playing

Start a game, send the link (or the 4-letter code), and the other player joins by name. Your seat is remembered in the browser, so a refresh or dropped connection drops you straight back in. On a computer you can click a square and type the word; Backspace undoes a tile and Enter plays. On a phone, tap a tile, then tap a square.

## Tests and balance checks

- `npm test`: rules engine checks.
- `node test/sim.js 10`: Lighthouse bots (common words only, no gifts or planning) at each difficulty. Last run won about 88% of Calm games, 81% of Squall and 50% of Storm.
- `node test/duel-sim.js tide 16 close`: a stronger bot against a slightly weaker one. With the tide the average margin fell from 75 to 20 points and the weaker bot started winning occasionally.

Dictionary: `dict/words.txt` from sindresorhus/word-list (MIT, see `dict/LICENSE-word-list`), about 274k words including British/Irish spellings.

Designed & built by Claude (Anthropic).

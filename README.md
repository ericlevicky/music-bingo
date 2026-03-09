# Music Bingo 🎵

A real-time Music Bingo web app.  An admin generates bingo cards from a Spotify playlist, assigns them to players (by email or phone number), and plays songs — players mark them off their cards and claim BINGO!

## How it works

Music Bingo is a multiplayer game where players match songs that are playing on Spotify to cells on their personal bingo card.  An admin controls the game; players just need a phone or laptop with a browser — no Spotify account required.

### Roles at a glance

| Role | URL | What they do |
|------|-----|--------------|
| **Admin** | `/admin` | Signs in with Google, connects Spotify, generates cards, shares links, starts/ends the game, watches the leaderboard |
| **Player** | `/card/<id>` | Opens their unique card link, marks cells as songs play, clicks **BINGO!** to claim a win |

---

### Admin flow (step by step)

1. **Sign in with Google** — Visit `/admin` and authenticate with your Google account.  Each Google account gets its own isolated game state on the server.

2. **Connect Spotify** — Click **Connect with Spotify** to authorise the app to read your playlists and detect the currently-playing track.  The server stores and automatically refreshes your Spotify tokens in memory for the duration of the server process.

3. **Generate bingo cards** — Pick a playlist from the dropdown (it must contain at least 25 tracks), then either:
   - Enter one player contact per line (email address or phone number) in the contacts box, or
   - Leave the contacts box empty and specify a plain count.

   Click **Generate cards**.  The server randomly selects 25 unique songs per card and arranges them in a 5×5 grid.  The centre cell is marked as a FREE space (can be toggled off in step 4).

4. **Share card links** — Each card gets a unique URL (`/card/<uuid>`).  The admin dashboard lists every card with a copy link button.  Alternatively, click **🔲 Game QR Code** to display a QR code pointing to the player join page (`/?game=<gameId>`); players who scan it enter their name and receive a freshly generated card on the spot.

5. **Configure player options** — Before starting the game, use the *Player Screen Options* panel to control what players see:

   | Option | Effect |
   |--------|--------|
   | Show song history | Toggles the list of already-played songs at the bottom of the player card |
   | Show currently-playing banner | Toggles the "Now Playing" track banner at the top of the card |
   | Highlight matching cell | Pulses the cell that matches the song currently playing |
   | Strict validation | When on, players can only mark cells for songs that have actually been detected as playing |
   | Free space | When on, the centre cell is automatically valid for all players |
   | Bingo mode | Controls what pattern counts as a win (see below) |

6. **Start the game** — Click **▶ Start Game**.  The server begins polling the Spotify API every few seconds.  Each time the track changes, the new song is broadcast to all connected players in real time via **Socket.io**.

7. **Watch live updates** — The admin dashboard shows:
   - A *Now Playing* panel with album art and track info
   - A running list of every song played so far
   - A live **Winners** leaderboard ranked by the time each BINGO was claimed

8. **End and reset** — Click **⏹ End Game** to stop accepting new BINGO claims.  Use **↺ Reset** to clear the game progress (played songs, winners) while keeping the same cards and links valid, so you can replay the game without re-sending URLs to players.

---

### Player flow (step by step)

1. Open the card link sent by the admin (or scan the QR code, enter your name, and receive a card automatically).
2. If prompted, type your name — it is shown to the admin and on the winners leaderboard when you claim BINGO.
3. Wait for the game to start.  The card shows a *"Waiting for game…"* status until the admin clicks **▶ Start Game**.
4. When a song plays, the **Now Playing** banner updates and (if enabled by the admin) the matching cell on your card is highlighted.
5. Click a cell to mark it.  Cells can only be marked for songs that have been played (when strict validation is on), or freely (when it is off).
6. When you have a complete winning pattern, click the **BINGO!** button.  The server validates your claim against the list of songs that have actually played and, if valid, records you as a winner with a timestamp and rank.

---

### Bingo win patterns

| Mode | Win condition |
|------|--------------|
| **Normal (any-line)** | Any complete row, column, or diagonal |
| **Postage Stamp** | Any filled 2×2 block in one of the four corners |
| **Full Board (Blackout)** | Every cell on the card must be validly marked |

---

### How Spotify detection works

While the game is active the server polls `GET /me/player/currently-playing` on behalf of the admin every few seconds.  When the track changes:

1. The previous song is added to the *played songs* history.
2. The new track is broadcast to every connected browser via a `song-change` Socket.io event.
3. Players see the Now Playing banner update and (if enabled) their matching card cell light up.

Players do **not** need a Spotify account — only the admin does.

---

### Real-time events (Socket.io)

All live updates travel over a single persistent WebSocket connection between the server and each browser tab:

| Event | Direction | What it carries |
|-------|-----------|-----------------|
| `song-change` | Server → all clients | New track metadata (title, artist, album art) |
| `game-started` | Server → all clients | Game status update |
| `game-ended` | Server → all clients | Game status update |
| `bingo-claimed` | Server → all clients | Winner name, card number, rank |
| `options-changed` | Server → all clients | Updated player display options |

---

## Local development

### 1 · Prerequisites

- Node.js 18+
- A [Spotify Developer App](#spotify-app)
- A [Google OAuth App](#google-oauth-app)

### 2 · Clone & install

```bash
git clone https://github.com/ericlevicky/music-bingo.git
cd music-bingo
npm install
```

### 3 · Configure environment variables

```bash
cp .env.example .env
# then edit .env and fill in the values below
```

| Variable | Where to get it |
|----------|----------------|
| `SPOTIFY_CLIENT_ID` | Spotify Developer Dashboard |
| `SPOTIFY_CLIENT_SECRET` | Spotify Developer Dashboard |
| `SPOTIFY_REDIRECT_URI` | Set to `http://localhost:3000/auth/spotify/callback` for local dev |
| `GOOGLE_CLIENT_ID` | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | Set to `http://localhost:3000/auth/google/callback` for local dev |
| `SESSION_SECRET` | Any long random string (e.g. run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `PORT` | Optional — defaults to `3000` |

### 4 · Run

```bash
npm start        # production mode
npm run dev      # auto-restart with nodemon
```

Open <http://localhost:3000>.

---

## Creating the OAuth apps

### Spotify app

1. Go to <https://developer.spotify.com/dashboard> → **Create app**
2. Set **Redirect URI** to `http://localhost:3000/auth/spotify/callback` (add your production URL later)
3. Copy **Client ID** and **Client secret** into your `.env`
4. Required scopes (the app requests these automatically):
   - `user-read-currently-playing`
   - `user-read-playback-state`
   - `playlist-read-private`
   - `playlist-read-collaborative`

### Google OAuth app

1. Go to <https://console.cloud.google.com/> → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth 2.0 Client ID**
2. Application type: **Web application**
3. Add **Authorised redirect URI**: `http://localhost:3000/auth/google/callback` (add your production URL later)
4. Enable the **Google People API** (APIs & Services → Library → search "Google People API")
5. Copy **Client ID** and **Client secret** into your `.env`

---

## Deployment (Render)

This app is a persistent **Node.js server with WebSockets**, so it needs a host that supports long-running processes. [Render](https://render.com) is used here — its free tier is **genuinely free forever** (no credit card required, no trial expiry).

Deployment is automatic: merging a PR to `main` triggers the **Deploy to Render** GitHub Actions workflow, which runs tests and then tells Render to pull the latest code and restart.

### Keeping the free tier awake

Render's free tier normally spins a service down after 15 minutes of inactivity, causing a ~30-second cold start on the next request. This app solves that automatically: when Render deploys it, it injects the `RENDER_EXTERNAL_URL` environment variable, and the server uses that to ping its own `/health` endpoint every 10 minutes — well before the sleep timer would fire. No external ping service or paid plan is needed.

### First-time setup (one-time steps)

#### A · Create the Render service

1. Sign up / log in at <https://render.com>
2. Click **New → Blueprint** and connect your GitHub repo (`<your-github-username>/music-bingo`)
3. Render reads `render.yaml` and creates the **music-bingo** web service automatically
4. Note the public URL Render assigns (e.g. `https://music-bingo-xxxx.onrender.com`)

#### B · Set the secret environment variables in Render

In the Render dashboard → your service → **Environment**, add these (they are marked `sync: false` in `render.yaml` so they are never committed to the repo):

| Variable | Value |
|----------|-------|
| `SPOTIFY_CLIENT_ID` | From Spotify Dashboard |
| `SPOTIFY_CLIENT_SECRET` | From Spotify Dashboard |
| `SPOTIFY_REDIRECT_URI` | `https://<your-app>.onrender.com/auth/spotify/callback` |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `https://<your-app>.onrender.com/auth/google/callback` |

> `SESSION_SECRET` is auto-generated by Render (see `render.yaml`) — you don't need to set it.

#### C · Register the production redirect URIs

- **Spotify**: In your Spotify app settings, add `https://<your-app>.onrender.com/auth/spotify/callback` as an allowed Redirect URI
- **Google**: In your Google OAuth app, add `https://<your-app>.onrender.com/auth/google/callback` as an Authorised redirect URI

#### D · Add the GitHub secret for auto-deploy

1. In Render dashboard → your service → **Settings** → **Deploy Hook** → copy the URL
2. In GitHub → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - Name: `RENDER_DEPLOY_HOOK_URL`
   - Value: the deploy hook URL from Render

That's it — every time a PR merges to `main`, GitHub Actions will run the tests and trigger a new Render deploy automatically.

---

## Running tests

```bash
npm test
```

---

## Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `SPOTIFY_CLIENT_ID` | ✅ | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | ✅ | Spotify app client secret |
| `SPOTIFY_REDIRECT_URI` | ✅ | OAuth callback URL for Spotify |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | ✅ | OAuth callback URL for Google |
| `SESSION_SECRET` | ✅ | Signs session cookies (auto-generated by Render) |
| `NODE_ENV` | ✅ (prod) | Set to `production` in production (enables secure cookies) |
| `PORT` | — | HTTP port; defaults to `3000`; Render sets this automatically |
| `RENDER_EXTERNAL_URL` | — | Set automatically by Render; enables the built-in keep-alive ping |

# Music Bingo 🎵

A real-time Music Bingo web app.  An admin generates bingo cards from a Spotify playlist, assigns them to players (by email or phone number), and plays songs — players mark them off their cards and claim BINGO!

## How it works

| Who | What they see |
|-----|---------------|
| **Admin** | `/admin` — connect Spotify, pick a playlist, generate cards, start/end the game, watch the leaderboard |
| **Player** | `/card/<id>` — their personal bingo card; cells light up as songs play; they click **BINGO!** to claim |

Real-time updates (currently playing song, BINGO claims, winners) are pushed via **WebSockets** (Socket.io).

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

## Deployment (Fly.io)

This app is a persistent **Node.js server with WebSockets**, so it needs a host that supports long-running processes. [Fly.io](https://fly.io) is used here because its free tier keeps machines **always on** — no 15-minute sleep, no cold starts.

Deployment is automatic: merging a PR to `main` triggers the **Deploy to Fly.io** GitHub Actions workflow, which runs tests and then deploys to Fly.io.

### First-time setup (one-time steps)

#### A · Install flyctl and create the app

1. Install the Fly CLI: <https://fly.io/docs/hands-on/install-flyctl/>
2. Sign up / log in:
   ```bash
   fly auth signup   # or: fly auth login
   ```
3. Create the app (does **not** deploy yet):
   ```bash
   fly launch --no-deploy
   ```
   Accept the defaults or customise the app name and region. `fly.toml` already contains the configuration.
4. Note the public URL Fly assigns (e.g. `https://music-bingo.fly.dev`)

#### B · Set the secret environment variables

Secrets are set via the CLI and are never committed to the repo:

```bash
# Generate a secure random session secret
fly secrets set SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

fly secrets set SPOTIFY_CLIENT_ID=<from Spotify Dashboard>
fly secrets set SPOTIFY_CLIENT_SECRET=<from Spotify Dashboard>
fly secrets set SPOTIFY_REDIRECT_URI=https://<your-app>.fly.dev/auth/spotify/callback

fly secrets set GOOGLE_CLIENT_ID=<from Google Cloud Console>
fly secrets set GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
fly secrets set GOOGLE_REDIRECT_URI=https://<your-app>.fly.dev/auth/google/callback
```

#### C · Register the production redirect URIs

- **Spotify**: In your Spotify app settings, add `https://<your-app>.fly.dev/auth/spotify/callback` as an allowed Redirect URI
- **Google**: In your Google OAuth app, add `https://<your-app>.fly.dev/auth/google/callback` as an Authorised redirect URI

#### D · Add the GitHub secret for auto-deploy

1. Create a Fly.io API token (rotate annually):
   ```bash
   fly tokens create deploy -x 8760h
   ```
2. In GitHub → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - Name: `FLY_API_TOKEN`
   - Value: the token from step 1

That's it — every time a PR merges to `main`, GitHub Actions will run the tests and deploy to Fly.io automatically.

#### Free-tier note

Fly.io's free tier includes three always-on shared-CPU VMs with 256 MB RAM each — more than enough for this app. `fly.toml` sets `auto_stop_machines = 'off'` and `min_machines_running = 1` so the machine never sleeps and there are no cold starts.

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
| `SESSION_SECRET` | ✅ | Signs session cookies (set via `fly secrets set SESSION_SECRET=...`) |
| `NODE_ENV` | ✅ (prod) | Set to `production` in production (enables secure cookies; set in `fly.toml`) |
| `PORT` | — | HTTP port; defaults to `3000`; Fly.io sets this automatically |

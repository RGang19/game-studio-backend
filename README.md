# Creator Studio Backend

Express API for the **Creator Studio** template-first game creation flow. Handles deterministic game package generation, AI game/code generation via 0G agents, generated cover-art thumbnails, source code ZIP export, template management, social/leaderboard features, and creator analytics.

---

## 🚀 Technology Stack

| Technology | Version | Purpose |
| :--- | :--- | :--- |
| **Express** | 4.18.2 | HTTP server framework |
| **MongoDB** | 7.2.0 (driver) | Game package persistence |
| **Zod** | 3.22.4 | Request validation schemas |
| **JSZip** | 3.10.1 | Source code ZIP export generation |
| **nanoid** | 5.0.4 | Short unique ID generation |
| **Helmet** | 7.1.0 | Security headers |
| **CORS** | 2.8.5 | Cross-origin resource sharing |
| **Morgan** | 1.10.0 | HTTP request logging |
| **dotenv** | 16.3.1 | Environment variable loading |
| **nodemon** | 3.0.2 (dev) | Auto-restart on file changes |

---

## 📁 Folder Structure

```text
backend/
├── package.json
├── .env                         # Environment variables
├── .env.example                 # Environment template
├── docs/
│   ├── ARCHITECTURE.md          # Backend architecture notes
│   └── TEMPLATE_EXPORT.md       # Template export format docs
└── src/
    ├── server.js                # Server entry point (listen on PORT)
    ├── app.js                   # Express app setup (middleware, routes)
    ├── controllers/
    │   ├── gameController.js        # Game create, generate-from-prompt, refine, export
    │   ├── templateController.js    # Template list, show, export handlers
    │   ├── agentController.js       # 0G agent endpoints (orchestrate, code, assets, …)
    │   ├── thumbnailController.js   # Generated cover-art serving
    │   ├── socialController.js      # Likes, favorites, follows, comments, shares, views
    │   ├── leaderboardController.js # Per-game scores and rankings
    │   ├── referralController.js    # Referral attribution and rewards
    │   └── dashboardController.js   # Creator analytics handler
    ├── routes/
    │   ├── gameRoutes.js            # /create, /generate-from-prompt, /refine, /export-code
    │   ├── templateRoutes.js        # GET /, /export, /:templateId
    │   ├── agentRoutes.js           # /agents/* (stack, orchestrate, code, assets, …)
    │   ├── authRoutes.js            # Anonymous JWT issuance
    │   ├── thumbnailRoutes.js       # GET /thumbnails/:id
    │   ├── socialRoutes.js          # /social/*
    │   ├── leaderboardRoutes.js     # /leaderboards/*
    │   ├── referralRoutes.js        # /referral/* and /r/:code
    │   └── dashboardRoutes.js       # GET /creator
    ├── services/
    │   ├── templateService.js       # Template lookup and listing
    │   ├── gameFactoryService.js    # Deterministic game package builder
    │   ├── promptPipelineService.js # Prompt → template + strategy routing
    │   ├── refinementService.js     # LLM refinement prompt bundle builder
    │   ├── zeroGService.js          # 0G agent client (chat, image, vision, speech)
    │   ├── thumbnailService.js      # Cover-art generation + storage
    │   ├── spacesStorageService.js  # DigitalOcean Spaces (S3-compatible) uploads
    │   ├── jobService.js            # Background job tracking (code, thumbnails)
    │   ├── authService.js           # JWT issuance and verification
    │   ├── socialService.js         # Social graph and engagement counters
    │   ├── leaderboardService.js    # Score submission and ranking
    │   ├── referralService.js       # Referral attribution
    │   ├── activityService.js       # Creator activity feed
    │   ├── exportService.js         # Full template pack export builder
    │   ├── codeExportService.js     # Source code ZIP archive builder
    │   └── databaseService.js       # MongoDB connection and persistence
    ├── middleware/
    │   └── errorHandler.js          # Zod validation + general error handler
    └── data/
        ├── templates.js             # Backend game template registry
        └── referenceGames.js        # Reference game metadata
```

---

## 🛠️ Requirements

- Node.js 18 or newer
- npm
- MongoDB (local or Atlas) — optional, the API functions without it but game packages won't persist

---

## ⚡ Setup

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

The API runs on **`http://localhost:3001`** by default.

---

## 💻 Scripts

- `npm run dev` — Starts the API with **nodemon** (auto-restart on changes).
- `npm start` — Starts the API with **Node** (production).

---

## 🌐 Environment

```text
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# 0G Private Computer agents (optional — for orchestration, code, assets, vision, speech)
OPENAI_API_KEY=
ZERO_G_API_KEY=
ZERO_G_BASE_URL=https://router-api.0g.ai/v1
LLM_PROVIDER=0g
ZERO_G_ORCHESTRATOR_MODEL=glm-5.1
ZERO_G_CODING_MODEL=deepseek-v4-pro
ZERO_G_BACKGROUND_MODEL=deepseek-v4-flash
ZERO_G_IMAGE_MODEL=z-image
ZERO_G_VISION_MODEL=qwen/qwen3-vl-30b-a3b-instruct
ZERO_G_SPEECH_MODEL=openai/whisper-large-v3

# Database (optional — persistence)
MONGODB_URI=mongodb://localhost:27017/creator_studio_1
MONGODB_COLLECTION=prompt_creator_studio
REDIS_URL=redis://localhost:6379

# DigitalOcean Spaces (optional — generated cover-art thumbnail storage)
# When configured, thumbnails are uploaded here and the public URL is stored on
# the game record. Without it, thumbnails fall back to Mongo binary storage.
SPACES_ENDPOINT=https://sfo3.digitaloceanspaces.com
SPACES_REGION=sfo3
SPACES_BUCKET=
SPACES_KEY=
SPACES_SECRET=
SPACES_PUBLIC_BASE=

# IPFS (optional — future publishing)
IPFS_API_URL=
IPFS_API_KEY=
IPFS_API_SECRET=

# Web3 (optional — future on-chain publishing)
WEB3_PROVIDER_URL=
CONTRACT_ADDRESS=

# Auth
JWT_SECRET=change-this-local-secret
```

`CORS_ORIGIN` can be a comma-separated list of allowed origins. `MONGODB_URI` can point at a local MongoDB database or an Atlas database. Generated game packages are saved to the collection configured by `MONGODB_COLLECTION`.

---

## 🔌 API Routes

All routes are mounted at both `/api` and `/` prefixes (dual-mount in `app.js`).

### Health

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Returns API status, strategy, and database config |

### Auth

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/auth/config` | Whether auth is configured (no secret exposed) |
| `POST` | `/api/auth/token` | Issue an anonymous JWT for the given (or generated) user id |

### Templates

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/templates` | List all templates (summary: id, name, category, timing, mechanic, controls) |
| `GET` | `/api/templates/:templateId` | Get a single template by ID |
| `GET` | `/api/templates/export` | Download full template pack JSON (metadata, tuning, themes, assets, AI prompts) |

### Games

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/games/create` | Generate a deterministic Tier 1 game package |
| `POST` | `/api/games/generate-from-prompt` | One-click prompt-to-game pipeline: route prompt, create package, optionally plan/code/assets |
| `POST` | `/api/games/refine` | Create an LLM-ready prompt bundle for Tier 2 refinement |
| `POST` | `/api/games/export-code` | Generate and download a source code ZIP archive |
| `GET` | `/api/games/:gameId` | Publicly load one published game |
| `GET` | `/api/games/:gameId/manage` | Creator-only load of a draft or published game |
| `POST` | `/api/games/:gameId/publish` | Publish a playable game and return its public play path |
| `DELETE` | `/api/games/:gameId/publish` | Unpublish a game and invalidate its public URL |

### Agents

| Method | Endpoint | Model | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/agents/stack` | — | Return configured 0G model stack, without exposing the API key |
| `POST` | `/api/agents/orchestrate` | `glm-5.1` | Main planning and task routing |
| `POST` | `/api/agents/code` | `deepseek-v4-pro` | Complex game/code generation |
| `POST` | `/api/agents/background` | `deepseek-v4-flash` | Cheap metadata, summaries, tags, validation |
| `POST` | `/api/agents/assets` | `z-image` | Image, thumbnail, sprite, and background generation |
| `POST` | `/api/agents/vision` | `qwen/qwen3-vl-30b-a3b-instruct` | Analyze uploaded references or image URLs |
| `POST` | `/api/agents/transcribe` | `openai/whisper-large-v3` | Voice input to text |

### Leaderboards

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/leaderboards/:gameId` | Top scores and rankings for one game |
| `POST` | `/api/leaderboards/:gameId/scores` | Submit a score for one game |

### Social

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/social/stats/:gameId` | Aggregate like/favorite/comment/share/view counts |
| `POST` | `/api/social/likes/toggle` | Toggle a like; `GET /likes/:gameId`, `GET /likes/user/:userId` to read |
| `POST` | `/api/social/favorites/toggle` | Toggle a favorite; `GET /favorites/:gameId`, `/favorites/user/:userId` |
| `POST` | `/api/social/follows/toggle` | Toggle following a creator; `GET /follows/:creatorId`, `/follows/user/:userId` |
| `POST` | `/api/social/comments` | Add a comment; `GET /comments/:gameId`, `DELETE /comments/:commentId` |
| `POST` | `/api/social/shares` | Record a share; `GET /shares/:gameId` for the count |
| `POST` | `/api/social/views/:gameId` | Record a view; `GET /views/:gameId`, `GET /views-top` for trending |
| `GET` | `/api/social/creator-stats/:creatorId` | Aggregate stats for a creator |

### Thumbnails

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/thumbnails/:templateId` | Serve a stored cover image (redirects to Spaces when configured) |
| `GET` | `/api/thumbnails` | List stored thumbnail ids |
| `POST` | `/api/thumbnails/:templateId` | Upload a cover image (auth required, multipart `thumbnail`) |

### Dashboard

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/dashboard/creator` | Returns creator analytics (mock data: stats, pipeline, recent games) |

### Referrals

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/r/:code` | Store the referral cookie for 30 days and redirect to Creator Studio |
| `GET` | `/api/referral/me` | Return the current user's permanent code, link, rewarded count, and referral KP |
| `POST` | `/api/referral/qualify` | Qualify the referred user's first completed game session over 30 seconds |
| `GET` | `/api/admin/referral/held` | List same-IP or velocity-held referrals |
| `POST` | `/api/admin/referral/:id/approve` | Approve a held referral and issue both rewards |

---

## 🏗️ Architecture

The backend optimizes for **reliable game creation before generative flexibility**.

```text
User intent
  → Template selection
  → Structured customization
  → Deterministic game package
  → Optional LLM refinement
  → Publish pipeline
```

### Tier 1: Templates (Primary Path)

- No API token required
- No external image dependency
- Canvas-friendly procedural assets
- Known mechanics and physics
- Stable output schema
- Validation via Zod schemas

Each template defines mechanics, controls, difficulty presets, game states, scoring rules, collision specs, and AI refinement context.

### Tier 2: LLM Refinement (Secondary Path)

AI refinement is optional. The backend builds a compact prompt bundle with:
- System role and output constraints
- Selected template specs (states, scoring, collision)
- User customization parameters
- Exact mechanics and physics tuning
- Validation checklist

The current implementation returns the prompt bundle and simulated job metadata. A production deployment can connect this service to OpenAI, Claude, 0G Compute, or an internal model runner behind a queue.

### Runtime Services

| Service | File | Responsibility |
| :--- | :--- | :--- |
| `templateService` | `templateService.js` | Template lookup and listing |
| `gameFactoryService` | `gameFactoryService.js` | Deterministic game package creation |
| `promptPipelineService` | `promptPipelineService.js` | Prompt → template and build-strategy routing |
| `refinementService` | `refinementService.js` | LLM-ready prompt bundle creation |
| `zeroGService` | `zeroGService.js` | 0G agent client (chat, image, vision, speech) |
| `thumbnailService` | `thumbnailService.js` | Cover-art generation and storage |
| `spacesStorageService` | `spacesStorageService.js` | DigitalOcean Spaces (S3-compatible) uploads |
| `jobService` | `jobService.js` | Background job tracking (code, thumbnails) |
| `authService` | `authService.js` | Anonymous JWT issuance and verification |
| `socialService` | `socialService.js` | Likes, favorites, follows, comments, shares, views |
| `leaderboardService` | `leaderboardService.js` | Per-game score submission and ranking |
| `referralService` | `referralService.js` | Referral attribution and rewards |
| `activityService` | `activityService.js` | Creator activity feed |
| `exportService` | `exportService.js` | Full template pack export with asset manifests |
| `codeExportService` | `codeExportService.js` | Source code ZIP archive generation |
| `databaseService` | `databaseService.js` | MongoDB connection, game package persistence |

### Request Validation

All incoming requests are validated with **Zod** schemas in `gameController.js`. The `errorHandler` middleware returns structured 400 responses for validation failures and appropriate status codes for other errors.

---

## 📦 Request / Response Examples

### POST /api/games/create

**Request:**
```json
{
  "templateId": "flappy",
  "prompt": "neon samurai arcade",
  "theme": "neon",
  "difficulty": "normal",
  "customization": "light",
  "extra": "none"
}
```

**Response (201):**
```json
{
  "game": {
    "id": "ab3x7k9mzp12",
    "tier": "template",
    "title": "Neon Flappy Bird",
    "templateId": "flappy",
    "category": "Arcade",
    "createdIn": "20s",
    "apiCost": 0,
    "reliability": "100%",
    "gameplay": { "mechanic": "...", "controls": "...", "tuning": { ... } },
    "visuals": { "mood": "bright arcade glow", "colors": [...] },
    "build": { "runtime": "browser", "renderer": "canvas" },
    "publish": { "ipfsReady": true, "nftMetadataReady": true },
    "checklist": [...]
  },
  "persistence": { "database": "connected", "collection": "prompt_creator_studio" }
}
```

### POST /api/games/refine

**Request:**
```json
{
  "gamePackage": { ... },
  "request": "Add a double-jump mechanic",
  "refinementLevel": "medium"
}
```

**Response (202):**
```json
{
  "refinement": {
    "jobId": "refine_abc123",
    "eta": "2-3 minutes",
    "promptBundle": { "system": "...", "user": "..." },
    "validation": ["Syntax validates", "Runs immediately in browser", ...]
  }
}
```

---

## 🔧 Troubleshooting

If `npm run dev` reports that port `3001` is already in use, find the running process:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

Then stop the listed PID or change `PORT` in `.env`.

---

## 🚢 Future Expansion

- Connect LLM refinement service to OpenAI / Claude / 0G Compute
- Add Redis/Bull for long-running refinement and publishing job queues
- Add IPFS and 0G Storage publishing adapters
- Add 0G Chain smart contract integration for on-chain game registry
- Add Phaser runtimes for each template's playable export
- Add real creator analytics from MongoDB aggregation

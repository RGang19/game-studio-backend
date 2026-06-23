# Backend Architecture

The backend optimizes for reliable game creation before generative flexibility.

```text
User intent
  -> Template selection
  -> Structured customization
  -> Deterministic game package
  -> Optional LLM refinement
  -> Publish pipeline
```

## Tier 1: Templates

Templates are the default route:

- No API token required.
- No external image dependency.
- Canvas-friendly assets.
- Known mechanics and physics.
- Stable output schema.

Each template defines mechanics, controls, difficulty presets, render style, an asset plan, a publish checklist, and AI refinement context.

## Tier 2: LLM Refinement

AI refinement is a secondary route for power users. The backend builds a compact prompt bundle with:

- System role and output constraints
- Selected template specs
- User customization
- Exact mechanics and physics
- Validation checklist

The current implementation returns the prompt bundle and simulated job metadata. A production deployment can connect this service to OpenAI, Claude, or an internal model runner behind a queue.

## Runtime Services

- `templateService`: owns the game templates.
- `gameFactoryService`: creates deterministic game packages.
- `promptPipelineService`: routes a free-text prompt to a template and build strategy.
- `refinementService`: creates LLM-ready prompt bundles.
- `zeroGService`: 0G agent client (orchestrator, coding, background, image, vision, speech).
- `thumbnailService`: generates game cover art and stores it (DigitalOcean Spaces).
- `spacesStorageService`: S3-compatible object storage for generated assets.
- `jobService`: tracks long-running background jobs (code and thumbnail generation).
- `databaseService`: MongoDB connection and game package persistence.
- `authService`: anonymous JWT issuance and verification.
- `socialService`: likes, favorites, follows, comments, shares, and view counts.
- `leaderboardService`: per-game score submission and ranking.
- `referralService` / `activityService`: referral attribution and creator activity feed.
- `exportService` / `codeExportService`: template pack and source-code ZIP export.

## Future Expansion

- Add Redis/Bull for long-running refinement and publishing job queues.
- Add IPFS and 0G Storage publishing adapters.
- Add 0G Chain smart contract integration for an on-chain game registry.
- Add Phaser runtimes for each template's playable export.

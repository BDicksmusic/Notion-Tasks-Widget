# Notion Tasks Webhook Relay

Cloudflare Worker that receives Notion webhooks and stores them for the desktop app to fetch.

## Setup

### 1. Install Wrangler CLI
```bash
npm install -g wrangler
```

### 2. Login to Cloudflare
```bash
wrangler login
```

### 3. Create KV Namespace
```bash
cd cloudflare-worker
wrangler kv:namespace create "WEBHOOK_EVENTS"
```

This will output something like:
```
{ binding = "WEBHOOK_EVENTS", id = "abc123..." }
```

### 4. Update wrangler.toml
Replace `YOUR_KV_NAMESPACE_ID` with the ID from step 3.

### 5. Deploy
```bash
npm install
npm run deploy
```

### 6. Note Your Worker URL
After deployment, you'll get a URL like:
```
https://notion-tasks-webhook-relay.YOUR_SUBDOMAIN.workers.dev
```

Update this URL in the Electron app's configuration.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/register` | Register new user, get webhook URL |
| POST | `/webhook/:userId` | Notion sends webhooks here |
| GET | `/events/:userId` | App fetches pending events |
| DELETE | `/events/:userId` | Clear processed events |
| GET | `/health` | Health check |

## How It Works

1. User clicks "Enable Real-time Sync" in the app
2. App calls `/register` to get a unique webhook URL
3. User pastes URL into Notion's webhook settings
4. Notion sends events to the worker
5. Worker stores events in Cloudflare KV
6. App polls `/events/:userId` every few seconds
7. App processes events and clears them

## Cost

**Free tier includes:**
- 100,000 requests/day
- 1GB KV storage
- Plenty for ~1000+ users

**If you exceed free tier:**
- $5/month for 10 million requests
- Very affordable at scale


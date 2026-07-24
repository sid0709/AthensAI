# ai-bff

AI kit and BFF for **OpenAI GPT** and **DeepSeek** models. Sole LLM gateway for NextOffer. In the Firestore runtime, every call writes one `ai_api_usage` document with request metrics and outcome metadata.

## Setup

```bash
cp .env.example .env
# Optional env default keys — Athens usually sends per-request apiKeys from profile
npm run dev -w ai-bff
```

## HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness + configured providers |
| GET | `/v1/models` | Model catalog with pricing |
| POST | `/v1/chat` | Primary chat API |
| POST | `/v1/chat/completions` | OpenAI-compatible alias (Bearer or `apiKeys`) |
| POST | `/v1/estimate` | Rough token + cost estimate |

Default port: **3920**.

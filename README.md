# InsureWatch — API Gateway

Node.js Express gateway. Entry point for all InsureWatch traffic. Forwards requests to downstream services with distributed trace context propagation.

## OTel Signals
- **Traces** — auto-instrumented HTTP + Express, manual spans on forwarding
- **Metrics** — `gateway.requests.total`, `gateway.errors.total`, `gateway.request.duration`
- **Logs** — structured JSON with `traceId` and `spanId` injected

## Routes
| Method | Path | Forwards to |
|---|---|---|
| POST | `/api/claims` | Claims Service |
| GET | `/api/claims/:id` | Claims Service |
| GET | `/api/policy/:customerId` | Policy Service |
| GET | `/api/policy/:customerId/coverage` | Policy Service |
| GET | `/api/investments/:customerId` | Investment Service |
| GET/POST | `/api/chaos/*` | Chaos Controller |
| GET | `/health` | — |

## Environment Variables
See `.env.example`

## Deploy on Railway
1. Push to GitHub
2. New Railway service → Deploy from GitHub
3. Set env vars from `.env.example`
4. Internal hostname: `api-gateway.railway.internal`

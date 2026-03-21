# ai-provider-healthcheck

Real-time health monitoring for AI provider endpoints (OpenAI, Anthropic, Google, Cohere, Mistral). Active probes, passive traffic observation, and state machine classification.

## Install

```bash
npm install ai-provider-healthcheck
```

## Quick Start

```typescript
import { createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      probeFn: async () => {
        const start = Date.now();
        const res = await fetch('https://api.openai.com/v1/models');
        return { success: res.ok, latencyMs: Date.now() - start, statusCode: res.status };
      },
    },
  ],
});

monitor.on('stateChange', (e) => console.log(`${e.provider}: ${e.from} -> ${e.to}`));
monitor.on('degraded', (e) => console.warn(`${e.provider} degraded: ${e.reason}`));

await monitor.start();

// Passive reporting from production traffic
monitor.reportSuccess('openai', { latencyMs: 150 });
monitor.reportError('openai', { status: 503 });

const health = monitor.getHealth('openai');
console.log(health.state); // 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
```

## API

### `createMonitor(config): HealthMonitor`

Create a health monitor for multiple providers.

### Health States

- **healthy** — Normal operation
- **degraded** — Elevated latency or error rate
- **unhealthy** — High error rate or consecutive failures
- **unknown** — No data yet

### Events

- `stateChange` — Provider health state changed
- `degraded` — Provider entered degraded state
- `recovered` — Provider recovered to healthy
- `latencySpike` — Latency exceeded threshold
- `error` — Probe or configuration error

### Methods

- `start()` / `stop()` — Start/stop active probing
- `getHealth(id)` — Get current health status
- `getAllHealth()` — Get all provider statuses
- `reportSuccess(id, metrics)` — Record successful request
- `reportError(id, error)` — Record failed request
- `probe(id)` — Manually trigger a probe

## License

MIT

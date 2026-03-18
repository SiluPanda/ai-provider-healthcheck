# ai-provider-healthcheck -- Specification

## 1. Overview

`ai-provider-healthcheck` is a real-time monitoring library for AI provider endpoint availability, latency, and error rates. It monitors the health of AI inference endpoints -- OpenAI, Anthropic, Google, Cohere, Mistral, and custom providers -- by performing active probes (lightweight API calls on a configurable interval), passively observing production traffic (error rates and latency reported by the caller), and classifying each provider into one of four health states: `healthy`, `degraded`, `unhealthy`, or `unknown`. It exposes an EventEmitter interface for reactive health state changes and a polling API for on-demand health queries.

The gap this package fills is specific and well-defined. AI providers experience outages, degraded performance, rate limiting surges, and elevated latency with no advance warning to consuming applications. When OpenAI's API latency spikes from 200ms to 8 seconds, or when Anthropic returns 503 errors for 45 seconds, applications that route all traffic to a single provider experience cascading failures. The developer learns about the degradation from user complaints, not from their infrastructure. Status pages (status.openai.com, status.anthropic.com) are updated manually, often minutes or hours after the incident begins, and are not machine-readable in a way that enables automated failover.

Existing multi-provider routing tools (Portkey, OpenRouter, LiteLLM) perform internal health tracking but do not expose it as a standalone library. Their health monitoring is coupled to their proxy layer -- you cannot use their health signals without routing all traffic through their system. There is no standalone npm package that answers the question "which of my AI providers is currently healthy and fast?" with a machine-readable result, a stream of real-time state change events, and historical latency percentiles.

`ai-provider-healthcheck` provides both a TypeScript/JavaScript API and a CLI. The API returns structured `ProviderHealth` objects with health state, latency percentiles (p50/p95/p99), error rates, and probe history. The EventEmitter interface fires events on health state transitions (`stateChange`), individual probe results (`probe`), latency spikes (`latencySpike`), and errors (`error`). The CLI prints a live status dashboard or a one-shot health report with conventional exit codes. The package composes with `ai-keyring` (which provider to route to), `ai-circuit-breaker` (when to stop sending traffic), and `prompt-price` (cost-aware routing decisions informed by provider health).

---

## 2. Goals and Non-Goals

### Goals

- Provide a `createMonitor(config)` function that returns a `HealthMonitor` instance managing health state, probing, and latency tracking for one or more AI providers.
- Provide `monitor.start()` and `monitor.stop()` methods that begin and end periodic active probing of registered providers.
- Provide `monitor.getHealth(provider)` to retrieve the current health state, latency percentiles, error rate, and probe history for a specific provider.
- Provide `monitor.getAllHealth()` to retrieve health states for all registered providers in a single call.
- Provide `monitor.probe(provider)` for on-demand manual probing of a specific provider outside the periodic schedule.
- Provide `monitor.reportSuccess(provider, latencyMs)` and `monitor.reportError(provider, error)` for passive monitoring -- the caller reports production traffic outcomes, and the monitor incorporates them into health calculations without making additional API calls.
- Implement four health states (`healthy`, `degraded`, `unhealthy`, `unknown`) with configurable transition rules based on latency thresholds and error rate thresholds over a sliding window.
- Implement active probing: send a lightweight API call to each provider on a configurable interval, measure TTFB and full response time, and update health state based on probe results.
- Implement latency tracking with rolling percentile computation: p50, p95, p99 over a configurable sliding window.
- Implement error rate tracking over a sliding window with classification of errors into transient (429, 503, timeout) and permanent (401, 403, 400).
- Provide a built-in provider registry with default probe endpoints for OpenAI, Anthropic, Google (Gemini), Cohere, and Mistral. Support custom provider registration with caller-provided probe functions.
- Emit events via the Node.js `EventEmitter` interface: `stateChange`, `probe`, `error`, `latencySpike`, `degraded`, `recovered`.
- Provide a CLI (`ai-provider-healthcheck`) with commands for one-shot health status, continuous monitoring dashboard, and JSON output.
- Keep runtime dependencies to zero. All probing, latency computation, and state management use built-in JavaScript APIs and the caller-provided HTTP function for probe requests.
- Target Node.js 18 and above.

### Non-Goals

- **Not a proxy or load balancer.** This package monitors provider health and emits signals. It does not intercept, route, or forward API requests. Use the health signals to make routing decisions in your own code, or combine with `ai-keyring` for automated failover. The monitor observes; it does not act.
- **Not a rate limiter.** This package detects rate limiting (429 responses) as a health signal. It does not control how many requests per second are sent to a provider. For proactive rate limiting, use `bottleneck`, `p-limit`, or `mcp-rate-guard`.
- **Not a retry library.** This package does not retry failed requests. When a probe fails or the caller reports an error, the monitor updates health state but does not re-execute the failed request. Use `tool-call-retry` or `p-retry` for retry logic.
- **Not a status page scraper.** This package does not scrape provider status pages (status.openai.com, status.anthropic.com). Status pages are updated manually by providers and lag behind actual incidents. Active probing and passive monitoring provide faster, more accurate health signals.
- **Not a cost tracker.** This package tracks latency and availability, not dollar costs. For cost tracking and budget enforcement, use `ai-circuit-breaker` and `prompt-price`.
- **Not a provider SDK.** This package does not wrap provider-specific APIs for inference. It makes lightweight probe calls to verify availability. The caller uses their own SDK or HTTP client for actual inference requests.
- **Not a persistent monitoring service.** This package runs within your Node.js process. It does not persist historical data to disk, provide a web dashboard, or run as a standalone daemon. For persistence, pipe events to your logging or metrics system.

---

## 3. Target Users and Use Cases

### Multi-Provider Routing Applications

Applications that call multiple AI providers (OpenAI, Anthropic, Google, Mistral) and need real-time health data to make intelligent routing decisions. When OpenAI is degraded (elevated latency, increased error rate), the application routes new requests to Anthropic. When Anthropic recovers, traffic shifts back. `ai-provider-healthcheck` provides the health signals; the application (or `ai-keyring`) makes the routing decision.

A typical integration: `monitor.on('stateChange', ({ provider, from, to }) => { if (to === 'unhealthy') routingTable.deprioritize(provider); })`.

### SRE and Platform Teams

Teams operating AI-powered services in production who need observability into upstream AI provider health. They want to know, at any moment, the p95 latency of each provider, the error rate over the last 5 minutes, and whether any provider has transitioned from `healthy` to `degraded`. These signals feed into Grafana dashboards, PagerDuty alerts, and incident response runbooks.

A typical integration: `monitor.on('probe', (result) => metrics.record('ai_provider_latency', result.latencyMs, { provider: result.provider }))`.

### High-Availability AI Applications

Applications with strict SLA requirements (e.g., chatbots, customer support, real-time translation) that cannot tolerate provider outages. They configure multiple providers as failover targets and use `ai-provider-healthcheck` to detect outages within seconds (not minutes, as status pages do). When the primary provider transitions to `unhealthy`, the application fails over to the secondary provider before users experience errors.

### Agent and Autonomous System Operators

Teams running autonomous AI agents that make unpredictable numbers of API calls over extended periods. Provider health varies throughout the day -- latency increases during peak hours, rate limits are hit during burst activity, and providers occasionally experience partial outages. The monitor provides continuous health tracking, allowing the agent orchestrator to make informed provider selection decisions on every call.

### Development and Testing Teams

Developers who want to verify, during CI or local development, that their configured AI providers are reachable and responding within acceptable latency. A one-shot `ai-provider-healthcheck --providers openai,anthropic` in CI confirms that the providers are healthy before running integration tests that depend on them.

### Cost-Aware Routing Systems

Applications that route requests to the cheapest healthy provider. Combined with `prompt-price` for cost data and `ai-provider-healthcheck` for health data, the router selects the cheapest provider among those currently in `healthy` state. If the cheapest provider degrades, it falls back to the next cheapest healthy provider.

---

## 4. Core Concepts

### Provider

A provider represents a single AI inference service endpoint. Each provider has:

- **`id`**: A unique string identifier (e.g., `'openai'`, `'anthropic'`, `'google'`, `'cohere'`, `'mistral'`, or a custom string for self-hosted endpoints).
- **`name`**: A human-readable display name (e.g., `'OpenAI'`, `'Anthropic Claude'`).
- **`baseUrl`**: The base URL of the provider's API (e.g., `'https://api.openai.com'`).
- **`probeFn`**: An async function that performs a lightweight health check request to the provider and returns a `ProbeResult`. Built-in providers have default probe functions; custom providers require a caller-provided one.

A provider is the unit of health monitoring. Each provider has its own health state, latency history, error rate, and probe schedule.

### Health State

Every provider is in exactly one of four health states at any given time:

| State | Meaning | Visual |
|---|---|---|
| `healthy` | Normal operation. Latency within expected range, error rate below threshold. | Green |
| `degraded` | Elevated latency or elevated error rate, but the provider is still responding to most requests. A warning state -- the provider is usable but not performing optimally. | Yellow |
| `unhealthy` | High error rate, consistently failing probes, or the provider is unreachable. Requests to this provider are likely to fail. | Red |
| `unknown` | No data yet. The provider has not been probed and no traffic has been reported. This is the initial state before the first probe completes. | Gray |

Health states are determined by evaluating two signals against configurable thresholds: the rolling error rate and the rolling latency percentile (p95 by default).

### Health State Transitions

State transitions follow a defined state machine. Not all transitions are valid:

```
                ┌──────────────┐
                │   unknown    │
                └──────┬───────┘
                       │ first probe completes
                       ▼
              ┌────────────────┐
         ┌───▶│    healthy     │◀──────────────┐
         │    └───────┬────────┘               │
         │            │ error rate > degraded   │
         │            │ threshold OR latency    │ error rate < healthy
         │            │ > degraded threshold    │ threshold AND latency
         │            ▼                         │ < healthy threshold
         │    ┌────────────────┐               │
         │    │   degraded     │───────────────┘
         │    └───────┬────────┘
         │            │ error rate > unhealthy
         │            │ threshold OR consecutive
         │            │ probe failures > threshold
         │            ▼
         │    ┌────────────────┐
         └────│  unhealthy     │
              └────────────────┘
               recovers (probes
               succeed, error
               rate drops)
```

**Transition rules:**

- **`unknown` -> `healthy`**: First successful probe or first successful traffic report.
- **`unknown` -> `unhealthy`**: First probe fails.
- **`healthy` -> `degraded`**: Rolling error rate exceeds `degradedErrorRate` threshold (default: 0.05 -- 5%) OR rolling p95 latency exceeds `degradedLatencyMs` threshold (default: 5000ms).
- **`degraded` -> `unhealthy`**: Rolling error rate exceeds `unhealthyErrorRate` threshold (default: 0.30 -- 30%) OR consecutive probe failures exceed `unhealthyAfterConsecutiveFailures` threshold (default: 3).
- **`degraded` -> `healthy`**: Rolling error rate drops below `healthyErrorRate` threshold (default: 0.02 -- 2%) AND rolling p95 latency drops below `healthyLatencyMs` threshold (default: 3000ms). Both conditions must be met to recover.
- **`unhealthy` -> `healthy`**: Same conditions as `degraded` -> `healthy`. Recovery requires sustained good performance, not a single successful probe.
- **`unhealthy` -> `degraded`**: At least one probe succeeds, but error rate or latency still exceeds healthy thresholds. The provider is responding but not yet fully recovered.

**Hysteresis**: To prevent rapid state oscillation (flapping), transitions require the triggering condition to persist for a configurable number of evaluation cycles (`stateChangeMinSamples`, default: 3). A single failed probe does not immediately transition a `healthy` provider to `degraded` -- three consecutive negative signals are required.

### Probe

A probe is a single lightweight API call to a provider's endpoint, designed to verify availability and measure latency with minimal cost. A probe:

1. Records the start time.
2. Sends a lightweight HTTP request to the provider's probe endpoint.
3. Records TTFB (time to first byte -- when the first response byte arrives).
4. Records the full response time (when the response is fully received).
5. Classifies the result as `success` or `failure`.
6. Returns a `ProbeResult` with timing data, HTTP status, and error details (if any).

Probes are designed to be cheap. For providers that support it, the probe calls a read-only endpoint (e.g., `/v1/models` for OpenAI) that does not consume tokens. For providers that require a generative call, the probe uses the smallest possible request (1 max token, shortest prompt).

### Latency Percentiles

Latency is tracked as a rolling distribution using a bounded ring buffer of timestamped latency samples. From this buffer, percentiles are computed on demand:

- **p50 (median)**: Half of requests complete faster than this value. Represents typical performance.
- **p95**: 95% of requests complete faster than this value. Represents performance under moderate load -- the "slow but not worst case" experience.
- **p99**: 99% of requests complete faster than this value. Captures tail latency -- the worst 1% of requests. Useful for SLA monitoring.

Percentiles are computed over the sliding window (`metricsWindowMs`, default: 300,000 -- 5 minutes). Only samples within the window are included. Older samples are pruned lazily on access.

Latency sources include both active probes (managed by the monitor) and passive traffic reports (reported by the caller via `reportSuccess`). Both contribute to the same latency distribution. Probe latency and traffic latency can be queried separately via `getHealth()` if needed.

### Error Rate

The error rate is computed as a rolling ratio over the sliding window:

```
error_rate = errors_in_window / total_requests_in_window
```

Where `total_requests_in_window` includes both successful and failed requests (probes and reported traffic). If `total_requests_in_window` is zero (no data), the error rate is `undefined` and does not trigger state transitions.

### Error Classification

Not all errors are equal. The monitor classifies errors into two categories that affect health state differently:

- **Transient errors**: Errors that are expected to resolve on their own. These include HTTP 429 (rate limited), HTTP 503 (service unavailable), HTTP 502 (bad gateway), HTTP 504 (gateway timeout), and network timeouts (`ETIMEDOUT`, `ECONNRESET`). Transient errors contribute to the error rate but individually do not indicate a broken provider -- the provider is temporarily overloaded or experiencing a brief interruption.

- **Permanent errors**: Errors that indicate a configuration or authorization problem that will not resolve without intervention. These include HTTP 401 (unauthorized -- invalid API key), HTTP 403 (forbidden -- insufficient permissions), and HTTP 400 (bad request -- malformed probe). Permanent errors may indicate the probe configuration is wrong, not that the provider is unhealthy. A single 401 on a probe triggers a `probeConfigError` event rather than marking the provider unhealthy.

Transient errors contribute fully to the error rate. Permanent errors are flagged separately and do not affect the provider's health state (since a 401 means "your key is wrong," not "the provider is down"). This distinction prevents a misconfigured API key from falsely marking a healthy provider as unhealthy.

### Sliding Window

All rolling metrics (error rate, latency percentiles) are computed over a fixed-size time window. The window slides forward in real time. Only events (probes, reported traffic) with timestamps within `[now - windowMs, now]` are included.

The sliding window is implemented as a bounded ring buffer of timestamped entries. Each entry records the timestamp, latency (if successful), and whether it was an error. When the buffer is read (via `getHealth()` or during state evaluation), entries older than the window are pruned. The buffer has a maximum size (`maxSamplesPerProvider`, default: 1000) to bound memory usage. When the buffer is full, the oldest entry is evicted regardless of whether it is within the window.

---

## 5. Probing Strategy

### What to Probe Per Provider

Each built-in provider has a default probe endpoint chosen to minimize cost and maximize reliability:

| Provider | Probe Endpoint | Method | Auth Header | Tokens Used | Notes |
|---|---|---|---|---|---|
| OpenAI | `GET /v1/models` | GET | `Authorization: Bearer <key>` | 0 | Lists available models. No token consumption. Fast. |
| Anthropic | `POST /v1/messages` | POST | `x-api-key: <key>` | ~2 | Sends `{ model: "claude-haiku-4-20250514", max_tokens: 1, messages: [{ role: "user", content: "." }] }`. Minimal token usage. Anthropic has no cost-free probe endpoint. |
| Google (Gemini) | `GET /v1beta/models` | GET | `x-goog-api-key: <key>` | 0 | Lists available models. No token consumption. |
| Cohere | `GET /v1/models` | GET | `Authorization: Bearer <key>` | 0 | Lists available models. No token consumption. |
| Mistral | `GET /v1/models` | GET | `Authorization: Bearer <key>` | 0 | Lists available models. No token consumption. |

For providers without a cost-free endpoint (like Anthropic), the probe is designed to use the absolute minimum tokens possible. At Anthropic's pricing, a probe with ~2 tokens costs approximately $0.000001 -- effectively free even at high probe frequencies.

### Custom Probe Functions

Callers can register custom providers with their own probe functions:

```typescript
const monitor = createMonitor({
  providers: [
    {
      id: 'my-llm',
      name: 'Self-Hosted LLaMA',
      probeFn: async () => {
        const start = performance.now();
        const res = await fetch('http://llm.internal:8080/health');
        const latencyMs = performance.now() - start;
        if (!res.ok) return { success: false, latencyMs, statusCode: res.status, error: `HTTP ${res.status}` };
        return { success: true, latencyMs, statusCode: 200 };
      },
    },
  ],
});
```

The probe function receives no arguments (it captures everything it needs via closure -- API key, base URL, etc.) and returns a `ProbeResult`.

### Probe Interval

The probe interval (`probeIntervalMs`, default: 30,000 -- 30 seconds) determines how frequently each provider is probed. All providers share the same default interval, but it can be overridden per provider.

Probe intervals are staggered: if three providers are registered, their probes do not fire simultaneously. The monitor distributes probe start times across the interval to avoid burst traffic. For a 30-second interval with three providers, probes fire at approximately t=0, t=10, t=20, then t=30, t=40, t=50, and so on.

Probes use `setTimeout` with `.unref()` to avoid preventing process exit. When `monitor.stop()` is called, all pending probe timers are cleared.

### Probe Timeout

Each probe has an individual timeout (`probeTimeoutMs`, default: 10,000 -- 10 seconds). If the probe request does not complete within this time, it is aborted (via `AbortController`) and recorded as a failure with error code `PROBE_TIMEOUT`.

A timed-out probe counts as a transient error (the provider may be slow, not necessarily down). Three consecutive timeouts transition the provider to `unhealthy` (via the consecutive failure threshold).

### Adaptive Probe Interval

When a provider transitions to `degraded` or `unhealthy`, the monitor optionally increases probe frequency to detect recovery faster. The adaptive interval (`degradedProbeIntervalMs`, default: `probeIntervalMs / 2` -- probe twice as fast when degraded) allows faster recovery detection without wasting probes on healthy providers.

When the provider recovers to `healthy`, the probe interval returns to the normal rate.

---

## 6. Latency Tracking

### What Is Measured

For each probe and each reported traffic event, two latency metrics are captured:

- **TTFB (Time to First Byte)**: The time from sending the request to receiving the first byte of the response. This measures the provider's processing time plus network round-trip. TTFB is the most relevant latency metric for streaming responses, where the user sees the first token quickly even if the full response takes seconds.

- **Full Response Time**: The time from sending the request to receiving the complete response. This measures the total request duration, including response body transfer. For non-streaming responses, this is the only relevant metric.

For active probes, both TTFB and full response time are measured by the probe infrastructure. For passive traffic reports (`reportSuccess(provider, { latencyMs, ttfbMs })`), the caller provides whichever metrics they have.

### Percentile Computation

Percentiles are computed using the selection-based algorithm over the sorted samples in the sliding window. For a window with N samples:

```
p50 = sample at index floor(N * 0.50)
p95 = sample at index floor(N * 0.95)
p99 = sample at index floor(N * 0.99)
```

The samples are stored in insertion order in the ring buffer. When percentiles are requested, the in-window samples are extracted and sorted. For the default maximum of 1000 samples, sorting takes approximately 0.1ms -- negligible.

### Rolling Window Statistics

In addition to percentiles, the following statistics are computed over the sliding window:

- **Mean**: Arithmetic mean of all latency samples in the window.
- **Min / Max**: Minimum and maximum latency observed in the window.
- **Standard deviation**: Standard deviation of latency samples.
- **Sample count**: Number of latency samples in the window.

These are computed on demand when `getHealth()` is called, not maintained incrementally.

### Latency Spike Detection

A latency spike is detected when a single probe or traffic report has latency exceeding a configurable multiple of the rolling p95:

```
spike_threshold = p95 * latencySpikeMultiplier (default: 3.0)
```

When a spike is detected, the `latencySpike` event fires with the provider, the observed latency, and the current p95. Latency spikes do not directly affect health state (the rolling percentiles and error rate handle that), but they provide a real-time signal that something unusual is happening.

---

## 7. Error Rate Tracking

### Sliding Window Computation

The error rate is computed over the same sliding window used for latency:

```
error_rate = count(errors in window) / count(total events in window)
```

Where "events" includes both successful requests and errors, from both active probes and passive traffic reports. If the window contains zero events, the error rate is `undefined` (not zero -- zero events means no data, not perfect health).

### Error Classification

Each error is classified when it is recorded:

```typescript
function classifyError(error: unknown): 'transient' | 'permanent' | 'unknown' {
  const status = extractStatusCode(error);
  if (status === 429 || status === 502 || status === 503 || status === 504) return 'transient';
  if (status === 401 || status === 403) return 'permanent';
  if (status === 400) return 'permanent';
  if (isNetworkError(error)) return 'transient'; // ETIMEDOUT, ECONNRESET, ECONNREFUSED
  return 'unknown';
}
```

The `extractStatusCode` function inspects the error object for `status`, `statusCode`, `response.status`, or `response.statusCode` properties, covering common SDK error shapes (OpenAI SDK, Anthropic SDK, raw `fetch` errors).

### Error Rate Thresholds

Error rate thresholds control health state transitions:

| Threshold | Default | Purpose |
|---|---|---|
| `healthyErrorRate` | 0.02 (2%) | Error rate must drop below this to transition to `healthy` |
| `degradedErrorRate` | 0.05 (5%) | Error rate above this triggers transition to `degraded` |
| `unhealthyErrorRate` | 0.30 (30%) | Error rate above this triggers transition to `unhealthy` |

The thresholds are asymmetric by design: it is harder to become `healthy` (must drop below 2%) than to leave `healthy` (must exceed 5%). This hysteresis band prevents flapping.

### Consecutive Failure Tracking

In addition to the rolling error rate, the monitor tracks consecutive probe failures. This catches scenarios where the provider is completely down (100% error rate in a short burst) before the sliding window accumulates enough samples for the error rate to cross the threshold.

A provider transitions from any state to `unhealthy` when `unhealthyAfterConsecutiveFailures` (default: 3) consecutive probes fail. The counter resets to zero on any successful probe.

---

## 8. Provider Registry

### Built-In Providers

The monitor ships with built-in configurations for five major AI providers. Built-in providers are registered by passing their `id` and API key:

```typescript
const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
    { id: 'google', apiKey: process.env.GOOGLE_API_KEY! },
    { id: 'cohere', apiKey: process.env.COHERE_API_KEY! },
    { id: 'mistral', apiKey: process.env.MISTRAL_API_KEY! },
  ],
});
```

For built-in providers, the monitor automatically configures the probe endpoint, HTTP method, headers, and response validation. The caller only provides the API key.

### Built-In Provider Defaults

| Provider ID | Display Name | Base URL | Probe Endpoint | Probe Model (if applicable) |
|---|---|---|---|---|
| `openai` | OpenAI | `https://api.openai.com` | `GET /v1/models` | N/A |
| `anthropic` | Anthropic | `https://api.anthropic.com` | `POST /v1/messages` | `claude-haiku-4-20250514` |
| `google` | Google Gemini | `https://generativelanguage.googleapis.com` | `GET /v1beta/models` | N/A |
| `cohere` | Cohere | `https://api.cohere.com` | `GET /v1/models` | N/A |
| `mistral` | Mistral | `https://api.mistral.ai` | `GET /v1/models` | N/A |

### Custom Provider Registration

Any provider can be registered with a custom probe function:

```typescript
const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    {
      id: 'azure-openai',
      name: 'Azure OpenAI (East US)',
      probeFn: async () => {
        const start = performance.now();
        const res = await fetch('https://my-resource.openai.azure.com/openai/models?api-version=2024-10-21', {
          headers: { 'api-key': process.env.AZURE_OPENAI_KEY! },
        });
        const latencyMs = performance.now() - start;
        return { success: res.ok, latencyMs, statusCode: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
      },
    },
    {
      id: 'local-llama',
      name: 'Local LLaMA 3',
      probeFn: async () => {
        const start = performance.now();
        const res = await fetch('http://localhost:11434/api/tags');
        const latencyMs = performance.now() - start;
        return { success: res.ok, latencyMs, statusCode: res.status };
      },
    },
  ],
});
```

Custom providers have no built-in defaults. The caller must provide `probeFn` or the monitor cannot actively probe the provider (passive monitoring via `reportSuccess`/`reportError` still works).

### Overriding Built-In Provider Defaults

Built-in provider configuration can be overridden:

```typescript
const monitor = createMonitor({
  providers: [
    {
      id: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
      baseUrl: 'https://openai-proxy.internal.company.com', // Custom base URL
      probeIntervalMs: 15_000, // Probe every 15 seconds instead of 30
    },
  ],
});
```

Overridable fields: `baseUrl`, `probeIntervalMs`, `probeTimeoutMs`, `probeFn` (replaces the built-in probe entirely), `name`.

---

## 9. API Surface

### Installation

```bash
npm install ai-provider-healthcheck
```

### Factory: `createMonitor`

Creates a new health monitor instance.

```typescript
import { createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  ],
  probeIntervalMs: 30_000,
});
```

**Signature:**

```typescript
function createMonitor(config: MonitorConfig): HealthMonitor;
```

### `monitor.start()`

Begins periodic probing of all registered providers. Probes are staggered across the interval.

```typescript
monitor.start();
// Probes begin immediately: first probe fires within 1 second, subsequent probes on interval
```

**Signature:**

```typescript
start(): void;
```

Calling `start()` when already started is a no-op. `start()` fires an initial probe for each provider immediately (within the first second, staggered).

### `monitor.stop()`

Stops all periodic probing. In-flight probes are allowed to complete but their results are discarded if `stop()` was called before they resolved.

```typescript
monitor.stop();
```

**Signature:**

```typescript
stop(): void;
```

Calling `stop()` when already stopped is a no-op. Clears all probe timers. Does not clear accumulated health data -- `getHealth()` still returns the last known state.

### `monitor.getHealth(provider)`

Returns the current health state and metrics for a specific provider.

```typescript
const health = monitor.getHealth('openai');
console.log(health.state);           // 'healthy'
console.log(health.latency.p50);     // 142
console.log(health.latency.p95);     // 387
console.log(health.latency.p99);     // 892
console.log(health.errorRate);       // 0.01
console.log(health.lastProbeAt);     // '2026-03-19T10:30:00.000Z'
console.log(health.consecutiveFailures); // 0
```

**Signature:**

```typescript
getHealth(providerId: string): ProviderHealth;
```

**Throws** `HealthCheckError` with code `UNKNOWN_PROVIDER` if the provider ID is not registered.

### `monitor.getAllHealth()`

Returns health states for all registered providers.

```typescript
const allHealth = monitor.getAllHealth();
// allHealth: {
//   openai: { state: 'healthy', latency: { p50: 142, p95: 387, p99: 892 }, ... },
//   anthropic: { state: 'degraded', latency: { p50: 2100, p95: 5400, p99: 8300 }, ... },
// }
```

**Signature:**

```typescript
getAllHealth(): Record<string, ProviderHealth>;
```

### `monitor.probe(provider)`

Manually triggers a single probe for a specific provider, outside the periodic schedule. Returns the probe result.

```typescript
const result = await monitor.probe('openai');
console.log(result.success);    // true
console.log(result.latencyMs);  // 134
console.log(result.statusCode); // 200
```

**Signature:**

```typescript
probe(providerId: string): Promise<ProbeResult>;
```

The probe result is incorporated into the provider's health metrics (latency history, error rate) just like a periodic probe. Manual probes do not reset or interfere with the periodic schedule.

### `monitor.reportSuccess(provider, metrics)`

Reports a successful production traffic event. The monitor incorporates the latency into its rolling metrics.

```typescript
// After a successful API call to OpenAI
const startTime = performance.now();
const response = await openai.chat.completions.create({ /* ... */ });
const latencyMs = performance.now() - startTime;

monitor.reportSuccess('openai', { latencyMs, ttfbMs: ttfb });
```

**Signature:**

```typescript
reportSuccess(providerId: string, metrics: SuccessMetrics): void;
```

```typescript
interface SuccessMetrics {
  /** Full response latency in milliseconds. Required. */
  latencyMs: number;
  /** Time to first byte in milliseconds. Optional. */
  ttfbMs?: number;
}
```

### `monitor.reportError(provider, error)`

Reports a failed production traffic event. The monitor classifies the error and incorporates it into error rate computation.

```typescript
try {
  await openai.chat.completions.create({ /* ... */ });
} catch (error) {
  monitor.reportError('openai', error);
}
```

**Signature:**

```typescript
reportError(providerId: string, error: unknown): void;
```

The error is classified as transient, permanent, or unknown (see section 7). Transient errors contribute to the error rate. Permanent errors are recorded but flagged separately.

### EventEmitter: `monitor.on(event, handler)`

The monitor extends Node.js `EventEmitter`. Available events:

```typescript
// State change: provider transitioned between health states
monitor.on('stateChange', (event: StateChangeEvent) => {
  console.log(`${event.provider}: ${event.from} -> ${event.to}`);
});

// Probe completed (success or failure)
monitor.on('probe', (event: ProbeEvent) => {
  console.log(`${event.provider}: ${event.success ? 'OK' : 'FAIL'} in ${event.latencyMs}ms`);
});

// Error occurred during probing or event processing
monitor.on('error', (event: MonitorError) => {
  console.error(`Monitor error: ${event.message}`);
});

// Latency spike detected
monitor.on('latencySpike', (event: LatencySpikeEvent) => {
  console.warn(`${event.provider}: latency spike ${event.latencyMs}ms (p95: ${event.p95Ms}ms)`);
});

// Provider transitioned to degraded state
monitor.on('degraded', (event: DegradedEvent) => {
  console.warn(`${event.provider} is degraded: ${event.reason}`);
});

// Provider recovered from degraded or unhealthy to healthy
monitor.on('recovered', (event: RecoveredEvent) => {
  console.log(`${event.provider} recovered from ${event.from} to healthy`);
});
```

### Lifecycle: `monitor.shutdown()`

Full cleanup: stops probing, removes all event listeners, clears all timers.

```typescript
monitor.shutdown();
```

**Signature:**

```typescript
shutdown(): void;
```

After `shutdown()`, the monitor is inert. Calling `start()` after `shutdown()` throws `HealthCheckError` with code `MONITOR_SHUTDOWN`.

### Type Definitions

```typescript
// ── Provider Configuration ──────────────────────────────────────────

/** Configuration for a built-in provider. */
interface BuiltInProviderConfig {
  /** Provider identifier. Must match a built-in provider: 'openai', 'anthropic', 'google', 'cohere', 'mistral'. */
  id: 'openai' | 'anthropic' | 'google' | 'cohere' | 'mistral';
  /** API key for authentication. Required for built-in providers. */
  apiKey: string;
  /** Override the default display name. */
  name?: string;
  /** Override the default base URL (e.g., for proxies). */
  baseUrl?: string;
  /** Override the default probe function. */
  probeFn?: () => Promise<ProbeResult>;
  /** Override the default probe interval for this provider. */
  probeIntervalMs?: number;
  /** Override the default probe timeout for this provider. */
  probeTimeoutMs?: number;
}

/** Configuration for a custom provider. */
interface CustomProviderConfig {
  /** Unique provider identifier. Must not match a built-in provider ID. */
  id: string;
  /** Human-readable display name. Required for custom providers. */
  name: string;
  /** Probe function. Required if active probing is desired. */
  probeFn?: () => Promise<ProbeResult>;
  /** API key. Optional; only used if probeFn is not provided. */
  apiKey?: string;
  /** Base URL. Optional; only used if probeFn is not provided. */
  baseUrl?: string;
  /** Probe interval for this provider. */
  probeIntervalMs?: number;
  /** Probe timeout for this provider. */
  probeTimeoutMs?: number;
}

type ProviderConfig = BuiltInProviderConfig | CustomProviderConfig;

// ── Probe Result ────────────────────────────────────────────────────

/** Result of a single probe. */
interface ProbeResult {
  /** Whether the probe succeeded. */
  success: boolean;
  /** Full response latency in milliseconds. */
  latencyMs: number;
  /** Time to first byte in milliseconds. Optional. */
  ttfbMs?: number;
  /** HTTP status code. Optional (not all probes are HTTP). */
  statusCode?: number;
  /** Error message if the probe failed. */
  error?: string;
}

// ── Provider Health ─────────────────────────────────────────────────

/** Health state for a single provider. */
interface ProviderHealth {
  /** Provider identifier. */
  provider: string;
  /** Provider display name. */
  name: string;
  /** Current health state. */
  state: HealthState;
  /** How long the provider has been in the current state, in milliseconds. */
  stateAge: number;
  /** ISO 8601 timestamp of the last state change. */
  stateChangedAt: string;
  /** Rolling latency statistics over the metrics window. */
  latency: LatencyStats;
  /** Rolling error rate over the metrics window (0-1). Undefined if no data. */
  errorRate: number | undefined;
  /** Number of events in the current metrics window. */
  sampleCount: number;
  /** Number of consecutive probe failures. Resets to 0 on success. */
  consecutiveFailures: number;
  /** ISO 8601 timestamp of the last probe (success or failure). Null if never probed. */
  lastProbeAt: string | null;
  /** Result of the last probe. Null if never probed. */
  lastProbeResult: ProbeResult | null;
  /** ISO 8601 timestamp of the last successful event (probe or traffic). Null if none. */
  lastSuccessAt: string | null;
  /** ISO 8601 timestamp of the last error (probe or traffic). Null if none. */
  lastErrorAt: string | null;
  /** Count of permanent errors (401, 403) in the window. */
  permanentErrors: number;
  /** Count of transient errors (429, 503, timeout) in the window. */
  transientErrors: number;
}

/** Health state enum. */
type HealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/** Latency statistics over the metrics window. */
interface LatencyStats {
  /** Median latency in milliseconds. Undefined if no data. */
  p50: number | undefined;
  /** 95th percentile latency in milliseconds. Undefined if no data. */
  p95: number | undefined;
  /** 99th percentile latency in milliseconds. Undefined if no data. */
  p99: number | undefined;
  /** Mean latency in milliseconds. Undefined if no data. */
  mean: number | undefined;
  /** Minimum latency in milliseconds. Undefined if no data. */
  min: number | undefined;
  /** Maximum latency in milliseconds. Undefined if no data. */
  max: number | undefined;
  /** Standard deviation in milliseconds. Undefined if fewer than 2 samples. */
  stddev: number | undefined;
  /** Number of latency samples in the window. */
  sampleCount: number;
}

// ── Events ──────────────────────────────────────────────────────────

/** Emitted when a provider's health state changes. */
interface StateChangeEvent {
  /** Provider identifier. */
  provider: string;
  /** Previous health state. */
  from: HealthState;
  /** New health state. */
  to: HealthState;
  /** Reason for the transition. */
  reason: string;
  /** ISO 8601 timestamp of the transition. */
  timestamp: string;
  /** Current provider health snapshot at the time of transition. */
  health: ProviderHealth;
}

/** Emitted after each probe completes. */
interface ProbeEvent {
  /** Provider identifier. */
  provider: string;
  /** Whether the probe succeeded. */
  success: boolean;
  /** Probe latency in milliseconds. */
  latencyMs: number;
  /** TTFB in milliseconds. Undefined if not measured. */
  ttfbMs?: number;
  /** HTTP status code. */
  statusCode?: number;
  /** Error message if the probe failed. */
  error?: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** Emitted when a latency spike is detected. */
interface LatencySpikeEvent {
  /** Provider identifier. */
  provider: string;
  /** The observed latency that triggered the spike detection. */
  latencyMs: number;
  /** The current p95 latency at the time of detection. */
  p95Ms: number;
  /** The spike threshold that was exceeded. */
  thresholdMs: number;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** Emitted when a provider transitions to degraded state. */
interface DegradedEvent {
  /** Provider identifier. */
  provider: string;
  /** Human-readable reason for degradation. */
  reason: string;
  /** Current error rate. */
  errorRate: number | undefined;
  /** Current p95 latency. */
  p95Ms: number | undefined;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** Emitted when a provider recovers to healthy state. */
interface RecoveredEvent {
  /** Provider identifier. */
  provider: string;
  /** The state the provider recovered from. */
  from: 'degraded' | 'unhealthy';
  /** How long the provider was in the non-healthy state, in milliseconds. */
  downtimeMs: number;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** Emitted when a monitor-internal error occurs. */
interface MonitorError {
  /** Error message. */
  message: string;
  /** Error code. */
  code: string;
  /** Provider identifier, if the error is provider-specific. */
  provider?: string;
  /** Original error, if available. */
  cause?: unknown;
}

// ── Monitor Configuration ───────────────────────────────────────────

/** Configuration for createMonitor. */
interface MonitorConfig {
  /** Providers to monitor. At least one required. */
  providers: ProviderConfig[];

  /** Default probe interval in milliseconds. Default: 30000 (30s). */
  probeIntervalMs?: number;

  /** Default probe timeout in milliseconds. Default: 10000 (10s). */
  probeTimeoutMs?: number;

  /** Probe interval when provider is degraded or unhealthy. Default: probeIntervalMs / 2. */
  degradedProbeIntervalMs?: number;

  /** Rolling metrics window in milliseconds. Default: 300000 (5 min). */
  metricsWindowMs?: number;

  /** Maximum number of samples to retain per provider. Default: 1000. */
  maxSamplesPerProvider?: number;

  /** Error rate threshold for transition to degraded. Default: 0.05 (5%). */
  degradedErrorRate?: number;

  /** Error rate threshold for transition to unhealthy. Default: 0.30 (30%). */
  unhealthyErrorRate?: number;

  /** Error rate threshold required to transition to healthy. Default: 0.02 (2%). */
  healthyErrorRate?: number;

  /** P95 latency threshold (ms) for transition to degraded. Default: 5000. */
  degradedLatencyMs?: number;

  /** P95 latency threshold (ms) required to transition to healthy. Default: 3000. */
  healthyLatencyMs?: number;

  /** Consecutive probe failures before transitioning to unhealthy. Default: 3. */
  unhealthyAfterConsecutiveFailures?: number;

  /** Minimum samples before state transitions are evaluated. Default: 3. */
  stateChangeMinSamples?: number;

  /** Multiplier of p95 latency for spike detection. Default: 3.0. */
  latencySpikeMultiplier?: number;

  /** Whether to start probing immediately on creation. Default: false. */
  autoStart?: boolean;

  /** HTTP fetch function to use for built-in probes. Default: global fetch. */
  fetchFn?: typeof fetch;
}

// ── Health Monitor Interface ────────────────────────────────────────

interface HealthMonitor {
  /** Start periodic probing. */
  start(): void;
  /** Stop periodic probing. */
  stop(): void;
  /** Get health for a specific provider. */
  getHealth(providerId: string): ProviderHealth;
  /** Get health for all providers. */
  getAllHealth(): Record<string, ProviderHealth>;
  /** Manually probe a specific provider. */
  probe(providerId: string): Promise<ProbeResult>;
  /** Report a successful traffic event. */
  reportSuccess(providerId: string, metrics: SuccessMetrics): void;
  /** Report a failed traffic event. */
  reportError(providerId: string, error: unknown): void;
  /** Full shutdown: stop probing, clear data, remove listeners. */
  shutdown(): void;
  /** EventEmitter methods. */
  on(event: 'stateChange', handler: (event: StateChangeEvent) => void): this;
  on(event: 'probe', handler: (event: ProbeEvent) => void): this;
  on(event: 'error', handler: (event: MonitorError) => void): this;
  on(event: 'latencySpike', handler: (event: LatencySpikeEvent) => void): this;
  on(event: 'degraded', handler: (event: DegradedEvent) => void): this;
  on(event: 'recovered', handler: (event: RecoveredEvent) => void): this;
  off(event: string, handler: (...args: unknown[]) => void): this;
  removeAllListeners(event?: string): this;
}

// ── Error ───────────────────────────────────────────────────────────

class HealthCheckError extends Error {
  code:
    | 'UNKNOWN_PROVIDER'            // getHealth or probe called with unregistered provider ID
    | 'PROBE_TIMEOUT'               // probe exceeded probeTimeoutMs
    | 'PROBE_FAILED'                // probe returned success: false
    | 'MONITOR_SHUTDOWN'            // operation attempted after shutdown()
    | 'INVALID_CONFIG'              // configuration validation failed
    | 'PROBE_CONFIG_ERROR';         // permanent error (401/403) indicates misconfigured probe
}
```

---

## 10. EventEmitter Events

### `stateChange`

Fired when a provider transitions between health states. This is the primary event for routing decisions and alerting.

```typescript
monitor.on('stateChange', ({ provider, from, to, reason, timestamp, health }) => {
  if (to === 'unhealthy') {
    alerting.page(`${provider} is unhealthy: ${reason}`);
    router.deprioritize(provider);
  }
  if (to === 'healthy' && from === 'unhealthy') {
    alerting.resolve(`${provider} has recovered`);
    router.reprioritize(provider);
  }
});
```

**When it fires**: Every time a provider's `state` field changes. Not fired on the initial `unknown` state assignment. Fired once when `unknown` transitions to the first observed state.

### `probe`

Fired after every probe completes (success or failure). Useful for metrics collection and logging.

```typescript
monitor.on('probe', ({ provider, success, latencyMs, statusCode, timestamp }) => {
  metrics.histogram('ai_provider_probe_latency_ms', latencyMs, { provider, success: String(success) });
  if (!success) {
    logger.warn({ provider, statusCode, timestamp }, 'AI provider probe failed');
  }
});
```

**When it fires**: After every active probe (periodic or manual via `monitor.probe()`). Not fired for passive traffic reports (`reportSuccess`/`reportError`).

### `error`

Fired when the monitor itself encounters an error (not provider errors -- those are handled by `reportError` and health state). Examples: probe function throws unexpectedly, event handler throws, timer setup fails.

```typescript
monitor.on('error', ({ message, code, provider, cause }) => {
  logger.error({ message, code, provider }, 'Health monitor internal error');
});
```

**When it fires**: On internal monitor errors. The monitor continues operating after emitting this event -- it does not crash.

### `latencySpike`

Fired when a single request's latency exceeds the spike threshold.

```typescript
monitor.on('latencySpike', ({ provider, latencyMs, p95Ms, thresholdMs }) => {
  logger.warn(`${provider} latency spike: ${latencyMs}ms (threshold: ${thresholdMs}ms, p95: ${p95Ms}ms)`);
});
```

**When it fires**: On any probe or `reportSuccess` call where `latencyMs > p95 * latencySpikeMultiplier`. Not fired if fewer than `stateChangeMinSamples` samples exist (insufficient data for a meaningful p95).

### `degraded`

Convenience event fired when a provider transitions to the `degraded` state. Equivalent to listening for `stateChange` where `to === 'degraded'`, but with additional context.

```typescript
monitor.on('degraded', ({ provider, reason, errorRate, p95Ms }) => {
  slack.post(`#ai-ops`, `${provider} is degraded: ${reason} (error rate: ${(errorRate! * 100).toFixed(1)}%, p95: ${p95Ms}ms)`);
});
```

### `recovered`

Convenience event fired when a provider transitions from `degraded` or `unhealthy` back to `healthy`.

```typescript
monitor.on('recovered', ({ provider, from, downtimeMs }) => {
  slack.post(`#ai-ops`, `${provider} recovered from ${from} after ${(downtimeMs / 1000).toFixed(0)}s`);
});
```

---

## 11. Polling vs Event-Driven Usage

### Event-Driven (Recommended)

The event-driven pattern is recommended for applications that need to react to provider health changes in real time:

```typescript
const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  ],
  autoStart: true,
});

// React to state changes
monitor.on('stateChange', ({ provider, to }) => {
  if (to === 'unhealthy') {
    routingTable.remove(provider);
  } else if (to === 'healthy') {
    routingTable.add(provider);
  }
});

// Ship metrics
monitor.on('probe', ({ provider, latencyMs, success }) => {
  prometheus.observe('ai_probe_latency', latencyMs, { provider });
  prometheus.inc('ai_probe_total', { provider, result: success ? 'success' : 'failure' });
});
```

### Polling

The polling pattern is for applications that check health on demand, before each request:

```typescript
const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  ],
  autoStart: true,
});

async function callAI(prompt: string): Promise<string> {
  const allHealth = monitor.getAllHealth();

  // Select the healthiest provider with the lowest p95 latency
  const healthyProviders = Object.values(allHealth)
    .filter(h => h.state === 'healthy')
    .sort((a, b) => (a.latency.p95 ?? Infinity) - (b.latency.p95 ?? Infinity));

  if (healthyProviders.length === 0) {
    // Fall back to degraded providers
    const degraded = Object.values(allHealth)
      .filter(h => h.state === 'degraded')
      .sort((a, b) => (a.latency.p95 ?? Infinity) - (b.latency.p95 ?? Infinity));

    if (degraded.length === 0) {
      throw new Error('All AI providers are unhealthy');
    }
    return callProvider(degraded[0].provider, prompt);
  }

  return callProvider(healthyProviders[0].provider, prompt);
}
```

### Hybrid: Passive Monitoring Without Active Probing

For applications that do not want the monitor to make its own API calls (to avoid additional cost or rate limit consumption), the monitor can operate in passive-only mode:

```typescript
const monitor = createMonitor({
  providers: [
    { id: 'openai', name: 'OpenAI' }, // No apiKey, no probeFn -> passive only
    { id: 'anthropic', name: 'Anthropic' },
  ],
  // Do not call monitor.start() -- no active probing
});

// Report all production traffic
async function callOpenAI(prompt: string): Promise<string> {
  const start = performance.now();
  try {
    const result = await openai.chat.completions.create({ /* ... */ });
    monitor.reportSuccess('openai', { latencyMs: performance.now() - start });
    return result.choices[0].message.content!;
  } catch (error) {
    monitor.reportError('openai', error);
    throw error;
  }
}

// Health state is updated based on reported traffic alone
monitor.on('stateChange', ({ provider, to }) => {
  console.log(`${provider} is now ${to} (based on production traffic)`);
});
```

In passive-only mode, the provider starts in `unknown` and transitions to a definite state after `stateChangeMinSamples` traffic reports.

---

## 12. Configuration Reference

### `MonitorConfig` Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `providers` | `ProviderConfig[]` | (required) | Providers to monitor. At least one required. |
| `probeIntervalMs` | `number` | `30000` (30s) | Default interval between probes for each provider. |
| `probeTimeoutMs` | `number` | `10000` (10s) | Maximum time to wait for a probe response. |
| `degradedProbeIntervalMs` | `number` | `probeIntervalMs / 2` | Probe interval when provider is degraded or unhealthy. |
| `metricsWindowMs` | `number` | `300000` (5 min) | Sliding window for error rate and latency percentiles. |
| `maxSamplesPerProvider` | `number` | `1000` | Maximum samples retained per provider in the ring buffer. |
| `degradedErrorRate` | `number` | `0.05` (5%) | Error rate above this transitions to `degraded`. |
| `unhealthyErrorRate` | `number` | `0.30` (30%) | Error rate above this transitions to `unhealthy`. |
| `healthyErrorRate` | `number` | `0.02` (2%) | Error rate must drop below this to transition to `healthy`. |
| `degradedLatencyMs` | `number` | `5000` | P95 latency (ms) above this transitions to `degraded`. |
| `healthyLatencyMs` | `number` | `3000` | P95 latency (ms) must drop below this to transition to `healthy`. |
| `unhealthyAfterConsecutiveFailures` | `number` | `3` | Consecutive probe failures before transitioning to `unhealthy`. |
| `stateChangeMinSamples` | `number` | `3` | Minimum samples required before evaluating state transitions. |
| `latencySpikeMultiplier` | `number` | `3.0` | Multiplier of p95 for latency spike detection. |
| `autoStart` | `boolean` | `false` | Start probing immediately on `createMonitor()`. |
| `fetchFn` | `typeof fetch` | `globalThis.fetch` | HTTP fetch function for built-in probes. |

### Configuration Validation

All options are validated synchronously when `createMonitor` is called. Invalid values throw `HealthCheckError` with code `INVALID_CONFIG` and actionable messages:

| Rule | Error |
|---|---|
| `providers` must be a non-empty array | `providers must be a non-empty array` |
| Provider `id` values must be unique | `duplicate provider id 'openai'` |
| Built-in provider must have `apiKey` or `probeFn` | `built-in provider 'openai' requires apiKey or probeFn` |
| Custom provider must have `name` | `custom provider 'my-llm' requires a name` |
| `probeIntervalMs` must be a positive integer | `probeIntervalMs must be a positive integer, received 0` |
| `probeTimeoutMs` must be a positive integer | `probeTimeoutMs must be a positive integer` |
| `probeTimeoutMs` must be less than `probeIntervalMs` | `probeTimeoutMs (35000) must be less than probeIntervalMs (30000)` |
| Error rate thresholds must be in [0, 1] | `degradedErrorRate must be between 0 and 1, received 1.5` |
| `healthyErrorRate < degradedErrorRate < unhealthyErrorRate` | `healthyErrorRate (0.10) must be less than degradedErrorRate (0.05)` |
| `healthyLatencyMs < degradedLatencyMs` | `healthyLatencyMs (6000) must be less than degradedLatencyMs (5000)` |

---

## 13. CLI

### Installation and Invocation

```bash
# Global install
npm install -g ai-provider-healthcheck
ai-provider-healthcheck status

# npx (no install)
npx ai-provider-healthcheck status --providers openai,anthropic

# Package script
# package.json: { "scripts": { "health": "ai-provider-healthcheck status" } }
npm run health
```

### CLI Binary Name

`ai-provider-healthcheck`

### Commands

#### `ai-provider-healthcheck status`

One-shot health check: probes all configured providers once and prints the results.

```
ai-provider-healthcheck status [options]

Options:
  --providers <list>    Comma-separated provider IDs. Default: all built-in providers with API keys set via env vars.
  --timeout <ms>        Per-probe timeout in milliseconds. Default: 10000.
  --format <fmt>        Output format: human (default) | json.
  --quiet               Suppress output except exit code.

Environment variables:
  OPENAI_API_KEY        API key for OpenAI
  ANTHROPIC_API_KEY     API key for Anthropic
  GOOGLE_API_KEY        API key for Google Gemini
  COHERE_API_KEY        API key for Cohere
  MISTRAL_API_KEY       API key for Mistral
```

**Human output:**

```
$ ai-provider-healthcheck status

  ai-provider-healthcheck v0.1.0

  Provider Health Status

  HEALTHY   OpenAI       134ms    ✓
  DEGRADED  Anthropic   2847ms    ⚠  elevated latency (p95 > 5000ms)
  HEALTHY   Google       201ms    ✓
  HEALTHY   Mistral      189ms    ✓
  ERROR     Cohere         --     ✗  HTTP 401 (invalid API key)

  Summary: 3 healthy, 1 degraded, 1 error
```

**JSON output:**

```
$ ai-provider-healthcheck status --format json
```

Outputs a JSON object with per-provider probe results and health states.

#### `ai-provider-healthcheck watch`

Continuous monitoring: probes providers on an interval and prints live updates.

```
ai-provider-healthcheck watch [options]

Options:
  --providers <list>    Comma-separated provider IDs.
  --interval <ms>       Probe interval in milliseconds. Default: 30000.
  --timeout <ms>        Per-probe timeout. Default: 10000.
  --format <fmt>        Output format: human (default) | json.

Environment variables:
  Same as 'status' command.
```

**Human output:**

```
$ ai-provider-healthcheck watch --interval 15000

  ai-provider-healthcheck v0.1.0  — watching (Ctrl+C to stop)

  ┌────────────┬──────────┬───────┬───────┬───────┬────────────┬────────────┐
  │ Provider   │ State    │  p50  │  p95  │  p99  │ Error Rate │ Last Probe │
  ├────────────┼──────────┼───────┼───────┼───────┼────────────┼────────────┤
  │ OpenAI     │ healthy  │ 142ms │ 387ms │ 892ms │     0.8%   │ 2s ago     │
  │ Anthropic  │ degraded │ 2.1s  │ 5.4s  │ 8.3s  │     3.2%   │ 2s ago     │
  │ Google     │ healthy  │ 198ms │ 412ms │ 701ms │     0.0%   │ 2s ago     │
  │ Mistral    │ healthy  │ 175ms │ 340ms │ 580ms │     1.1%   │ 2s ago     │
  └────────────┴──────────┴───────┴───────┴───────┴────────────┴────────────┘

  [10:30:15] Anthropic: degraded -> unhealthy (error rate 32%, 3 consecutive failures)
  [10:30:45] Anthropic: unhealthy -> degraded (probe succeeded, latency 1.8s)
  [10:31:15] Anthropic: degraded -> healthy (error rate 1.2%, p95 890ms)
```

### Exit Codes

| Code | Meaning |
|---|---|
| `0` | All providers are healthy. |
| `1` | One or more providers are degraded or unhealthy. |
| `2` | Configuration or usage error (missing API keys, invalid flags). |

---

## 14. Integration

### Integration with `ai-keyring`

`ai-keyring` manages API key pools and rotation across providers. `ai-provider-healthcheck` monitors provider-level health. Together, they enable health-aware key selection:

```typescript
import { createKeyring } from 'ai-keyring';
import { createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  ],
  autoStart: true,
});

const keyring = createKeyring({
  keys: [
    { id: 'oai-1', key: process.env.OPENAI_KEY_1!, provider: 'openai' },
    { id: 'oai-2', key: process.env.OPENAI_KEY_2!, provider: 'openai' },
    { id: 'ant-1', key: process.env.ANTHROPIC_KEY!, provider: 'anthropic' },
  ],
  strategy: 'priority',
});

// When a provider becomes unhealthy, deprioritize its keys
monitor.on('stateChange', ({ provider, to }) => {
  if (to === 'unhealthy') {
    // Caller implements routing logic: skip the unhealthy provider's pool
    routingPreference = routingPreference.filter(p => p !== provider);
  }
  if (to === 'healthy') {
    if (!routingPreference.includes(provider)) routingPreference.push(provider);
  }
});

// Select a key from the healthiest available provider
function selectKey() {
  for (const provider of routingPreference) {
    try {
      return keyring.getKey(provider);
    } catch {
      continue; // Pool exhausted, try next provider
    }
  }
  throw new Error('All providers unavailable');
}
```

The distinction between the two packages is clear: `ai-provider-healthcheck` answers "is the OpenAI API endpoint up and fast?" while `ai-keyring` answers "which of my three OpenAI API keys should I use?" A provider can be healthy while a specific key is rate-limited; a key can be valid while the provider is experiencing an outage.

### Integration with `ai-circuit-breaker`

`ai-circuit-breaker` provides spend-based circuit breaking -- it stops requests when a cost budget is exceeded. `ai-provider-healthcheck` provides availability-based health monitoring. Together:

```typescript
import { createCircuitBreaker } from 'ai-circuit-breaker';
import { createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [{ id: 'openai', apiKey: process.env.OPENAI_API_KEY! }],
  autoStart: true,
});

const breaker = createCircuitBreaker({
  budgetLimit: 100, // $100 per day
});

async function callAI(prompt: string) {
  const health = monitor.getHealth('openai');
  if (health.state === 'unhealthy') {
    throw new Error('OpenAI is unhealthy -- failing fast');
  }

  // Circuit breaker checks budget
  return breaker.call(() => openai.chat.completions.create({ /* ... */ }));
}
```

### Integration with `prompt-price`

`prompt-price` estimates the cost of a prompt before sending it. Combined with `ai-provider-healthcheck`, applications can make cost-aware routing decisions factoring in provider health:

```typescript
import { estimateCost } from 'prompt-price';
import { createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  ],
  autoStart: true,
});

function selectProviderAndModel(prompt: string) {
  const candidates = [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'anthropic', model: 'claude-haiku-4-20250514' },
  ];

  // Filter to healthy providers
  const healthy = candidates.filter(c => {
    const h = monitor.getHealth(c.provider);
    return h.state === 'healthy' || h.state === 'degraded';
  });

  // Select cheapest healthy provider
  return healthy.sort((a, b) => {
    const costA = estimateCost(prompt, a.model);
    const costB = estimateCost(prompt, b.model);
    return costA - costB;
  })[0];
}
```

---

## 15. Testing Strategy

### Unit Tests

Unit tests mock the HTTP fetch function to test health monitoring logic in isolation.

**Monitor creation tests:**
- `createMonitor` with valid config returns a `HealthMonitor` instance.
- `createMonitor` with empty `providers` throws `HealthCheckError` with code `INVALID_CONFIG`.
- `createMonitor` with duplicate provider IDs throws.
- `createMonitor` with invalid threshold ordering (healthyErrorRate > degradedErrorRate) throws.
- Built-in provider without `apiKey` or `probeFn` throws.

**Health state transition tests:**
- Provider starts in `unknown` state.
- After first successful probe, transitions to `healthy`.
- After first failed probe, transitions to `unhealthy`.
- After `stateChangeMinSamples` probes with error rate above `degradedErrorRate`, transitions from `healthy` to `degraded`.
- After `unhealthyAfterConsecutiveFailures` consecutive failures, transitions to `unhealthy`.
- After error rate drops below `healthyErrorRate` AND latency drops below `healthyLatencyMs`, transitions back to `healthy`.
- Hysteresis: a single failed probe does not transition `healthy` to `degraded` when `stateChangeMinSamples > 1`.
- Direct `unknown` -> `unhealthy` transition when first probe fails.
- `unhealthy` -> `degraded` transition when a probe succeeds but metrics are still above healthy thresholds.

**Latency tracking tests:**
- `getHealth().latency.p50` returns undefined when no samples exist.
- After 10 probes with known latencies, p50/p95/p99 are computed correctly (verified against hand-sorted expected values).
- Samples outside the metrics window are excluded from percentile computation.
- Ring buffer evicts oldest entry when `maxSamplesPerProvider` is exceeded.

**Error rate tests:**
- Error rate is `undefined` when no events exist.
- After 100 events (5 errors, 95 successes), error rate is 0.05.
- Permanent errors (401, 403) do not contribute to the error rate.
- Transient errors (429, 503, timeout) contribute to the error rate.
- Events outside the metrics window are excluded.

**Error classification tests:**
- HTTP 429 is classified as transient.
- HTTP 503, 502, 504 are classified as transient.
- Network errors (`ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`) are classified as transient.
- HTTP 401, 403, 400 are classified as permanent.
- Unknown error shapes are classified as `unknown`.

**Event emission tests:**
- `stateChange` event fires with correct `from`, `to`, and `reason` on each transition.
- `stateChange` does not fire when health is re-evaluated but state has not changed.
- `probe` event fires after every periodic probe with correct `success`, `latencyMs`, `statusCode`.
- `latencySpike` fires when `latencyMs > p95 * latencySpikeMultiplier`.
- `latencySpike` does not fire when fewer than `stateChangeMinSamples` samples exist.
- `degraded` event fires when transitioning to `degraded`.
- `recovered` event fires when transitioning from `degraded` or `unhealthy` to `healthy`.
- `error` event fires on internal monitor errors without crashing the monitor.

**Passive monitoring tests:**
- `reportSuccess` updates latency metrics.
- `reportError` updates error rate.
- Health state transitions based on passive reports alone (no active probing).
- `reportSuccess` and `reportError` with unknown provider ID are silently ignored (no throw -- passive monitoring should not crash the caller).

**Probe scheduling tests:**
- `start()` schedules probes for all providers.
- Probes are staggered (not all fire at the same time).
- `stop()` clears all probe timers.
- `start()` after `stop()` resumes probing.
- `start()` when already started is a no-op.
- `stop()` when already stopped is a no-op.
- `shutdown()` makes subsequent `start()` throw.
- Probe timers use `.unref()` (verify by checking the timer handle).

**Built-in probe tests:**
- OpenAI probe sends `GET /v1/models` with correct `Authorization` header.
- Anthropic probe sends `POST /v1/messages` with correct `x-api-key` header and minimal payload.
- Google probe sends `GET /v1beta/models` with correct `x-goog-api-key` header.
- Probes respect `probeTimeoutMs` and abort on timeout.
- Probes measure latency using `performance.now()`.

### Integration Tests

- **End-to-end with mock HTTP server**: Start a local HTTP server that simulates an AI provider (returns 200 normally, 503 intermittently, 429 under load). Run the monitor against it and verify state transitions and event emissions over a 30-second test window.
- **Passive monitoring round-trip**: Create a monitor with no active probing. Report 50 successes, verify `healthy`. Report 20 errors in a row, verify transition to `unhealthy`. Report 10 successes, verify recovery.
- **CLI integration**: Invoke `ai-provider-healthcheck status` via `child_process.execSync` with a mock server. Verify exit codes and output format.
- **Multiple providers**: Register three providers with different mock endpoints (one healthy, one degraded, one unhealthy). Verify `getAllHealth()` returns the correct state for each.

### Test Framework

Tests use Vitest, matching the project's existing configuration. HTTP mocks use a lightweight in-process HTTP server created with `node:http`.

---

## 16. Performance

### Probe Overhead

Each active probe makes one HTTP request. For 5 providers at a 30-second interval, the monitor makes 10 HTTP requests per minute. This is negligible compared to production API call volume.

| Operation | Cost |
|---|---|
| Single probe (HTTP request + timing) | ~100-500ms (network-dependent) |
| Percentile computation (sort 1000 samples) | < 1ms |
| Error rate computation (count events in window) | < 0.1ms |
| State evaluation (compare metrics to thresholds) | < 0.01ms |
| `getHealth()` call | < 1ms |
| `getAllHealth()` with 5 providers | < 5ms |

### Memory Footprint

| Component | Memory per Provider |
|---|---|
| Ring buffer (1000 samples x ~50 bytes each) | ~50 KB |
| Health state and metadata | ~1 KB |
| Probe timers | ~0.1 KB |
| Total per provider | ~51 KB |

For 5 providers, total memory usage is approximately 255 KB. For 20 providers (a generous upper bound), approximately 1 MB.

### Timer Management

All probe timers use `setTimeout` (not `setInterval`) with `.unref()` to avoid preventing process exit. After each probe completes, the next timer is scheduled. This ensures that probes do not pile up if a probe takes longer than the interval (each probe waits for the previous one to complete before scheduling the next).

---

## 17. Dependencies

### Runtime Dependencies

**Zero mandatory runtime dependencies.** All probing, latency computation, percentile calculation, error classification, and state management are implemented in pure TypeScript.

Node.js built-ins used:

- `node:events` -- EventEmitter base class
- `node:crypto` -- UUID generation for internal identifiers (optional; falls back to `Date.now()` + counter)
- `globalThis.fetch` -- HTTP requests for built-in probes (available in Node.js 18+)
- `node:timers` -- `setTimeout` for probe scheduling
- `perf_hooks` -- `performance.now()` for high-resolution timing

### Dev Dependencies

| Package | Purpose |
|---|---|
| `typescript` | TypeScript compiler |
| `vitest` | Test runner |
| `eslint` | Linting |
| `@types/node` | Node.js type definitions |

---

## 18. File Structure

```
ai-provider-healthcheck/
├── src/
│   ├── index.ts                      # Public API exports: createMonitor, types, errors
│   ├── monitor.ts                    # HealthMonitor class: start, stop, probe, getHealth, events
│   ├── provider.ts                   # Provider configuration, built-in registry, probe function resolution
│   ├── health-state.ts               # Health state machine: transitions, hysteresis, threshold evaluation
│   ├── metrics.ts                    # Ring buffer, latency percentiles, error rate, sliding window
│   ├── probes/
│   │   ├── openai.ts                 # Built-in probe for OpenAI (GET /v1/models)
│   │   ├── anthropic.ts              # Built-in probe for Anthropic (POST /v1/messages)
│   │   ├── google.ts                 # Built-in probe for Google Gemini (GET /v1beta/models)
│   │   ├── cohere.ts                 # Built-in probe for Cohere (GET /v1/models)
│   │   └── mistral.ts               # Built-in probe for Mistral (GET /v1/models)
│   ├── error-classifier.ts          # Error classification: transient, permanent, unknown
│   ├── cli.ts                       # CLI entry point (ai-provider-healthcheck command)
│   └── types.ts                     # All TypeScript type definitions
├── src/__tests__/
│   ├── monitor.test.ts              # HealthMonitor lifecycle, start/stop, probe scheduling
│   ├── health-state.test.ts         # State transition tests, hysteresis, threshold evaluation
│   ├── metrics.test.ts              # Ring buffer, percentile computation, error rate, sliding window
│   ├── error-classifier.test.ts     # Error classification unit tests
│   ├── probes/
│   │   ├── openai.test.ts           # OpenAI probe unit tests (mocked fetch)
│   │   ├── anthropic.test.ts        # Anthropic probe unit tests
│   │   ├── google.test.ts           # Google probe unit tests
│   │   ├── cohere.test.ts           # Cohere probe unit tests
│   │   └── mistral.test.ts          # Mistral probe unit tests
│   ├── events.test.ts               # Event emission tests: stateChange, probe, latencySpike
│   ├── passive.test.ts              # Passive monitoring tests: reportSuccess, reportError
│   └── integration/
│       ├── end-to-end.test.ts       # Full monitor lifecycle with mock HTTP server
│       └── cli.test.ts              # CLI invocation via child_process, exit code verification
├── package.json
├── tsconfig.json
├── README.md
└── SPEC.md
```

---

## 19. Implementation Roadmap

### Phase 1: Core Metrics Engine (Week 1)

The foundation is the metrics and state management layer.

1. **`types.ts`**: All TypeScript type definitions -- `ProviderConfig`, `ProbeResult`, `ProviderHealth`, `HealthState`, `MonitorConfig`, event types, `HealthCheckError`.

2. **`metrics.ts`**: Ring buffer with timestamped entries, sliding window pruning, percentile computation (p50/p95/p99 via sorted selection), error rate computation, latency statistics (mean, min, max, stddev). Unit-tested with deterministic inputs.

3. **`error-classifier.ts`**: Error classification -- `extractStatusCode` from various error shapes, `classifyError` into transient/permanent/unknown. Unit-tested with error objects from OpenAI SDK, Anthropic SDK, and raw `fetch` errors.

4. **`health-state.ts`**: State machine implementation -- transition rules, hysteresis (stateChangeMinSamples), threshold evaluation, consecutive failure tracking. Unit-tested with synthetic metric sequences that trigger each transition.

### Phase 2: Probes and Provider Registry (Week 1-2)

1. **`probes/*.ts`**: Built-in probe functions for each provider. Each probe function takes an API key and returns a `ProbeResult`. Uses `fetch` with `AbortController` for timeout. Measures `performance.now()` for latency.

2. **`provider.ts`**: Provider registry -- built-in provider defaults (base URL, probe endpoint, headers), custom provider registration, configuration merging (caller overrides on top of defaults).

### Phase 3: Monitor and Events (Week 2)

1. **`monitor.ts`**: The `HealthMonitor` class extending `EventEmitter`. Implements `start()`, `stop()`, `probe()`, `getHealth()`, `getAllHealth()`, `reportSuccess()`, `reportError()`, `shutdown()`. Wires together probes, metrics, health state, and event emission. Probe scheduling with staggering and `.unref()` timers. Adaptive probe interval on degradation.

2. **Event emission**: `stateChange`, `probe`, `error`, `latencySpike`, `degraded`, `recovered`. Tested for correct event payload on each transition.

### Phase 4: CLI (Week 2-3)

1. **`cli.ts`**: Two commands -- `status` (one-shot) and `watch` (continuous). Argument parsing using `util.parseArgs` (Node.js 18+). Environment variable detection for API keys. Human-readable table output and JSON output. Exit code logic.

### Phase 5: Tests and Documentation (Week 3)

1. Full unit test suite for all modules.
2. Integration tests with mock HTTP servers.
3. CLI tests via `child_process.execSync`.
4. README with quick-start, API reference, and common integration examples.
5. Performance validation against the targets in Section 16.

---

## 20. Examples

### Example 1: Basic Multi-Provider Monitoring

```typescript
import { createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  ],
  probeIntervalMs: 30_000,
  autoStart: true,
});

monitor.on('stateChange', ({ provider, from, to, reason }) => {
  console.log(`[${new Date().toISOString()}] ${provider}: ${from} -> ${to} (${reason})`);
});

// Check health on demand
const health = monitor.getHealth('openai');
console.log(`OpenAI: ${health.state}, p95: ${health.latency.p95}ms, error rate: ${health.errorRate}`);

// Clean shutdown on process exit
process.on('SIGINT', () => {
  monitor.shutdown();
  process.exit(0);
});
```

### Example 2: Health-Aware Routing with Failover

```typescript
import { createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
    { id: 'google', apiKey: process.env.GOOGLE_API_KEY! },
  ],
  autoStart: true,
});

const providerPriority = ['openai', 'anthropic', 'google'];

async function callAI(prompt: string): Promise<string> {
  for (const providerId of providerPriority) {
    const health = monitor.getHealth(providerId);
    if (health.state === 'unhealthy') continue;

    const start = performance.now();
    try {
      const result = await callProvider(providerId, prompt);
      monitor.reportSuccess(providerId, { latencyMs: performance.now() - start });
      return result;
    } catch (error) {
      monitor.reportError(providerId, error);
      continue; // Try next provider
    }
  }
  throw new Error('All AI providers failed');
}
```

### Example 3: Passive-Only Monitoring with Alerting

```typescript
import { createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
  ],
  degradedErrorRate: 0.10,
  unhealthyErrorRate: 0.50,
});

// No monitor.start() -- passive only

monitor.on('degraded', ({ provider, reason, errorRate }) => {
  slack.post('#ai-ops', `${provider} degraded: ${reason} (error rate: ${((errorRate ?? 0) * 100).toFixed(1)}%)`);
});

monitor.on('recovered', ({ provider, from, downtimeMs }) => {
  slack.post('#ai-ops', `${provider} recovered from ${from} (downtime: ${(downtimeMs / 1000).toFixed(0)}s)`);
});

// Wrap all production API calls
async function callOpenAI(prompt: string) {
  const start = performance.now();
  try {
    const result = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }] });
    monitor.reportSuccess('openai', { latencyMs: performance.now() - start });
    return result;
  } catch (error) {
    monitor.reportError('openai', error);
    throw error;
  }
}
```

### Example 4: Prometheus Metrics Export

```typescript
import { createMonitor } from 'ai-provider-healthcheck';
import { register, Histogram, Gauge, Counter } from 'prom-client';

const latencyHistogram = new Histogram({
  name: 'ai_provider_probe_latency_ms',
  help: 'AI provider probe latency in milliseconds',
  labelNames: ['provider', 'result'],
  buckets: [50, 100, 200, 500, 1000, 2000, 5000, 10000],
});

const stateGauge = new Gauge({
  name: 'ai_provider_health_state',
  help: 'AI provider health state (0=unknown, 1=healthy, 2=degraded, 3=unhealthy)',
  labelNames: ['provider'],
});

const stateMap = { unknown: 0, healthy: 1, degraded: 2, unhealthy: 3 };

const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  ],
  autoStart: true,
});

monitor.on('probe', ({ provider, success, latencyMs }) => {
  latencyHistogram.observe({ provider, result: success ? 'success' : 'failure' }, latencyMs);
});

monitor.on('stateChange', ({ provider, to }) => {
  stateGauge.set({ provider }, stateMap[to]);
});
```

### Example 5: CI Pre-Test Health Gate

```typescript
// ci-health-check.ts -- run before integration tests
import { createMonitor } from 'ai-provider-healthcheck';

async function main() {
  const monitor = createMonitor({
    providers: [
      { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    ],
  });

  const result = await monitor.probe('openai');

  if (!result.success) {
    console.error(`OpenAI probe failed: ${result.error}`);
    process.exit(1);
  }

  if (result.latencyMs > 5000) {
    console.warn(`OpenAI probe slow: ${result.latencyMs}ms`);
    process.exit(1);
  }

  console.log(`OpenAI healthy: ${result.latencyMs}ms`);
  process.exit(0);
}

main();
```

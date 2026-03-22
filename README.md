# ai-provider-healthcheck

Monitor AI provider endpoint latency and availability with active probes, passive observation, and automatic health state classification.

[![npm version](https://img.shields.io/npm/v/ai-provider-healthcheck.svg)](https://www.npmjs.com/package/ai-provider-healthcheck)
[![npm downloads](https://img.shields.io/npm/dt/ai-provider-healthcheck.svg)](https://www.npmjs.com/package/ai-provider-healthcheck)
[![license](https://img.shields.io/npm/l/ai-provider-healthcheck.svg)](https://github.com/SiluPanda/ai-provider-healthcheck/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/ai-provider-healthcheck.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Real-time health monitoring for AI inference endpoints. Tracks OpenAI, Anthropic, Google Gemini, Cohere, Mistral, and any custom provider. Classifies each provider into one of four health states -- `healthy`, `degraded`, `unhealthy`, or `unknown` -- using configurable error rate thresholds, latency percentiles, and consecutive failure counts over a sliding time window. Emits events on every state transition, latency spike, and probe result so your application can react instantly to provider degradation. Zero runtime dependencies.

## Installation

```bash
npm install ai-provider-healthcheck
```

Requires Node.js 18 or later.

## Quick Start

```typescript
import { createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  ],
});

monitor.on('stateChange', ({ provider, from, to, reason }) => {
  console.log(`${provider}: ${from} -> ${to} (${reason})`);
});

monitor.start();

// Query health on demand
const health = monitor.getHealth('openai');
console.log(health.state);       // 'healthy'
console.log(health.latency.p95); // 387
console.log(health.errorRate);   // 0.01
```

## Features

- **Active probing** -- periodic lightweight HTTP checks against provider endpoints on a configurable interval with staggered scheduling across providers.
- **Passive monitoring** -- record production traffic outcomes via `reportSuccess` and `reportError` without making additional API calls.
- **Health state machine** -- four-state model (`healthy`, `degraded`, `unhealthy`, `unknown`) with hysteresis to prevent flapping between states.
- **Latency percentiles** -- rolling p50, p95, p99, mean, min, max, and standard deviation computed over a configurable sliding time window.
- **Error rate tracking** -- rolling error rate with automatic classification of errors into transient (429, 502, 503, 504, network errors) and permanent (400, 401, 403). Permanent errors are tracked separately and do not inflate the error rate used for state transitions.
- **Latency spike detection** -- emits `latencySpike` events when observed latency exceeds a configurable multiplier of the current p95 baseline.
- **Event-driven** -- emits `stateChange`, `probe`, `latencySpike`, `degraded`, `recovered`, and `error` events via the Node.js `EventEmitter` interface.
- **Built-in providers** -- pre-configured probe endpoints for OpenAI, Anthropic, Google Gemini, Cohere, and Mistral. Pass an `id` and `apiKey` to get started.
- **Custom providers** -- register any provider with a custom `probeFn`, or use passive-only monitoring without a probe function.
- **Asymmetric thresholds** -- recovering from `degraded` or `unhealthy` to `healthy` requires stricter thresholds than the initial degradation, preventing oscillation.
- **Consecutive failure bypass** -- transitions directly to `unhealthy` after a configurable number of consecutive probe failures, bypassing normal hysteresis.
- **Ring buffer metrics** -- bounded memory usage with a configurable maximum sample count per provider.
- **Zero runtime dependencies** -- uses only `node:http`, `node:https`, and `node:events`.

## API Reference

### `createMonitor(config)`

Creates and returns a new `HealthMonitor` instance.

```typescript
function createMonitor(config: MonitorConfig): HealthMonitor;
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `config` | `MonitorConfig` | Monitor configuration (see [Configuration](#configuration)) |

**Returns:** `HealthMonitor` -- an `EventEmitter` subclass with health monitoring methods.

```typescript
import { createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    {
      id: 'my-llm',
      name: 'Self-Hosted LLM',
      probeFn: async () => {
        const start = performance.now();
        const res = await fetch('http://llm.internal:8080/health');
        return {
          success: res.ok,
          latencyMs: performance.now() - start,
          statusCode: res.status,
        };
      },
    },
  ],
});
```

---

### `monitor.start()`

Starts periodic probing of all providers that have a `probeFn` configured. Probes are staggered across providers to avoid thundering herd. Providers in `degraded` or `unhealthy` state are probed at the faster `degradedProbeIntervalMs` rate.

```typescript
start(): void
```

Calling `start()` when already running is a no-op. Throws `HealthCheckError` with code `MONITOR_SHUTDOWN` if called after `shutdown()`.

---

### `monitor.stop()`

Stops periodic probing. Clears all scheduled probe timers. Does not clear collected metrics or health state. Can be restarted with `start()`.

```typescript
stop(): void
```

Calling `stop()` when already stopped is a no-op.

---

### `monitor.getHealth(providerId)`

Returns the current health snapshot for a specific provider.

```typescript
getHealth(providerId: string): ProviderHealth
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `providerId` | `string` | The provider's `id` as specified in configuration |

**Returns:** `ProviderHealth`

```typescript
interface ProviderHealth {
  provider: string;              // Provider id
  name: string;                  // Display name
  state: HealthState;            // 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  stateAge: number;              // Milliseconds since last state change
  stateChangedAt: string;        // ISO 8601 timestamp of last state change
  latency: LatencyStats;         // Latency percentiles and statistics
  errorRate: number | undefined; // Rolling error rate (0-1), undefined if no data
  sampleCount: number;           // Number of samples in current window
  consecutiveFailures: number;   // Current streak of consecutive failures
  lastProbeAt: string | null;    // ISO 8601 timestamp of last probe
  lastProbeResult: ProbeResult | null;
  lastSuccessAt: string | null;  // ISO 8601 timestamp of last success
  lastErrorAt: string | null;    // ISO 8601 timestamp of last error
  permanentErrors: number;       // Count of permanent errors (401, 403, 400) in window
  transientErrors: number;       // Count of transient errors (429, 5xx, network) in window
}
```

**Throws:** `HealthCheckError` with code `UNKNOWN_PROVIDER` if `providerId` is not registered. Throws with code `MONITOR_SHUTDOWN` if called after `shutdown()`.

```typescript
const health = monitor.getHealth('openai');
console.log(health.state);              // 'healthy'
console.log(health.latency.p95);        // 387
console.log(health.latency.mean);       // 201
console.log(health.errorRate);          // 0.01
console.log(health.consecutiveFailures); // 0
```

---

### `monitor.getAllHealth()`

Returns health snapshots for all registered providers.

```typescript
getAllHealth(): Record<string, ProviderHealth>
```

**Returns:** An object keyed by provider `id`, with `ProviderHealth` values.

**Throws:** `HealthCheckError` with code `MONITOR_SHUTDOWN` if called after `shutdown()`.

```typescript
const all = monitor.getAllHealth();
for (const [id, health] of Object.entries(all)) {
  console.log(`${id}: ${health.state} (p95=${health.latency.p95}ms)`);
}
```

---

### `monitor.probe(providerId)`

Manually triggers an immediate probe of a specific provider, outside the periodic schedule. The probe result is recorded into the metrics window and may trigger state transitions and events.

```typescript
probe(providerId: string): Promise<ProbeResult>
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `providerId` | `string` | The provider's `id` |

**Returns:** `Promise<ProbeResult>`

```typescript
interface ProbeResult {
  success: boolean;       // Whether the probe succeeded (HTTP 2xx/3xx)
  latencyMs: number;      // Total response time in milliseconds
  ttfbMs?: number;        // Time to first byte in milliseconds
  statusCode?: number;    // HTTP status code
  error?: string;         // Error message if the probe failed
}
```

**Throws:** `HealthCheckError` with code `UNKNOWN_PROVIDER` if the provider is not registered, or `PROBE_FAILED` if the provider has no `probeFn` configured.

```typescript
const result = await monitor.probe('openai');
if (result.success) {
  console.log(`Latency: ${result.latencyMs}ms, TTFB: ${result.ttfbMs}ms`);
} else {
  console.log(`Probe failed: ${result.error}`);
}
```

---

### `monitor.reportSuccess(providerId, metrics)`

Reports a successful production request for passive monitoring. Records the latency into the metrics window and resets the consecutive failure counter.

```typescript
reportSuccess(providerId: string, metrics: SuccessMetrics): void
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `providerId` | `string` | The provider's `id` |
| `metrics` | `SuccessMetrics` | `{ latencyMs: number; ttfbMs?: number }` |

**Throws:** `HealthCheckError` with code `UNKNOWN_PROVIDER` or `MONITOR_SHUTDOWN`.

```typescript
const start = performance.now();
try {
  const response = await openai.chat.completions.create({ /* ... */ });
  monitor.reportSuccess('openai', { latencyMs: performance.now() - start });
} catch (error) {
  monitor.reportError('openai', error);
}
```

---

### `monitor.reportError(providerId, error)`

Reports a failed production request for passive monitoring. The error is automatically classified as transient, permanent, or unknown. Permanent errors (400, 401, 403) do not increment the consecutive failure counter and do not count toward the error rate numerator. Transient errors (429, 502, 503, 504, network errors) increment consecutive failures and contribute to the error rate.

```typescript
reportError(providerId: string, error: unknown): void
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `providerId` | `string` | The provider's `id` |
| `error` | `unknown` | The error object. Status codes are extracted from `error.status`, `error.statusCode`, or `error.response.status`. Network error codes (`ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `EPIPE`) and timeout messages are recognized. |

**Throws:** `HealthCheckError` with code `UNKNOWN_PROVIDER` or `MONITOR_SHUTDOWN`.

---

### `monitor.shutdown()`

Full cleanup. Stops all probing, removes all event listeners, and clears all collected metrics data. After calling `shutdown()`, all other methods on the monitor will throw `HealthCheckError` with code `MONITOR_SHUTDOWN`.

```typescript
shutdown(): void
```

---

### `executeProbe(options)`

Low-level function that performs a single HTTP probe request using `node:http` or `node:https`. Measures total latency and time to first byte. Used internally by built-in providers, but exported for custom probe implementations.

```typescript
function executeProbe(options: ProbeRequestOptions): Promise<ProbeResult>
```

**Parameters:**

```typescript
interface ProbeRequestOptions {
  url: string;                       // Full URL to probe
  method: string;                    // HTTP method (GET, POST, etc.)
  headers: Record<string, string>;   // Request headers
  body?: string;                     // Optional request body
  timeoutMs: number;                 // Timeout in milliseconds
}
```

**Returns:** `Promise<ProbeResult>` -- never rejects; timeout and network errors are returned as `{ success: false, error: '...' }`.

```typescript
import { executeProbe } from 'ai-provider-healthcheck';

const result = await executeProbe({
  url: 'https://api.openai.com/v1/models',
  method: 'GET',
  headers: { Authorization: 'Bearer sk-...' },
  timeoutMs: 5000,
});
```

---

### `classifyError(error)`

Classifies an error object into `'transient'`, `'permanent'`, or `'unknown'`. Inspects `error.status`, `error.statusCode`, `error.response.status`, `error.response.statusCode`, `error.code`, and `error.message` to determine the classification.

```typescript
function classifyError(error: unknown): ErrorClassification
// ErrorClassification = 'transient' | 'permanent' | 'unknown'
```

| Classification | Status Codes | Network Codes |
|---|---|---|
| `transient` | 429, 502, 503, 504 | `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `EPIPE` |
| `permanent` | 400, 401, 403 | -- |
| `unknown` | Everything else | Everything else |

```typescript
import { classifyError } from 'ai-provider-healthcheck';

classifyError({ status: 429 });        // 'transient'
classifyError({ status: 401 });        // 'permanent'
classifyError({ code: 'ETIMEDOUT' });  // 'transient'
classifyError(new Error('unknown'));    // 'unknown'
```

---

### `classifyStatusCode(statusCode)`

Classifies an HTTP status code into an error classification.

```typescript
function classifyStatusCode(statusCode: number | undefined): ErrorClassification
```

```typescript
import { classifyStatusCode } from 'ai-provider-healthcheck';

classifyStatusCode(503); // 'transient'
classifyStatusCode(401); // 'permanent'
classifyStatusCode(500); // 'unknown'
classifyStatusCode(undefined); // 'unknown'
```

---

### `isBuiltInProvider(id)`

Type guard that checks whether a string is a recognized built-in provider id.

```typescript
function isBuiltInProvider(id: string): id is BuiltInProviderId
// BuiltInProviderId = 'openai' | 'anthropic' | 'google' | 'cohere' | 'mistral'
```

```typescript
import { isBuiltInProvider } from 'ai-provider-healthcheck';

isBuiltInProvider('openai');    // true
isBuiltInProvider('my-custom'); // false
```

---

### `createBuiltInProbeFn(definition, apiKey, baseUrl?, timeoutMs?)`

Creates a probe function for a built-in provider. Used internally when resolving built-in provider configurations, but exported for advanced customization.

```typescript
function createBuiltInProbeFn(
  definition: BuiltInProviderDefinition,
  apiKey: string,
  baseUrl?: string,
  timeoutMs?: number  // default: 10000
): () => Promise<ProbeResult>
```

```typescript
import { BUILT_IN_PROVIDERS, createBuiltInProbeFn } from 'ai-provider-healthcheck';

const probeFn = createBuiltInProbeFn(
  BUILT_IN_PROVIDERS.openai,
  'sk-...',
  'https://my-proxy.com',  // optional custom base URL
  5000                      // optional timeout
);
const result = await probeFn();
```

---

### `BUILT_IN_PROVIDERS`

A constant record mapping each `BuiltInProviderId` to its provider definition, including default base URL, probe path, HTTP method, and header builder.

```typescript
const BUILT_IN_PROVIDERS: Record<BuiltInProviderId, BuiltInProviderDefinition>
```

---

### `HealthCheckError`

Custom error class thrown by all monitor methods when an operation cannot be completed.

```typescript
class HealthCheckError extends Error {
  code: HealthCheckErrorCode;
  constructor(message: string, code: HealthCheckErrorCode);
}

type HealthCheckErrorCode =
  | 'UNKNOWN_PROVIDER'
  | 'PROBE_TIMEOUT'
  | 'PROBE_FAILED'
  | 'MONITOR_SHUTDOWN'
  | 'INVALID_CONFIG'
  | 'PROBE_CONFIG_ERROR';
```

---

### `MetricsCollector`

Ring buffer-based metrics collector that records probe samples and computes latency statistics, error rates, and error counts over a sliding time window.

```typescript
class MetricsCollector {
  constructor(maxSamples: number, windowMs: number);
  record(entry: SampleEntry): void;
  getLatencyStats(now?: number): LatencyStats;
  getErrorRate(now?: number): number | undefined;
  getErrorCounts(now?: number): { transient: number; permanent: number };
  getSampleCount(now?: number): number;
  clear(): void;
}
```

---

### `HealthStateMachine`

State machine that evaluates provider metrics and manages health state transitions with hysteresis.

```typescript
class HealthStateMachine {
  constructor(config: ResolvedMonitorConfig);
  getState(): HealthState;
  getStateChangedAt(): number;
  getConsecutiveFailures(): number;
  recordSuccess(): void;
  recordFailure(): void;
  evaluate(metrics: MetricsCollector, now?: number): StateEvaluation | null;
  forceState(state: HealthState, now?: number): void;
}
```

---

### `HealthMonitorImpl`

The concrete implementation of `HealthMonitor`, extending `EventEmitter`. Use `createMonitor()` to instantiate.

```typescript
class HealthMonitorImpl extends EventEmitter implements HealthMonitor {
  constructor(config: MonitorConfig);
  // All HealthMonitor methods
}
```

## Configuration

The `MonitorConfig` object is passed to `createMonitor()`. All fields except `providers` are optional and have sensible defaults.

```typescript
interface MonitorConfig {
  providers: ProviderConfig[];           // Required. At least one provider.
  probeIntervalMs?: number;              // Default: 30000 (30s)
  probeTimeoutMs?: number;               // Default: 10000 (10s)
  degradedProbeIntervalMs?: number;      // Default: probeIntervalMs / 2
  metricsWindowMs?: number;              // Default: 300000 (5 minutes)
  maxSamplesPerProvider?: number;        // Default: 1000
  degradedErrorRate?: number;            // Default: 0.05 (5%)
  unhealthyErrorRate?: number;           // Default: 0.30 (30%)
  healthyErrorRate?: number;             // Default: 0.02 (2%)
  degradedLatencyMs?: number;            // Default: 5000 (5s)
  healthyLatencyMs?: number;             // Default: 3000 (3s)
  unhealthyAfterConsecutiveFailures?: number; // Default: 3
  stateChangeMinSamples?: number;        // Default: 3 (hysteresis)
  latencySpikeMultiplier?: number;       // Default: 3.0
  autoStart?: boolean;                   // Default: false
  fetchFn?: typeof fetch;               // Custom fetch implementation
}
```

| Option | Default | Description |
|---|---|---|
| `probeIntervalMs` | `30000` | Milliseconds between active probes for healthy providers |
| `probeTimeoutMs` | `10000` | Maximum time to wait for a probe response |
| `degradedProbeIntervalMs` | `probeIntervalMs / 2` | Probe interval when a provider is degraded or unhealthy |
| `metricsWindowMs` | `300000` | Sliding window size for latency and error rate calculations |
| `maxSamplesPerProvider` | `1000` | Maximum samples retained per provider (ring buffer) |
| `degradedErrorRate` | `0.05` | Error rate threshold to transition to `degraded` |
| `unhealthyErrorRate` | `0.30` | Error rate threshold to transition to `unhealthy` |
| `healthyErrorRate` | `0.02` | Error rate must drop below this to recover to `healthy` |
| `degradedLatencyMs` | `5000` | p95 latency threshold to transition to `degraded` |
| `healthyLatencyMs` | `3000` | p95 latency must drop below this to recover to `healthy` |
| `unhealthyAfterConsecutiveFailures` | `3` | Consecutive probe failures to transition directly to `unhealthy` |
| `stateChangeMinSamples` | `3` | Number of consistent evaluations required before a state transition (hysteresis) |
| `latencySpikeMultiplier` | `3.0` | Latency spike is detected when latency exceeds `p95 * multiplier` |
| `autoStart` | `false` | Whether to start periodic probing immediately on construction |

### Provider Configuration

Built-in providers require only `id` and `apiKey`:

```typescript
interface BuiltInProviderConfig {
  id: BuiltInProviderId;               // 'openai' | 'anthropic' | 'google' | 'cohere' | 'mistral'
  apiKey: string;                       // API key for authentication
  name?: string;                        // Override the default display name
  baseUrl?: string;                     // Override the default base URL (for proxies)
  probeFn?: () => Promise<ProbeResult>; // Override the default probe function
  probeIntervalMs?: number;             // Override the global probe interval
  probeTimeoutMs?: number;              // Override the global probe timeout
}
```

Custom providers require `id` and `name`:

```typescript
interface CustomProviderConfig {
  id: string;                           // Unique identifier
  name: string;                         // Display name
  probeFn?: () => Promise<ProbeResult>; // Probe function (omit for passive-only monitoring)
  apiKey?: string;
  baseUrl?: string;
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
}
```

## Events

The monitor extends `EventEmitter` and emits the following events:

### `stateChange`

Emitted when a provider transitions between health states.

```typescript
monitor.on('stateChange', (event: StateChangeEvent) => {
  // event.provider  - provider id
  // event.from      - previous HealthState
  // event.to        - new HealthState
  // event.reason    - human-readable explanation
  // event.timestamp - ISO 8601 string
  // event.health    - full ProviderHealth snapshot
});
```

### `probe`

Emitted after every active probe completes, whether it succeeds or fails.

```typescript
monitor.on('probe', (event: ProbeEvent) => {
  // event.provider   - provider id
  // event.success    - boolean
  // event.latencyMs  - response time
  // event.ttfbMs     - time to first byte (if available)
  // event.statusCode - HTTP status code (if available)
  // event.error      - error message (if failed)
  // event.timestamp  - ISO 8601 string
});
```

### `latencySpike`

Emitted when a reported or probed latency exceeds `p95 * latencySpikeMultiplier`. Requires at least 5 samples in the window to establish a baseline.

```typescript
monitor.on('latencySpike', (event: LatencySpikeEvent) => {
  // event.provider    - provider id
  // event.latencyMs   - observed latency
  // event.p95Ms       - current p95 baseline
  // event.thresholdMs - spike threshold (p95 * multiplier)
  // event.timestamp   - ISO 8601 string
});
```

### `degraded`

Emitted when a provider transitions to the `degraded` state.

```typescript
monitor.on('degraded', (event: DegradedEvent) => {
  // event.provider  - provider id
  // event.reason    - explanation
  // event.errorRate - current error rate (or undefined)
  // event.p95Ms     - current p95 latency (or undefined)
  // event.timestamp - ISO 8601 string
});
```

### `recovered`

Emitted when a provider transitions from `degraded` or `unhealthy` back to `healthy`.

```typescript
monitor.on('recovered', (event: RecoveredEvent) => {
  // event.provider   - provider id
  // event.from       - 'degraded' | 'unhealthy'
  // event.downtimeMs - time spent in degraded/unhealthy state
  // event.timestamp  - ISO 8601 string
});
```

### `error`

Emitted for monitor-level errors, including permanent probe errors (e.g., 401 authentication failures) and listener errors.

```typescript
monitor.on('error', (event: MonitorError) => {
  // event.message  - error description
  // event.code     - HealthCheckErrorCode string
  // event.provider - provider id (if applicable)
  // event.cause    - original error (if applicable)
});
```

## Error Handling

All monitor methods throw `HealthCheckError` with a `code` property for programmatic error handling:

```typescript
import { HealthCheckError, createMonitor } from 'ai-provider-healthcheck';

const monitor = createMonitor({
  providers: [{ id: 'openai', apiKey: 'sk-...' }],
});

try {
  monitor.getHealth('nonexistent');
} catch (err) {
  if (err instanceof HealthCheckError) {
    switch (err.code) {
      case 'UNKNOWN_PROVIDER':
        console.log('Provider not registered');
        break;
      case 'MONITOR_SHUTDOWN':
        console.log('Monitor has been shut down');
        break;
      case 'INVALID_CONFIG':
        console.log('Invalid configuration');
        break;
      case 'PROBE_FAILED':
        console.log('Probe execution failed');
        break;
    }
  }
}
```

### Error Codes

| Code | When |
|---|---|
| `UNKNOWN_PROVIDER` | `getHealth`, `probe`, `reportSuccess`, or `reportError` called with an unregistered provider id |
| `MONITOR_SHUTDOWN` | Any method called after `shutdown()`, or `start()` called after `shutdown()` |
| `INVALID_CONFIG` | Empty providers array, missing provider id, or duplicate provider ids |
| `PROBE_FAILED` | `probe()` called on a provider with no `probeFn` configured |
| `PROBE_TIMEOUT` | A probe request exceeded the configured timeout |
| `PROBE_CONFIG_ERROR` | A probe returned a permanent error (401, 403, 400), emitted via the `error` event |

### Error Classification

Errors reported via `reportError()` and probe failures are automatically classified to determine their impact on health state:

- **Transient** errors (429, 502, 503, 504, `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `EPIPE`) increment consecutive failures and count toward the error rate. These indicate temporary provider issues.
- **Permanent** errors (400, 401, 403) are tracked separately. They do not increment consecutive failures and do not count toward the error rate numerator. These typically indicate configuration issues (wrong API key, malformed request).
- **Unknown** errors are treated as transient for error rate and consecutive failure purposes.

## Health States

| State | Meaning | Transition Triggers |
|---|---|---|
| `unknown` | No data collected yet. Initial state before the first probe or report. | First sample transitions to `healthy` (success) or `unhealthy` (failure). |
| `healthy` | Normal operation. Latency and error rate within configured thresholds. | Transitions to `degraded` when error rate exceeds `degradedErrorRate` or p95 exceeds `degradedLatencyMs`. |
| `degraded` | Elevated latency or error rate. Provider is responding but not performing optimally. | Transitions to `unhealthy` when error rate exceeds `unhealthyErrorRate`. Recovers to `healthy` when error rate drops below `healthyErrorRate` and p95 drops below `healthyLatencyMs`. |
| `unhealthy` | High error rate or unreachable. Requests to this provider are likely to fail. | Recovers to `healthy` when metrics improve past healthy thresholds with consistent readings. Also triggered by `unhealthyAfterConsecutiveFailures` consecutive failures. |

The state machine uses hysteresis controlled by `stateChangeMinSamples` to prevent rapid flapping. A transition requires the same target state for that many consecutive evaluations before it takes effect. The exception is the `unknown` to initial state transition (immediate) and consecutive failure-triggered unhealthy transitions (bypass hysteresis).

## Advanced Usage

### Passive-Only Monitoring

Monitor provider health without active probing by omitting the `probeFn`. Useful when you want to track health based solely on production traffic:

```typescript
const monitor = createMonitor({
  providers: [
    { id: 'openai', name: 'OpenAI' },  // No probeFn, no apiKey
  ],
});

// Report outcomes from your production calls
monitor.reportSuccess('openai', { latencyMs: 200 });
monitor.reportError('openai', { status: 503 });

const health = monitor.getHealth('openai');
```

### Custom Base URL (Proxy Support)

Route probes through a proxy or custom endpoint:

```typescript
const monitor = createMonitor({
  providers: [
    {
      id: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
      baseUrl: 'https://my-openai-proxy.internal',
    },
  ],
});
```

### Multi-Provider Health Dashboard

```typescript
const monitor = createMonitor({
  providers: [
    { id: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    { id: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
    { id: 'google', apiKey: process.env.GOOGLE_API_KEY! },
    { id: 'cohere', apiKey: process.env.COHERE_API_KEY! },
    { id: 'mistral', apiKey: process.env.MISTRAL_API_KEY! },
  ],
  probeIntervalMs: 15_000,
  metricsWindowMs: 600_000,
});

monitor.on('stateChange', ({ provider, from, to, reason }) => {
  console.log(`[${new Date().toISOString()}] ${provider}: ${from} -> ${to} -- ${reason}`);
});

monitor.on('latencySpike', ({ provider, latencyMs, p95Ms }) => {
  console.log(`[SPIKE] ${provider}: ${latencyMs}ms (p95 baseline: ${p95Ms}ms)`);
});

monitor.on('recovered', ({ provider, from, downtimeMs }) => {
  console.log(`[RECOVERED] ${provider}: was ${from} for ${(downtimeMs / 1000).toFixed(1)}s`);
});

monitor.start();

// Periodic status dump
setInterval(() => {
  const all = monitor.getAllHealth();
  for (const [id, h] of Object.entries(all)) {
    console.log(`${id}: ${h.state} | p95=${h.latency.p95 ?? '-'}ms | err=${((h.errorRate ?? 0) * 100).toFixed(1)}%`);
  }
}, 60_000);
```

### Failover Routing

Use health data to select the best provider for each request:

```typescript
function selectProvider(monitor: HealthMonitor, providerIds: string[]): string | null {
  const all = monitor.getAllHealth();
  const healthy = providerIds
    .filter((id) => all[id]?.state === 'healthy')
    .sort((a, b) => (all[a].latency.p95 ?? Infinity) - (all[b].latency.p95 ?? Infinity));

  if (healthy.length > 0) return healthy[0];

  const degraded = providerIds.filter((id) => all[id]?.state === 'degraded');
  if (degraded.length > 0) return degraded[0];

  return null;
}
```

### Graceful Shutdown

```typescript
process.on('SIGTERM', () => {
  monitor.shutdown(); // Stops probes, removes listeners, clears data
  process.exit(0);
});
```

## Built-in Providers

| Provider | Probe Endpoint | Method | Tokens Used |
|---|---|---|---|
| `openai` | `GET /v1/models` | GET | 0 |
| `anthropic` | `POST /v1/messages` | POST | ~2 |
| `google` | `GET /v1beta/models` | GET | 0 |
| `cohere` | `GET /v1/models` | GET | 0 |
| `mistral` | `GET /v1/models` | GET | 0 |

All built-in probes except Anthropic use zero-cost model listing endpoints. The Anthropic probe sends a minimal message (`"."`, `max_tokens: 1`) because Anthropic does not expose a free health check endpoint.

## TypeScript

This package is written in TypeScript with strict mode enabled and ships with full type declarations. All types are exported from the package entry point:

```typescript
import type {
  HealthState,
  BuiltInProviderId,
  ProbeResult,
  BuiltInProviderConfig,
  CustomProviderConfig,
  ProviderConfig,
  SuccessMetrics,
  LatencyStats,
  ProviderHealth,
  StateChangeEvent,
  ProbeEvent,
  LatencySpikeEvent,
  DegradedEvent,
  RecoveredEvent,
  MonitorError,
  MonitorConfig,
  ResolvedMonitorConfig,
  HealthCheckErrorCode,
  HealthMonitor,
  ErrorClassification,
  SampleEntry,
  ResolvedProvider,
} from 'ai-provider-healthcheck';
```

## License

MIT

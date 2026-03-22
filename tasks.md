# ai-provider-healthcheck -- Task Breakdown

This file tracks all implementation tasks derived from [SPEC.md](./SPEC.md). Each task is granular and actionable. Tasks are grouped by implementation phase.

---

## Phase 1: Project Scaffolding and Configuration

- [x] **Install dev dependencies** — Add `typescript`, `vitest`, `eslint`, and `@types/node` as dev dependencies in `package.json`. Ensure versions are compatible with Node.js 18+ and ES2022 target. | Status: done
- [ ] **Add CLI bin entry to package.json** — Add `"bin": { "ai-provider-healthcheck": "dist/cli.js" }` to `package.json` so the CLI is available after global install or via npx. | Status: not_done
- [x] **Create vitest config** — Create a `vitest.config.ts` (or add config to `package.json`) that handles the test directory structure under `src/__tests__/`. | Status: done
- [x] **Create eslint config** — Add an ESLint configuration file (`.eslintrc` or `eslint.config.js`) appropriate for the TypeScript project. | Status: done
- [ ] **Create directory structure** — Create all directories specified in the file structure: `src/probes/`, `src/__tests__/`, `src/__tests__/probes/`, `src/__tests__/integration/`. | Status: not_done

---

## Phase 2: Type Definitions (`src/types.ts`)

- [x] **Define `HealthState` type** — `type HealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'`. | Status: done
- [x] **Define `ProbeResult` interface** — Fields: `success` (boolean), `latencyMs` (number), `ttfbMs?` (number), `statusCode?` (number), `error?` (string). | Status: done
- [x] **Define `SuccessMetrics` interface** — Fields: `latencyMs` (number, required), `ttfbMs?` (number, optional). | Status: done
- [x] **Define `BuiltInProviderConfig` interface** — Fields: `id` (union of built-in IDs), `apiKey` (string), `name?`, `baseUrl?`, `probeFn?`, `probeIntervalMs?`, `probeTimeoutMs?`. | Status: done
- [x] **Define `CustomProviderConfig` interface** — Fields: `id` (string), `name` (string, required), `probeFn?`, `apiKey?`, `baseUrl?`, `probeIntervalMs?`, `probeTimeoutMs?`. | Status: done
- [x] **Define `ProviderConfig` union type** — `type ProviderConfig = BuiltInProviderConfig | CustomProviderConfig`. | Status: done
- [x] **Define `LatencyStats` interface** — Fields: `p50`, `p95`, `p99`, `mean`, `min`, `max`, `stddev` (all `number | undefined`), `sampleCount` (number). | Status: done
- [x] **Define `ProviderHealth` interface** — Fields: `provider`, `name`, `state`, `stateAge`, `stateChangedAt`, `latency` (LatencyStats), `errorRate`, `sampleCount`, `consecutiveFailures`, `lastProbeAt`, `lastProbeResult`, `lastSuccessAt`, `lastErrorAt`, `permanentErrors`, `transientErrors`. | Status: done
- [x] **Define `StateChangeEvent` interface** — Fields: `provider`, `from`, `to`, `reason`, `timestamp`, `health`. | Status: done
- [x] **Define `ProbeEvent` interface** — Fields: `provider`, `success`, `latencyMs`, `ttfbMs?`, `statusCode?`, `error?`, `timestamp`. | Status: done
- [x] **Define `LatencySpikeEvent` interface** — Fields: `provider`, `latencyMs`, `p95Ms`, `thresholdMs`, `timestamp`. | Status: done
- [x] **Define `DegradedEvent` interface** — Fields: `provider`, `reason`, `errorRate`, `p95Ms`, `timestamp`. | Status: done
- [x] **Define `RecoveredEvent` interface** — Fields: `provider`, `from` ('degraded' | 'unhealthy'), `downtimeMs`, `timestamp`. | Status: done
- [x] **Define `MonitorError` interface** — Fields: `message`, `code`, `provider?`, `cause?`. | Status: done
- [x] **Define `MonitorConfig` interface** — All fields from the spec: `providers`, `probeIntervalMs`, `probeTimeoutMs`, `degradedProbeIntervalMs`, `metricsWindowMs`, `maxSamplesPerProvider`, all error rate thresholds, latency thresholds, `unhealthyAfterConsecutiveFailures`, `stateChangeMinSamples`, `latencySpikeMultiplier`, `autoStart`, `fetchFn`. Include defaults in JSDoc comments. | Status: done
- [x] **Define `HealthMonitor` interface** — Methods: `start()`, `stop()`, `getHealth()`, `getAllHealth()`, `probe()`, `reportSuccess()`, `reportError()`, `shutdown()`. EventEmitter overloads for `on`/`off`/`removeAllListeners` with typed events. | Status: done
- [x] **Define `HealthCheckError` class** — Extends `Error`. Has `code` property with union type: `'UNKNOWN_PROVIDER' | 'PROBE_TIMEOUT' | 'PROBE_FAILED' | 'MONITOR_SHUTDOWN' | 'INVALID_CONFIG' | 'PROBE_CONFIG_ERROR'`. | Status: done

---

## Phase 3: Core Metrics Engine (`src/metrics.ts`)

- [x] **Implement timestamped ring buffer** — Create a `RingBuffer` class (or equivalent) that stores timestamped entries with fields: `timestamp` (number), `latencyMs` (number | undefined), `ttfbMs` (number | undefined), `isError` (boolean), `errorType` ('transient' | 'permanent' | 'unknown' | undefined). Support a configurable max size (`maxSamplesPerProvider`, default 1000). When full, evict the oldest entry. | Status: done
- [x] **Implement sliding window pruning** — When reading samples, filter out entries older than `now - metricsWindowMs`. Pruning is lazy (on read, not on a timer). | Status: done
- [x] **Implement percentile computation** — Given the in-window latency samples, sort them and compute p50, p95, p99 using the floor-index method: `sample at index floor(N * percentile)`. Return `undefined` when no samples exist. | Status: done
- [x] **Implement mean/min/max/stddev computation** — Compute arithmetic mean, minimum, maximum, and standard deviation over the in-window latency samples. Return `undefined` for stddev when fewer than 2 samples. | Status: done
- [x] **Implement error rate computation** — Compute `errors_in_window / total_events_in_window`. Return `undefined` when total events is zero. Only count transient and unknown errors toward the error rate; permanent errors do not contribute. | Status: done
- [x] **Implement `addSuccess` method** — Add a successful event to the ring buffer with timestamp and latency data. | Status: done
- [x] **Implement `addError` method** — Add an error event to the ring buffer with timestamp and error classification. | Status: done
- [x] **Implement `getLatencyStats` method** — Return a `LatencyStats` object computed from in-window samples. | Status: done
- [x] **Implement `getErrorRate` method** — Return the current error rate from in-window samples. | Status: done
- [x] **Implement `getSampleCount` method** — Return the count of in-window events. | Status: done
- [x] **Implement permanent/transient error counts** — Return counts of permanent and transient errors within the window. | Status: done

---

## Phase 4: Error Classifier (`src/error-classifier.ts`)

- [x] **Implement `extractStatusCode` function** — Extract HTTP status code from error objects. Check `error.status`, `error.statusCode`, `error.response.status`, `error.response.statusCode` to cover OpenAI SDK, Anthropic SDK, and raw fetch error shapes. Return `undefined` if no status code found. | Status: done
- [x] **Implement `isNetworkError` function** — Detect network errors by checking for `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED` in `error.code` or `error.cause.code`. | Status: done
- [x] **Implement `classifyError` function** — Classify errors: HTTP 429/502/503/504 and network errors as `'transient'`; HTTP 400/401/403 as `'permanent'`; everything else as `'unknown'`. | Status: done

---

## Phase 5: Health State Machine (`src/health-state.ts`)

- [x] **Implement health state container** — Store current state, state change timestamp, consecutive failure count, and a sample counter for hysteresis. | Status: done
- [x] **Implement `unknown -> healthy` transition** — Trigger on first successful probe or traffic report. | Status: done
- [x] **Implement `unknown -> unhealthy` transition** — Trigger when first probe fails. | Status: done
- [x] **Implement `healthy -> degraded` transition** — Trigger when rolling error rate exceeds `degradedErrorRate` OR p95 latency exceeds `degradedLatencyMs`. Require `stateChangeMinSamples` samples before evaluating. | Status: done
- [x] **Implement `degraded -> unhealthy` transition** — Trigger when rolling error rate exceeds `unhealthyErrorRate` OR consecutive probe failures exceed `unhealthyAfterConsecutiveFailures`. | Status: done
- [x] **Implement `degraded -> healthy` transition** — Trigger when error rate drops below `healthyErrorRate` AND p95 latency drops below `healthyLatencyMs`. Both conditions must be met. | Status: done
- [x] **Implement `unhealthy -> healthy` transition** — Same conditions as `degraded -> healthy`. Recovery requires sustained good performance. | Status: done
- [x] **Implement `unhealthy -> degraded` transition** — Trigger when at least one probe succeeds but error rate or latency still exceeds healthy thresholds. | Status: done
- [x] **Implement hysteresis / flap prevention** — Require the triggering condition to persist for `stateChangeMinSamples` consecutive evaluation cycles before allowing a transition. A single failed probe should not immediately degrade a healthy provider. | Status: done
- [x] **Implement consecutive failure tracking** — Increment on each probe failure, reset to zero on any successful probe. Transition to `unhealthy` when count exceeds `unhealthyAfterConsecutiveFailures`. | Status: done
- [x] **Implement `evaluate` method** — Given current metrics (error rate, p95 latency, consecutive failures, sample count), compute the correct state and return the transition if one occurred, including the reason string. | Status: done

---

## Phase 6: Provider Registry (`src/provider.ts`)

- [x] **Define built-in provider defaults** — Create a registry object mapping provider IDs (`'openai'`, `'anthropic'`, `'google'`, `'cohere'`, `'mistral'`) to their defaults: display name, base URL, probe endpoint, HTTP method, auth header format. | Status: done
- [x] **Implement provider config resolution** — Merge caller-provided config on top of built-in defaults. Handle overrides for `baseUrl`, `name`, `probeIntervalMs`, `probeTimeoutMs`, `probeFn`. | Status: done
- [x] **Implement custom provider registration** — Accept providers with arbitrary `id` and caller-provided `probeFn`. Require `name` for custom providers. Support passive-only mode (no `probeFn`, no `apiKey`). | Status: done
- [ ] **Implement configuration validation** — Validate all rules from Section 12: non-empty providers array, unique IDs, built-in providers require `apiKey` or `probeFn`, custom providers require `name`, numeric thresholds are positive, threshold ordering is correct (`healthyErrorRate < degradedErrorRate < unhealthyErrorRate`, `healthyLatencyMs < degradedLatencyMs`), `probeTimeoutMs < probeIntervalMs`. Throw `HealthCheckError` with code `INVALID_CONFIG` and actionable messages. | Status: not_done

---

## Phase 7: Built-In Probe Functions (`src/probes/`)

- [x] **Implement OpenAI probe (`src/probes/openai.ts`)** — `GET /v1/models` with `Authorization: Bearer <key>` header. Measure TTFB and full response time using `performance.now()`. Use `AbortController` for timeout. Return `ProbeResult`. | Status: done
- [x] **Implement Anthropic probe (`src/probes/anthropic.ts`)** — `POST /v1/messages` with `x-api-key: <key>` header and minimal payload: `{ model: "claude-haiku-4-20250514", max_tokens: 1, messages: [{ role: "user", content: "." }] }`. Measure latency. Use `AbortController` for timeout. Return `ProbeResult`. | Status: done
- [x] **Implement Google Gemini probe (`src/probes/google.ts`)** — `GET /v1beta/models` with `x-goog-api-key: <key>` header. Measure latency. Use `AbortController` for timeout. Return `ProbeResult`. | Status: done
- [x] **Implement Cohere probe (`src/probes/cohere.ts`)** — `GET /v1/models` with `Authorization: Bearer <key>` header. Measure latency. Use `AbortController` for timeout. Return `ProbeResult`. | Status: done
- [x] **Implement Mistral probe (`src/probes/mistral.ts`)** — `GET /v1/models` with `Authorization: Bearer <key>` header. Measure latency. Use `AbortController` for timeout. Return `ProbeResult`. | Status: done
- [x] **Implement shared probe helper** — Extract common probe logic (timing, AbortController, error handling, ProbeResult construction) into a shared utility to avoid duplication across the five probe files. | Status: done

---

## Phase 8: Health Monitor (`src/monitor.ts`)

- [x] **Implement `HealthMonitor` class extending EventEmitter** — Create the main class that wires together provider registry, metrics engine, health state machine, and probe scheduling. | Status: done
- [x] **Implement `createMonitor(config)` factory function** — Validate config, resolve provider configurations, instantiate per-provider metrics and health state, return the monitor instance. Support `autoStart` option. | Status: done
- [x] **Implement `start()` method** — Begin periodic probing. Schedule the first probe for each provider immediately (staggered within the first second). Use `setTimeout` with `.unref()`. Mark monitor as started. No-op if already started. | Status: done
- [x] **Implement probe staggering** — Distribute probe start times across the interval. For N providers with interval T, probes fire at approximately `t=0, t=T/N, t=2T/N, ...` to avoid burst traffic. | Status: done
- [x] **Implement probe scheduling loop** — After each probe completes, schedule the next probe using `setTimeout`. Do not use `setInterval`. This prevents probe pile-up if a probe takes longer than the interval. | Status: done
- [x] **Implement `stop()` method** — Clear all pending probe timers. Allow in-flight probes to complete but discard results if `stop()` was called. No-op if already stopped. Do not clear accumulated health data. | Status: done
- [x] **Implement `getHealth(providerId)` method** — Return a `ProviderHealth` object for the specified provider. Compute latency stats, error rate, state age, and all other fields on demand. Throw `HealthCheckError` with code `UNKNOWN_PROVIDER` if the provider ID is not registered. | Status: done
- [x] **Implement `getAllHealth()` method** — Return `Record<string, ProviderHealth>` for all registered providers. | Status: done
- [x] **Implement `probe(providerId)` method** — Manually trigger a single probe. Incorporate the result into metrics and health state. Do not reset or interfere with periodic schedule. Return the `ProbeResult`. Throw `HealthCheckError` with code `UNKNOWN_PROVIDER` for unregistered providers. | Status: done
- [x] **Implement `reportSuccess(providerId, metrics)` method** — Record a successful traffic event into the provider's metrics (latency, TTFB). Trigger health state re-evaluation. Silently ignore unknown provider IDs (do not throw). | Status: done
- [x] **Implement `reportError(providerId, error)` method** — Classify the error, record it into the provider's metrics. Trigger health state re-evaluation. Silently ignore unknown provider IDs (do not throw). | Status: done
- [x] **Implement `shutdown()` method** — Stop all probing, remove all event listeners, clear all timers. Mark monitor as shut down. Subsequent `start()` calls throw `HealthCheckError` with code `MONITOR_SHUTDOWN`. | Status: done
- [x] **Implement adaptive probe interval** — When a provider transitions to `degraded` or `unhealthy`, switch to `degradedProbeIntervalMs` (default: `probeIntervalMs / 2`). When the provider recovers to `healthy`, revert to normal interval. | Status: done
- [x] **Implement probe timeout with AbortController** — Each probe has a per-probe timeout (`probeTimeoutMs`). If the probe does not complete in time, abort via `AbortController` and record as a failure with error code `PROBE_TIMEOUT`. | Status: done
- [x] **Implement discarding results after stop** — If `stop()` is called while probes are in-flight, ensure their results are not incorporated into metrics when they resolve. | Status: done

---

## Phase 9: Event Emission

- [x] **Emit `stateChange` event** — Fire on every health state transition with `StateChangeEvent` payload (provider, from, to, reason, timestamp, health snapshot). Do not fire on initial `unknown` state assignment. Fire once when `unknown` transitions to the first observed state. | Status: done
- [x] **Emit `probe` event** — Fire after every active probe (periodic or manual) with `ProbeEvent` payload. Do not fire for passive traffic reports (`reportSuccess`/`reportError`). | Status: done
- [x] **Emit `error` event** — Fire on internal monitor errors (e.g., probe function throws unexpectedly, event handler throws, timer setup fails). The monitor must continue operating after emitting this event. | Status: done
- [x] **Emit `latencySpike` event** — Fire when a single request's latency exceeds `p95 * latencySpikeMultiplier`. Do not fire when fewer than `stateChangeMinSamples` samples exist. Fire for both active probes and `reportSuccess` calls. | Status: done
- [x] **Emit `degraded` event** — Convenience event fired when transitioning to `degraded`. Include `provider`, `reason`, `errorRate`, `p95Ms`, `timestamp`. | Status: done
- [x] **Emit `recovered` event** — Convenience event fired when transitioning from `degraded` or `unhealthy` to `healthy`. Include `provider`, `from`, `downtimeMs`, `timestamp`. | Status: done
- [x] **Handle `probeConfigError` for permanent errors** — When a probe returns a permanent error (401/403), emit an `error` event with code `PROBE_CONFIG_ERROR` instead of marking the provider unhealthy. | Status: done

---

## Phase 10: CLI (`src/cli.ts`)

- [ ] **Implement CLI entry point** — Add shebang (`#!/usr/bin/env node`), parse arguments using `util.parseArgs` (Node.js 18+ built-in). | Status: not_done
- [ ] **Implement `status` command** — One-shot health check: probe all configured providers once and print results. Detect providers from `--providers` flag or auto-detect from environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `COHERE_API_KEY`, `MISTRAL_API_KEY`). | Status: not_done
- [ ] **Implement `status` human output format** — Print a human-readable table showing provider name, state (HEALTHY/DEGRADED/ERROR), latency, and status symbol. Include a summary line. | Status: not_done
- [ ] **Implement `status` JSON output format** — When `--format json` is passed, output a JSON object with per-provider probe results and health states. | Status: not_done
- [ ] **Implement `status --quiet` mode** — Suppress all output; communicate health state only via exit code. | Status: not_done
- [ ] **Implement `status --timeout` option** — Accept per-probe timeout in milliseconds. Default: 10000. | Status: not_done
- [ ] **Implement `watch` command** — Continuous monitoring: start the monitor, print a live-updating table at each probe cycle. Accept `--interval`, `--timeout`, `--providers`, `--format` options. | Status: not_done
- [ ] **Implement `watch` human output format** — Print an updating table with columns: Provider, State, p50, p95, p99, Error Rate, Last Probe. Log state change events below the table with timestamps. | Status: not_done
- [ ] **Implement `watch` JSON output format** — When `--format json` is passed with `watch`, output newline-delimited JSON objects for each probe cycle and state change event. | Status: not_done
- [ ] **Implement CLI exit codes** — Exit `0` when all providers are healthy, `1` when any provider is degraded or unhealthy, `2` for configuration/usage errors (missing API keys, invalid flags). | Status: not_done
- [ ] **Implement CLI version display** — Print package version in the output header (read from `package.json`). | Status: not_done
- [ ] **Implement CLI error handling** — Handle missing API keys gracefully with a clear error message and exit code 2. Handle unknown commands or invalid flags. | Status: not_done

---

## Phase 11: Public API Exports (`src/index.ts`)

- [x] **Export `createMonitor` factory function** — The primary entry point for the library. | Status: done
- [x] **Export all type definitions** — Export all interfaces and types: `MonitorConfig`, `ProviderConfig`, `BuiltInProviderConfig`, `CustomProviderConfig`, `ProbeResult`, `ProviderHealth`, `HealthState`, `LatencyStats`, `SuccessMetrics`, `StateChangeEvent`, `ProbeEvent`, `LatencySpikeEvent`, `DegradedEvent`, `RecoveredEvent`, `MonitorError`, `HealthMonitor`. | Status: done
- [x] **Export `HealthCheckError` class** — So consumers can catch typed errors. | Status: done

---

## Phase 12: Unit Tests

### Monitor Creation Tests (`src/__tests__/monitor.test.ts`)

- [x] **Test: createMonitor with valid config returns HealthMonitor** — Verify the returned object has all expected methods: `start`, `stop`, `getHealth`, `getAllHealth`, `probe`, `reportSuccess`, `reportError`, `shutdown`, `on`, `off`. | Status: done
- [x] **Test: createMonitor with empty providers throws INVALID_CONFIG** — Pass `providers: []` and verify `HealthCheckError` with code `INVALID_CONFIG`. | Status: done
- [x] **Test: createMonitor with duplicate provider IDs throws** — Pass two providers with the same `id` and verify the error. | Status: done
- [ ] **Test: createMonitor with invalid threshold ordering throws** — Pass `healthyErrorRate > degradedErrorRate` and verify the error. | Status: not_done
- [ ] **Test: createMonitor with invalid latency threshold ordering throws** — Pass `healthyLatencyMs > degradedLatencyMs` and verify the error. | Status: not_done
- [ ] **Test: built-in provider without apiKey or probeFn throws** — Register `{ id: 'openai' }` without `apiKey` or `probeFn`. | Status: not_done
- [ ] **Test: custom provider without name throws** — Register `{ id: 'my-llm' }` without `name`. | Status: not_done
- [ ] **Test: probeTimeoutMs greater than probeIntervalMs throws** — Verify the validation error. | Status: not_done
- [ ] **Test: error rate thresholds outside [0,1] throw** — Verify that `degradedErrorRate: 1.5` throws. | Status: not_done
- [x] **Test: autoStart option starts probing immediately** — Pass `autoStart: true` and verify probes begin without calling `start()`. | Status: done

### Probe Scheduling Tests (`src/__tests__/monitor.test.ts`)

- [x] **Test: start() schedules probes for all providers** — Verify timers are created for each provider. | Status: done
- [ ] **Test: probes are staggered across the interval** — Verify probe start times are distributed, not simultaneous. | Status: not_done
- [ ] **Test: stop() clears all probe timers** — Verify no probes fire after stop(). | Status: not_done
- [ ] **Test: start() after stop() resumes probing** — Verify probes fire again after restarting. | Status: not_done
- [x] **Test: start() when already started is a no-op** — Verify no duplicate timers are created. | Status: done
- [x] **Test: stop() when already stopped is a no-op** — Verify no error is thrown. | Status: done
- [x] **Test: shutdown() makes subsequent start() throw** — Verify `HealthCheckError` with code `MONITOR_SHUTDOWN`. | Status: done
- [ ] **Test: probe timers use unref()** — Verify that timers do not prevent process exit. | Status: not_done

### Health State Transition Tests (`src/__tests__/health-state.test.ts`)

- [x] **Test: provider starts in unknown state** — Verify `getHealth().state === 'unknown'` before any probe. | Status: done
- [x] **Test: unknown -> healthy on first successful probe** — Verify state transition after first success. | Status: done
- [x] **Test: unknown -> unhealthy on first failed probe** — Verify state transition after first failure. | Status: done
- [x] **Test: healthy -> degraded on error rate exceeding degradedErrorRate** — Send enough mixed results to push error rate above 5%. | Status: done
- [x] **Test: healthy -> degraded on p95 latency exceeding degradedLatencyMs** — Send probes with high latency values. | Status: done
- [x] **Test: degraded -> unhealthy on error rate exceeding unhealthyErrorRate** — Push error rate above 30%. | Status: done
- [x] **Test: degraded -> unhealthy on consecutive probe failures** — Fail 3 consecutive probes (default threshold). | Status: done
- [x] **Test: degraded -> healthy on recovery** — Error rate drops below 2% AND p95 latency drops below 3000ms. | Status: done
- [x] **Test: unhealthy -> healthy on sustained recovery** — Verify recovery requires sustained good performance. | Status: done
- [ ] **Test: unhealthy -> degraded on partial recovery** — At least one probe succeeds but metrics still exceed healthy thresholds. | Status: not_done
- [x] **Test: hysteresis prevents flapping** — A single failed probe does not transition healthy to degraded when `stateChangeMinSamples > 1`. | Status: done
- [x] **Test: consecutive failure counter resets on success** — After 2 consecutive failures, one success resets the counter. | Status: done

### Latency Tracking Tests (`src/__tests__/metrics.test.ts`)

- [x] **Test: p50/p95/p99 are undefined when no samples exist** — Verify `getLatencyStats()` returns undefined percentiles. | Status: done
- [x] **Test: percentile computation with known inputs** — Insert 10 samples with known latencies, verify p50/p95/p99 match hand-computed expected values. | Status: done
- [x] **Test: samples outside metrics window are excluded** — Insert old samples, advance time, verify they are not included in computations. | Status: done
- [x] **Test: ring buffer evicts oldest entry at capacity** — Fill buffer to `maxSamplesPerProvider`, add one more, verify the oldest is gone. | Status: done
- [x] **Test: mean/min/max/stddev computation** — Insert known values, verify statistics are computed correctly. | Status: done
- [x] **Test: stddev is undefined with fewer than 2 samples** — Verify edge case handling. | Status: done
- [x] **Test: sampleCount returns correct count of in-window samples** — Verify count after insertions and time advancement. | Status: done

### Error Rate Tests (`src/__tests__/metrics.test.ts`)

- [x] **Test: error rate is undefined with no events** — Verify initial state. | Status: done
- [x] **Test: error rate computation with known inputs** — 5 errors out of 100 events = 0.05. | Status: done
- [x] **Test: permanent errors (401, 403) do not contribute to error rate** — Insert permanent errors, verify they are excluded from the error rate numerator. | Status: done
- [x] **Test: transient errors (429, 503, timeout) contribute to error rate** — Verify they are included. | Status: done
- [x] **Test: events outside metrics window are excluded from error rate** — Advance time, verify old events are pruned. | Status: done
- [x] **Test: permanent and transient error counts** — Verify `permanentErrors` and `transientErrors` fields return correct counts. | Status: done

### Error Classification Tests (`src/__tests__/error-classifier.test.ts`)

- [x] **Test: HTTP 429 is classified as transient** — Verify classification. | Status: done
- [x] **Test: HTTP 502, 503, 504 are classified as transient** — Verify each status code. | Status: done
- [x] **Test: Network errors (ETIMEDOUT, ECONNRESET, ECONNREFUSED) are classified as transient** — Verify error code detection. | Status: done
- [x] **Test: HTTP 401, 403 are classified as permanent** — Verify classification. | Status: done
- [x] **Test: HTTP 400 is classified as permanent** — Verify classification. | Status: done
- [x] **Test: Unknown error shapes are classified as unknown** — Verify fallback. | Status: done
- [x] **Test: extractStatusCode handles various error shapes** — Test with `{ status: 429 }`, `{ statusCode: 503 }`, `{ response: { status: 401 } }`, `{ response: { statusCode: 403 } }`. | Status: done

### Event Emission Tests (`src/__tests__/events.test.ts`)

- [x] **Test: stateChange fires with correct payload on transition** — Verify `from`, `to`, `reason`, `timestamp`, and `health` snapshot. | Status: done
- [ ] **Test: stateChange does not fire when state is unchanged** — Re-evaluate health without a transition, verify no event. | Status: not_done
- [ ] **Test: stateChange does not fire on initial unknown assignment** — Verify no event before the first probe. | Status: not_done
- [x] **Test: probe event fires after every periodic probe** — Verify `success`, `latencyMs`, `statusCode`, `timestamp`. | Status: done
- [x] **Test: probe event fires after manual probe** — Verify `monitor.probe()` emits a probe event. | Status: done
- [x] **Test: latencySpike fires when threshold exceeded** — Insert samples to establish p95, then insert one above `p95 * latencySpikeMultiplier`. | Status: done
- [ ] **Test: latencySpike does not fire with insufficient samples** — Fewer than `stateChangeMinSamples` samples should suppress spike detection. | Status: not_done
- [x] **Test: degraded event fires on transition to degraded** — Verify event payload includes `provider`, `reason`, `errorRate`, `p95Ms`. | Status: done
- [x] **Test: recovered event fires on transition to healthy** — Verify `from` and `downtimeMs` fields. | Status: done
- [x] **Test: error event fires on internal monitor errors** — Verify monitor continues operating after emitting error. | Status: done

### Passive Monitoring Tests (`src/__tests__/passive.test.ts`)

- [x] **Test: reportSuccess updates latency metrics** — Report successes and verify `getHealth().latency` reflects them. | Status: done
- [ ] **Test: reportSuccess with ttfbMs records TTFB** — Verify TTFB data is stored. | Status: not_done
- [x] **Test: reportError updates error rate** — Report errors and verify `getHealth().errorRate` increases. | Status: done
- [x] **Test: health state transitions based on passive reports alone** — No active probing; transitions happen from `reportSuccess`/`reportError` calls. | Status: done
- [ ] **Test: reportSuccess/reportError with unknown provider ID is silently ignored** — Verify no throw (passive monitoring should not crash the caller). | Status: not_done
- [x] **Test: latencySpike fires from reportSuccess** — Report a success with latency above the spike threshold. | Status: done

### Built-In Probe Tests (`src/__tests__/probes/`)

- [x] **Test: OpenAI probe sends correct request** — Mock fetch, verify `GET /v1/models` with `Authorization: Bearer <key>` header. Verify `ProbeResult` shape. (`src/__tests__/probes/openai.test.ts`) | Status: done
- [x] **Test: Anthropic probe sends correct request** — Mock fetch, verify `POST /v1/messages` with `x-api-key: <key>` header and minimal body. (`src/__tests__/probes/anthropic.test.ts`) | Status: done
- [x] **Test: Google probe sends correct request** — Mock fetch, verify `GET /v1beta/models` with `x-goog-api-key: <key>` header. (`src/__tests__/probes/google.test.ts`) | Status: done
- [x] **Test: Cohere probe sends correct request** — Mock fetch, verify `GET /v1/models` with correct auth header. (`src/__tests__/probes/cohere.test.ts`) | Status: done
- [x] **Test: Mistral probe sends correct request** — Mock fetch, verify `GET /v1/models` with correct auth header. (`src/__tests__/probes/mistral.test.ts`) | Status: done
- [ ] **Test: probe respects probeTimeoutMs and aborts on timeout** — Mock a slow fetch, verify `AbortController` aborts and result is `PROBE_TIMEOUT`. | Status: not_done
- [ ] **Test: probe measures latency with performance.now()** — Verify latency is recorded in the `ProbeResult`. | Status: not_done
- [ ] **Test: probe returns correct ProbeResult on HTTP error** — Mock a 503 response, verify `success: false`, correct `statusCode` and `error` message. | Status: not_done

---

## Phase 13: Integration Tests (`src/__tests__/integration/`)

- [x] **Test: end-to-end with mock HTTP server** — Start a local HTTP server simulating an AI provider (returns 200 normally, 503 intermittently). Run the monitor against it. Verify state transitions and event emissions over a test window. (`src/__tests__/integration/end-to-end.test.ts`) | Status: done
- [x] **Test: passive monitoring round-trip** — Create a monitor with no active probing. Report 50 successes (verify `healthy`), then 20 errors (verify `unhealthy`), then 10 successes (verify recovery). | Status: done
- [x] **Test: multiple providers with different states** — Register three providers with different mock endpoints (one healthy, one degraded, one unhealthy). Verify `getAllHealth()` returns correct states. | Status: done
- [ ] **Test: adaptive probe interval** — Verify that when a provider degrades, the probe interval shortens to `degradedProbeIntervalMs`, and reverts on recovery. | Status: not_done
- [ ] **Test: CLI status command** — Invoke `ai-provider-healthcheck status` via `child_process.execSync` with a mock server. Verify output format and exit code 0 for healthy providers. (`src/__tests__/integration/cli.test.ts`) | Status: not_done
- [ ] **Test: CLI status --format json** — Verify JSON output is valid and contains expected fields. | Status: not_done
- [ ] **Test: CLI status exits 1 for degraded providers** — Verify exit code 1 when a provider is unhealthy. | Status: not_done
- [ ] **Test: CLI status exits 2 for missing API keys** — Invoke without any environment variables, verify exit code 2. | Status: not_done
- [ ] **Test: CLI watch command** — Start watch mode, verify it outputs the table and logs state changes. Test graceful shutdown via process signal. | Status: not_done

---

## Phase 14: Documentation

- [x] **Create README.md** — Write a comprehensive README including: overview, installation (`npm install ai-provider-healthcheck`), quick-start example, API reference for `createMonitor`, `monitor.start/stop/getHealth/getAllHealth/probe/reportSuccess/reportError/shutdown`, event documentation, CLI usage, configuration reference table, integration examples (with `ai-keyring`, `ai-circuit-breaker`, `prompt-price`), and license. | Status: done
- [ ] **Add JSDoc comments to all public APIs** — Document `createMonitor`, all `HealthMonitor` methods, all interfaces/types, and `HealthCheckError` with JSDoc. Include `@param`, `@returns`, `@throws`, and `@example` tags. | Status: not_done
- [ ] **Add inline code comments for complex logic** — Document the state machine transitions, percentile computation algorithm, ring buffer eviction, and hysteresis logic. | Status: not_done

---

## Phase 15: Build, Lint, and Publish Readiness

- [ ] **Verify TypeScript build succeeds** — Run `npm run build` and confirm `dist/` is generated with `.js`, `.d.ts`, and `.js.map` files. | Status: not_done
- [ ] **Verify lint passes** — Run `npm run lint` with zero errors. | Status: not_done
- [ ] **Verify all tests pass** — Run `npm run test` (vitest) and confirm all unit and integration tests pass. | Status: not_done
- [ ] **Verify package.json metadata** — Confirm `name`, `version`, `description`, `main`, `types`, `files`, `bin`, `engines`, `license`, `keywords`, and `publishConfig` are all correct. | Status: not_done
- [ ] **Add meaningful keywords to package.json** — Add keywords like `ai`, `health-check`, `monitoring`, `provider`, `latency`, `openai`, `anthropic`, `availability`. | Status: not_done
- [x] **Verify zero runtime dependencies** — Confirm `dependencies` field in `package.json` is empty or absent. All functionality uses Node.js built-ins. | Status: done
- [ ] **Version bump** — Bump version according to semver before publishing. | Status: not_done
- [ ] **Dry-run npm publish** — Run `npm publish --dry-run` to verify the package contents are correct (only `dist/` files). | Status: not_done

---

## Phase 16: Edge Cases and Robustness

- [ ] **Handle fetch not available** — If `globalThis.fetch` is not available and no `fetchFn` is provided, throw `HealthCheckError` with code `INVALID_CONFIG` and a clear message about Node.js 18+ requirement. | Status: not_done
- [x] **Handle probe function throwing** — If a custom `probeFn` throws an unexpected error (not a structured `ProbeResult`), catch it, emit an `error` event, and record it as a probe failure. Do not crash the monitor. | Status: done
- [x] **Handle event handler throwing** — If a user's event handler (e.g., `monitor.on('stateChange', handler)`) throws, catch the error, emit an `error` event, and continue operating. | Status: done
- [ ] **Handle concurrent probe() and stop()** — If `stop()` is called while a manual `probe()` is in-flight, the probe should resolve but its result should be discarded. | Status: not_done
- [x] **Handle getHealth() after shutdown** — Decide behavior: throw `MONITOR_SHUTDOWN` or return last known state. Spec says `getHealth()` still returns last known state after `stop()`, but `shutdown()` is full cleanup. Implement accordingly. | Status: done
- [x] **Handle provider with no probeFn and no apiKey** — Passive-only mode: `start()` should not attempt to probe this provider. Only `reportSuccess`/`reportError` update its health. | Status: done
- [ ] **Handle very large latency values** — Ensure percentile computation and statistics don't overflow or produce NaN for extremely large latency values. | Status: not_done
- [x] **Handle rapid reportSuccess/reportError calls** — Ensure the ring buffer handles burst traffic without data loss (up to `maxSamplesPerProvider`, then oldest is evicted). | Status: done
- [ ] **Handle clock skew / time going backwards** — Ensure sliding window logic handles `Date.now()` or `performance.now()` returning non-monotonic values gracefully. | Status: not_done

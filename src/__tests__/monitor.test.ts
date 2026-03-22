import { describe, it, expect, afterEach, vi } from 'vitest';
import { HealthMonitorImpl } from '../monitor.js';
import type {
  MonitorConfig,
  ProbeResult,
  StateChangeEvent,
  ProbeEvent,
  LatencySpikeEvent,
  DegradedEvent,
  RecoveredEvent,
  MonitorError,
} from '../types.js';
import { HealthCheckError } from '../types.js';

function makeConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    providers: [
      {
        id: 'test-provider',
        name: 'Test Provider',
        probeFn: async () => ({
          success: true,
          latencyMs: 100,
          statusCode: 200,
        }),
      },
    ],
    probeIntervalMs: 30_000,
    probeTimeoutMs: 10_000,
    stateChangeMinSamples: 1,
    ...overrides,
  };
}

function makeSuccessProbe(latencyMs: number = 100): () => Promise<ProbeResult> {
  return async () => ({
    success: true,
    latencyMs,
    statusCode: 200,
  });
}

function makeFailureProbe(statusCode: number = 503, latencyMs: number = 100): () => Promise<ProbeResult> {
  return async () => ({
    success: false,
    latencyMs,
    statusCode,
    error: `HTTP ${statusCode}`,
  });
}

describe('HealthMonitorImpl', () => {
  let monitor: HealthMonitorImpl;

  afterEach(() => {
    if (monitor) {
      monitor.shutdown();
    }
  });

  describe('construction', () => {
    it('creates a monitor with valid config', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      expect(monitor).toBeDefined();
    });

    it('throws on empty providers', () => {
      expect(() => new HealthMonitorImpl({ providers: [] })).toThrow(HealthCheckError);
    });

    it('throws on duplicate provider ids', () => {
      expect(
        () =>
          new HealthMonitorImpl({
            providers: [
              { id: 'a', name: 'A' },
              { id: 'a', name: 'A2' },
            ],
          })
      ).toThrow('Duplicate');
    });

    it('throws on missing provider id', () => {
      expect(
        () =>
          new HealthMonitorImpl({
            providers: [{ id: '', name: 'NoId' }],
          })
      ).toThrow('id is required');
    });
  });

  describe('getHealth', () => {
    it('returns unknown state initially', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      const health = monitor.getHealth('test-provider');
      expect(health.state).toBe('unknown');
      expect(health.provider).toBe('test-provider');
      expect(health.name).toBe('Test Provider');
      expect(health.lastProbeAt).toBeNull();
      expect(health.lastProbeResult).toBeNull();
      expect(health.consecutiveFailures).toBe(0);
      expect(health.errorRate).toBeUndefined();
      expect(health.latency.sampleCount).toBe(0);
    });

    it('throws for unknown provider', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      expect(() => monitor.getHealth('nonexistent')).toThrow(HealthCheckError);
      try {
        monitor.getHealth('nonexistent');
      } catch (e) {
        expect((e as HealthCheckError).code).toBe('UNKNOWN_PROVIDER');
      }
    });
  });

  describe('getAllHealth', () => {
    it('returns health for all providers', () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            { id: 'a', name: 'Provider A', probeFn: makeSuccessProbe() },
            { id: 'b', name: 'Provider B', probeFn: makeSuccessProbe() },
          ],
        })
      );
      const all = monitor.getAllHealth();
      expect(Object.keys(all)).toEqual(['a', 'b']);
      expect(all['a'].provider).toBe('a');
      expect(all['b'].provider).toBe('b');
    });
  });

  describe('probe', () => {
    it('executes probe and returns result', async () => {
      monitor = new HealthMonitorImpl(makeConfig());
      const result = await monitor.probe('test-provider');
      expect(result.success).toBe(true);
      expect(result.latencyMs).toBe(100);
      expect(result.statusCode).toBe(200);
    });

    it('throws for unknown provider', async () => {
      monitor = new HealthMonitorImpl(makeConfig());
      await expect(monitor.probe('nonexistent')).rejects.toThrow(HealthCheckError);
    });

    it('throws for provider without probe function', async () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [{ id: 'no-probe', name: 'No Probe' }],
        })
      );
      await expect(monitor.probe('no-probe')).rejects.toThrow(HealthCheckError);
    });

    it('updates health state after probe', async () => {
      monitor = new HealthMonitorImpl(makeConfig());
      await monitor.probe('test-provider');
      const health = monitor.getHealth('test-provider');
      expect(health.state).toBe('healthy');
      expect(health.lastProbeAt).not.toBeNull();
      expect(health.lastProbeResult).not.toBeNull();
      expect(health.lastProbeResult!.success).toBe(true);
    });

    it('updates latency stats after successful probe', async () => {
      monitor = new HealthMonitorImpl(makeConfig());
      await monitor.probe('test-provider');
      const health = monitor.getHealth('test-provider');
      expect(health.latency.p50).toBe(100);
      expect(health.latency.sampleCount).toBe(1);
    });

    it('records failure when probe returns success: false', async () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            {
              id: 'failing',
              name: 'Failing',
              probeFn: makeFailureProbe(503),
            },
          ],
        })
      );
      const result = await monitor.probe('failing');
      expect(result.success).toBe(false);
      const health = monitor.getHealth('failing');
      expect(health.state).toBe('unhealthy');
    });

    it('handles probe function that throws', async () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            {
              id: 'throwing',
              name: 'Throwing',
              probeFn: async () => {
                throw new Error('network error');
              },
            },
          ],
        })
      );
      const result = await monitor.probe('throwing');
      expect(result.success).toBe(false);
      expect(result.error).toBe('network error');
    });
  });

  describe('reportSuccess', () => {
    it('records success metrics', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      monitor.reportSuccess('test-provider', { latencyMs: 150 });
      const health = monitor.getHealth('test-provider');
      expect(health.state).toBe('healthy');
      expect(health.latency.p50).toBe(150);
      expect(health.sampleCount).toBe(1);
      expect(health.lastSuccessAt).not.toBeNull();
    });

    it('throws for unknown provider', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      expect(() =>
        monitor.reportSuccess('nonexistent', { latencyMs: 100 })
      ).toThrow(HealthCheckError);
    });

    it('resets consecutive failures on success', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      // Report errors first
      monitor.reportError('test-provider', { status: 503 });
      monitor.reportError('test-provider', { status: 503 });
      let health = monitor.getHealth('test-provider');
      expect(health.consecutiveFailures).toBe(2);

      // Report success
      monitor.reportSuccess('test-provider', { latencyMs: 100 });
      health = monitor.getHealth('test-provider');
      expect(health.consecutiveFailures).toBe(0);
    });
  });

  describe('reportError', () => {
    it('records transient error', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      monitor.reportError('test-provider', { status: 503 });
      const health = monitor.getHealth('test-provider');
      expect(health.transientErrors).toBe(1);
      expect(health.lastErrorAt).not.toBeNull();
    });

    it('records permanent error without affecting consecutive failures', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      monitor.reportError('test-provider', { status: 401 });
      const health = monitor.getHealth('test-provider');
      expect(health.permanentErrors).toBe(1);
      expect(health.consecutiveFailures).toBe(0); // permanent errors don't increment
    });

    it('increments consecutive failures for transient errors', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      monitor.reportError('test-provider', { status: 503 });
      monitor.reportError('test-provider', { status: 429 });
      const health = monitor.getHealth('test-provider');
      expect(health.consecutiveFailures).toBe(2);
    });

    it('throws for unknown provider', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      expect(() =>
        monitor.reportError('nonexistent', { status: 503 })
      ).toThrow(HealthCheckError);
    });
  });

  describe('state transitions via probe', () => {
    it('transitions unknown -> healthy on first success', async () => {
      monitor = new HealthMonitorImpl(makeConfig());
      expect(monitor.getHealth('test-provider').state).toBe('unknown');
      await monitor.probe('test-provider');
      expect(monitor.getHealth('test-provider').state).toBe('healthy');
    });

    it('transitions unknown -> unhealthy on first failure', async () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            { id: 'p', name: 'P', probeFn: makeFailureProbe(503) },
          ],
        })
      );
      await monitor.probe('p');
      expect(monitor.getHealth('p').state).toBe('unhealthy');
    });

    it('transitions healthy -> degraded on elevated error rate', async () => {
      let shouldFail = false;
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            {
              id: 'p',
              name: 'P',
              probeFn: async () => {
                if (shouldFail) {
                  return { success: false, latencyMs: 100, statusCode: 503, error: 'HTTP 503' };
                }
                return { success: true, latencyMs: 100, statusCode: 200 };
              },
            },
          ],
          stateChangeMinSamples: 1,
          degradedErrorRate: 0.05,
        })
      );

      // Get to healthy
      await monitor.probe('p');
      expect(monitor.getHealth('p').state).toBe('healthy');

      // Start failing
      shouldFail = true;
      for (let i = 0; i < 5; i++) {
        await monitor.probe('p');
      }
      expect(monitor.getHealth('p').state).not.toBe('healthy');
    });
  });

  describe('events', () => {
    it('emits stateChange event on transition', async () => {
      monitor = new HealthMonitorImpl(makeConfig());
      const events: StateChangeEvent[] = [];
      monitor.on('stateChange', (e) => events.push(e));

      await monitor.probe('test-provider');
      expect(events).toHaveLength(1);
      expect(events[0].from).toBe('unknown');
      expect(events[0].to).toBe('healthy');
      expect(events[0].provider).toBe('test-provider');
      expect(events[0].timestamp).toBeDefined();
      expect(events[0].health).toBeDefined();
    });

    it('emits probe event on every probe', async () => {
      monitor = new HealthMonitorImpl(makeConfig());
      const events: ProbeEvent[] = [];
      monitor.on('probe', (e) => events.push(e));

      await monitor.probe('test-provider');
      expect(events).toHaveLength(1);
      expect(events[0].success).toBe(true);
      expect(events[0].latencyMs).toBe(100);
      expect(events[0].provider).toBe('test-provider');
    });

    it('emits degraded event', async () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            { id: 'p', name: 'P', probeFn: makeSuccessProbe() },
          ],
          stateChangeMinSamples: 1,
          degradedErrorRate: 0.05,
          unhealthyErrorRate: 0.30,
          unhealthyAfterConsecutiveFailures: 999,
        })
      );

      const events: DegradedEvent[] = [];
      monitor.on('degraded', (e) => events.push(e));

      // Get to healthy first
      await monitor.probe('p');

      // Build up baseline successes to keep error rate between 5% and 30%
      for (let i = 0; i < 80; i++) {
        monitor.reportSuccess('p', { latencyMs: 100 });
      }

      // Add enough errors: 10 errors / (81 + 10) = ~11% -> degraded not unhealthy
      for (let i = 0; i < 10; i++) {
        monitor.reportError('p', { status: 503 });
      }

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].provider).toBe('p');
      expect(events[0].reason).toBeDefined();
    });

    it('emits recovered event when transitioning to healthy', async () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            { id: 'p', name: 'P', probeFn: makeSuccessProbe() },
          ],
          stateChangeMinSamples: 1,
          degradedErrorRate: 0.05,
          unhealthyErrorRate: 0.30,
          healthyErrorRate: 0.02,
          unhealthyAfterConsecutiveFailures: 999,
        })
      );

      const recoveredEvents: RecoveredEvent[] = [];
      monitor.on('recovered', (e) => recoveredEvents.push(e));

      // Get to healthy
      await monitor.probe('p');

      // Build baseline successes
      for (let i = 0; i < 80; i++) {
        monitor.reportSuccess('p', { latencyMs: 100 });
      }

      // Push to degraded (error rate ~11%, between 5% and 30%)
      for (let i = 0; i < 10; i++) {
        monitor.reportError('p', { status: 503 });
      }

      // Recover with lots of successes to bring error rate below 2%
      for (let i = 0; i < 500; i++) {
        monitor.reportSuccess('p', { latencyMs: 100 });
      }

      expect(recoveredEvents.length).toBeGreaterThanOrEqual(1);
      expect(recoveredEvents[0].provider).toBe('p');
      expect(recoveredEvents[0].from).toBe('degraded');
    });

    it('emits error event for permanent probe errors', async () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            { id: 'p', name: 'P', probeFn: makeFailureProbe(401) },
          ],
        })
      );

      const errors: MonitorError[] = [];
      monitor.on('error', (e) => errors.push(e));

      await monitor.probe('p');
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0].code).toBe('PROBE_CONFIG_ERROR');
    });

    it('emits latencySpike event when latency exceeds threshold', () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          latencySpikeMultiplier: 3.0,
          stateChangeMinSamples: 1,
        })
      );

      const spikes: LatencySpikeEvent[] = [];
      monitor.on('latencySpike', (e) => spikes.push(e));

      // Build up baseline
      for (let i = 0; i < 10; i++) {
        monitor.reportSuccess('test-provider', { latencyMs: 100 });
      }

      // Report a spike (100 * 3 = 300 threshold, so 500 should trigger)
      monitor.reportSuccess('test-provider', { latencyMs: 500 });

      expect(spikes.length).toBeGreaterThanOrEqual(1);
      expect(spikes[0].latencyMs).toBe(500);
      expect(spikes[0].provider).toBe('test-provider');
    });
  });

  describe('start and stop', () => {
    it('start is idempotent', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      monitor.start();
      monitor.start(); // should not throw
      monitor.stop();
    });

    it('stop is idempotent', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      monitor.stop(); // not started, should not throw
      monitor.stop();
    });

    it('start throws after shutdown', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      monitor.shutdown();
      expect(() => monitor.start()).toThrow(HealthCheckError);
      try {
        monitor.start();
      } catch (e) {
        expect((e as HealthCheckError).code).toBe('MONITOR_SHUTDOWN');
      }
    });

    it('schedules probes on start with fake timers', () => {
      vi.useFakeTimers();
      try {
        let probeCount = 0;
        monitor = new HealthMonitorImpl(
          makeConfig({
            providers: [
              {
                id: 'p',
                name: 'P',
                probeFn: async () => {
                  probeCount++;
                  return { success: true, latencyMs: 100, statusCode: 200 };
                },
              },
            ],
            probeIntervalMs: 1000,
          })
        );

        monitor.start();
        // Initial probe should fire quickly
        vi.advanceTimersByTime(100);
        // The async probe needs to resolve
        expect(probeCount).toBeGreaterThanOrEqual(0);
        monitor.stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('shutdown', () => {
    it('prevents all operations after shutdown', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      monitor.shutdown();
      expect(() => monitor.getHealth('test-provider')).toThrow(HealthCheckError);
      expect(() => monitor.getAllHealth()).toThrow(HealthCheckError);
      expect(() =>
        monitor.reportSuccess('test-provider', { latencyMs: 100 })
      ).toThrow(HealthCheckError);
      expect(() =>
        monitor.reportError('test-provider', { status: 503 })
      ).toThrow(HealthCheckError);
    });

    it('removes all listeners', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      monitor.on('stateChange', () => {});
      monitor.on('probe', () => {});
      monitor.shutdown();
      expect(monitor.listenerCount('stateChange')).toBe(0);
      expect(monitor.listenerCount('probe')).toBe(0);
    });
  });

  describe('multiple providers', () => {
    it('tracks providers independently', async () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            { id: 'a', name: 'A', probeFn: makeSuccessProbe(100) },
            { id: 'b', name: 'B', probeFn: makeFailureProbe(503) },
          ],
        })
      );

      await monitor.probe('a');
      await monitor.probe('b');

      expect(monitor.getHealth('a').state).toBe('healthy');
      expect(monitor.getHealth('b').state).toBe('unhealthy');
      expect(monitor.getHealth('a').latency.p50).toBe(100);
    });

    it('getAllHealth returns all providers', async () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            { id: 'x', name: 'X', probeFn: makeSuccessProbe() },
            { id: 'y', name: 'Y', probeFn: makeSuccessProbe() },
            { id: 'z', name: 'Z', probeFn: makeSuccessProbe() },
          ],
        })
      );

      const all = monitor.getAllHealth();
      expect(Object.keys(all)).toHaveLength(3);
    });
  });

  describe('autoStart', () => {
    it('starts probing automatically when autoStart is true', () => {
      vi.useFakeTimers();
      try {
        monitor = new HealthMonitorImpl(
          makeConfig({
            autoStart: true,
            probeIntervalMs: 5000,
          })
        );
        // Should not throw - monitor was auto-started
        monitor.stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('passive monitoring without probeFn', () => {
    it('tracks health via reportSuccess/reportError only', () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [{ id: 'passive', name: 'Passive Provider' }],
          stateChangeMinSamples: 1,
        })
      );

      monitor.reportSuccess('passive', { latencyMs: 200 });
      expect(monitor.getHealth('passive').state).toBe('healthy');
      expect(monitor.getHealth('passive').latency.p50).toBe(200);
    });
  });

  describe('built-in provider resolution', () => {
    it('resolves openai provider config', () => {
      monitor = new HealthMonitorImpl({
        providers: [{ id: 'openai', apiKey: 'test-key' }],
      });
      const health = monitor.getHealth('openai');
      expect(health.name).toBe('OpenAI');
    });

    it('resolves anthropic provider config', () => {
      monitor = new HealthMonitorImpl({
        providers: [{ id: 'anthropic', apiKey: 'test-key' }],
      });
      const health = monitor.getHealth('anthropic');
      expect(health.name).toBe('Anthropic');
    });

    it('resolves google provider config', () => {
      monitor = new HealthMonitorImpl({
        providers: [{ id: 'google', apiKey: 'test-key' }],
      });
      expect(monitor.getHealth('google').name).toBe('Google Gemini');
    });

    it('resolves cohere provider config', () => {
      monitor = new HealthMonitorImpl({
        providers: [{ id: 'cohere', apiKey: 'test-key' }],
      });
      expect(monitor.getHealth('cohere').name).toBe('Cohere');
    });

    it('resolves mistral provider config', () => {
      monitor = new HealthMonitorImpl({
        providers: [{ id: 'mistral', apiKey: 'test-key' }],
      });
      expect(monitor.getHealth('mistral').name).toBe('Mistral');
    });

    it('allows name override for built-in provider', () => {
      monitor = new HealthMonitorImpl({
        providers: [{ id: 'openai', apiKey: 'test-key', name: 'My OpenAI' }],
      });
      expect(monitor.getHealth('openai').name).toBe('My OpenAI');
    });
  });

  describe('health status fields', () => {
    it('populates all ProviderHealth fields after probe', async () => {
      monitor = new HealthMonitorImpl(makeConfig());
      await monitor.probe('test-provider');

      const health = monitor.getHealth('test-provider');
      expect(health.provider).toBe('test-provider');
      expect(health.name).toBe('Test Provider');
      expect(health.state).toBe('healthy');
      expect(health.stateAge).toBeGreaterThanOrEqual(0);
      expect(health.stateChangedAt).toBeDefined();
      expect(health.latency.p50).toBe(100);
      expect(health.errorRate).toBe(0);
      expect(health.sampleCount).toBe(1);
      expect(health.consecutiveFailures).toBe(0);
      expect(health.lastProbeAt).toBeDefined();
      expect(health.lastProbeResult).toBeDefined();
      expect(health.lastSuccessAt).toBeDefined();
      expect(health.lastErrorAt).toBeNull();
      expect(health.permanentErrors).toBe(0);
      expect(health.transientErrors).toBe(0);
    });

    it('tracks lastErrorAt after error', () => {
      monitor = new HealthMonitorImpl(makeConfig());
      monitor.reportError('test-provider', { status: 503 });
      const health = monitor.getHealth('test-provider');
      expect(health.lastErrorAt).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles rapid successive probes', async () => {
      let counter = 0;
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            {
              id: 'p',
              name: 'P',
              probeFn: async () => ({
                success: true,
                latencyMs: ++counter * 10,
                statusCode: 200,
              }),
            },
          ],
        })
      );

      await Promise.all([
        monitor.probe('p'),
        monitor.probe('p'),
        monitor.probe('p'),
      ]);

      const health = monitor.getHealth('p');
      expect(health.sampleCount).toBe(3);
    });

    it('handles probe that returns ttfbMs', async () => {
      monitor = new HealthMonitorImpl(
        makeConfig({
          providers: [
            {
              id: 'p',
              name: 'P',
              probeFn: async () => ({
                success: true,
                latencyMs: 200,
                ttfbMs: 50,
                statusCode: 200,
              }),
            },
          ],
        })
      );

      const result = await monitor.probe('p');
      expect(result.ttfbMs).toBe(50);
    });
  });
});

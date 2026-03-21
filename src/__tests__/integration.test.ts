import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { createMonitor } from '../index.js';
import type {
  HealthMonitor,
  StateChangeEvent,
  ProbeEvent,
  RecoveredEvent,
  DegradedEvent,
  LatencySpikeEvent,
} from '../types.js';

function createMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe('Integration Tests', () => {
  const servers: http.Server[] = [];
  const monitors: HealthMonitor[] = [];

  afterEach(async () => {
    for (const m of monitors) {
      m.shutdown();
    }
    monitors.length = 0;
    for (const s of servers) {
      await closeServer(s);
    }
    servers.length = 0;
  });

  it('probes a real HTTP server and reports healthy', async () => {
    const { server, port } = await createMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    servers.push(server);

    const monitor = createMonitor({
      providers: [
        {
          id: 'local',
          name: 'Local Server',
          probeFn: async () => {
            const start = performance.now();
            return new Promise<{ success: boolean; latencyMs: number; statusCode: number }>((resolve) => {
              const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                  resolve({
                    success: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400,
                    latencyMs: performance.now() - start,
                    statusCode: res.statusCode ?? 0,
                  });
                });
              });
              req.on('error', () => {
                resolve({ success: false, latencyMs: performance.now() - start, statusCode: 0 });
              });
            });
          },
        },
      ],
      stateChangeMinSamples: 1,
    });
    monitors.push(monitor);

    const result = await monitor.probe('local');
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.latencyMs).toBeGreaterThan(0);

    const health = monitor.getHealth('local');
    expect(health.state).toBe('healthy');
    expect(health.latency.p50).toBeGreaterThan(0);
  });

  it('probes a failing HTTP server and reports unhealthy', async () => {
    const { server, port } = await createMockServer((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Service Unavailable');
    });
    servers.push(server);

    const monitor = createMonitor({
      providers: [
        {
          id: 'failing',
          name: 'Failing Server',
          probeFn: async () => {
            const start = performance.now();
            return new Promise<{ success: boolean; latencyMs: number; statusCode: number; error?: string }>((resolve) => {
              const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                  const code = res.statusCode ?? 0;
                  resolve({
                    success: code >= 200 && code < 400,
                    latencyMs: performance.now() - start,
                    statusCode: code,
                    error: code >= 400 ? `HTTP ${code}` : undefined,
                  });
                });
              });
              req.on('error', (err) => {
                resolve({
                  success: false,
                  latencyMs: performance.now() - start,
                  statusCode: 0,
                  error: err.message,
                });
              });
            });
          },
        },
      ],
      stateChangeMinSamples: 1,
    });
    monitors.push(monitor);

    const result = await monitor.probe('failing');
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(503);

    const health = monitor.getHealth('failing');
    expect(health.state).toBe('unhealthy');
  });

  it('emits stateChange events through lifecycle', async () => {
    let shouldFail = false;
    const monitor = createMonitor({
      providers: [
        {
          id: 'lifecycle',
          name: 'Lifecycle',
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
      unhealthyErrorRate: 0.30,
    });
    monitors.push(monitor);

    const stateChanges: StateChangeEvent[] = [];
    monitor.on('stateChange', (e) => stateChanges.push(e));

    // Start healthy
    await monitor.probe('lifecycle');
    expect(stateChanges.length).toBe(1);
    expect(stateChanges[0].to).toBe('healthy');

    // Push to degraded with failures
    shouldFail = true;
    for (let i = 0; i < 5; i++) {
      await monitor.probe('lifecycle');
    }

    // Should have transitioned through states
    expect(stateChanges.length).toBeGreaterThan(1);
    const states = stateChanges.map((e) => e.to);
    expect(states).toContain('healthy');
  });

  it('tracks passive success/error reports correctly', () => {
    const monitor = createMonitor({
      providers: [{ id: 'passive', name: 'Passive' }],
      stateChangeMinSamples: 1,
    });
    monitors.push(monitor);

    // Report successes
    for (let i = 0; i < 10; i++) {
      monitor.reportSuccess('passive', { latencyMs: 100 + i * 10 });
    }

    let health = monitor.getHealth('passive');
    expect(health.state).toBe('healthy');
    expect(health.latency.sampleCount).toBe(10);
    expect(health.latency.min).toBe(100);
    expect(health.latency.max).toBe(190);
    expect(health.errorRate).toBe(0);

    // Now report errors to degrade
    for (let i = 0; i < 10; i++) {
      monitor.reportError('passive', { status: 503 });
    }

    health = monitor.getHealth('passive');
    expect(health.transientErrors).toBe(10);
    expect(health.errorRate).toBeGreaterThan(0);
  });

  it('handles mixed probe and passive monitoring', async () => {
    const monitor = createMonitor({
      providers: [
        {
          id: 'mixed',
          name: 'Mixed',
          probeFn: async () => ({
            success: true,
            latencyMs: 200,
            statusCode: 200,
          }),
        },
      ],
      stateChangeMinSamples: 1,
    });
    monitors.push(monitor);

    // Active probe
    await monitor.probe('mixed');

    // Passive reports
    monitor.reportSuccess('mixed', { latencyMs: 150 });
    monitor.reportSuccess('mixed', { latencyMs: 250 });

    const health = monitor.getHealth('mixed');
    expect(health.sampleCount).toBe(3);
    expect(health.state).toBe('healthy');
  });

  it('creates monitor with multiple providers', async () => {
    const monitor = createMonitor({
      providers: [
        {
          id: 'fast',
          name: 'Fast Provider',
          probeFn: async () => ({
            success: true,
            latencyMs: 50,
            statusCode: 200,
          }),
        },
        {
          id: 'slow',
          name: 'Slow Provider',
          probeFn: async () => ({
            success: true,
            latencyMs: 3000,
            statusCode: 200,
          }),
        },
        {
          id: 'down',
          name: 'Down Provider',
          probeFn: async () => ({
            success: false,
            latencyMs: 100,
            statusCode: 503,
            error: 'HTTP 503',
          }),
        },
      ],
      stateChangeMinSamples: 1,
    });
    monitors.push(monitor);

    await Promise.all([
      monitor.probe('fast'),
      monitor.probe('slow'),
      monitor.probe('down'),
    ]);

    const all = monitor.getAllHealth();
    expect(all['fast'].state).toBe('healthy');
    expect(all['fast'].latency.p50).toBe(50);
    expect(all['slow'].state).toBe('healthy');
    expect(all['slow'].latency.p50).toBe(3000);
    expect(all['down'].state).toBe('unhealthy');
  });

  it('supports full degradation and recovery cycle', async () => {
    const monitor = createMonitor({
      providers: [
        {
          id: 'cycling',
          name: 'Cycling',
          probeFn: async () => ({
            success: true,
            latencyMs: 100,
            statusCode: 200,
          }),
        },
      ],
      stateChangeMinSamples: 1,
      degradedErrorRate: 0.05,
      unhealthyErrorRate: 0.30,
      healthyErrorRate: 0.02,
    });
    monitors.push(monitor);

    const recovered: RecoveredEvent[] = [];
    monitor.on('recovered', (e) => recovered.push(e));

    // Start healthy with a good baseline
    for (let i = 0; i < 5; i++) {
      await monitor.probe('cycling');
    }
    expect(monitor.getHealth('cycling').state).toBe('healthy');

    // Add more successes to build baseline
    for (let i = 0; i < 80; i++) {
      monitor.reportSuccess('cycling', { latencyMs: 100 });
    }

    // Degrade with errors (10 errors / 95 total ~ 10.5% -> degraded)
    for (let i = 0; i < 10; i++) {
      monitor.reportError('cycling', { status: 503 });
    }

    // Recover with lots of successes to bring error rate below 2%
    for (let i = 0; i < 500; i++) {
      monitor.reportSuccess('cycling', { latencyMs: 100 });
    }

    const health = monitor.getHealth('cycling');
    expect(health.state).toBe('healthy');
    expect(recovered.length).toBeGreaterThanOrEqual(1);
  });

  it('latency spike detection with mock data', () => {
    const monitor = createMonitor({
      providers: [{ id: 'spike', name: 'Spike Test' }],
      stateChangeMinSamples: 1,
      latencySpikeMultiplier: 2.0,
    });
    monitors.push(monitor);

    const spikes: LatencySpikeEvent[] = [];
    monitor.on('latencySpike', (e) => spikes.push(e));

    // Build baseline at 100ms
    for (let i = 0; i < 10; i++) {
      monitor.reportSuccess('spike', { latencyMs: 100 });
    }

    // Report a spike (2x threshold = 200ms, so 300 should trigger)
    monitor.reportSuccess('spike', { latencyMs: 300 });

    expect(spikes.length).toBe(1);
    expect(spikes[0].latencyMs).toBe(300);
    expect(spikes[0].p95Ms).toBeDefined();
  });

  it('permanent errors do not affect error rate', () => {
    const monitor = createMonitor({
      providers: [{ id: 'perm', name: 'Perm Test' }],
      stateChangeMinSamples: 1,
    });
    monitors.push(monitor);

    // Report successes
    for (let i = 0; i < 10; i++) {
      monitor.reportSuccess('perm', { latencyMs: 100 });
    }

    // Report permanent errors (401 - wrong API key)
    for (let i = 0; i < 5; i++) {
      monitor.reportError('perm', { status: 401 });
    }

    const health = monitor.getHealth('perm');
    // Permanent errors don't count in error rate numerator
    expect(health.errorRate).toBe(0);
    expect(health.permanentErrors).toBe(5);
    expect(health.state).toBe('healthy');
  });

  it('createMonitor exports work correctly', () => {
    const monitor = createMonitor({
      providers: [
        {
          id: 'test',
          name: 'Test',
          probeFn: async () => ({ success: true, latencyMs: 100, statusCode: 200 }),
        },
      ],
    });
    monitors.push(monitor);

    expect(typeof monitor.start).toBe('function');
    expect(typeof monitor.stop).toBe('function');
    expect(typeof monitor.getHealth).toBe('function');
    expect(typeof monitor.getAllHealth).toBe('function');
    expect(typeof monitor.probe).toBe('function');
    expect(typeof monitor.reportSuccess).toBe('function');
    expect(typeof monitor.reportError).toBe('function');
    expect(typeof monitor.shutdown).toBe('function');
    expect(typeof monitor.on).toBe('function');
    expect(typeof monitor.off).toBe('function');
    expect(typeof monitor.removeAllListeners).toBe('function');
  });

  it('handles degraded event fields correctly', () => {
    const monitor = createMonitor({
      providers: [{ id: 'deg', name: 'Degraded Test' }],
      stateChangeMinSamples: 1,
      degradedErrorRate: 0.05,
      unhealthyErrorRate: 0.30,
      unhealthyAfterConsecutiveFailures: 999,
    });
    monitors.push(monitor);

    const degradedEvents: DegradedEvent[] = [];
    monitor.on('degraded', (e) => degradedEvents.push(e));

    // Build up healthy baseline
    for (let i = 0; i < 80; i++) {
      monitor.reportSuccess('deg', { latencyMs: 100 });
    }

    // Push to degraded (10 errors / 90 total ~ 11% -> degraded but not unhealthy)
    for (let i = 0; i < 10; i++) {
      monitor.reportError('deg', { status: 503 });
    }

    expect(degradedEvents.length).toBeGreaterThanOrEqual(1);
    const evt = degradedEvents[0];
    expect(evt.provider).toBe('deg');
    expect(evt.timestamp).toBeDefined();
    expect(typeof evt.reason).toBe('string');
  });

  it('probe events include all fields', async () => {
    const monitor = createMonitor({
      providers: [
        {
          id: 'fields',
          name: 'Fields',
          probeFn: async () => ({
            success: true,
            latencyMs: 123,
            ttfbMs: 45,
            statusCode: 200,
          }),
        },
      ],
    });
    monitors.push(monitor);

    const probeEvents: ProbeEvent[] = [];
    monitor.on('probe', (e) => probeEvents.push(e));

    await monitor.probe('fields');
    expect(probeEvents).toHaveLength(1);
    expect(probeEvents[0].success).toBe(true);
    expect(probeEvents[0].latencyMs).toBe(123);
    expect(probeEvents[0].ttfbMs).toBe(45);
    expect(probeEvents[0].statusCode).toBe(200);
    expect(probeEvents[0].provider).toBe('fields');
    expect(probeEvents[0].timestamp).toBeDefined();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { HealthStateMachine } from '../state.js';
import { MetricsCollector } from '../metrics.js';
import type { ResolvedMonitorConfig } from '../types.js';

function makeConfig(overrides: Partial<ResolvedMonitorConfig> = {}): ResolvedMonitorConfig {
  return {
    probeIntervalMs: 30_000,
    probeTimeoutMs: 10_000,
    degradedProbeIntervalMs: 15_000,
    metricsWindowMs: 300_000,
    maxSamplesPerProvider: 1000,
    degradedErrorRate: 0.05,
    unhealthyErrorRate: 0.30,
    healthyErrorRate: 0.02,
    degradedLatencyMs: 5000,
    healthyLatencyMs: 3000,
    unhealthyAfterConsecutiveFailures: 3,
    stateChangeMinSamples: 3,
    latencySpikeMultiplier: 3.0,
    autoStart: false,
    ...overrides,
  };
}

describe('HealthStateMachine', () => {
  let sm: HealthStateMachine;
  let metrics: MetricsCollector;
  const config = makeConfig();

  beforeEach(() => {
    sm = new HealthStateMachine(config);
    metrics = new MetricsCollector(1000, 300_000);
  });

  describe('initial state', () => {
    it('starts in unknown state', () => {
      expect(sm.getState()).toBe('unknown');
    });

    it('starts with 0 consecutive failures', () => {
      expect(sm.getConsecutiveFailures()).toBe(0);
    });
  });

  describe('unknown -> healthy', () => {
    it('transitions to healthy on first successful probe', () => {
      const now = Date.now();
      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      const result = sm.evaluate(metrics, now);
      expect(result).not.toBeNull();
      expect(result!.newState).toBe('healthy');
      expect(sm.getState()).toBe('healthy');
    });
  });

  describe('unknown -> unhealthy', () => {
    it('transitions to unhealthy on first failed probe', () => {
      const now = Date.now();
      metrics.record({
        timestamp: now,
        latencyMs: undefined,
        success: false,
        errorClassification: 'transient',
      });
      const result = sm.evaluate(metrics, now);
      expect(result).not.toBeNull();
      expect(result!.newState).toBe('unhealthy');
      expect(sm.getState()).toBe('unhealthy');
    });
  });

  describe('healthy -> degraded', () => {
    it('transitions to degraded when error rate exceeds threshold with hysteresis', () => {
      const now = Date.now();

      // First, get to healthy
      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      sm.evaluate(metrics, now);
      expect(sm.getState()).toBe('healthy');

      // Add samples to produce an error rate between degraded (5%) and unhealthy (30%)
      // 80 successes + 10 failures = 10/90 ~ 11% error rate -> degraded but not unhealthy
      for (let i = 0; i < 80; i++) {
        metrics.record({ timestamp: now, latencyMs: 100, success: true });
      }
      for (let i = 0; i < 10; i++) {
        metrics.record({
          timestamp: now,
          latencyMs: undefined,
          success: false,
          errorClassification: 'transient',
        });
      }

      // First evaluation: hysteresis counter = 1
      let result = sm.evaluate(metrics, now);
      expect(result).toBeNull();

      // Second evaluation: hysteresis counter = 2
      result = sm.evaluate(metrics, now);
      expect(result).toBeNull();

      // Third evaluation: hysteresis counter = 3, transition occurs
      result = sm.evaluate(metrics, now);
      expect(result).not.toBeNull();
      expect(result!.newState).toBe('degraded');
      expect(sm.getState()).toBe('degraded');
    });

    it('transitions to degraded when p95 latency exceeds threshold', () => {
      const now = Date.now();

      // Get to healthy
      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      sm.evaluate(metrics, now);

      // Add high-latency samples (p95 > 5000ms)
      for (let i = 0; i < 20; i++) {
        metrics.record({ timestamp: now, latencyMs: 6000, success: true });
      }

      // 3 evaluations for hysteresis
      sm.evaluate(metrics, now);
      sm.evaluate(metrics, now);
      const result = sm.evaluate(metrics, now);
      expect(result).not.toBeNull();
      expect(result!.newState).toBe('degraded');
    });
  });

  describe('degraded -> unhealthy', () => {
    it('transitions to unhealthy when error rate exceeds unhealthy threshold', () => {
      const now = Date.now();

      // Force to degraded state directly
      sm.forceState('degraded', now);
      expect(sm.getState()).toBe('degraded');

      // Create metrics with error rate > unhealthy threshold (30%)
      // Use a fresh collector: 5 successes + 5 failures = 50% error rate
      const unhealthyMetrics = new MetricsCollector(1000, 300_000);
      for (let i = 0; i < 5; i++) {
        unhealthyMetrics.record({ timestamp: now, latencyMs: 100, success: true });
      }
      for (let i = 0; i < 5; i++) {
        unhealthyMetrics.record({
          timestamp: now,
          latencyMs: undefined,
          success: false,
          errorClassification: 'transient',
        });
      }

      // Hysteresis for degraded -> unhealthy
      sm.evaluate(unhealthyMetrics, now);
      sm.evaluate(unhealthyMetrics, now);
      const result = sm.evaluate(unhealthyMetrics, now);
      expect(result).not.toBeNull();
      expect(result!.newState).toBe('unhealthy');
    });
  });

  describe('consecutive failures', () => {
    it('tracks consecutive failures', () => {
      sm.recordFailure();
      expect(sm.getConsecutiveFailures()).toBe(1);
      sm.recordFailure();
      expect(sm.getConsecutiveFailures()).toBe(2);
      sm.recordSuccess();
      expect(sm.getConsecutiveFailures()).toBe(0);
    });

    it('transitions to unhealthy after consecutive failures bypassing hysteresis', () => {
      const now = Date.now();

      // Get to healthy
      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      sm.evaluate(metrics, now);
      expect(sm.getState()).toBe('healthy');

      // Record consecutive failures
      sm.recordFailure();
      sm.recordFailure();
      sm.recordFailure();

      // Add a sample for evaluation
      metrics.record({
        timestamp: now,
        latencyMs: undefined,
        success: false,
        errorClassification: 'transient',
      });

      const result = sm.evaluate(metrics, now);
      expect(result).not.toBeNull();
      expect(result!.newState).toBe('unhealthy');
      expect(result!.reason).toContain('consecutive');
    });
  });

  describe('recovery: degraded -> healthy', () => {
    it('transitions back to healthy when metrics improve with hysteresis', () => {
      const now = Date.now();

      // Get to healthy
      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      sm.evaluate(metrics, now);

      // Force to degraded state
      sm.forceState('degraded', now);
      expect(sm.getState()).toBe('degraded');

      // Use a fresh collector with only good data
      const freshMetrics = new MetricsCollector(1000, 300_000);
      for (let i = 0; i < 10; i++) {
        freshMetrics.record({ timestamp: now, latencyMs: 100, success: true });
      }

      // 3 evaluations for hysteresis
      sm.evaluate(freshMetrics, now);
      sm.evaluate(freshMetrics, now);
      const result = sm.evaluate(freshMetrics, now);
      expect(result).not.toBeNull();
      expect(result!.newState).toBe('healthy');
    });

    it('requires both error rate and latency within thresholds for recovery', () => {
      const now = Date.now();

      sm.forceState('degraded', now);

      // Low error rate but high latency
      const highLatencyMetrics = new MetricsCollector(1000, 300_000);
      for (let i = 0; i < 20; i++) {
        highLatencyMetrics.record({ timestamp: now, latencyMs: 4000, success: true });
      }

      // Latency at 4000 is between healthy (3000) and degraded (5000)
      // From degraded, must drop below healthyLatencyMs (3000) to recover
      sm.evaluate(highLatencyMetrics, now);
      sm.evaluate(highLatencyMetrics, now);
      sm.evaluate(highLatencyMetrics, now);
      // Should NOT recover because p95 is above healthyLatencyMs (3000)
      expect(sm.getState()).toBe('degraded');
    });
  });

  describe('recovery: unhealthy -> healthy', () => {
    it('transitions from unhealthy to healthy with good metrics', () => {
      const now = Date.now();

      sm.forceState('unhealthy', now);

      const goodMetrics = new MetricsCollector(1000, 300_000);
      for (let i = 0; i < 10; i++) {
        goodMetrics.record({ timestamp: now, latencyMs: 100, success: true });
      }

      // This should go unhealthy -> degraded first, or directly to healthy
      // Since error rate is 0 and latency is low, it should classify as healthy
      sm.evaluate(goodMetrics, now);
      sm.evaluate(goodMetrics, now);
      const result = sm.evaluate(goodMetrics, now);
      expect(result).not.toBeNull();
      expect(result!.newState).toBe('healthy');
    });
  });

  describe('hysteresis', () => {
    it('resets hysteresis counter when target state changes', () => {
      const now = Date.now();

      // Get to healthy
      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      sm.evaluate(metrics, now);

      // Trigger degraded evaluation
      for (let i = 0; i < 10; i++) {
        metrics.record({
          timestamp: now,
          latencyMs: undefined,
          success: false,
          errorClassification: 'transient',
        });
      }

      // First eval: hysteresis = 1
      sm.evaluate(metrics, now);

      // Now add many successes to change the error rate back
      const freshMetrics = new MetricsCollector(1000, 300_000);
      for (let i = 0; i < 20; i++) {
        freshMetrics.record({ timestamp: now, latencyMs: 100, success: true });
      }

      // This should reset hysteresis since target state changed back to healthy
      const result = sm.evaluate(freshMetrics, now);
      expect(result).toBeNull(); // Still healthy, no transition
      expect(sm.getState()).toBe('healthy');
    });

    it('does not transition without enough consistent signals', () => {
      const now = Date.now();

      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      sm.evaluate(metrics, now);

      // Only 1 evaluation with bad data
      for (let i = 0; i < 10; i++) {
        metrics.record({
          timestamp: now,
          latencyMs: undefined,
          success: false,
          errorClassification: 'transient',
        });
      }
      sm.evaluate(metrics, now);

      // State should still be healthy
      expect(sm.getState()).toBe('healthy');
    });
  });

  describe('stateChangeMinSamples = 1', () => {
    it('transitions immediately when hysteresis is 1', () => {
      const fastConfig = makeConfig({ stateChangeMinSamples: 1 });
      const fastSm = new HealthStateMachine(fastConfig);
      const now = Date.now();

      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      fastSm.evaluate(metrics, now);
      expect(fastSm.getState()).toBe('healthy');

      // Add failures
      for (let i = 0; i < 10; i++) {
        metrics.record({
          timestamp: now,
          latencyMs: undefined,
          success: false,
          errorClassification: 'transient',
        });
      }

      const result = fastSm.evaluate(metrics, now);
      expect(result).not.toBeNull();
      // With high error rate, should transition
    });
  });

  describe('forceState', () => {
    it('sets state directly', () => {
      const now = Date.now();
      sm.forceState('degraded', now);
      expect(sm.getState()).toBe('degraded');
      expect(sm.getStateChangedAt()).toBe(now);
    });

    it('resets hysteresis', () => {
      const now = Date.now();

      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      sm.evaluate(metrics, now);

      // Start building hysteresis
      for (let i = 0; i < 10; i++) {
        metrics.record({
          timestamp: now,
          latencyMs: undefined,
          success: false,
          errorClassification: 'transient',
        });
      }
      sm.evaluate(metrics, now); // hysteresis = 1

      // Force state resets hysteresis
      sm.forceState('healthy', now);
      expect(sm.getState()).toBe('healthy');
    });
  });

  describe('no transition when conditions not met', () => {
    it('returns null when no data', () => {
      const result = sm.evaluate(metrics);
      expect(result).toBeNull();
    });

    it('returns null when state matches current classification', () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        metrics.record({ timestamp: now, latencyMs: 100, success: true });
      }
      sm.evaluate(metrics, now); // unknown -> healthy
      const result = sm.evaluate(metrics, now);
      expect(result).toBeNull();
    });
  });

  describe('reason messages', () => {
    it('includes error rate in degraded reason', () => {
      const now = Date.now();
      const fastConfig = makeConfig({ stateChangeMinSamples: 1 });
      const fastSm = new HealthStateMachine(fastConfig);

      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      fastSm.evaluate(metrics, now);

      // Add failures to exceed degraded threshold
      for (let i = 0; i < 10; i++) {
        metrics.record({
          timestamp: now,
          latencyMs: undefined,
          success: false,
          errorClassification: 'transient',
        });
      }

      const result = fastSm.evaluate(metrics, now);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('error rate');
    });

    it('includes latency in degraded reason', () => {
      const now = Date.now();
      const fastConfig = makeConfig({ stateChangeMinSamples: 1 });
      const fastSm = new HealthStateMachine(fastConfig);

      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      fastSm.evaluate(metrics, now);

      // Add high latency samples
      for (let i = 0; i < 20; i++) {
        metrics.record({ timestamp: now, latencyMs: 6000, success: true });
      }

      const result = fastSm.evaluate(metrics, now);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain('p95 latency');
    });

    it('includes consecutive failures in unhealthy reason', () => {
      const now = Date.now();

      metrics.record({ timestamp: now, latencyMs: 100, success: true });
      sm.evaluate(metrics, now);

      sm.recordFailure();
      sm.recordFailure();
      sm.recordFailure();

      metrics.record({
        timestamp: now,
        latencyMs: undefined,
        success: false,
        errorClassification: 'transient',
      });

      const result = sm.evaluate(metrics, now);
      expect(result!.reason).toContain('consecutive');
    });
  });
});

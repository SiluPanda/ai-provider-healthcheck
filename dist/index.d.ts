export type { HealthState, BuiltInProviderId, ProbeResult, BuiltInProviderConfig, CustomProviderConfig, ProviderConfig, SuccessMetrics, LatencyStats, ProviderHealth, StateChangeEvent, ProbeEvent, LatencySpikeEvent, DegradedEvent, RecoveredEvent, MonitorError, MonitorConfig, ResolvedMonitorConfig, HealthCheckErrorCode, HealthMonitor, ErrorClassification, SampleEntry, ResolvedProvider, } from './types.js';
export { HealthCheckError } from './types.js';
export { HealthMonitorImpl } from './monitor.js';
export { MetricsCollector } from './metrics.js';
export { HealthStateMachine } from './state.js';
export { executeProbe, classifyError, classifyStatusCode } from './probe.js';
export { BUILT_IN_PROVIDERS, isBuiltInProvider, createBuiltInProbeFn } from './providers.js';
import type { MonitorConfig, HealthMonitor } from './types.js';
/**
 * Creates a new health monitor instance.
 */
export declare function createMonitor(config: MonitorConfig): HealthMonitor;
//# sourceMappingURL=index.d.ts.map
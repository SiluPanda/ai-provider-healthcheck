import { EventEmitter } from 'node:events';
export type HealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type BuiltInProviderId = 'openai' | 'anthropic' | 'google' | 'cohere' | 'mistral';
export interface ProbeResult {
    success: boolean;
    latencyMs: number;
    ttfbMs?: number;
    statusCode?: number;
    error?: string;
}
export interface BuiltInProviderConfig {
    id: BuiltInProviderId;
    apiKey: string;
    name?: string;
    baseUrl?: string;
    probeFn?: () => Promise<ProbeResult>;
    probeIntervalMs?: number;
    probeTimeoutMs?: number;
}
export interface CustomProviderConfig {
    id: string;
    name: string;
    probeFn?: () => Promise<ProbeResult>;
    apiKey?: string;
    baseUrl?: string;
    probeIntervalMs?: number;
    probeTimeoutMs?: number;
}
export type ProviderConfig = BuiltInProviderConfig | CustomProviderConfig;
export interface SuccessMetrics {
    latencyMs: number;
    ttfbMs?: number;
}
export interface LatencyStats {
    p50: number | undefined;
    p95: number | undefined;
    p99: number | undefined;
    mean: number | undefined;
    min: number | undefined;
    max: number | undefined;
    stddev: number | undefined;
    sampleCount: number;
}
export interface ProviderHealth {
    provider: string;
    name: string;
    state: HealthState;
    stateAge: number;
    stateChangedAt: string;
    latency: LatencyStats;
    errorRate: number | undefined;
    sampleCount: number;
    consecutiveFailures: number;
    lastProbeAt: string | null;
    lastProbeResult: ProbeResult | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    permanentErrors: number;
    transientErrors: number;
}
export interface StateChangeEvent {
    provider: string;
    from: HealthState;
    to: HealthState;
    reason: string;
    timestamp: string;
    health: ProviderHealth;
}
export interface ProbeEvent {
    provider: string;
    success: boolean;
    latencyMs: number;
    ttfbMs?: number;
    statusCode?: number;
    error?: string;
    timestamp: string;
}
export interface LatencySpikeEvent {
    provider: string;
    latencyMs: number;
    p95Ms: number;
    thresholdMs: number;
    timestamp: string;
}
export interface DegradedEvent {
    provider: string;
    reason: string;
    errorRate: number | undefined;
    p95Ms: number | undefined;
    timestamp: string;
}
export interface RecoveredEvent {
    provider: string;
    from: 'degraded' | 'unhealthy';
    downtimeMs: number;
    timestamp: string;
}
export interface MonitorError {
    message: string;
    code: string;
    provider?: string;
    cause?: unknown;
}
export interface MonitorConfig {
    providers: ProviderConfig[];
    probeIntervalMs?: number;
    probeTimeoutMs?: number;
    degradedProbeIntervalMs?: number;
    metricsWindowMs?: number;
    maxSamplesPerProvider?: number;
    degradedErrorRate?: number;
    unhealthyErrorRate?: number;
    healthyErrorRate?: number;
    degradedLatencyMs?: number;
    healthyLatencyMs?: number;
    unhealthyAfterConsecutiveFailures?: number;
    stateChangeMinSamples?: number;
    latencySpikeMultiplier?: number;
    autoStart?: boolean;
    fetchFn?: typeof fetch;
}
export interface ResolvedMonitorConfig {
    probeIntervalMs: number;
    probeTimeoutMs: number;
    degradedProbeIntervalMs: number;
    metricsWindowMs: number;
    maxSamplesPerProvider: number;
    degradedErrorRate: number;
    unhealthyErrorRate: number;
    healthyErrorRate: number;
    degradedLatencyMs: number;
    healthyLatencyMs: number;
    unhealthyAfterConsecutiveFailures: number;
    stateChangeMinSamples: number;
    latencySpikeMultiplier: number;
    autoStart: boolean;
}
export type HealthCheckErrorCode = 'UNKNOWN_PROVIDER' | 'PROBE_TIMEOUT' | 'PROBE_FAILED' | 'MONITOR_SHUTDOWN' | 'INVALID_CONFIG' | 'PROBE_CONFIG_ERROR';
export declare class HealthCheckError extends Error {
    code: HealthCheckErrorCode;
    constructor(message: string, code: HealthCheckErrorCode);
}
export interface HealthMonitor extends EventEmitter {
    start(): void;
    stop(): void;
    getHealth(providerId: string): ProviderHealth;
    getAllHealth(): Record<string, ProviderHealth>;
    probe(providerId: string): Promise<ProbeResult>;
    reportSuccess(providerId: string, metrics: SuccessMetrics): void;
    reportError(providerId: string, error: unknown): void;
    shutdown(): void;
    on(event: 'stateChange', handler: (event: StateChangeEvent) => void): this;
    on(event: 'probe', handler: (event: ProbeEvent) => void): this;
    on(event: 'error', handler: (event: MonitorError) => void): this;
    on(event: 'latencySpike', handler: (event: LatencySpikeEvent) => void): this;
    on(event: 'degraded', handler: (event: DegradedEvent) => void): this;
    on(event: 'recovered', handler: (event: RecoveredEvent) => void): this;
    off(event: string, handler: (...args: unknown[]) => void): this;
    removeAllListeners(event?: string): this;
}
export type ErrorClassification = 'transient' | 'permanent' | 'unknown';
export interface SampleEntry {
    timestamp: number;
    latencyMs: number | undefined;
    success: boolean;
    errorClassification?: ErrorClassification;
}
export interface ResolvedProvider {
    id: string;
    name: string;
    probeFn?: () => Promise<ProbeResult>;
    probeIntervalMs: number;
    probeTimeoutMs: number;
}
//# sourceMappingURL=types.d.ts.map
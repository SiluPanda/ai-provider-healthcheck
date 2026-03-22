import type { HealthState, ResolvedMonitorConfig } from './types.js';
import type { MetricsCollector } from './metrics.js';
export interface StateEvaluation {
    newState: HealthState;
    reason: string;
}
export interface StateContext {
    currentState: HealthState;
    consecutiveFailures: number;
    sampleCount: number;
}
export declare class HealthStateMachine {
    private readonly config;
    private state;
    private stateChangedAt;
    private consecutiveFailures;
    private hysteresisCounter;
    private pendingState;
    constructor(config: ResolvedMonitorConfig);
    getState(): HealthState;
    getStateChangedAt(): number;
    getConsecutiveFailures(): number;
    recordSuccess(): void;
    recordFailure(): void;
    evaluate(metrics: MetricsCollector, now?: number): StateEvaluation | null;
    private classifyState;
    private tryTransition;
    private applyTransition;
    private buildReason;
    forceState(state: HealthState, now?: number): void;
}
//# sourceMappingURL=state.d.ts.map
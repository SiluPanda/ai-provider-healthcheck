"use strict";
// ai-provider-healthcheck - Monitor AI provider endpoint latency and availability
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBuiltInProbeFn = exports.isBuiltInProvider = exports.BUILT_IN_PROVIDERS = exports.classifyStatusCode = exports.classifyError = exports.executeProbe = exports.HealthStateMachine = exports.MetricsCollector = exports.HealthMonitorImpl = exports.HealthCheckError = void 0;
exports.createMonitor = createMonitor;
var types_js_1 = require("./types.js");
Object.defineProperty(exports, "HealthCheckError", { enumerable: true, get: function () { return types_js_1.HealthCheckError; } });
var monitor_js_1 = require("./monitor.js");
Object.defineProperty(exports, "HealthMonitorImpl", { enumerable: true, get: function () { return monitor_js_1.HealthMonitorImpl; } });
var metrics_js_1 = require("./metrics.js");
Object.defineProperty(exports, "MetricsCollector", { enumerable: true, get: function () { return metrics_js_1.MetricsCollector; } });
var state_js_1 = require("./state.js");
Object.defineProperty(exports, "HealthStateMachine", { enumerable: true, get: function () { return state_js_1.HealthStateMachine; } });
var probe_js_1 = require("./probe.js");
Object.defineProperty(exports, "executeProbe", { enumerable: true, get: function () { return probe_js_1.executeProbe; } });
Object.defineProperty(exports, "classifyError", { enumerable: true, get: function () { return probe_js_1.classifyError; } });
Object.defineProperty(exports, "classifyStatusCode", { enumerable: true, get: function () { return probe_js_1.classifyStatusCode; } });
var providers_js_1 = require("./providers.js");
Object.defineProperty(exports, "BUILT_IN_PROVIDERS", { enumerable: true, get: function () { return providers_js_1.BUILT_IN_PROVIDERS; } });
Object.defineProperty(exports, "isBuiltInProvider", { enumerable: true, get: function () { return providers_js_1.isBuiltInProvider; } });
Object.defineProperty(exports, "createBuiltInProbeFn", { enumerable: true, get: function () { return providers_js_1.createBuiltInProbeFn; } });
const monitor_js_2 = require("./monitor.js");
/**
 * Creates a new health monitor instance.
 */
function createMonitor(config) {
    return new monitor_js_2.HealthMonitorImpl(config);
}
//# sourceMappingURL=index.js.map
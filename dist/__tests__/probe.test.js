"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const probe_js_1 = require("../probe.js");
(0, vitest_1.describe)('classifyError', () => {
    (0, vitest_1.it)('classifies 429 as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ status: 429 })).toBe('transient');
    });
    (0, vitest_1.it)('classifies 502 as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ status: 502 })).toBe('transient');
    });
    (0, vitest_1.it)('classifies 503 as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ status: 503 })).toBe('transient');
    });
    (0, vitest_1.it)('classifies 504 as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ status: 504 })).toBe('transient');
    });
    (0, vitest_1.it)('classifies 401 as permanent', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ status: 401 })).toBe('permanent');
    });
    (0, vitest_1.it)('classifies 403 as permanent', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ status: 403 })).toBe('permanent');
    });
    (0, vitest_1.it)('classifies 400 as permanent', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ status: 400 })).toBe('permanent');
    });
    (0, vitest_1.it)('classifies ETIMEDOUT as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ code: 'ETIMEDOUT' })).toBe('transient');
    });
    (0, vitest_1.it)('classifies ECONNRESET as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ code: 'ECONNRESET' })).toBe('transient');
    });
    (0, vitest_1.it)('classifies ECONNREFUSED as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ code: 'ECONNREFUSED' })).toBe('transient');
    });
    (0, vitest_1.it)('reads statusCode property', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ statusCode: 503 })).toBe('transient');
    });
    (0, vitest_1.it)('reads response.status property', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ response: { status: 429 } })).toBe('transient');
    });
    (0, vitest_1.it)('reads response.statusCode property', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ response: { statusCode: 401 } })).toBe('permanent');
    });
    (0, vitest_1.it)('returns unknown for unrecognized errors', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ message: 'something broke' })).toBe('unknown');
    });
    (0, vitest_1.it)('returns unknown for null', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)(null)).toBe('unknown');
    });
    (0, vitest_1.it)('returns unknown for undefined', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)(undefined)).toBe('unknown');
    });
    (0, vitest_1.it)('classifies network timeout message as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ message: 'Request timed out' })).toBe('transient');
    });
    (0, vitest_1.it)('classifies ECONNRESET message as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ message: 'ECONNRESET happened' })).toBe('transient');
    });
    (0, vitest_1.it)('classifies 500 as unknown (not in known lists)', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ status: 500 })).toBe('unknown');
    });
    (0, vitest_1.it)('prefers status over code', () => {
        // status 401 (permanent) should win over code ETIMEDOUT (transient)
        (0, vitest_1.expect)((0, probe_js_1.classifyError)({ status: 401, code: 'ETIMEDOUT' })).toBe('permanent');
    });
});
(0, vitest_1.describe)('classifyStatusCode', () => {
    (0, vitest_1.it)('classifies undefined as unknown', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyStatusCode)(undefined)).toBe('unknown');
    });
    (0, vitest_1.it)('classifies 429 as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyStatusCode)(429)).toBe('transient');
    });
    (0, vitest_1.it)('classifies 503 as transient', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyStatusCode)(503)).toBe('transient');
    });
    (0, vitest_1.it)('classifies 401 as permanent', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyStatusCode)(401)).toBe('permanent');
    });
    (0, vitest_1.it)('classifies 200 as unknown (success codes)', () => {
        (0, vitest_1.expect)((0, probe_js_1.classifyStatusCode)(200)).toBe('unknown');
    });
});
//# sourceMappingURL=probe.test.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const providers_js_1 = require("../providers.js");
(0, vitest_1.describe)('providers', () => {
    (0, vitest_1.describe)('BUILT_IN_PROVIDERS', () => {
        (0, vitest_1.it)('has 5 built-in providers', () => {
            (0, vitest_1.expect)(Object.keys(providers_js_1.BUILT_IN_PROVIDERS)).toHaveLength(5);
        });
        (0, vitest_1.it)('has openai config', () => {
            const p = providers_js_1.BUILT_IN_PROVIDERS.openai;
            (0, vitest_1.expect)(p.id).toBe('openai');
            (0, vitest_1.expect)(p.name).toBe('OpenAI');
            (0, vitest_1.expect)(p.baseUrl).toBe('https://api.openai.com');
            (0, vitest_1.expect)(p.probePath).toBe('/v1/models');
            (0, vitest_1.expect)(p.probeMethod).toBe('GET');
        });
        (0, vitest_1.it)('has anthropic config', () => {
            const p = providers_js_1.BUILT_IN_PROVIDERS.anthropic;
            (0, vitest_1.expect)(p.id).toBe('anthropic');
            (0, vitest_1.expect)(p.name).toBe('Anthropic');
            (0, vitest_1.expect)(p.baseUrl).toBe('https://api.anthropic.com');
            (0, vitest_1.expect)(p.probePath).toBe('/v1/messages');
            (0, vitest_1.expect)(p.probeMethod).toBe('POST');
            (0, vitest_1.expect)(p.probeBody).toBeDefined();
        });
        (0, vitest_1.it)('has google config', () => {
            const p = providers_js_1.BUILT_IN_PROVIDERS.google;
            (0, vitest_1.expect)(p.id).toBe('google');
            (0, vitest_1.expect)(p.name).toBe('Google Gemini');
            (0, vitest_1.expect)(p.baseUrl).toBe('https://generativelanguage.googleapis.com');
            (0, vitest_1.expect)(p.probePath).toBe('/v1beta/models');
        });
        (0, vitest_1.it)('has cohere config', () => {
            const p = providers_js_1.BUILT_IN_PROVIDERS.cohere;
            (0, vitest_1.expect)(p.id).toBe('cohere');
            (0, vitest_1.expect)(p.name).toBe('Cohere');
            (0, vitest_1.expect)(p.baseUrl).toBe('https://api.cohere.com');
            (0, vitest_1.expect)(p.probePath).toBe('/v1/models');
        });
        (0, vitest_1.it)('has mistral config', () => {
            const p = providers_js_1.BUILT_IN_PROVIDERS.mistral;
            (0, vitest_1.expect)(p.id).toBe('mistral');
            (0, vitest_1.expect)(p.name).toBe('Mistral');
            (0, vitest_1.expect)(p.baseUrl).toBe('https://api.mistral.ai');
            (0, vitest_1.expect)(p.probePath).toBe('/v1/models');
        });
    });
    (0, vitest_1.describe)('isBuiltInProvider', () => {
        (0, vitest_1.it)('returns true for built-in providers', () => {
            (0, vitest_1.expect)((0, providers_js_1.isBuiltInProvider)('openai')).toBe(true);
            (0, vitest_1.expect)((0, providers_js_1.isBuiltInProvider)('anthropic')).toBe(true);
            (0, vitest_1.expect)((0, providers_js_1.isBuiltInProvider)('google')).toBe(true);
            (0, vitest_1.expect)((0, providers_js_1.isBuiltInProvider)('cohere')).toBe(true);
            (0, vitest_1.expect)((0, providers_js_1.isBuiltInProvider)('mistral')).toBe(true);
        });
        (0, vitest_1.it)('returns false for custom providers', () => {
            (0, vitest_1.expect)((0, providers_js_1.isBuiltInProvider)('my-custom')).toBe(false);
            (0, vitest_1.expect)((0, providers_js_1.isBuiltInProvider)('azure-openai')).toBe(false);
            (0, vitest_1.expect)((0, providers_js_1.isBuiltInProvider)('')).toBe(false);
        });
    });
    (0, vitest_1.describe)('buildHeaders', () => {
        (0, vitest_1.it)('builds openai auth header', () => {
            const headers = providers_js_1.BUILT_IN_PROVIDERS.openai.buildHeaders('sk-test');
            (0, vitest_1.expect)(headers['Authorization']).toBe('Bearer sk-test');
        });
        (0, vitest_1.it)('builds anthropic auth header', () => {
            const headers = providers_js_1.BUILT_IN_PROVIDERS.anthropic.buildHeaders('sk-ant-test');
            (0, vitest_1.expect)(headers['x-api-key']).toBe('sk-ant-test');
            (0, vitest_1.expect)(headers['content-type']).toBe('application/json');
            (0, vitest_1.expect)(headers['anthropic-version']).toBe('2023-06-01');
        });
        (0, vitest_1.it)('builds google auth header', () => {
            const headers = providers_js_1.BUILT_IN_PROVIDERS.google.buildHeaders('goog-key');
            (0, vitest_1.expect)(headers['x-goog-api-key']).toBe('goog-key');
        });
        (0, vitest_1.it)('builds cohere auth header', () => {
            const headers = providers_js_1.BUILT_IN_PROVIDERS.cohere.buildHeaders('co-key');
            (0, vitest_1.expect)(headers['Authorization']).toBe('Bearer co-key');
        });
        (0, vitest_1.it)('builds mistral auth header', () => {
            const headers = providers_js_1.BUILT_IN_PROVIDERS.mistral.buildHeaders('mis-key');
            (0, vitest_1.expect)(headers['Authorization']).toBe('Bearer mis-key');
        });
    });
    (0, vitest_1.describe)('createBuiltInProbeFn', () => {
        (0, vitest_1.it)('returns a function', () => {
            const fn = (0, providers_js_1.createBuiltInProbeFn)(providers_js_1.BUILT_IN_PROVIDERS.openai, 'test-key');
            (0, vitest_1.expect)(typeof fn).toBe('function');
        });
        (0, vitest_1.it)('uses custom baseUrl when provided', () => {
            const fn = (0, providers_js_1.createBuiltInProbeFn)(providers_js_1.BUILT_IN_PROVIDERS.openai, 'test-key', 'https://custom-proxy.com');
            (0, vitest_1.expect)(typeof fn).toBe('function');
        });
    });
    (0, vitest_1.describe)('anthropic probe body', () => {
        (0, vitest_1.it)('contains expected fields', () => {
            const body = JSON.parse(providers_js_1.BUILT_IN_PROVIDERS.anthropic.probeBody);
            (0, vitest_1.expect)(body.model).toBe('claude-haiku-4-20250514');
            (0, vitest_1.expect)(body.max_tokens).toBe(1);
            (0, vitest_1.expect)(body.messages).toHaveLength(1);
            (0, vitest_1.expect)(body.messages[0].role).toBe('user');
            (0, vitest_1.expect)(body.messages[0].content).toBe('.');
        });
    });
});
//# sourceMappingURL=providers.test.js.map
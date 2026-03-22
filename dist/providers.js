"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILT_IN_PROVIDERS = void 0;
exports.isBuiltInProvider = isBuiltInProvider;
exports.createBuiltInProbeFn = createBuiltInProbeFn;
const probe_js_1 = require("./probe.js");
exports.BUILT_IN_PROVIDERS = {
    openai: {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        probePath: '/v1/models',
        probeMethod: 'GET',
        buildHeaders: (apiKey) => ({
            'Authorization': `Bearer ${apiKey}`,
        }),
    },
    anthropic: {
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com',
        probePath: '/v1/messages',
        probeMethod: 'POST',
        probeBody: JSON.stringify({
            model: 'claude-haiku-4-20250514',
            max_tokens: 1,
            messages: [{ role: 'user', content: '.' }],
        }),
        buildHeaders: (apiKey) => ({
            'x-api-key': apiKey,
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
        }),
    },
    google: {
        id: 'google',
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        probePath: '/v1beta/models',
        probeMethod: 'GET',
        buildHeaders: (apiKey) => ({
            'x-goog-api-key': apiKey,
        }),
    },
    cohere: {
        id: 'cohere',
        name: 'Cohere',
        baseUrl: 'https://api.cohere.com',
        probePath: '/v1/models',
        probeMethod: 'GET',
        buildHeaders: (apiKey) => ({
            'Authorization': `Bearer ${apiKey}`,
        }),
    },
    mistral: {
        id: 'mistral',
        name: 'Mistral',
        baseUrl: 'https://api.mistral.ai',
        probePath: '/v1/models',
        probeMethod: 'GET',
        buildHeaders: (apiKey) => ({
            'Authorization': `Bearer ${apiKey}`,
        }),
    },
};
function isBuiltInProvider(id) {
    return id in exports.BUILT_IN_PROVIDERS;
}
function createBuiltInProbeFn(definition, apiKey, baseUrl, timeoutMs = 10000) {
    const url = (baseUrl ?? definition.baseUrl) + definition.probePath;
    const headers = definition.buildHeaders(apiKey);
    const method = definition.probeMethod;
    const body = definition.probeBody;
    return () => (0, probe_js_1.executeProbe)({
        url,
        method,
        headers,
        body,
        timeoutMs,
    });
}
//# sourceMappingURL=providers.js.map
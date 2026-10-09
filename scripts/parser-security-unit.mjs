#!/usr/bin/env node
/** Offline parser/schema regressions. Adversarial inputs run in killable children. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Validator } from '@cfworker/json-schema';

globalThis.fetch = async () => { throw new Error('Parser tests must not use the network'); };
const self = fileURLToPath(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const job = inputs => ({ id: 'test-job', title: 'Parser fixture', from: 'requester', type: 'task', goal: 'Complete the fixture.',
  attempts: 1, clarification_rounds: 0, max_attempts: 3, max_clarification_rounds: 5, thread: [], inputs });
const render = (api, inputs) => api.renderJobForWorker(job(inputs), { rules: [] }, { kind: 'mcp', claimId: 'test-claim' });

if (process.argv[2] === '--adversarial') {
  const api = await import(pathToFileURL(process.argv[4]).href);
  const start = performance.now();
  switch (process.argv[3]) {
    case 'heading-spaces':
      assert.equal(api.parseSubmission('text/plain', '# x' + ' '.repeat(120_000) + 'x').submission.status, 'completed');
      break;
    case 'heading-tabs-and-suffix':
      assert.equal(api.parseSubmission('text/plain', '#### x' + '\t'.repeat(120_000) + 'x\nAnswer.').submission.summary, 'Answer.');
      assert.ok(api.parseSubmission('text/plain', '## Summary' + '*'.repeat(120_000) + 'x\nAnswer.').submission.summary);
      break;
    case 'blank-lines':
      assert.equal(api.parseSubmission('text/markdown', '## Summary\nAnswer.\n' + '\n'.repeat(240_000) + 'end').submission.summary.slice(0, 7), 'Answer.');
      break;
    case 'indented-fence':
      assert.equal(api.parseSubmission('text/markdown', '## Summary\nAnswer.\n' + ' \t\n'.repeat(100_000) + '   ```json\n{}\n```').submission.summary, 'Answer.');
      break;
    case 'unterminated-json-openers':
      assert.equal(api.parseSubmission('text/plain', '```json'.repeat(50_000) + '\n{}').submission.data, undefined);
      break;
    case 'unterminated-source-links':
      assert.ok(api.parseSubmission('text/plain', '[source](https://x/'.repeat(20_000)).submission.sources.length <= 50);
      break;
    case 'url-punctuation': {
      const url = 'https://example.test/' + ':'.repeat(240_000) + 'x';
      assert.equal(api.parseSubmission('text/plain', url).submission.sources[0].url, url);
      break;
    }
    case 'schema-regex-and-refs':
      for (const pattern of ['^(a+)+$', '(a|aa)+$', '([a-zA-Z]+)*$']) {
        assert.equal(api.isUsableSchema({ type: 'string', pattern }), false);
        assert.match(api.schemaErrors({ type: 'string', pattern }, 'a'.repeat(100_000) + '!')[0], /unsupported keyword/);
      }
      assert.ok(api.schemaErrors({ $ref: '#' }, {} ).length);
      assert.ok(api.schemaErrors({ allOf: [{ $ref: '#' }, { $ref: '#' }] }, {}).length);
      break;
    case 'compact-json-whitespace': {
      const inputs = { values: [' '.repeat(240_000) + 'x'] };
      const result = render(api, inputs);
      const block = result.split('```json\n')[1].split('\n```')[0];
      assert.deepEqual(JSON.parse(block), inputs);
      break;
    }
    case 'deep-input-admission': {
      const inputs = { nested: JSON.parse('['.repeat(3000) + '0' + ']'.repeat(3000)) };
      const env = { DB: { prepare() { throw new Error('Unsafe input reached database lookup'); } } };
      await assert.rejects(api.validateJobRequest(env, 'owner', null, { type: 'task', to: '*', title: 'Deep input', goal: 'Test.', inputs }),
        error => error.status === 400 && /inputs.*nesting depth 64/.test(error.message));
      break;
    }
    case 'deep-unschematized-result': {
      const raw = '{"summary":"Done.","data":' + '['.repeat(3000) + '0' + ']'.repeat(3000) + '}';
      const parsed = api.parseSubmission('application/json', raw);
      for (const status of ['completed', 'failed', 'needs_input']) for (const output of [undefined, { format: 'markdown' }, { format: 'json' }]) {
        assert.match(api.validateSubmission({ ...parsed.submission, status }, output, [])[0], /nesting depth 64/);
      }
      break;
    }
    case 'deep-legacy-render': {
      const value = JSON.parse('['.repeat(16_000) + '0' + ']'.repeat(16_000));
      assert.match(JSON.parse(api.renderJSON(value)).display_error, /nesting depth 64/);
      assert.ok(render(api, { nested: value }).length < 3000);
      break;
    }
    default: throw new Error('Unknown adversarial case');
  }
  console.log(JSON.stringify({ case: process.argv[3], elapsedMs: Math.round(performance.now() - start) }));
} else {
  const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-parser-test-'));
  let checks = 0;
  const check = async (name, run) => { await run(); console.log(`ok ${++checks} - ${name}`); };
  try {
    const modulePath = join(temporary, 'parser.mjs');
    await build({ stdin: { contents: "export * from './src/parse'; export * from './src/render'; export { validateJobRequest } from './src/store';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: modulePath, logLevel: 'silent' });
    const api = await import(pathToFileURL(modulePath).href);
    const schema = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', minItems: 1,
      items: { type: 'object', required: ['claim', 'url'], properties: { claim: { type: 'string' }, url: { type: 'string' } } } } } };

    await check('published research schema accepts its normal JSON markdown result', () => {
      const raw = '## Summary ##\nTwo findings.\n\n```JSON\n{"findings":[{"claim":"Tested","url":"https://example.test/a"}]}\n```\n## Sources\n[Evidence](https://example.test/a)\nhttps://example.test/b.';
      const parsed = api.parseSubmission('text/markdown', raw);
      assert.equal(parsed.submission.summary, 'Two findings.');
      assert.deepEqual(parsed.submission.sources, [{ url: 'https://example.test/a', title: 'Evidence' }, { url: 'https://example.test/b' }]);
      assert.deepEqual(api.validateSubmission(parsed.submission, { format: 'json', schema }, parsed.notes), []);
    });
    await check('missing required fields and wrong item types identify the problem', () => {
      assert.match(api.schemaErrors(schema, { findings: [{ claim: 'Tested' }] })[0], /url/);
      assert.match(api.schemaErrors(schema, { findings: [] })[0], /at least 1 items/);
      assert.match(api.schemaErrors(schema, { findings: ['wrong'] })[0], /type object/);
    });
    await check('bold and colon headings, plain prose, JSON envelopes, and result wrappers still parse', () => {
      for (const heading of ['**Summary**:', 'Summary:', '### Summary ###']) {
        assert.equal(api.parseSubmission('text/plain', `${heading}\r\nAnswer.\r\n\r\nSources:\r\nhttps://example.test`).submission.summary, 'Answer.');
      }
      assert.equal(api.parseSubmission('text/plain', '# Title\nFirst line.\nSecond line.\n\nOther.').submission.summary, 'First line. Second line.');
      assert.equal(api.parseSubmission('application/json', JSON.stringify({ result: '## Summary\nAnswer.' })).submission.summary, 'Answer.');
      assert.deepEqual(api.parseSubmission('application/json', '{"summary":"Answer.","data":{"ok":true}}').submission.data, { ok: true });
      assert.deepEqual(api.parseSubmission('application/json', '[1,2]').submission.data, [1, 2]);
    });
    await check('failures, questions, and malformed JSON remain explicit', () => {
      assert.equal(api.parseSubmission('text/plain', 'FAILED: Missing access.').submission.status, 'failed');
      assert.equal(api.parseSubmission('text/plain', 'NEEDS_INPUT: Which source?').submission.question, 'Which source?');
      const parsed = api.parseSubmission('text/plain', '## Summary\nAnswer.\n```json\n{"broken":}\n```');
      assert.match(api.validateSubmission(parsed.submission, { format: 'json' }, parsed.notes)[0], /isn't valid JSON/);
    });
    await check('primitive unions, scalar enums/constants and numeric bounds validate', () => {
      assert.deepEqual(api.schemaErrors({ type: ['integer', 'null'] }, null), []);
      assert.deepEqual(api.schemaErrors({ type: ['integer', 'null'] }, 2), []);
      assert.ok(api.schemaErrors({ type: 'integer' }, 2.5).length);
      assert.deepEqual(api.schemaErrors({ enum: [1, null, 'yes', false] }, false), []);
      assert.ok(api.schemaErrors({ enum: [1, 'yes'] }, {}).length);
      assert.deepEqual(api.schemaErrors({ const: null }, null), []);
      assert.ok(api.schemaErrors({ const: null }, false).length);
      const limits = { type: 'number', minimum: 1, maximum: 3, exclusiveMinimum: 1, exclusiveMaximum: 3 };
      assert.deepEqual(api.schemaErrors(limits, 2), []);
      for (const invalid of [0, 1, 3, 4]) assert.ok(api.schemaErrors(limits, invalid).length);
    });
    await check('Unicode lengths use code points and object/array size constraints apply', () => {
      assert.deepEqual(api.schemaErrors({ type: 'string', minLength: 1, maxLength: 1 }, '🙂'), []);
      assert.ok(api.schemaErrors({ minLength: 2 }, '🙂').length);
      assert.ok(api.schemaErrors({ maxLength: 1 }, '🙂x').length);
      assert.ok(api.schemaErrors({ minProperties: 1 }, {}).length);
      assert.ok(api.schemaErrors({ maxProperties: 0 }, { value: 1 }).length);
      assert.ok(api.schemaErrors({ maxItems: 1 }, [1, 2]).length);
    });
    await check('tuple prefixes, boolean schemas and schema-valued additional properties work', () => {
      const tuple = { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }], items: false };
      assert.deepEqual(api.schemaErrors(tuple, ['answer', 1]), []);
      assert.ok(api.schemaErrors(tuple, ['answer', 1, 2]).length);
      assert.deepEqual(api.schemaErrors({ additionalProperties: { type: 'number' } }, { a: 1 }), []);
      assert.ok(api.schemaErrors({ additionalProperties: { type: 'number' } }, { a: 'wrong' }).length);
      assert.ok(api.schemaErrors({ properties: { value: false } }, { value: 1 }).length);
      assert.deepEqual(api.schemaErrors({ properties: { value: true }, additionalProperties: false }, { value: 1 }), []);
    });
    await check('required and properties never inherit constructor or __proto__', () => {
      assert.ok(api.schemaErrors({ required: ['constructor'] }, {}).length);
      assert.ok(api.schemaErrors({ required: ['__proto__'] }, {}).length);
      const rule = JSON.parse('{"properties":{"__proto__":{"type":"integer"},"constructor":{"type":"string"}},"additionalProperties":false}');
      assert.deepEqual(api.schemaErrors(rule, JSON.parse('{"__proto__":1,"constructor":"value"}')), []);
      assert.ok(api.schemaErrors(rule, JSON.parse('{"__proto__":"wrong"}')).length);
      assert.ok(api.schemaErrors({ properties: {}, additionalProperties: false }, { constructor: 'unexpected' }).length);
    });
    await check('supported annotations are inert and do not hide schema keywords', () => {
      const rule = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Test', description: 'Example', $comment: 'No code',
        default: { pattern: '^(a+)+$' }, examples: [{ anything: true }], readOnly: true, writeOnly: false, deprecated: false, type: 'string' };
      assert.deepEqual(api.outputSchemaErrors(rule), []);
      assert.deepEqual(api.schemaErrors(rule, 'answer'), []);
      assert.ok(api.schemaErrors(rule, 2).length);
    });
    await check('unsupported executable or ambiguous schema features reject at admission and submission', () => {
      for (const keyword of ['pattern', 'patternProperties', 'format', '$ref', '$recursiveRef', '$dynamicRef', '$defs', '$id',
        'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'contains', 'uniqueItems', 'dependentSchemas', 'unevaluatedProperties', 'multipleOf', 'minLenght']) {
        const rule = { [keyword]: keyword === 'pattern' ? '^(a+)+$' : {} };
        assert.equal(api.isUsableSchema(rule), false, keyword);
        assert.match(api.outputSchemaErrors(rule)[0], /unsupported keyword/, keyword);
        assert.ok(api.schemaErrors(rule, 'any value').length, keyword);
      }
      assert.equal(api.isUsableSchema({ properties: { nested: { pattern: '^(a+)+$' } } }), false);
    });
    await check('invalid keyword values never become a usable schema or a clean validation result', () => {
      for (const rule of [false, null, [], { type: 'invalid' }, { type: [] }, { type: ['string', 'string'] },
        { required: 'value' }, { required: ['value', 'value'] }, { properties: [] }, { properties: { value: null } },
        { items: [] }, { prefixItems: [] }, { enum: [] }, { enum: [1, 1] }, { enum: [{}] }, { const: [] },
        { maxLength: -1 }, { minItems: 1.5 }, { maximum: '2' }, { title: false }, { deprecated: 'false' }, { examples: {} },
        { $schema: 'https://json-schema.org/draft/2019-09/schema' }]) {
        assert.equal(api.isUsableSchema(rule), false, JSON.stringify(rule));
        assert.ok(api.schemaErrors(rule, {}).length, JSON.stringify(rule));
      }
    });
    await check('schema byte, depth and node limits fail closed', () => {
      assert.match(api.outputSchemaErrors({ description: '🙂'.repeat(9000) })[0], /32 KiB/);
      let deep = {};
      for (let index = 0; index < 17; index++) deep = { items: deep };
      assert.match(api.outputSchemaErrors(deep)[0], /nesting depth 16/);
      const wide = { properties: Object.fromEntries(Array.from({ length: 200 }, (_, index) => ['p' + index, {}])) };
      assert.deepEqual(api.outputSchemaErrors(wide), []);
      wide.properties.p0 = { properties: Object.fromEntries(Array.from({ length: 60 }, (_, index) => ['q' + index, {}])) };
      assert.match(api.outputSchemaErrors(wide)[0], /256 schema nodes/);
    });
    await check('data depth, volume, non-JSON values and bounded validation work cannot report success', () => {
      let deep = null;
      for (let index = 0; index < 65; index++) deep = [deep];
      assert.match(api.schemaErrors({}, deep)[0], /nesting depth 64/);
      assert.match(api.schemaErrors({}, Array(20_001).fill(0))[0], /20000 JSON values/);
      for (const value of [undefined, NaN, Infinity, new Date(), { value: undefined }]) assert.ok(api.schemaErrors({}, value).length);
      const cyclic = {}; cyclic.self = cyclic;
      assert.ok(api.schemaErrors({}, cyclic).length);
      const work = api.schemaErrors({ items: { enum: Array.from({ length: 64 }, (_, index) => index) } }, Array(3000).fill(0));
      assert.match(work[0], /validation could not be completed.*100000 checks/);
    });
    await check('compact JSON preserves quoting, brackets, escaped newlines and nested arrays', () => {
      const inputs = { scalar: [' [x] ', 'a\\"b', 'line\nbreak', null, true, 3], nested: [[1, 2], { value: ' [ ] ' }], empty: [] };
      const text = render(api, inputs);
      const block = text.split('```json\n')[1].split('\n```')[0];
      assert.deepEqual(JSON.parse(block), inputs);
      assert.ok(block.includes('[1, 2]'));
    });
    await check('ordinary shallow inputs and schema-free structured results remain usable', async () => {
      const inputs = { products: ['one', 'two'], options: { days: 30, include_archived: false } };
      const env = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ work_types: '["task"]' }] }) }) }) } };
      const request = await api.validateJobRequest(env, 'owner', null, { type: 'task', to: '*', title: 'Shallow input', goal: 'Test.', inputs });
      assert.deepEqual(request.inputs, inputs);
      for (const output of [undefined, { format: 'markdown' }, { format: 'json' }]) {
        assert.deepEqual(api.validateSubmission({ summary: 'Done.', data: inputs }, output, []), []);
      }
      assert.deepEqual(JSON.parse(api.renderJSON(inputs)), inputs);
    });
    await check('rendering bounds indentation before expansion and preserves admissible nested data', () => {
      let value = Array(10_000).fill(0);
      for (let index = 0; index < 63; index++) value = [value];
      assert.equal(api.structuredDataError(value), undefined);
      const rendered = api.renderJSON(value);
      assert.ok(rendered.length < 64 * 1024);
      assert.deepEqual(JSON.parse(rendered), value);
      assert.match(JSON.parse(api.renderJSON('🙂'.repeat(200_000))).display_error, /512 KiB display limit/);
      assert.ok(api.structuredDataError(Array(1_000_000)));
      assert.ok(api.structuredDataError(Array(5)));
    });
    await check('supported constraints agree with the reference validator across varied JSON values', () => {
      const rules = [{}, schema, { type: ['integer', 'null'] }, { enum: ['yes', 1, false, null] }, { const: null },
        { minLength: 1, maxLength: 3 }, { minimum: -1, maximum: 3, exclusiveMinimum: 0, exclusiveMaximum: 2 },
        { properties: { a: { type: 'integer' } }, required: ['a'], additionalProperties: false },
        { minProperties: 1, maxProperties: 2, additionalProperties: { type: ['number', 'boolean'] } },
        { minItems: 1, maxItems: 3, items: { type: 'integer' } },
        { prefixItems: [{ type: 'string' }, { type: 'integer' }], items: false }, { properties: { a: false } }];
      const values = [null, true, false, -1, 0, 1, 1.5, 2, 3, '', 'yes', 'long value', '🙂', '🙂🙂', {},
        { a: 1 }, { a: 'wrong' }, { a: false }, { b: 1 }, { a: 1, b: 2 }, { a: 1, b: 2, c: 3 }, [], [1],
        [1, 2], [1, 2, 3, 4], ['yes', 1], ['yes', 1, 2], { findings: [{ claim: 'Tested', url: 'https://example.test' }] }];
      for (const rule of rules) for (const value of values) {
        const expected = new Validator(structuredClone(rule), '2020-12', true).validate(value).valid;
        assert.equal(api.schemaErrors(rule, value).length === 0, expected, JSON.stringify({ rule, value }));
      }
    });
    for (const name of ['heading-spaces', 'heading-tabs-and-suffix', 'blank-lines', 'indented-fence', 'unterminated-json-openers',
      'unterminated-source-links', 'url-punctuation', 'schema-regex-and-refs', 'compact-json-whitespace',
      'deep-input-admission', 'deep-unschematized-result', 'deep-legacy-render']) {
      await check(`adversarial ${name} completes under a 2-second process deadline`, () => {
        const child = spawnSync(process.execPath, [self, '--adversarial', name, modulePath], { timeout: 2000, killSignal: 'SIGKILL', encoding: 'utf8' });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        const result = JSON.parse(child.stdout);
        assert.ok(result.elapsedMs < 2000);
      });
    }
    console.log(`Passed ${checks} parser/schema security checks.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

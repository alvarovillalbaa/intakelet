// T2: authored schemas/rows. No account, external data, model or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOutputSchema, validateOutput, validateOutputRecipe, mapOutput, compileOutputRecipe, readField } from '../../src/output-schema.mjs';

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const recipe = () => ({ id: 'tasks', version: '1', schema: object({ id: { type: 'integer' }, title: { type: 'string', minLength: 1 }, owner: object({ email: { type: 'string', format: 'email' } }), labels: { type: 'array', items: { type: 'string' }, maxItems: 5 }, done: { type: 'boolean' }, note: { type: ['string', 'null'] } }), fields: [
  { from: ['number'], to: ['id'], transforms: ['integer'] }, { from: ['name'], to: ['title'], transforms: ['trim'] }, { from: ['person', 'email'], to: ['owner', 'email'], transforms: ['trim', 'lowercase'] }, { from: ['tags'], to: ['labels'] }, { from: ['closed'], to: ['done'], transforms: ['boolean'] }, { from: ['note'], to: ['note'], default: null }
], key: [['id']] });
const row = () => ({ number: '12', name: ' Authored task ', person: { email: ' PERSON@example.test ' }, tags: ['one'], closed: 'false' });

test('S01 maps nested custom output, arrays, nullable defaults and explicit scalar conversions', () => {
  assert.deepEqual(mapOutput(row(), recipe()), { data: { id: 12, title: 'Authored task', owner: { email: 'person@example.test' }, labels: ['one'], done: false, note: null }, identity: [12] });
});
test('S02 no silent coercion, null substitution or arbitrary numeric/boolean parsing', () => {
  for (const number of [' 12', '', '0x10', '01', 'Infinity', '9007199254740993', true]) assert.throws(() => mapOutput({ ...row(), number }, recipe()));
  for (const closed of ['yes', 1, null, 'False']) assert.throws(() => mapOutput({ ...row(), closed }, recipe()));
  assert.throws(() => mapOutput({ ...row(), person: null }, recipe()));
  const strict = recipe(); strict.fields[0].transforms = []; assert.throws(() => mapOutput(row(), strict), /finite number/);
});
test('S03 missing optional values differ from explicit null; required outputs still validate', () => {
  const definition = recipe(); definition.fields.at(-1).optional = true; delete definition.fields.at(-1).default; definition.schema.required.pop();
  assert.equal(Object.hasOwn(mapOutput(row(), definition).data, 'note'), false);
  assert.equal(mapOutput({ ...row(), note: null }, definition).data.note, null);
  definition.schema.required.push('note'); assert.throws(() => mapOutput(row(), definition), /required/);
});
test('S04 schema rejects unknown/executable keywords, unsafe fields, unbounded schemas and reversed bounds', () => {
  for (const schema of [{ ...object({}), $ref: 'remote' }, { type: 'string', pattern: '.*' }, { type: 'object', properties: {} }, { type: [] }, { type: ['string', 'number'] }, { type: 'array', items: { type: 'null' }, minItems: 2, maxItems: 1 }, { type: 'number', minimum: 4, maximum: 1 }, JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}},"additionalProperties":false}')]) assert.throws(() => validateOutputSchema(schema));
  let deep = { type: 'string' }; for (let i = 0; i < 10; i++) deep = object({ child: deep }); assert.throws(() => validateOutputSchema(deep), /budget/);
});
test('S05 closed objects and item schemas report exact failing paths', () => {
  assert.throws(() => validateOutput(recipe().schema, { ...mapOutput(row(), recipe()).data, extra: 1 }), /not declared/);
  assert.throws(() => mapOutput({ ...row(), tags: ['one', 7] }, recipe()), error => error.code === 'output_value' && JSON.stringify(error.details.path) === '["labels","1"]');
});
test('S06 string length counts Unicode characters; dates, enums and HTTPS assertions are explicit', () => {
  assert.equal(validateOutput({ type: 'string', minLength: 1, maxLength: 1 }, '😀'), '😀');
  assert.equal(validateOutput({ type: ['null'], enum: [null] }, null), null);
  assert.equal(validateOutput({ type: 'string', format: 'date' }, '2024-02-29'), '2024-02-29');
  for (const date of ['2025-02-29', '2024-02-30', '24-1-1']) assert.throws(() => validateOutput({ type: 'string', format: 'date' }, date));
  for (const url of ['http://example.test', 'https://person:secret@example.test']) assert.throws(() => validateOutput({ type: 'string', format: 'https-url' }, url));
  assert.throws(() => validateOutput({ type: 'integer', enum: [1, 2] }, 3));
});
test('S07 mappings cannot duplicate/overlap outputs or descend into array schemas', () => {
  for (const field of [{ from: [], to: ['owner'] }, { from: ['name'], to: ['title'] }, { from: [], to: ['labels', '0'] }, { from: [], to: ['absent'] }]) { const definition = recipe(); definition.fields.push(field); assert.throws(() => validateOutputRecipe(definition)); }
  assert.throws(() => readField({}, ['constructor'])); assert.deepEqual(readField({ value: null }, ['value']), { found: true, value: null });
});
test('S08 empty/null identities cannot create records and compiled recipes isolate caller mutation', () => {
  const definition = recipe(), map = compileOutputRecipe(definition); definition.fields[0].constant = 1;
  assert.deepEqual(map(row()).identity, [12]);
  const text = { id: 'items', version: '1', schema: object({ key: { type: ['string', 'null'] } }), fields: [{ from: ['key'], to: ['key'] }], key: [['key']] };
  for (const key of ['', '   ', null]) assert.throws(() => mapOutput({ key }, text), /identity/);
  const result = map(row()); result.data.labels.push('mutated'); assert.deepEqual(map(row()).data.labels, ['one']);
});

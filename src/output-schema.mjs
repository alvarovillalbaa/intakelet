import { exact, label, workspace, requireValue, clone, canonical, byteLength, IntakeletError } from './values.mjs';

export const OUTPUT_LIMITS = Object.freeze({ depth: 8, schemaNodes: 256, fields: 200, rowBytes: 524288 });
const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const TRANSFORMS = ['trim', 'lowercase', 'uppercase', 'number', 'integer', 'boolean', 'string'];
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const typeOf = schema => Array.isArray(schema.type) ? schema.type.find(type => type !== 'null') ?? 'null' : schema.type;
function path(value, empty = false) {
  requireValue(Array.isArray(value) && (empty || value.length > 0) && value.length <= OUTPUT_LIMITS.depth, 'mapping', 'Use bounded arrays of field names for paths');
  for (const key of value) { label(key, 100); requireValue(!unsafe.has(key), 'mapping', 'Unsafe path field'); }
  return value;
}
export function readField(value, parts) {
  path(parts, true); let current = value;
  for (const key of parts) { if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return { found: false }; current = current[key]; }
  return { found: true, value: current };
}
export function validateOutputSchema(input) {
  requireValue(byteLength(canonical(input)) <= 131072, 'output_schema', 'Output schema exceeds 128KiB');
  let nodes = 0;
  function visit(schema, depth) {
    requireValue(depth <= OUTPUT_LIMITS.depth && ++nodes <= OUTPUT_LIMITS.schemaNodes, 'output_schema', 'Output schema exceeds its nesting/node budget');
    requireValue(schema && typeof schema === 'object' && !Array.isArray(schema), 'output_schema', 'Use an explicit typed output schema');
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    requireValue(types.every(type => TYPES.includes(type)) && new Set(types).size === types.length && (types.length === 1 || types.length === 2 && types.includes('null')), 'output_schema', 'Use a single type or one nullable type');
    const type = typeOf(schema), allowed = { object: ['properties', 'required', 'additionalProperties'], array: ['items', 'minItems', 'maxItems'], string: ['minLength', 'maxLength', 'format'], integer: ['minimum', 'maximum'], number: ['minimum', 'maximum'], boolean: [], null: [] }[type];
    exact(schema, ['type'], [...allowed, 'enum', 'title', 'description']);
    for (const key of ['title', 'description']) if (schema[key] !== undefined) label(schema[key], key === 'title' ? 200 : 1000);
    if (schema.enum !== undefined) requireValue(Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.length <= 100 && new Set(schema.enum.map(canonical)).size === schema.enum.length, 'output_schema', 'Enum needs 1–100 distinct JSON values');
    if (type === 'object') {
      requireValue(schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) && Object.keys(schema.properties).length <= OUTPUT_LIMITS.fields && schema.additionalProperties === false, 'output_schema', 'Object schemas need explicit properties and additionalProperties:false');
      for (const [key, child] of Object.entries(schema.properties)) { label(key, 100); requireValue(!unsafe.has(key), 'output_schema', 'Unsafe output field'); visit(child, depth + 1); }
      if (schema.required !== undefined) requireValue(Array.isArray(schema.required) && new Set(schema.required).size === schema.required.length && schema.required.every(key => typeof key === 'string' && Object.hasOwn(schema.properties, key)), 'output_schema', 'Required fields must name declared properties');
    }
    if (type === 'array') {
      requireValue(schema.items !== undefined, 'output_schema', 'Array schemas need an item schema'); visit(schema.items, depth + 1);
      for (const key of ['minItems', 'maxItems']) if (schema[key] !== undefined) requireValue(Number.isSafeInteger(schema[key]) && schema[key] >= 0 && schema[key] <= 10000, 'output_schema', 'Array limits must be 0–10000');
      requireValue(schema.maxItems === undefined || schema.minItems === undefined || schema.maxItems >= schema.minItems, 'output_schema', 'Array bounds are reversed');
    }
    if (type === 'string') {
      for (const key of ['minLength', 'maxLength']) if (schema[key] !== undefined) requireValue(Number.isSafeInteger(schema[key]) && schema[key] >= 0 && schema[key] <= OUTPUT_LIMITS.rowBytes, 'output_schema', 'String limits are invalid');
      requireValue(schema.maxLength === undefined || schema.minLength === undefined || schema.maxLength >= schema.minLength, 'output_schema', 'String bounds are reversed');
      requireValue(schema.format === undefined || ['email', 'date', 'https-url'].includes(schema.format), 'output_schema', 'Supported format assertions are email, date and https-url');
    }
    if (type === 'number' || type === 'integer') {
      for (const key of ['minimum', 'maximum']) if (schema[key] !== undefined) requireValue(typeof schema[key] === 'number' && Number.isFinite(schema[key]), 'output_schema', 'Numeric bounds must be finite');
      requireValue(schema.maximum === undefined || schema.minimum === undefined || schema.maximum >= schema.minimum, 'output_schema', 'Numeric bounds are reversed');
    }
  }
  visit(input, 0); canonical(input); return clone(input);
}

function validateValue(schema, value, parts = []) {
  const fail = message => { throw new IntakeletError('output_value', message, { path: parts }); };
  const types = Array.isArray(schema.type) ? schema.type : [schema.type], type = typeOf(schema);
  if (value === null) { if (!types.includes('null')) fail('Null is not allowed'); }
  else if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object');
    for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) fail('An output field is not declared');
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail('A required output field is missing: ' + key);
    for (const [key, item] of Object.entries(value)) validateValue(schema.properties[key], item, [...parts, key]);
  } else if (type === 'array') {
    if (!Array.isArray(value)) fail('Expected an array');
    if (value.length > 10000 || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 10000)) fail('Array length is outside the admitted range');
    value.forEach((item, index) => validateValue(schema.items, item, [...parts, String(index)]));
  } else if (type === 'string') {
    if (typeof value !== 'string') fail('Expected text');
    const length = [...value].length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? OUTPUT_LIMITS.rowBytes)) fail('Text length is outside the declared range');
    if (schema.format === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value)) fail('Expected an email-shaped value');
    if (schema.format === 'date') { let date; try { date = new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10); } catch {} if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || date !== value) fail('Expected a valid calendar date'); }
    if (schema.format === 'https-url') { let url; try { url = new URL(value); } catch {} if (url?.protocol !== 'https:' || url.username || url.password) fail('Expected an HTTPS URL without credentials'); }
  } else if (type === 'boolean') { if (typeof value !== 'boolean') fail('Expected a boolean'); }
  else if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || type === 'integer' && !Number.isSafeInteger(value)) fail('Expected a finite number or safe integer');
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail('Number is outside the declared range');
  } else fail('Expected null');
  if (schema.enum && !schema.enum.some(item => canonical(item) === canonical(value))) fail('Value is not in the declared enum');
}
export function validateOutput(schema, value) {
  const checked = validateOutputSchema(schema); requireValue(byteLength(canonical(value)) <= OUTPUT_LIMITS.rowBytes, 'output_size', 'Output row exceeds 512KiB');
  validateValue(checked, value); return clone(value);
}

function schemaAt(schema, parts) {
  let current = schema;
  for (const key of parts) { requireValue(typeOf(current) === 'object' && Object.hasOwn(current.properties, key), 'mapping', 'A target path is absent from the output schema'); current = current.properties[key]; }
  return current;
}
export function validateOutputRecipe(input) {
  exact(input, ['id', 'version', 'schema', 'fields', 'key']); workspace(input.id); label(input.version, 80);
  const schema = validateOutputSchema(input.schema); requireValue(schema.type === 'object', 'output_schema', 'Migration rows need a non-null object root');
  requireValue(Array.isArray(input.fields) && input.fields.length > 0 && input.fields.length <= OUTPUT_LIMITS.fields, 'mapping', 'Provide 1–200 explicit field mappings'); const targets = [];
  for (const field of input.fields) {
    exact(field, ['to'], ['from', 'constant', 'default', 'optional', 'transforms']); path(field.to); schemaAt(schema, field.to);
    requireValue(Object.hasOwn(field, 'from') !== Object.hasOwn(field, 'constant'), 'mapping', 'Choose a source path or an explicit constant');
    if (Object.hasOwn(field, 'from')) path(field.from, true);
    requireValue(field.optional === undefined || typeof field.optional === 'boolean', 'mapping', 'Optional must be boolean');
    requireValue(field.transforms === undefined || Array.isArray(field.transforms) && field.transforms.length <= 4 && field.transforms.every(name => TRANSFORMS.includes(name)), 'mapping', 'Use at most four declared transforms');
    for (const prior of targets) requireValue(!prior.slice(0, Math.min(prior.length, field.to.length)).every((key, index) => key === field.to[index]), 'mapping', 'Target mappings must not duplicate or overlap');
    targets.push(field.to);
  }
  requireValue(Array.isArray(input.key) && input.key.length > 0 && input.key.length <= 8 && new Set(input.key.map(canonical)).size === input.key.length, 'mapping', 'Choose 1–8 distinct output identity paths');
  for (const key of input.key) { path(key); requireValue(['string', 'number', 'integer', 'boolean'].includes(typeOf(schemaAt(schema, key))), 'mapping', 'Identity fields must be scalar'); }
  canonical(input); return clone(input);
}
function transform(value, name) {
  if (['trim', 'lowercase', 'uppercase'].includes(name)) { requireValue(typeof value === 'string', 'transform', 'Text transforms require text'); return name === 'trim' ? value.trim() : name === 'lowercase' ? value.toLowerCase() : value.toUpperCase(); }
  if (name === 'number' || name === 'integer') {
    requireValue(typeof value === 'number' || typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value), 'transform', 'Use an explicit finite numeric value');
    const number = Number(value); requireValue(Number.isFinite(number) && (name !== 'integer' || Number.isSafeInteger(number)), 'transform', 'Numeric conversion is not finite or safely integral'); return number;
  }
  if (name === 'boolean') { requireValue(typeof value === 'boolean' || value === 'true' || value === 'false', 'transform', 'Boolean conversion accepts only true/false'); return value === true || value === 'true'; }
  requireValue(value === null || ['string', 'boolean', 'number'].includes(typeof value), 'transform', 'String conversion accepts only JSON scalars'); return String(value);
}
function mapChecked(input, checked) {
  requireValue(byteLength(canonical(input)) <= OUTPUT_LIMITS.rowBytes, 'input_size', 'Source row exceeds 512KiB'); const output = {};
  for (const rule of checked.fields) {
    const source = Object.hasOwn(rule, 'constant') ? { found: true, value: rule.constant } : readField(input, rule.from);
    let value;
    if (source.found) value = clone(source.value);
    else if (Object.hasOwn(rule, 'default')) value = clone(rule.default);
    else { if (rule.optional) continue; throw new IntakeletError('mapping', 'A mapped source field is missing', { from: rule.from, to: rule.to }); }
    for (const name of rule.transforms ?? []) value = transform(value, name);
    let target = output;
    for (const part of rule.to.slice(0, -1)) { target[part] ??= {}; target = target[part]; }
    target[rule.to.at(-1)] = value;
  }
  requireValue(byteLength(canonical(output)) <= OUTPUT_LIMITS.rowBytes, 'output_size', 'Output row exceeds 512KiB'); validateValue(checked.schema, output);
  const data = clone(output), identity = checked.key.map(key => { const item = readField(data, key); requireValue(item.found && item.value !== null && (typeof item.value !== 'string' || item.value.trim()), 'identity', 'Every identity field needs a nonempty scalar value'); return clone(item.value); });
  return { data, identity };
}
export function compileOutputRecipe(recipe) { const checked = validateOutputRecipe(recipe); return input => mapChecked(input, checked); }
export function mapOutput(input, recipe) { return compileOutputRecipe(recipe)(input); }

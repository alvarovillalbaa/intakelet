import { exact, label, requireValue, clone } from './values.mjs';
import { validateOutputRecipe } from './output-schema.mjs';

const catalog = [
  { source: 'fileId', label: 'Stable file ID', path: ['fileId'], schema: { type: 'string' } },
  { source: 'name', label: 'File name', path: ['name'], schema: { type: 'string' } },
  { source: 'mediaType', label: 'Media type', path: ['mediaType'], schema: { type: 'string' } },
  { source: 'bytes', label: 'Size in bytes', path: ['bytes'], schema: { type: 'integer', minimum: 0 } },
  { source: 'sha256', label: 'Content digest', path: ['sha256'], schema: { type: 'string' } },
  { source: 'assetId', label: 'Stored asset ID', path: ['assetId'], schema: { type: 'string' } },
  { source: 'text', label: 'Extracted text (nullable)', path: ['extracted', 'text'], schema: { type: ['string', 'null'] } }
];
export function fileOutputFields() { return clone(catalog); }
export function buildFileOutput({ id, version = '1', fields, key } = {}) {
  requireValue(Array.isArray(fields) && fields.length > 0 && fields.length <= 200, 'mapping', 'Choose 1–200 destination fields'); label(key, 800);
  const schema = { type: 'object', properties: {}, required: [], additionalProperties: false }, mappings = [];
  for (const field of fields) {
    exact(field, ['source', 'target']); label(field.target, 800); const source = catalog.find(item => item.source === field.source); requireValue(source, 'mapping', 'Choose a declared file source field');
    const parts = field.target.split('.'); requireValue(parts.length <= 8 && parts.every(part => part.length > 0 && part.length <= 100 && part === part.trim() && !['__proto__', 'constructor', 'prototype'].includes(part)), 'mapping', 'Use nonempty, safe destination path segments');
    let parent = schema;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(parent.properties, part)) parent.properties[part] = { type: 'object', properties: {}, required: [], additionalProperties: false };
      requireValue(parent.properties[part].type === 'object', 'mapping', 'Destination paths cannot overlap');
      if (!parent.required.includes(part)) parent.required.push(part); parent = parent.properties[part];
    }
    const last = parts.at(-1); requireValue(!Object.hasOwn(parent.properties, last), 'mapping', 'Destination paths cannot duplicate or overlap'); parent.properties[last] = clone(source.schema); parent.required.push(last);
    mappings.push({ from: clone(source.path), to: parts, ...(source.source === 'text' ? { default: null } : {}) });
  }
  requireValue(fields.some(field => field.target === key), 'identity', 'Choose a declared destination field as the row key');
  return validateOutputRecipe({ id, version, schema, fields: mappings, key: [key.split('.')] });
}

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SQLITE_SCHEMA_SQL } from '../src/sqlite-schema-v1.mjs';
const path = new URL('../src/sqlite-host-v1.sql', import.meta.url);
if (process.argv[2] === '--write') await writeFile(path, SQLITE_SCHEMA_SQL, { flag: 'wx', mode: 0o644 });
else if (process.argv[2] !== '--check') throw new Error('Use --write once or --check for the immutable V1 artifact.');
const actual = await readFile(path, 'utf8');
if (actual !== SQLITE_SCHEMA_SQL) throw new Error('Generated SQLite schema differs from its immutable source.');
console.log(JSON.stringify({ schema: 1, bytes: Buffer.byteLength(actual), sha256: createHash('sha256').update(actual).digest('hex') }));

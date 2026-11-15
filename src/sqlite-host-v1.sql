-- Intakelet SQLite migration host schema V1. Generated; do not edit.
CREATE TABLE intakelet_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL,
  schema_hash TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  settings TEXT NOT NULL CHECK (json_valid(settings))
) STRICT;

CREATE TABLE intakelet_connections (
  id TEXT PRIMARY KEY,
  spec_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  cursor TEXT NOT NULL DEFAULT 'null' CHECK (json_valid(cursor)),
  lease_token TEXT,
  lease_fence INTEGER NOT NULL DEFAULT 0 CHECK (lease_fence BETWEEN 0 AND 9007199254740991),
  lease_deadline INTEGER,
  continuous INTEGER NOT NULL DEFAULT 0 CHECK (continuous IN (0, 1)),
  route_id TEXT
) STRICT;

CREATE TABLE intakelet_routes (
  connection_id TEXT PRIMARY KEY REFERENCES intakelet_connections(id),
  spec_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload))
) STRICT;

CREATE TABLE intakelet_records (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES intakelet_connections(id),
  source_key TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  data_hash TEXT NOT NULL,
  imported_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  UNIQUE (connection_id, source_key)
) STRICT;

CREATE TABLE intakelet_receipts (
  batch_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES intakelet_connections(id),
  receipt TEXT NOT NULL CHECK (json_valid(receipt)),
  batch TEXT NOT NULL CHECK (json_valid(batch)),
  bytes INTEGER NOT NULL CHECK (bytes > 0)
) STRICT;

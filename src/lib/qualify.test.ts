import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateMermaidCodeForAllDBs, type Metadata, type QualifyMode, type Table } from './metadata';

const table = (databaseName: string, schemaName: string, name: string, references?: string): Table => ({
  name, databaseName, schemaName, hasPrimaryKey: true, estimatedRowCount: 0, columnCount: 1, indexCount: 0,
  checkConstraintCount: 0, sql: '', columns: [{ name: 'id', dataType: 'INTEGER', precision: 0, scale: 0, isNullable: false }],
  constraints: references
    ? [{ columnName: 'id', constraintType: 'FOREIGN KEY', referencedTable: references, sql: `FOREIGN KEY (id) REFERENCES ${references}(id)` }]
    : [],
});

const metadata = (...tables: Table[]): Metadata => ({
  databases: [...new Set(tables.map((table) => table.databaseName!))].map((name) => ({
    name,
    schemas: [...new Set(tables.filter((table) => table.databaseName === name).map((table) => table.schemaName!))]
      .map((schema) => ({ name: schema, tables: tables.filter((table) => table.databaseName === name && table.schemaName === schema) })),
  })),
});

const entities = (data: Metadata, qualify?: QualifyMode): string[] =>
  [...generateMermaidCodeForAllDBs(data, false, false, undefined, 'full', qualify && { qualify })!.matchAll(/^\s*"([^"]+)" \{$/gm)]
    .map(([, name]) => name).sort();
const edges = (data: Metadata, qualify?: QualifyMode): string[] =>
  generateMermaidCodeForAllDBs(data, false, false, undefined, 'full', { qualify })!.split('\n')
    .map((line) => line.trim()).filter((line) => line.includes('||--o{')).sort();

const oneDatabase = metadata(
  table('shop', 'main', 'orders'), table('shop', 'main', 'lines', 'orders'),
  table('shop', 'crm', 'users'), table('shop', 'billing', 'users'),
);
const twoDatabases = metadata(
  table('shop', 'main', 'orders'), table('shop', 'main', 'lines', 'orders'),
  table('archive', 'main', 'orders'), table('archive', 'main', 'notes'),
);

test('auto omits the database prefix when the diagram has one database', () => {
  assert.deepEqual(entities(oneDatabase), ['billing.users', 'crm.users', 'lines', 'orders']);
  assert.deepEqual(entities(oneDatabase, 'auto'), entities(oneDatabase));
  assert.deepEqual(edges(oneDatabase), ['"orders" ||--o{ "lines" : ""']);
});

test('auto keeps the database prefix when the diagram spans several databases', () => {
  assert.deepEqual(entities(twoDatabases), ['archive.notes', 'archive.orders', 'shop.lines', 'shop.orders']);
});

test('always keeps the database prefix, adding the schema only for colliding names', () => {
  assert.deepEqual(entities(oneDatabase, 'always'), ['shop.billing.users', 'shop.crm.users', 'shop.lines', 'shop.orders']);
  assert.deepEqual(edges(oneDatabase, 'always'), ['"shop.orders" ||--o{ "shop.lines" : ""']);
});

test('never omits the database prefix, falling back to it only when the schema is not enough', () => {
  assert.deepEqual(entities(oneDatabase, 'never'), entities(oneDatabase));
  // orders exists in main of both databases, so only the full name tells them apart.
  assert.deepEqual(entities(twoDatabases, 'never'), ['archive.main.orders', 'lines', 'notes', 'shop.main.orders']);
  assert.deepEqual(edges(twoDatabases, 'never'), ['"shop.main.orders" ||--o{ "lines" : ""']);
});

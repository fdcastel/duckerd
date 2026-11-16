import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateMermaidCodeForAllDBs, type DiagramOptions, type Metadata, type Table } from './metadata';
import { renderERD } from './render';

const table = (databaseName: string, schemaName: string, name: string, references?: string, comment?: string): Table => ({
  name, databaseName, schemaName, comment, hasPrimaryKey: true, estimatedRowCount: 0, columnCount: 1, indexCount: 0,
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

const source = (data: Metadata, options: DiagramOptions = {}): string =>
  generateMermaidCodeForAllDBs(data, false, false, undefined, 'full', options)!;

/** Maps each subgraph title to the entities declared inside it. */
const groups = (text: string): Record<string, string[]> => Object.fromEntries(
  [...text.matchAll(/^\s*subgraph group\d+ \["([^"]*)"\]\n([\s\S]*?)^\s*end$/gm)]
    .map(([, title, body]) => [title, [...body.matchAll(/^\s*"([^"]+)"/gm)].map(([, name]) => name).sort()]),
);

const oneSchema = metadata(table('shop', 'main', 'orders'), table('shop', 'main', 'lines', 'orders'));
const twoSchemas = metadata(
  table('shop', 'crm', 'customers'), table('shop', 'crm', 'contacts', 'customers'),
  table('shop', 'sales', 'orders'), table('shop', 'sales', 'lines', 'orders'),
);

test('auto leaves a single-schema diagram unchanged', () => {
  assert.doesNotMatch(source(oneSchema), /subgraph/);
  assert.equal(source(oneSchema), source(oneSchema, { group: 'none' }));
});

test('auto groups tables by schema when there are several, with relationships after the groups', () => {
  const text = source(twoSchemas);
  assert.equal(text, source(twoSchemas, { group: 'schema' }));
  assert.deepEqual(groups(text), { crm: ['contacts', 'customers'], sales: ['lines', 'orders'] });
  const lastEnd = text.lastIndexOf('end\n');
  for (const edge of ['"customers" ||--o{ "contacts" : ""', '"orders" ||--o{ "lines" : ""']) {
    assert.ok(text.indexOf(edge) > lastEnd, edge);
  }
});

test('schema mode groups a single schema, and none never groups', () => {
  assert.deepEqual(groups(source(oneSchema, { group: 'schema' })), { main: ['lines', 'orders'] });
  assert.doesNotMatch(source(twoSchemas, { group: 'none' }), /subgraph/);
});

test('groups include the database when the diagram spans several databases', () => {
  const data = metadata(table('shop', 'main', 'orders'), table('archive', 'main', 'orders'));
  assert.deepEqual(groups(source(data)), { 'archive.main': ['archive.orders'], 'shop.main': ['shop.orders'] });
});

test('comment groups use the first capture group, or the whole match, and leave other tables ungrouped', () => {
  const data = metadata(
    table('db', 'main', 'person', undefined, 'Origin: Person'), table('db', 'main', 'address', 'person', 'Origin: Person'),
    table('db', 'main', 'order', undefined, 'Origin: "Sales" "dept"'), table('db', 'main', 'log'),
  );
  const text = source(data, { group: 'none', groupComment: /Origin: (.+)/ });
  assert.deepEqual(groups(text), { Person: ['address', 'person'], "'Sales' 'dept'": ['order'] });
  assert.match(text, /^\s*end\n\s*"log" \{/m, 'unmatched tables follow the groups');
  assert.match(text, /"person" \|\|--o\{ "address" : ""/);
  assert.deepEqual(Object.keys(groups(source(data, { groupComment: /Person/ }))), ['Person']);
  assert.equal(source(data, { groupComment: /nothing/ }), source(data, { group: 'none' }));
});

test('grouped source renders a labelled box per group', async () => {
  const svg = (await renderERD(source(twoSchemas), { format: 'svg', theme: 'default' })).toString();
  assert.equal(svg.match(/class="pele-cluster"/g)?.length, 2);
  assert.match(svg, /class="pele-cluster-label"[^>]*>crm<\/text>/);
  assert.match(svg, /class="pele-cluster-label"[^>]*>sales<\/text>/);
});

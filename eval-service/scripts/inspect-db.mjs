import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('eval-service/data/eval.db', { readOnly: true });

const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();

for (const t of tables) {
  const count = db.prepare(`SELECT count(*) as c FROM "${t.name}"`).get().c;
  const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
  console.log(`\n========================================`);
  console.log(`TABLE: ${t.name} (Rows: ${count})`);
  console.log(`========================================`);
  for (const c of cols) {
    const pk = c.pk ? `[PK]` : '';
    const nn = c.notnull ? `NOT NULL` : '';
    const dflt = c.dflt_value !== null ? `DEFAULT ${c.dflt_value}` : '';
    console.log(`  ${c.name.padEnd(20)} ${c.type.padEnd(10)} ${pk} ${nn} ${dflt}`);
  }
}

const indexes = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name").all();
console.log(`\n========================================`);
console.log(`INDEXES (${indexes.length})`);
console.log(`========================================`);
for (const idx of indexes) {
  console.log(`  ${idx.name.padEnd(30)} ON ${idx.tbl_name}`);
}

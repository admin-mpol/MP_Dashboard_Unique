import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresRepository } from './db/postgres.js';
import { buildDashboard } from './quality.js';
import { exampleRecords, exampleDetails } from './test-fixtures.js';

function fakePostgres() {
  const saved = { records: [], details: [] };
  const state = { commits: 0, rollbacks: 0 };
  return {
    state,
    pool: {
      async query(sql, values = []) {
        if (sql.includes('FROM quality_table_days')) {
          return { rows: saved.records.filter(row => row.date >= values[0] && row.date <= values[1]) };
        }
        if (sql.includes('FROM quality_piece_details')) {
          return { rows: saved.details.filter(row => row.date >= values[0] && row.date <= values[1]) };
        }
        throw new Error(`Consulta inesperada: ${sql}`);
      },
      async connect() {
        const pending = { records: [], details: [] };
        return {
          async query(sql, values = []) {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') {
              if (sql === 'ROLLBACK') state.rollbacks += 1;
              return { rows: [] };
            }
            if (sql === 'COMMIT') {
              saved.records.push(...pending.records);
              saved.details.push(...pending.details);
              state.commits += 1;
              return { rows: [] };
            }
            if (sql.startsWith('INSERT INTO quality_table_days')) {
              const row = {
                table: values[0], date: values[1], staff: values[2], hours: values[3],
                approved: values[4], blocked: values[5], detailProvided: values[6],
              };
              if ([...saved.records, ...pending.records].some(item => item.table === row.table && item.date === row.date)) {
                throw Object.assign(new Error('duplicate key'), { code: '23505' });
              }
              pending.records.push(row);
              return { rows: [] };
            }
            if (sql.startsWith('INSERT INTO quality_piece_details')) {
              const row = {
                date: values[0], piece: values[1], brokenWithoutPiece: values[2],
                fissure: values[3], sharpBurr: values[4], stain: values[5],
                other: values[6], brokenWithPiece: values[7],
              };
              if ([...saved.details, ...pending.details].some(item => item.piece === row.piece && item.date === row.date)) {
                throw Object.assign(new Error('duplicate key'), { code: '23505' });
              }
              pending.details.push(row);
              return { rows: [] };
            }
            throw new Error(`Consulta inesperada: ${sql}`);
          },
          release() {},
        };
      },
      async end() {},
    },
  };
}

test('Postgres usa el modelo Bellia y guarda ambas hojas en una transacción', async () => {
  const { pool, state } = fakePostgres();
  const repo = await createPostgresRepository({}, pool);
  try {
    assert.equal(repo.qualityVersion, 3);
    await repo.insertQualityBatch({
      records: exampleRecords(), details: exampleDetails(), detailProvided: true,
      uploadedBy: 'admin', sourceName: 'control.xlsx',
    });
    const records = await repo.listQualityRecords('2026-11-18', '2026-11-19');
    const details = await repo.listQualityDetails('2026-11-18', '2026-11-19');
    const dashboard = buildDashboard(records, details);
    assert.equal(state.commits, 1);
    assert.equal(dashboard.summary.inspected, 255);
    assert.equal(dashboard.summary.required, 500);
    assert.equal(dashboard.defects.total, 40);
    const oneDay = await repo.listQualityRecords('2026-11-18', '2026-11-18');
    assert.equal(oneDay.length, 2);
    const mesaDos = buildDashboard(records, details, { table: 'Mesa 2' });
    assert.equal(mesaDos.summary.inspected, 55);
    assert.equal(mesaDos.summary.required, 150);

    const fresh = { ...exampleRecords()[0], date: '2026-11-20' };
    await assert.rejects(repo.insertQualityBatch({
      records: [fresh, exampleRecords()[0]], uploadedBy: 'admin', sourceName: 'control.xlsx',
    }), /Ya existe una jornada/);
    assert.equal(state.rollbacks, 1);
    assert.equal((await repo.listQualityRecords('2026-11-20', '2026-11-20')).length, 0);
    await assert.rejects(repo.insertQualityBatch({
      records: [{ ...fresh, staff: 0 }], uploadedBy: 'admin', sourceName: 'control.xlsx',
    }), { status: 400 });
    assert.equal(state.commits, 1);
  } finally { await repo.close(); }
});

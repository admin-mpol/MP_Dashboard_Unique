import { DuplicateRecordError } from './index.js';
import { validateBoxControlBatch } from '../box-control.js';

// Bellia uses the same repository contract for SQLite, Oracle and Postgres.
// Configura DATABASE_URL o POSTGRES_HOST/PORT/DATABASE/USER/PASSWORD.
export async function createPostgresRepository(config, injectedPool) {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(pg.types.builtins.INT8, value => (value === null ? null : Number(value)));
  const pool = injectedPool || new pg.Pool(poolConfig(config));
  const userSelect = 'SELECT id AS "id", email AS "email", name AS "name", password_hash AS "passwordHash", role AS "role", created_at AS "createdAt" FROM users';
  return {
    qualityVersion: 3,
    async getUserByEmail(email) {
      return (await pool.query(`${userSelect} WHERE email = $1`, [email])).rows[0] || null;
    },
    async getUserById(id) {
      return (await pool.query(`${userSelect} WHERE id = $1`, [id])).rows[0] || null;
    },
    async listUsers() {
      return (await pool.query(`SELECT id AS "id", email AS "email", name AS "name", role AS "role",
        created_at AS "createdAt" FROM users ORDER BY created_at DESC`)).rows;
    },
    async createUser(user) {
      await pool.query(`INSERT INTO users (id,email,name,password_hash,role,created_at)
        VALUES ($1,$2,$3,$4,$5,$6)`,
        [user.id, user.email, user.name, user.passwordHash, user.role, user.createdAt]);
      return user;
    },
    async deleteViewer(id) {
      const result = await pool.query("DELETE FROM users WHERE id = $1 AND role = 'viewer'", [id]);
      return result.rowCount > 0;
    },
    async createSession(tokenHash, userId, expiresAt, lastActivityAt) {
      await pool.query(`INSERT INTO sessions (token_hash,user_id,expires_at,last_activity_at)
        VALUES ($1,$2,$3,$4)`, [tokenHash, userId, expiresAt, lastActivityAt]);
    },
    async getSession(tokenHash) {
      return (await pool.query(`SELECT user_id AS "userId", expires_at AS "expiresAt", last_activity_at AS "lastActivityAt"
        FROM sessions WHERE token_hash = $1`, [tokenHash])).rows[0] || null;
    },
    async touchSession(tokenHash, lastActivityAt) {
      await pool.query('UPDATE sessions SET last_activity_at = GREATEST(last_activity_at, $2) WHERE token_hash = $1',
        [tokenHash, lastActivityAt]);
    },
    async deleteSession(tokenHash) {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    },
    async listQualityRecords(from, to) {
      return (await pool.query(`SELECT table_name AS "table", report_date AS "date",
        staff AS "staff", hours AS "hours", approved AS "approved", blocked AS "blocked",
        detail_provided AS "detailProvided", source_name AS "sourceName",
        uploaded_at AS "uploadedAt" FROM quality_table_days
        WHERE report_date BETWEEN $1 AND $2
        ORDER BY report_date, table_name`, [from, to])).rows;
    },
    async listQualityDetails(from, to) {
      return (await pool.query(`SELECT report_date AS "date", piece AS "piece",
        broken_without_piece AS "brokenWithoutPiece", fissure AS "fissure",
        sharp_burr AS "sharpBurr", stain AS "stain", other AS "other",
        broken_with_piece AS "brokenWithPiece" FROM quality_piece_details
        WHERE report_date BETWEEN $1 AND $2
        ORDER BY report_date, piece`, [from, to])).rows;
    },
    async insertQualityBatch({ records, details = [], detailProvided = false, uploadedBy, sourceName }) {
      validateBoxControlBatch(records, details);
      const uploadedAt = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const row of records) {
          await client.query(`INSERT INTO quality_table_days
            (table_name,report_date,staff,hours,approved,blocked,detail_provided,
            uploaded_by,uploaded_at,source_name)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
            row.table, row.date, row.staff, row.hours, row.approved, row.blocked,
            Number(detailProvided), uploadedBy, uploadedAt, sourceName,
          ]);
        }
        for (const row of details) {
          await client.query(`INSERT INTO quality_piece_details
            (report_date,piece,broken_without_piece,fissure,sharp_burr,stain,other,
            broken_with_piece,uploaded_by,uploaded_at,source_name)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
            row.date, row.piece, row.brokenWithoutPiece, row.fissure, row.sharpBurr,
            row.stain, row.other, row.brokenWithPiece, uploadedBy, uploadedAt, sourceName,
          ]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') {
          throw new DuplicateRecordError();
        }
        throw error;
      } finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}

function poolConfig(config) {
  if (config.DATABASE_URL) return { connectionString: config.DATABASE_URL };
  const { POSTGRES_HOST: host, POSTGRES_PORT: port, POSTGRES_DATABASE: database,
    POSTGRES_USER: user, POSTGRES_PASSWORD: password } = config;
  const missing = [
    ['POSTGRES_HOST', host], ['POSTGRES_DATABASE', database],
    ['POSTGRES_USER', user], ['POSTGRES_PASSWORD', password],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Faltan ${missing.join(', ')} o DATABASE_URL.`);
  }
  return { host, port: Number(port) || 5432, database, user, password };
}

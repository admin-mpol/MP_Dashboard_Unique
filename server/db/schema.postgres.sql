-- Bellia: ejecutar una vez en un esquema Postgres nuevo y vacío.
-- Crea la estructura; npm run seed crea el administrador y la aplicación importa el Excel.
-- No migra las tablas del dashboard anterior.

CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(300) NOT NULL,
  role VARCHAR(10) NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at VARCHAR(30) NOT NULL
);

CREATE TABLE sessions (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at VARCHAR(30) NOT NULL,
  last_activity_at VARCHAR(30)
);

-- Una jornada por fecha y mesa; el detalle de fallas no identifica la mesa.
CREATE TABLE quality_table_days (
  table_name VARCHAR(100) NOT NULL
    CHECK (table_name = btrim(table_name) AND char_length(table_name) BETWEEN 1 AND 100),
  report_date VARCHAR(10) NOT NULL
    CHECK (report_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  staff BIGINT NOT NULL CHECK (staff >= 1),
  hours DOUBLE PRECISION NOT NULL CHECK (hours >= 8 AND hours <= 24),
  approved BIGINT NOT NULL CHECK (approved >= 0),
  blocked BIGINT NOT NULL CHECK (blocked >= 0),
  detail_provided SMALLINT NOT NULL CHECK (detail_provided IN (0, 1)),
  uploaded_by VARCHAR(36) NOT NULL REFERENCES users(id),
  uploaded_at VARCHAR(30) NOT NULL,
  source_name VARCHAR(100) NOT NULL,
  CONSTRAINT pk_quality_table_days PRIMARY KEY (table_name, report_date),
  CONSTRAINT ck_quality_boxes CHECK (approved + blocked <= 450359962737049)
);
CREATE INDEX idx_quality_table_days_date ON quality_table_days(report_date);

CREATE TABLE quality_piece_details (
  report_date VARCHAR(10) NOT NULL
    CHECK (report_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  piece VARCHAR(100) NOT NULL
    CHECK (piece = btrim(piece) AND char_length(piece) BETWEEN 1 AND 100),
  broken_without_piece BIGINT NOT NULL CHECK (broken_without_piece >= 0),
  fissure BIGINT NOT NULL CHECK (fissure >= 0),
  sharp_burr BIGINT NOT NULL CHECK (sharp_burr >= 0),
  stain BIGINT NOT NULL CHECK (stain >= 0),
  other BIGINT NOT NULL CHECK (other >= 0),
  broken_with_piece BIGINT NOT NULL CHECK (broken_with_piece >= 0),
  uploaded_by VARCHAR(36) NOT NULL REFERENCES users(id),
  uploaded_at VARCHAR(30) NOT NULL,
  source_name VARCHAR(100) NOT NULL,
  CONSTRAINT pk_quality_piece_details PRIMARY KEY (report_date, piece)
);
CREATE INDEX idx_quality_piece_details_date ON quality_piece_details(report_date);

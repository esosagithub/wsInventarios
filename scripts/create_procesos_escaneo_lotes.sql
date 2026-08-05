-- Tabla tecnica para idempotencia de POST /api/inventarios/process-scan.
-- Ejecutar una sola vez en el mismo esquema de las tablas de escaneo.

CREATE SEQUENCE seq_procesos_escaneo_lotes
  START WITH 1
  INCREMENT BY 1
  NOCACHE
  NOCYCLE;

CREATE TABLE procesos_escaneo_lotes_tbl (
  lote_id          NUMBER        NOT NULL,
  fingerprint      VARCHAR2(64)  NOT NULL,
  proceso_id       NUMBER        NOT NULL,
  device_id        VARCHAR2(200),
  items_recibidos  NUMBER        NOT NULL,
  estado           VARCHAR2(20)  NOT NULL,
  fecha_creacion   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL,
  fecha_procesado  TIMESTAMP,
  CONSTRAINT pk_procesos_escaneo_lotes PRIMARY KEY (lote_id),
  CONSTRAINT uk_escaneo_lote_fingerprint UNIQUE (fingerprint),
  CONSTRAINT ck_escaneo_lote_estado CHECK (estado IN ('PROCESANDO', 'PROCESADO')),
  CONSTRAINT fk_escaneo_lote_proceso FOREIGN KEY (proceso_id)
    REFERENCES procesos_escaneo_tbl (proceso_id)
);

CREATE INDEX ix_escaneo_lote_proceso
  ON procesos_escaneo_lotes_tbl (proceso_id);

-- Recomendado si funcionalmente section_name identifica una sola sesion.
-- Validar primero que no existan duplicados antes de ejecutar:
-- CREATE UNIQUE INDEX uk_sesiones_escaneo_section
--   ON sesiones_escaneo_tbl (section_name);


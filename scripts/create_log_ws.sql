-- Ejecutar conectado como pedidos_web_vtex
CREATE TABLE ventas_web_log_ws (
    id_log           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha_registro   TIMESTAMP        DEFAULT SYSTIMESTAMP NOT NULL,
    endpoint         VARCHAR2(200)    NOT NULL,
    metodo_http      VARCHAR2(10)     NOT NULL,
    usuario          VARCHAR2(100),
    json_request     CLOB,
    query_ejecutado  CLOB,
    json_response    CLOB,
    http_status      NUMBER(3),
    duracion_ms      NUMBER,
    ip_origen        VARCHAR2(50),
    mensaje_error    CLOB
);

COMMENT ON TABLE  ventas_web_log_ws                    IS 'Auditoria de consumo de WebServices VTEX';
COMMENT ON COLUMN ventas_web_log_ws.json_request       IS 'JSON recibido en la peticion (body / query params)';
COMMENT ON COLUMN ventas_web_log_ws.query_ejecutado    IS 'Operacion SQL ejecutada (INSERT/SELECT/UPDATE/DELETE y tablas afectadas)';
COMMENT ON COLUMN ventas_web_log_ws.json_response      IS 'JSON devuelto al cliente';
COMMENT ON COLUMN ventas_web_log_ws.duracion_ms        IS 'Tiempo de respuesta en milisegundos';

CREATE INDEX idx_log_ws_fecha    ON ventas_web_log_ws (fecha_registro);
CREATE INDEX idx_log_ws_endpoint ON ventas_web_log_ws (endpoint);
CREATE INDEX idx_log_ws_usuario  ON ventas_web_log_ws (usuario);
CREATE INDEX idx_log_ws_status   ON ventas_web_log_ws (http_status);

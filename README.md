# WS Inventarios

API REST para gestión de inventarios, construida con Node.js + Express y Oracle Database.

## Requisitos

- Node.js 14 o superior
- Oracle Instant Client 19.x (`C:\oracle\instantclient_19_31`)
- Acceso a la base de datos Oracle

## Instalación

```bash
npm install
```

## Variables de entorno

Crear el archivo `.env` en la raíz del proyecto:

```env
# Base de datos principal (MS_INVENTARIOS)
ORACLE_LIB_DIR=C:\oracle\instantclient_19_31
DB_USER=MS_INVENTARIOS
DB_PASSWORD=MS_INVENTARIOS
DB_CONNECT_STRING=<host>:<puerto>/<servicio>

# Puerto de la aplicación
PORT=3001

# Cache diario de UPC por tienda
UPC_CACHE_DIRECTORY=docs/MCU
UPC_CACHE_TIMEZONE=America/Guayaquil

# Autenticación Basic Auth
AUTH_USERNAME=<usuario>
AUTH_PASSWORD=<contraseña>
```

## Ejecución

```bash
# Producción
npm start

# Desarrollo (con recarga automática)
npm run dev
```

El servidor arranca en `http://localhost:3001`. Al iniciar se muestran en consola:
```
Pool de conexiones a Oracle creado
Servidor corriendo en http://localhost:3001
```

## Estructura del proyecto

```
wsInventarios/
├── config/
│   └── database.js          # Pool Oracle principal (MS_INVENTARIOS)
├── src/
│   ├── index.js             # Punto de entrada, registro de rutas
│   ├── middleware/
│   │   └── auth.js          # Basic Auth
│   ├── routes/
│   │   ├── piqueoRoutes.js
│   │   ├── procesarEscaneosRoutes.js
│   │   ├── upcRoutes.js
│   │   └── tercerConteoRoutes.js
│   ├── controllers/
│   │   ├── piqueoController.js
│   │   ├── procesarEscaneos.js
│   │   ├── upcController.js
│   │   └── tercerConteoController.js
│   └── services/
│       └── upcCacheService.js
├── .env
├── package.json
└── README.md
```

## Servicios disponibles

### Servicios de inventario — Basic Auth — `/api/inventarios/*`

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/inventarios/piqueos` | Obtener piqueos por cédula |
| POST | `/api/inventarios/actualizar-segundo-conteo` | Actualizar segundo conteo |
| POST | `/api/inventarios/process-scan` | Procesar escaneos |
| POST | `/api/inventarios/upcs-por-cedula` | Obtener UPCs por cédula (cache diario por tienda) |
| POST | `/api/inventarios/tercer-conteo` | Registrar tercer conteo |
| GET | `/api/inventarios/tercer-conteo/:cd_tercer_conteo` | Obtener tercer conteo por ID |

**Autenticación:** `Authorization: Basic <base64(usuario:contraseña)>`

## Rutas de diagnóstico

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Estado de la API |
| GET | `/pool-stats` | Estadísticas del pool Oracle principal |

## Dependencias principales

| Paquete | Versión | Uso |
|---------|---------|-----|
| express | ^4.18.2 | Framework HTTP |
| oracledb | ^6.0.0 | Conector Oracle |
| dotenv | ^16.0.3 | Variables de entorno |
| nodemon | ^3.0.1 | Recarga en desarrollo |

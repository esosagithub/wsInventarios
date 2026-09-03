const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const CACHE_DIRECTORY = path.resolve(
  process.env.UPC_CACHE_DIRECTORY || path.join(__dirname, '..', '..', 'docs', 'MCU')
);
const CACHE_TIMEZONE = process.env.UPC_CACHE_TIMEZONE || 'America/Guayaquil';
const generationsInProgress = new Map();

let cleanupInProgress = null;

class CacheGenerationInProgressError extends Error {
  constructor(storeKey) {
    super(`La generacion del cache UPC para la tienda ${storeKey} ya esta en progreso`);
    this.name = 'CacheGenerationInProgressError';
    this.code = 'UPC_CACHE_GENERATION_IN_PROGRESS';
    this.storeKey = storeKey;
  }
}

function getCurrentDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CACHE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sanitizeKeyPart(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildStoreKey(store) {
  return [store.sapWerks, store.sbsNo, store.storeNo].map(sanitizeKeyPart).join('_');
}

async function removeIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function cleanupOldFiles(currentDate) {
  // Se revisa en cada llamada. Un archivo antiguo puede ser copiado o creado
  // despues de una limpieza previa durante el mismo dia.
  if (cleanupInProgress) return cleanupInProgress;

  cleanupInProgress = (async () => {
    await fs.mkdir(CACHE_DIRECTORY, { recursive: true });
    const entries = await fs.readdir(CACHE_DIRECTORY, { withFileTypes: true });
    await Promise.all(entries.map(async entry => {
      if (!entry.isFile()) return;
      const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})_[a-zA-Z0-9_-]+\.json(?:\..+\.tmp)?$/);
      if (match && match[1] < currentDate) {
        await removeIfExists(path.join(CACHE_DIRECTORY, entry.name));
      }
    }));
  })().finally(() => {
    cleanupInProgress = null;
  });

  return cleanupInProgress;
}

function isValidCache(payload, date, store, dblink) {
  return payload
    && payload.version === 1
    && payload.fecha === date
    && payload.tienda
    && String(payload.tienda.sap_werks) === String(store.sapWerks)
    && String(payload.tienda.sbs_no) === String(store.sbsNo)
    && String(payload.tienda.store_no) === String(store.storeNo)
    && payload.dblink === dblink
    && Array.isArray(payload.productos);
}

async function readCache(filePath, date, store, dblink) {
  try {
    const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!isValidCache(payload, date, store, dblink)) {
      await removeIfExists(filePath);
      return null;
    }
    return payload.productos;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Cache UPC invalido; se regenerara: ${filePath}`, error.message);
      await removeIfExists(filePath);
    }
    return null;
  }
}

async function writeCacheAtomically(filePath, payload) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(payload), 'utf8');
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await removeIfExists(temporaryPath);
    throw error;
  }
}

async function getOrCreateStoreProducts({ store, dblink, loadProducts }) {
  const currentDate = getCurrentDate();
  await cleanupOldFiles(currentDate);
  const filePath = path.join(CACHE_DIRECTORY, `${currentDate}_${buildStoreKey(store)}.json`);

  const cachedProducts = await readCache(filePath, currentDate, store, dblink);
  if (cachedProducts) return { products: cachedProducts, source: 'file' };

  const storeKey = buildStoreKey(store);
  const generationKey = `${currentDate}_${storeKey}_${sanitizeKeyPart(dblink)}`;
  if (generationsInProgress.has(generationKey)) {
    throw new CacheGenerationInProgressError(storeKey);
  }

  const generation = (async () => {
    const productsFromFile = await readCache(filePath, currentDate, store, dblink);
    if (productsFromFile) return { products: productsFromFile, source: 'file' };

    const products = await loadProducts();
    const payload = {
      version: 1,
      fecha: currentDate,
      fecha_generacion: new Date().toISOString(),
      zona_horaria: CACHE_TIMEZONE,
      tienda: {
        sap_werks: store.sapWerks,
        sbs_no: store.sbsNo,
        store_no: store.storeNo
      },
      dblink,
      productos: products
    };

    try {
      await writeCacheAtomically(filePath, payload);
    } catch (error) {
      console.error('No se pudo guardar el cache de UPC:', error);
    }
    return { products, source: 'database' };
  })().finally(() => generationsInProgress.delete(generationKey));

  generationsInProgress.set(generationKey, {
    generation,
    dblink,
    storeKey,
    startedAt: Date.now()
  });
  return generation;
}

function getActiveGenerations() {
  const now = Date.now();
  return Array.from(generationsInProgress.values(), entry => ({
    dblink: entry.dblink,
    tienda: entry.storeKey,
    duracion_ms: now - entry.startedAt
  }));
}

module.exports = {
  getOrCreateStoreProducts,
  getActiveGenerations,
  CacheGenerationInProgressError
};

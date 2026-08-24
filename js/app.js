/**
 * ════════════════════════════════════════════════════════════════════
 *  app.js — Lógica principal de "Discos Tucumanos"
 *  Versión v5 (fix CORS + modal "Leer más")
 * ════════════════════════════════════════════════════════════════════
 *
 *  DIAGNÓSTICO QUE MOTIVA ESTA VERSIÓN
 *  -----------------------------------
 *  Los endpoints de Google Sheets NO envían cabeceras CORS
 *  (Access-Control-Allow-Origin):
 *    · /gviz/tq?tqx=out:csv  → 200 OK pero sin ACAO  ⇒ fetch() bloqueado.
 *    · /export?format=csv    → 307 a googleusercontent.com sin ACAO.
 *  Por eso el sitio mostraba "No se pudo cargar el catálogo".
 *
 *  SOLUCIÓN: JSONP sobre gviz (tqx=out:json;responseHandler:cb).
 *  La carga por etiqueta <script> NO está sujeta a CORS, funciona desde
 *  file://, GitHub Pages, Netlify, etc. Es el mismo mecanismo que usa la
 *  librería oficial de Google Visualization. El fetch queda como fallback.
 *
 *  GARANTÍAS MANTENIDAS
 *  --------------------
 *  1. UN disco por día, idéntico para todos (función pura de la fecha).
 *  2. Inmunidad a nuevos ingresos: orden permanente por hash del ID
 *     estable; insertar discos NO reinicia el recorrido.
 *  3. Bucle infinito con aritmética modular (nunca undefined).
 *  4. Caché por sesión + backup persistente + fallbacks en cascada.
 *  5. Diseño editorial intacto (mismos IDs/clases de index.html).
 *
 *  NUEVO EN v5
 *  -----------
 *  · Descarga por JSONP (fix definitivo del catálogo vacío).
 *  · console.log descriptivos en cada paso de la cadena de carga.
 *  · Invalidación automática de cachés de versiones anteriores.
 *  · Modal "Leer más" para descripciones largas (backdrop oscurecido,
 *    scroll interno, cierre con × / clic fuera / ESC).
 * ════════════════════════════════════════════════════════════════════
 */


// ════════════════════════════════════════════════════════════════════
//  1. CONFIGURACIÓN
// ════════════════════════════════════════════════════════════════════

const LOG = "[Discos Tucumanos]"; // prefijo de todos los console.log/warn/error

/** ID del spreadsheet vinculado (el que está entre /d/ y /edit en su URL). */
const SPREADSHEET_ID = "1jkW5jLHwoS1SZDIlzD4pGdBAl9u_kBuEDFvG4metQXM";

/** GID de la pestaña a consumir (0 = primera pestaña). */
const GID = "0";

/** Timeout máximo de red por intento (JSONP o fetch), en ms. */
const TIMEOUT_FETCH_MS = 12000;

/**
 * TTL de la caché de sesión del CATÁLOGO (minutos). Solo evita re-descargar
 * al navegar; el disco del día depende EXCLUSIVAMENTE de la fecha.
 */
const TTL_CACHE_MIN = 30;

/**
 * ÉPOCA de referencia para contar días: 01/01/2025 (medianoche local).
 * Edición #001 = ese día. El índice modular sigue siendo válido si se cambia.
 */
const EPOCA = new Date(2025, 0, 1);

const MS_POR_DIA = 86400000;

// ── Claves de almacenamiento (v2: invalida automáticamente las v1 viejas) ──
const KS_SESION = "dt_catalogo_sesion_v2"; // sessionStorage: catálogo reciente
const KS_BACKUP = "dt_catalogo_backup_v2"; // localStorage : último catálogo válido
const KS_HOY    = "dt_album_hoy_v2";       // localStorage : álbum fijado de hoy

/** Claves legadas de versiones anteriores que se limpian al arrancar. */
const CLAVES_LEGADO = [
  "dt_catalogo_sesion_v1", "dt_catalogo_backup_v1", "dt_album_hoy_v1",
  "dt_albums", "dt_albums_ts",
];

// ── Umbrales del truncado de descripción ("Leer más") ──
const DESC_MAX_CHARS  = 200; // más de 200 caracteres → descripción "larga"
const DESC_MAX_LINEAS = 4;   // o más de 4 líneas            → "larga"
const DESC_RECORTE    = 180; // largo objetivo del preview truncado


// ════════════════════════════════════════════════════════════════════
//  2. UTILIDADES DE FECHA (base de la selección diaria)
// ════════════════════════════════════════════════════════════════════

/** Clave legible del día local, ej "2026-08-24". Detecta la medianoche. */
function claveDeHoy() {
  const n = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

/**
 * Días enteros desde la ÉPOCA sobre medianoche LOCAL (el disco cambia
 * exactamente a las 00:00 del huso del sitio). Determinista: todos los
 * visitantes del mismo día obtienen el mismo número.
 */
function numeroDeDia() {
  const n = new Date();
  const medianocheHoy = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.max(0, Math.round((medianocheHoy - EPOCA.getTime()) / MS_POR_DIA));
}

/** Número de edición del header (#001 el día de la ÉPOCA). */
function numeroDeEdicion() {
  return numeroDeDia() + 1;
}


// ════════════════════════════════════════════════════════════════════
//  3. HASH Y NORMALIZACIÓN (IDs estables y orden determinista)
// ════════════════════════════════════════════════════════════════════

/** Hash FNV-1a de 32 bits: string → entero sin signo, determinista. */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Minúsculas + sin tildes + espacios colapsados ("Mí Luna" === "mi luna"). */
function normalizarTexto(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ID limpio de un álbum de Spotify desde URL (con o sin /intl-es/) o URI. */
function extraerSpotifyId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:spotify:album:|\/album\/)([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

/**
 * ID ESTABLE del álbum: ID de Spotify si existe (inmune a ediciones del
 * Sheet); si no, título+artista normalizados. Base del orden permanente,
 * de la deduplicación y del "fijado" diario.
 */
function albumId(a) {
  return extraerSpotifyId(a.spotifyUrl) ||
         normalizarTexto(a.title) + "::" + normalizarTexto(a.artist);
}

/**
 * ¿URL http(s) realmente utilizable? Descarta textos ("Ig: leo.deza") y
 * hosts sin forma de dominio ("https://Polaroid!") que `new URL()` tolera.
 */
function esHttpValida(u) {
  try {
    const url = new URL(String(u).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(url.hostname) ||
           url.hostname === "localhost";
  } catch (_) {
    return false;
  }
}


// ════════════════════════════════════════════════════════════════════
//  4. PARSEO DE DATOS (CSV robusto + tabla gviz JSONP)
// ════════════════════════════════════════════════════════════════════

/**
 * Parser CSV RFC-4180 carácter a carácter: tolera comas y SALTOS DE LÍNEA
 * dentro de campos entre comillas (descripciones multilínea del Form),
 * comillas escapadas ("") y finales CRLF/LF + BOM.
 *
 * @param {string} texto  CSV crudo.
 * @returns {string[][]}  Matriz filas/celdas, sin filas totalmente vacías.
 */
function parseCSV(texto) {
  const s = String(texto || "").replace(/^\uFEFF/, "");
  const filas = [];
  let fila = [];
  let campo = "";
  let enComillas = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (enComillas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; } // "" → comilla literal
        else enComillas = false;
      } else {
        campo += c; // coma o \n DENTRO de comillas: contenido
      }
    } else {
      if (c === '"')        enComillas = true;
      else if (c === ",")  { fila.push(campo); campo = ""; }
      else if (c === "\n") { fila.push(campo); campo = ""; filas.push(fila); fila = []; }
      else if (c === "\r") { /* CRLF: el \n hace el corte */ }
      else                 campo += c;
    }
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }

  return filas.filter(f => f.some(v => String(v).trim() !== ""));
}

/**
 * Convierte el objeto `table` de la respuesta JSONP de gviz en la MISMA
 * matriz filas/celdas que produce parseCSV, para reutilizar todo el
 * pipeline posterior.
 *
 *  table.cols[i].label  → encabezados ("Título del Álbum", "Columna 1"...).
 *  table.rows[i].c[j]   → celdas {v: valor crudo, f: valor formateado}.
 *                         Se prefiere `f` (fechas/años legibles).
 *
 * Si gviz no reconoció la primera fila como encabezados (labels vacíos),
 * la primera fila de datos ES el encabezado y se promociona.
 */
function gvizATabla(table) {
  const cols = (table && table.cols) || [];
  const labels = cols.map(c => String((c && c.label) || "").trim());

  const filas = ((table && table.rows) || []).map(r =>
    cols.map((_, i) => {
      const cell = (r && r.c && r.c[i]) || null;
      if (!cell) return "";
      const v = (cell.f !== undefined && cell.f !== null) ? cell.f : cell.v;
      return v === undefined || v === null ? "" : String(v);
    })
  );

  if (labels.length && labels.every(l => l === "")) {
    const headers = filas.shift() || [];
    return [headers, ...filas];
  }
  return [labels, ...filas];
}

/**
 * Asigna cada encabezado (normalizado) a un rol interno. Funciona con la
 * hoja cruda del Form ("Título del Álbum", "Marca temporal", "Columna 1"…)
 * y con la hoja limpia "Álbumes" (title, artist, year…). El orden importa:
 * los roles específicos (spotify/youtube/portada/web) van primero porque
 * sus encabezados largos contienen palabras genéricas ("artista", "álbum").
 */
function asignarRoles(headers) {
  const roles = { titulo: -1, artista: -1, anio: -1, descripcion: -1, spotify: -1, youtube: -1, portada: -1, web: -1 };
  const libres = headers.map(() => true);

  const tomar = (rol, test) => {
    for (let i = 0; i < headers.length; i++) {
      if (libres[i] && test(headers[i])) { roles[rol] = i; libres[i] = false; return; }
    }
  };

  tomar("spotify",     h => /spotify/.test(h));
  tomar("youtube",     h => /youtube/.test(h));
  tomar("portada",     h => /portada|cover|tapa/.test(h));
  tomar("web",         h => /\bweb\b|bandcamp|soundcloud|instagram|sitio|oficial/.test(h));
  tomar("descripcion", h => /descripcion|description|resen/.test(h));
  tomar("anio",        h => /anio|lanzamiento|\bano\b|year/.test(h));
  tomar("artista",     h => /artista|artist|banda/.test(h));
  tomar("titulo",      h => /titulo|\btitle\b|album/.test(h));

  return roles;
}

/** Primer año de 4 dígitos del texto ("2019", "año 2019"...). */
function valorAnio(s) {
  const m = String(s || "").match(/\d{4}/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * Sanitiza la URL de portada: rechaza no-http(s), documentos de Google
 * (no embebibles) y convierte archivos de Drive a miniatura pública.
 */
function normalizarUrlPortada(u) {
  if (!esHttpValida(u)) return "";
  const url = String(u).trim();
  if (/docs\.google\.com\/(document|presentation|forms|spreadsheets)/.test(url)) return "";
  const drive = url.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/);
  if (drive) return `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w800`;
  return url;
}

/**
 * Matriz filas/celdas → catálogo final. Aplica:
 *  1. Mapeo de columnas por rol.
 *  2. Filtrado de auditoría (descarta "DUPLICADO" / "DESCARTADO"
 *     que el Apps Script escribe en columnas extra).
 *  3. Validación mínima: título + artista obligatorios.
 *  4. Saneo de URLs (http(s) válidas; inválidas → "").
 *  5. Deduplicación por ID estable conservando la primera aparición.
 */
function filasACatalogo(filas) {
  if (!filas || !filas.length) return [];

  const headers  = (filas[0] || []).map(normalizarTexto);
  const roles    = asignarRoles(headers);
  const ocupados = Object.values(roles);
  const libres   = headers.map((_, i) => !ocupados.includes(i));

  const celda = (fila, i) =>
    (i >= 0 && i < fila.length ? String(fila[i]) : "").trim();

  const vistos = new Set();
  const albums = [];

  for (const fila of filas.slice(1)) {
    // (2) Columnas de auditoría del script
    const auditoria = fila.filter((_, i) => libres[i]).join(" ");
    if (/duplicado|descartado/i.test(auditoria)) continue;

    // (1) + (3)
    const titulo  = celda(fila, roles.titulo);
    const artista = celda(fila, roles.artista);
    if (!titulo || !artista) continue;

    // (4)
    const album = {
      title:       titulo,
      artist:      artista,
      year:        valorAnio(celda(fila, roles.anio)),
      description: celda(fila, roles.descripcion),
      spotifyUrl:  esHttpValida(celda(fila, roles.spotify)) ? celda(fila, roles.spotify) : "",
      youtubeUrl:  esHttpValida(celda(fila, roles.youtube)) ? celda(fila, roles.youtube) : "",
      webUrl:      esHttpValida(celda(fila, roles.web))     ? celda(fila, roles.web)     : "",
      coverUrl:    normalizarUrlPortada(celda(fila, roles.portada)),
      country:     "Argentina · Tucumán",
    };

    // (5)
    const id = albumId(album);
    if (vistos.has(id)) continue;
    vistos.add(id);

    albums.push(album);
  }

  return albums;
}


// ════════════════════════════════════════════════════════════════════
//  5. SELECCIÓN DIARIA (determinista, estable e infinita)
// ════════════════════════════════════════════════════════════════════

/**
 * Orden PERMANENTE del catálogo por hash del ID estable. Insertar o
 * editar filas conserva el orden relativo de los demás discos: el
 * recorrido nunca se reinicia "desde el primero". Función pura.
 */
function ordenEstable(albums) {
  return albums
    .map(a => ({ a, h: fnv1a(albumId(a)) }))
    .sort((x, y) => x.h - y.h || albumId(x.a).localeCompare(albumId(y.a)))
    .map(o => o.a);
}

/** Índice modular seguro: ciclo infinito, jamás fuera de rango. */
function indiceParaDia(dia, total) {
  return ((dia % total) + total) % total;
}

/** Álbum que toca según fecha y catálogo (misma entrada → mismo resultado). */
function resolverAlbumBase(albums, dia) {
  const orden = ordenEstable(albums);
  return orden[indiceParaDia(dia, orden.length)];
}

/**
 * Álbum de HOY con "fijado" anti-ediciones: si ya se eligió hoy (registro
 * en localStorage con clave de fecha) se devuelve SIEMPRE ese, aunque el
 * Sheet cambie durante la jornada. La clave incluye la FECHA, así que a
 * medianoche caduca sola: la caché jamás impide el cambio diario.
 */
function resolverAlbumDeHoy(albums) {
  const hoy = claveDeHoy();
  const orden = ordenEstable(albums);

  const fijado = leerJSON(KS_HOY, false);
  if (fijado && fijado.fecha === hoy) {
    const album = orden.find(a => albumId(a) === fijado.id);
    if (album) return album;
  }

  const elegido = orden[indiceParaDia(numeroDeDia(), orden.length)];
  guardarJSON(KS_HOY, { fecha: hoy, id: albumId(elegido) }, false);
  return elegido;
}


// ════════════════════════════════════════════════════════════════════
//  6. ALMACENAMIENTO SEGURO
// ════════════════════════════════════════════════════════════════════

function leerJSON(clave, sesion) {
  try {
    const store = sesion ? sessionStorage : localStorage;
    const raw = store.getItem(clave);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function guardarJSON(clave, valor, sesion) {
  try {
    const store = sesion ? sessionStorage : localStorage;
    store.setItem(clave, JSON.stringify(valor));
  } catch (_) { /* sin almacenamiento: se continúa sin caché */ }
}

/** Limpia cachés de versiones anteriores (garantiza lecturas frescas). */
function limpiarCachesLegado() {
  try {
    CLAVES_LEGADO.forEach(k => {
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    });
  } catch (_) {}
}

function leerSesionFresca() {
  const dato = leerJSON(KS_SESION, true);
  if (!dato || !Array.isArray(dato.albums) || !dato.albums.length) return null;
  return (Date.now() - (dato.ts || 0)) < TTL_CACHE_MIN * 60000 ? dato.albums : null;
}

function leerSesion() {
  const dato = leerJSON(KS_SESION, true);
  return dato && Array.isArray(dato.albums) ? dato.albums : null;
}

function guardarSesion(albums) { guardarJSON(KS_SESION, { ts: Date.now(), albums }, true); }
function invalidarSesion() { try { sessionStorage.removeItem(KS_SESION); } catch (_) {} }
function guardarBackupLocal(albums) { guardarJSON(KS_BACKUP, { ts: Date.now(), albums }, false); }
function leerBackupLocal() {
  const dato = leerJSON(KS_BACKUP, false);
  return dato && Array.isArray(dato.albums) ? dato.albums : null;
}


// ════════════════════════════════════════════════════════════════════
//  7. RED: JSONP (primario) + FETCH (fallback), con logs de depuración
// ════════════════════════════════════════════════════════════════════

/**
 * Descarga la hoja vía JSONP de gviz. Los <script> no están sujetos a
 * CORS, por lo que funciona incluso abriendo index.html con file://.
 * gviz ejecutará `window[NOMBRE](data)` con la tabla completa.
 *
 * @returns {Promise<string[][]>} matriz filas/celdas.
 */
function descargarViaJSONP() {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      return reject(new Error("JSONP requiere navegador"));
    }

    // Nombre de callback único por intento (evita colisiones)
    const nombre = `__dtGvizCb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const script = document.createElement("script");
    let resuelto = false;

    const limpiar = () => {
      try { delete window[nombre]; } catch (_) { window[nombre] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    // Timeout: si gviz no responde, falla controladamente
    const temporizador = setTimeout(() => {
      if (resuelto) return;
      resuelto = true;
      limpiar();
      reject(new Error("Timeout esperando la respuesta de Google Sheets"));
    }, TIMEOUT_FETCH_MS);

    // Callback invocado por la respuesta JSONP
    window[nombre] = (data) => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(temporizador);
      limpiar();

      if (!data || data.status !== "ok" || !data.table) {
        const motivos = ((data && data.errors) || []).map(e => e.message || e.reason).join("; ");
        return reject(new Error(`gviz respondió '${data && data.status}' ${motivos}`.trim()));
      }
      resolve(gvizATabla(data.table));
    };

    script.onerror = () => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(temporizador);
      limpiar();
      reject(new Error("Fallo de red al cargar el script de Google Sheets"));
    };

    script.src =
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq` +
      `?tqx=out:json;responseHandler:${nombre}&gid=${GID}`;
    document.head.appendChild(script);
  });
}

/**
 * Endpoints fetch de respaldo (requieren CORS; hoy suelen fallar, pero se
 * mantienen por si la hoja se publica o Google cambia sus cabeceras).
 */
const URLS_CANDIDATAS = [
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID}`,
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/pub?gid=${GID}&single=true&output=csv`,
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`,
];

/** Heurística anti-página-de-login: el texto debe parecer un CSV. */
function pareceCSV(texto) {
  const t = String(texto || "").trim();
  return t.length >= 10 && t.includes(",") && !t.startsWith("<");
}

/**
 * Fallback: fetch clásico a las URLs candidatas, con timeout por intento.
 * @returns {Promise<string[][]>}
 */
async function descargarViaFetch() {
  for (const url of URLS_CANDIDATAS) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_FETCH_MS);
    try {
      console.log(`${LOG} Fetch de respaldo → ${url.split("/d/")[1] || url}`);
      const resp = await fetch(url, { signal: controlador.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const texto = await resp.text();
      if (!pareceCSV(texto)) throw new Error("La respuesta no es un CSV");
      console.log(`${LOG} Fetch OK desde ${url.split("/d/")[1] || url}`);
      return parseCSV(texto);
    } catch (e) {
      console.warn(`${LOG} Fetch falló (${e.message}): ${url}`);
    } finally {
      clearTimeout(temporizador);
    }
  }
  throw new Error("Todos los endpoints de descarga fallaron");
}

/**
 * Cadena de descarga: 1) JSONP (sin CORS) → 2) fetch a candidatas.
 * @returns {Promise<{filas: string[][], fuente: string}>}
 */
async function obtenerFilas() {
  try {
    console.log(`${LOG} Descargando catálogo vía JSONP (gviz, sin CORS)...`);
    const filas = await descargarViaJSONP();
    console.log(`${LOG} JSONP OK — ${Math.max(0, filas.length - 1)} filas de datos recibidas`);
    return { filas, fuente: "jsonp" };
  } catch (e) {
    console.warn(`${LOG} JSONP falló: ${e.message}. Probando fetch...`);
  }
  return { filas: await descargarViaFetch(), fuente: "fetch" };
}

/**
 * Orquestador de carga con degradación elegante:
 *  sesión fresca → red (JSONP/fetch) → sesión vieja → backup local → error.
 * Registra por consola la fuente utilizada para facilitar depuración.
 */
async function cargarCatalogo({ forzarRed = false } = {}) {
  if (forzarRed) invalidarSesion();
  else {
    const fresca = leerSesionFresca();
    if (fresca) {
      console.log(`${LOG} Catálogo desde caché de sesión (${fresca.length} álbumes)`);
      return fresca;
    }
  }

  try {
    const { filas, fuente } = await obtenerFilas();
    const albums = filasACatalogo(filas);
    if (!albums.length) throw new Error("El catálogo llegó vacío o sin filas válidas");
    console.log(`${LOG} Catálogo procesado: ${albums.length} álbumes únicos (fuente: ${fuente})`);
    guardarSesion(albums);
    guardarBackupLocal(albums);
    return albums;
  } catch (errorRed) {
    console.error(`${LOG} Descarga falló: ${errorRed.message}`);
    const sesion = leerSesion();
    if (sesion && sesion.length) {
      console.warn(`${LOG} Usando caché de sesión anterior (${sesion.length} álbumes)`);
      return sesion;
    }
    const backup = leerBackupLocal();
    if (backup && backup.length) {
      console.warn(`${LOG} Usando backup local (${backup.length} álbumes)`);
      return backup;
    }
    throw errorRed;
  }
}


// ════════════════════════════════════════════════════════════════════
//  8. HELPERS DE UI
// ════════════════════════════════════════════════════════════════════

const $ = (id) => document.getElementById(id);

/** Paleta HSL determinística para portadas sin imagen. */
function paletaDesdeString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return [`hsl(${h},45%,38%)`, `hsl(${(h + 40) % 360},50%,28%)`, `hsl(${(h + 80) % 360},40%,20%)`];
}

/** Notificación flotante (.toast / .toast.show del CSS existente). */
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

/** Error controlado: mismos contenedores/clases → la UI nunca se rompe. */
function mostrarError(msg) {
  $("album-title").textContent = "Sin álbum por hoy";
  $("album-year").textContent  = "";
  $("artist-name").textContent = msg;
  $("spine-title").textContent = "Discos Tucumanos";
  $("meta-block").innerHTML    = "";
  $("description").textContent = "";
  const btn = $("btn-read-more");
  if (btn) btn.hidden = true;
  $("cd-cover").innerHTML      = `<div class="cd-cover-placeholder">${msg}</div>`;
}

/** Fecha/edición del header y año del footer (hora local). */
function pintarFecha() {
  const ahora = new Date();
  $("hdr-day").textContent  = ahora.getDate();
  $("hdr-date").textContent = ahora.toLocaleDateString("es-AR", {
    weekday: "long", month: "long", year: "numeric",
  });
  $("footer-year").textContent = ahora.getFullYear();
  $("issue-num").textContent   = "#" + String(numeroDeEdicion()).padStart(3, "0");
}


// ════════════════════════════════════════════════════════════════════
//  9. TRUNCADO DE DESCRIPCIÓN + MODAL "LEER MÁS"
// ════════════════════════════════════════════════════════════════════

/**
 * Analiza la descripción y decide si necesita truncado:
 *  · corta  → se muestra completa tal cual (sin interacción).
 *  · larga  → preview de ~DESC_RECORTE caracteres con corte limpio en
 *             palabra, y el texto completo queda disponible para el modal.
 */
function prepararDescripcion(desc) {
  const texto = String(desc || "").trim();
  if (!texto) return { completa: "", preview: "", esLarga: false };

  const lineas = texto.split(/\r?\n/).length;
  const esLarga = texto.length > DESC_MAX_CHARS || lineas > DESC_MAX_LINEAS;
  if (!esLarga) return { completa: texto, preview: texto, esLarga: false };

  let recorte = texto.slice(0, DESC_RECORTE);
  const ultimoEspacio = recorte.lastIndexOf(" ");
  if (ultimoEspacio > DESC_RECORTE * 0.5) recorte = recorte.slice(0, ultimoEspacio);
  return { completa: texto, preview: recorte.trimEnd() + "…", esLarga: true };
}

/** ¿El modal está visible? */
function modalAbierto() {
  const backdrop = $("modal-backdrop");
  return !!backdrop && backdrop.classList.contains("abierto");
}

/**
 * Abre el modal con el texto completo de la reseña. Oscurece el fondo
 * (backdrop + blur, ver css/modal.css), bloquea el scroll de la página
 * y mueve el foco al botón de cierre (accesibilidad teclado).
 */
function abrirModal(titulo, meta, texto) {
  const backdrop = $("modal-backdrop");
  if (!backdrop) return;

  $("modal-title").textContent = titulo || "";
  $("modal-meta").textContent  = meta || "";
  $("modal-body").textContent  = texto || "";
  $("modal-body").scrollTop    = 0; // siempre arranca desde arriba

  estado.focoPrevio = document.activeElement;
  backdrop.classList.add("abierto");
  document.body.style.overflow = "hidden"; // sin scroll de fondo
  $("modal-close").focus();
}

/** Cierra el modal restaurando scroll y foco previos. */
function cerrarModal() {
  const backdrop = $("modal-backdrop");
  if (!backdrop || !backdrop.classList.contains("abierto")) return;

  backdrop.classList.remove("abierto");
  document.body.style.overflow = "";
  if (estado.focoPrevio && estado.focoPrevio.focus) estado.focoPrevio.focus();
  estado.focoPrevio = null;
}

/** Registra una sola vez todos los mecanismos de cierre y apertura. */
function configurarModal() {
  const backdrop = $("modal-backdrop");
  if (!backdrop) return;

  // 1) Botón ×
  $("modal-close").addEventListener("click", cerrarModal);

  // 2) Clic en cualquier punto del backdrop FUERA del contenido
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) cerrarModal();
  });

  // 3) Tecla ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalAbierto()) cerrarModal();
  });

  // "Leer más" y la propia descripción truncada abren el modal
  const abrirDesdeEstado = () => {
    if (estado.descripcionCompleta) {
      abrirModal(estado.albumTitulo, estado.albumMeta, estado.descripcionCompleta);
    }
  };
  $("btn-read-more").addEventListener("click", abrirDesdeEstado);
  $("description").addEventListener("click", abrirDesdeEstado);
}


// ════════════════════════════════════════════════════════════════════
//  10. RENDER
// ════════════════════════════════════════════════════════════════════

/** Estado compartido de la página (compartir, modal, vigilante). */
const estado = {
  fecha: "",
  album: null,
  catalogo: [],
  descripcionCompleta: "", // alimenta el modal
  albumTitulo: "",
  albumMeta: "",
  focoPrevio: null,
};

/**
 * Pinta el álbum del día usando solo IDs/clases existentes en
 * index.html + las nuevas clases del modal (css/modal.css).
 */
function renderAlbum(album) {
  // Encabezado central
  $("album-title").textContent = album.title;
  $("album-year").textContent  = album.year ? `(${album.year})` : "";
  $("artist-name").textContent = album.artist;
  $("spine-title").textContent = `${album.title} · ${album.artist}`;

  // Ficha técnica (columna izquierda)
  const meta = [
    { k: "Origen", v: album.country || "—" },
    { k: "Año",    v: album.year || "—" },
  ];
  $("meta-block").innerHTML = meta
    .map(({ k, v }) => `
      <div class="meta-row">
        <span class="meta-key">${k}</span>
        <span class="meta-val">${v}</span>
      </div>`)
    .join("");

  const generos = $("genre-section");
  if (generos) generos.style.display = "none";

  // Portada (cadena: portada explícita → oEmbed Spotify → gradiente)
  pintarPortada(album);

  // Botones: link real si existe; si no, búsqueda directa
  const q = encodeURIComponent(`${album.title} ${album.artist}`);
  $("btn-spotify").href = album.spotifyUrl || `https://open.spotify.com/search/${q}`;
  $("btn-youtube").href = album.youtubeUrl || `https://music.youtube.com/search?q=${q}`;

  // Web del artista: visible solo con URL válida
  const webBtn = $("artist-web");
  if (webBtn) {
    if (album.webUrl) {
      webBtn.style.display = "inline-block";
      webBtn.href = album.webUrl;
    } else {
      webBtn.style.display = "none";
    }
  }

  // ── Descripción con truncado + "Leer más" ──
  const info = prepararDescripcion(album.description);
  const parrafo = $("description");
  const btnMas = $("btn-read-more");

  parrafo.textContent = info.esLarga ? info.preview : info.completa;
  parrafo.classList.toggle("description-clicable", info.esLarga);
  if (btnMas) btnMas.hidden = !info.esLarga;

  // Datos que usará el modal al hacer clic
  estado.descripcionCompleta = info.completa;
  estado.albumTitulo = album.title;
  estado.albumMeta = `${album.artist}${album.year ? " · " + album.year : ""}`;

  // Tracklist: sin datos en este setup (sección oculta por CSS)
  $("tracklist").innerHTML =
    `<li style="opacity:.45;font-style:italic;">Tracklist no disponible</li>`;
}

/** Portada degradada con gradiente derivado del nombre (nodo DOM seguro). */
function gradientePortada(album) {
  const [c1, c2, c3] = paletaDesdeString(album.title + album.artist);

  const capas = document.createElement("div");
  capas.style.cssText =
    `width:100%;height:100%;background:linear-gradient(135deg,${c1} 0%,${c2} 60%,${c3} 100%);` +
    `display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center;`;

  const texto = document.createElement("div");
  texto.style.cssText =
    `font-family:'Playfair Display',serif;color:rgba(255,255,255,.9);font-size:1.1rem;` +
    `font-weight:700;line-height:1.3;text-shadow:0 2px 12px rgba(0,0,0,.3);`;
  texto.append(album.title);
  texto.append(document.createElement("br"));

  const artista = document.createElement("span");
  artista.style.cssText = `font-weight:400;font-style:italic;font-size:.85rem;`;
  artista.textContent = album.artist;
  texto.append(artista);

  capas.append(texto);
  return capas;
}


// ════════════════════════════════════════════════════════════════════
//  11. PORTADA: CADENA DE RESOLUCIÓN ASÍNCRONA
// ════════════════════════════════════════════════════════════════════

/** Token anti-carrera: solo la última petición de portada escribe en DOM. */
let tokenPortada = 0;

/** ¿Carga realmente la imagen? Evita íconos rotos con links caídos. */
function probarImagen(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/** Miniatura vía oEmbed público de Spotify (sin API key; nunca lanza). */
async function traerThumbnailSpotify(spotifyUrl) {
  try {
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
    const resp = await fetch(endpoint);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.thumbnail_url || null;
  } catch (_) {
    return null;
  }
}

/** Candidatos ordenados: portada explícita del Sheet → tapa de Spotify. */
async function candidatosPortada(album) {
  const lista = [];
  if (album.coverUrl) lista.push(album.coverUrl);
  if (album.spotifyUrl && /open\.spotify\.com/.test(album.spotifyUrl)) {
    const thumb = await traerThumbnailSpotify(album.spotifyUrl);
    if (thumb) lista.push(thumb);
  }
  return lista;
}

/** Prueba candidatos en orden; si ninguno carga, gradiente tipográfico. */
async function pintarPortada(album) {
  const contenedor = $("cd-cover");
  const token = ++tokenPortada;

  const urls = await candidatosPortada(album);
  if (token !== tokenPortada) return;

  for (const url of urls) {
    if (await probarImagen(url)) {
      if (token !== tokenPortada) return;
      const img = document.createElement("img");
      img.src = url;
      img.alt = `Portada de ${album.title}`;
      contenedor.replaceChildren(img);
      return;
    }
  }

  if (token === tokenPortada) contenedor.replaceChildren(gradientePortada(album));
}


// ════════════════════════════════════════════════════════════════════
//  12. EVENTOS
// ════════════════════════════════════════════════════════════════════

/** Compartir usa el álbum FIJADO de hoy (estado), nunca recalcula. */
function configurarBotonCompartir() {
  $("btn-share").addEventListener("click", async () => {
    const a = estado.album;
    if (!a) { showToast("Todavía no hay álbum cargado"); return; }

    const shareData = {
      title: `${a.title} · ${a.artist}`,
      text:  `Hoy en Discos Tucumanos: "${a.title}" (${a.year}) de ${a.artist}. ¡Escuchalo!`,
      url:   window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`);
        showToast("¡Enlace copiado al portapapeles!");
      }
    } catch (err) {
      if (err.name !== "AbortError") showToast("No se pudo compartir");
    }
  });
}

/**
 * Vigilante de medianoche: pestaña abierta cruzando las 00:00 (o que
 * vuelve de segundo plano en un nuevo día) → refresca fecha, invalida
 * caché y repinta con el disco nuevo. La caché jamás frena el cambio.
 */
function vigilarCambioDeDia() {
  const comprobar = async () => {
    if (claveDeHoy() === estado.fecha) return;
    console.log(`${LOG} Cambió el día → actualizando álbum del día`);
    estado.fecha = claveDeHoy();
    pintarFecha();
    await cargarYPintar(true);
  };

  setInterval(() => { comprobar().catch(() => {}); }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) comprobar().catch(() => {});
  });
}


// ════════════════════════════════════════════════════════════════════
//  13. ORQUESTACIÓN E INICIO
// ════════════════════════════════════════════════════════════════════

/** Ciclo completo: cargar catálogo (con fallbacks) → fijar/pintar álbum. */
async function cargarYPintar(forzarRed) {
  try {
    const albums = await cargarCatalogo({ forzarRed });
    estado.catalogo = albums;

    const album = resolverAlbumDeHoy(albums);
    estado.album = album;

    const total = albums.length;
    const orden = ordenEstable(albums);
    const posicion = orden.findIndex(a => albumId(a) === albumId(album));
    console.log(
      `${LOG} Álbum de hoy: "${album.title}" — ${album.artist} ` +
      `(edición #${numeroDeEdicion()}, día ${numeroDeDia()}, disco ${posicion + 1}/${total})`
    );

    renderAlbum(album);
    document.title = `${album.title} · ${album.artist} — Discos Tucumanos`;

  } catch (err) {
    console.error(`${LOG} No se pudo cargar el catálogo:`, err);
    mostrarError("No se pudo cargar el catálogo.");
  }
}

/** Punto de entrada del sitio (solo navegador). */
function iniciarSitio() {
  limpiarCachesLegado(); // invalida cachés de versiones anteriores (v1)

  console.log(`${LOG} Iniciando… (protocolo: ${location.protocol})`);
  if (location.protocol === "file:") {
    console.info(
      `${LOG} Estás abriendo el sitio con file://. La descarga por JSONP ` +
      `debería funcionar igual; si algo fallara, serví la carpeta con un ` +
      `servidor local (ej: python -m http.server) y abrí http://localhost:8000`
    );
  }

  estado.fecha = claveDeHoy();
  pintarFecha();
  configurarBotonCompartir();
  configurarModal();
  vigilarCambioDeDia();
  cargarYPintar(false);
}

// Bootstrap: en el navegador arranca; en Node quedan expuestas las
// funciones puras para pruebas automatizadas.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  iniciarSitio();
}

// Exposición para tests fuera del navegador (opcional).
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseCSV, gvizATabla, asignarRoles, filasACatalogo, normalizarTexto,
    extraerSpotifyId, albumId, ordenEstable, indiceParaDia,
    resolverAlbumBase, numeroDeDia, claveDeHoy, prepararDescripcion,
  };
}

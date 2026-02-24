/**
 * app.js — Lógica principal de Discos Tucumanos
 *
 * Lee el catálogo desde un Google Sheet publicado como CSV.
 * Única línea a editar: SHEET_CSV_URL
 */

// ════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ════════════════════════════════════════════════════════════════

/**
 * URL del Google Sheet publicado como CSV.
 *
 * Cómo obtenerla:
 *  1. Google Sheet → Archivo → Compartir → Publicar en la web
 *  2. Seleccioná la hoja "Álbumes" y el formato "CSV"
 *  3. Copiá la URL y pegala aquí
 */
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTG8DJ_rNb6G0pwGQ_yNS94cO-N9APKmI55Wk4Z8n56QXNyXkT6mQubWWKhbQ9bquX-Hkw8EdQNKY4M/pub?gid=1032908286&single=true&output=csv";

/** Minutos de caché por sesión (evita fetches repetidos al navegar) */
const CACHE_MINUTOS = 60;


// ════════════════════════════════════════════════════════════════
//  PARSEO DE CSV
// ════════════════════════════════════════════════════════════════

/**
 * Parsea el CSV del Sheet en un array de objetos.
 * Maneja campos entre comillas con comas y saltos de línea internos.
 */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCSVRow(lines[0]);

  return lines.slice(1)
    .map(line => {
      const values = splitCSVRow(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h.trim()] = (values[i] || "").trim(); });
      return obj;
    })
    .filter(row => row.title && row.artist);
}

/** Divide una fila CSV respetando campos entre comillas. */
function splitCSVRow(row) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"' && row[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

/**
 * Convierte una fila del CSV al objeto álbum interno.
 * Columnas del Sheet: title, artist, year, description, spotify, youtube, web, timestamp, cover
 */
function csvRowToAlbum(row) {
  return {
    title: row.title || "",
    artist: row.artist || "",
    year: parseInt(row.year, 10) || 0,
    description: row.description || "",
    spotifyUrl: row.spotify || "",
    youtubeUrl: row.youtube || "",
    webUrl: row.web || "",
    coverUrl: row.cover || "",
    country: "Argentina · Tucumán",
  };
}


// ════════════════════════════════════════════════════════════════
//  CACHÉ DE SESIÓN
// ════════════════════════════════════════════════════════════════

const CACHE_KEY = "dt_albums";
const CACHE_TS = "dt_albums_ts";

function guardarCache(albums) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(albums));
    sessionStorage.setItem(CACHE_TS, Date.now().toString());
  } catch (_) { }
}

function leerCache() {
  try {
    const ts = parseInt(sessionStorage.getItem(CACHE_TS) || "0", 10);
    const expired = (Date.now() - ts) > CACHE_MINUTOS * 60_000;
    if (expired) return null;
    const data = sessionStorage.getItem(CACHE_KEY);
    return data ? JSON.parse(data) : null;
  } catch (_) { return null; }
}


// ════════════════════════════════════════════════════════════════
//  CARGA DE DATOS
// ════════════════════════════════════════════════════════════════

async function cargarAlbumes() {
  const cached = leerCache();
  if (cached?.length) return cached;

  const resp = await fetch(SHEET_CSV_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const albums = parseCSV(await resp.text()).map(csvRowToAlbum);
  guardarCache(albums);
  return albums;
}


// ════════════════════════════════════════════════════════════════
//  SELECCIÓN DIARIA
// ════════════════════════════════════════════════════════════════

/** Índice consistente para todos los usuarios en el mismo día. */
function getDayIndex(total) {
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86_400_000);
  return (now.getFullYear() * 1000 + dayOfYear) % total;
}

/** Número de edición autoincremental desde el 1/1/2025. */
function getIssueNumber() {
  return Math.max(1, Math.floor((new Date() - new Date("2025-01-01")) / 86_400_000) + 1);
}


// ════════════════════════════════════════════════════════════════
//  HELPERS DE UI
// ════════════════════════════════════════════════════════════════

/** Paleta de 3 colores HSL determinísticos desde un string. */
function paletteFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return [`hsl(${h},45%,38%)`, `hsl(${(h + 40) % 360},50%,28%)`, `hsl(${(h + 80) % 360},40%,20%)`];
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

function mostrarError(msg) {
  document.getElementById("album-title").textContent = "Sin álbum por hoy";
  document.getElementById("artist-name").textContent = msg;
  document.getElementById("cd-cover").innerHTML = `<div class="cd-cover-placeholder">${msg}</div>`;
  document.getElementById("description").textContent = "";
}


// ════════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════════

function renderAlbum(album) {
  // Encabezado
  document.getElementById("album-title").textContent = album.title;
  document.getElementById("album-year").textContent = `(${album.year})`;
  document.getElementById("artist-name").textContent = album.artist;
  document.getElementById("spine-title").textContent = `${album.title} · ${album.artist}`;

  // Ficha técnica (sin géneros)
  const meta = [
    { k: "Origen", v: album.country || "—" },
    { k: "Año", v: album.year },
  ];
  document.getElementById("meta-block").innerHTML = meta
    .map(({ k, v }) => `
      <div class="meta-row">
        <span class="meta-key">${k}</span>
        <span class="meta-val">${v}</span>
      </div>`)
    .join("");

  // Ocultar sección de géneros (no se usa en este setup)
  const genreSection = document.getElementById("genre-section");
  if (genreSection) genreSection.style.display = "none";

  // Portada
  const coverEl = document.getElementById("cd-cover");
  if (album.coverUrl) {
    // Portada provista manualmente
    const img = new Image();
    img.onload = () => { coverEl.innerHTML = `<img src="${album.coverUrl}" alt="Portada de ${album.title}">`; };
    img.onerror = () => { coverEl.innerHTML = buildGradientCover(album); };
    img.src = album.coverUrl;
  } else if (album.spotifyUrl && album.spotifyUrl.includes("spotify")) {
    // Intentar obtener la tapa desde Spotify oEmbed (sin API key)
    fetchSpotifyCover(album.spotifyUrl)
      .then(imgUrl => {
        if (imgUrl) {
          coverEl.innerHTML = `<img src="${imgUrl}" alt="Portada de ${album.title}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
        } else {
          coverEl.innerHTML = buildGradientCover(album);
        }
      })
      .catch(() => { coverEl.innerHTML = buildGradientCover(album); });
  } else {
    coverEl.innerHTML = buildGradientCover(album);
  }

  // Botones
  const q = encodeURIComponent(`${album.title} ${album.artist}`);
  document.getElementById("btn-spotify").href = album.spotifyUrl || `https://open.spotify.com/search/${q}`;
  document.getElementById("btn-youtube").href = album.youtubeUrl || `https://music.youtube.com/search?q=${q}`;

  // Mostrar enlace de la web del artista si existe
  // Localiza el botón en el HTML
  const webBtn = document.getElementById("artist-web");

  if (webBtn) {
    // Si el álbum tiene link de web, lo mostramos y asignamos el href
    if (album.webUrl && album.webUrl.trim() !== "") {
      webBtn.style.display = "inline-block";
      webBtn.href = album.webUrl;
    } else {
      // Si no tiene, lo ocultamos para que no quede un botón vacío
      webBtn.style.display = "none";
    }
  }

  // Descripción
  document.getElementById("description").textContent = album.description || "";

  // Tracklist: no disponible en este setup
  document.getElementById("tracklist").innerHTML =
    `<li style="opacity:.45;font-style:italic;">Tracklist no disponible</li>`;
}

function buildGradientCover(album) {
  const [c1, c2, c3] = paletteFromString(album.title + album.artist);
  return `
    <div style="width:100%;height:100%;
      background:linear-gradient(135deg,${c1} 0%,${c2} 60%,${c3} 100%);
      display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center;">
      <div style="font-family:'Playfair Display',serif;color:rgba(255,255,255,.9);
        font-size:1.1rem;font-weight:700;line-height:1.3;text-shadow:0 2px 12px rgba(0,0,0,.3);">
        ${album.title}<br>
        <span style="font-weight:400;font-style:italic;font-size:.85rem;">${album.artist}</span>
      </div>
    </div>`;
}


// ════════════════════════════════════════════════════════════════
//  PORTADA DESDE SPOTIFY
// ════════════════════════════════════════════════════════════════

/**
 * Obtiene la URL de la imagen de tapa del álbum usando el endpoint oEmbed de Spotify.
 * No requiere API key. Devuelve null si falla o la URL no corresponde a un álbum/track.
 *
 * @param {string} spotifyUrl - URL de Spotify (álbum, track o playlist)
 * @returns {Promise<string|null>}
 */
async function fetchSpotifyCover(spotifyUrl) {
  try {
    const oembedEndpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
    const resp = await fetch(oembedEndpoint);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.thumbnail_url || null;
  } catch {
    return null;
  }
}


// ════════════════════════════════════════════════════════════════
//  COMPARTIR
// ════════════════════════════════════════════════════════════════

document.getElementById("btn-share").addEventListener("click", async () => {
  const albums = leerCache();
  if (!albums?.length) return;

  const a = albums[getDayIndex(albums.length)];
  const shareData = {
    title: `${a.title} · ${a.artist}`,
    text: `Hoy en Discos Tucumanos: "${a.title}" (${a.year}) de ${a.artist}. ¡Escuchalo!`,
    url: window.location.href,
  };

  try {
    if (navigator.share) await navigator.share(shareData);
    else {
      await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`);
      showToast("¡Enlace copiado al portapapeles!");
    }
  } catch (err) {
    if (err.name !== "AbortError") showToast("No se pudo compartir");
  }
});


// ════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════

async function init() {
  const now = new Date();

  document.getElementById("hdr-day").textContent = now.getDate();
  document.getElementById("hdr-date").textContent = now.toLocaleDateString("es-AR", {
    weekday: "long", month: "long", year: "numeric",
  });
  document.getElementById("footer-year").textContent = now.getFullYear();
  document.getElementById("issue-num").textContent =
    "#" + String(getIssueNumber()).padStart(3, "0");

  try {
    const albums = await cargarAlbumes();

    if (!albums.length) {
      mostrarError("El catálogo está vacío — ¡cargá el primer álbum!");
      return;
    }

    const album = albums[getDayIndex(albums.length)];
    renderAlbum(album);
    document.title = `${album.title} · ${album.artist} — Discos Tucumanos`;

  } catch (err) {
    console.error("Error cargando álbumes:", err);
    mostrarError("No se pudo cargar el catálogo.");
  }
}

init();

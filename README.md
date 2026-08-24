# El Disco Tucumano de Hoy

> Un álbum por día · desde el NOA

Sitio estático que recomienda **un único disco tucumano por día**, idéntico para
todos los visitantes durante las 24 horas. El catálogo vive en una Google Sheet
alimentada por un formulario público, y el sitio lo consume directamente desde
el navegador — sin backend, sin build, sin dependencias.

---

## Características

- **Un disco por día** — la recomendación es una función pura de la fecha:
  mismo día → mismo álbum en todo el mundo. Cambia exactamente a la medianoche
  (incluso si la pestaña queda abierta, gracias a un vigilante interno).
- **Inmune a nuevos ingresos** — el orden de recorrido se calcula con un hash
  determinista del ID de cada álbum: agregar discos a la planilla **no reinicia
  la secuencia** ni altera el sentido del recorrido.
- **Ciclo infinito** — cuando los días superan la cantidad de discos, el
  recorrido vuelve a empezar solito (aritmética modular, jamás `undefined`).
- **Descarga sin CORS** — usa JSONP sobre el endpoint `gviz` de Google Sheets,
  por lo que funciona incluso abriendo el `index.html` con doble clic
  (`file://`), GitHub Pages, Netlify o cualquier hosting estático.
- **Fallbacks en cascada** — JSONP → fetch → caché de sesión → backup local →
  pantalla de error elegante. Si Google falla, el sitio no se rompe.
- **Modal "Leer más"** — las reseñas largas se truncan con un preview y abren
  un modal editorial con scroll propio (cierre con ×, clic fuera o `ESC`).
- **Deduplicación automática** — descarta filas marcadas como duplicadas por
  el script de auditoría y sanea URLs inválidas.
- **Portadas con cadena de fallbacks** — columna de portada (incluye links de
  Google Drive) → miniatura vía oEmbed de Spotify → gradiente tipográfico.

---

## Estructura del proyecto

```
discos-tucumanos/
├── index.html          # Maquetación (diario / ficha editorial)
├── css/
│   ├── style.css       # Estilos principales (paleta vintage, tipografías)
│   └── modal.css       # Modal "Leer más"
├── js/
│   └── app.js          # Toda la lógica (documentada)
├── assets/
│   └── favicon.png
├── Code.gs             # Google Apps Script (va en el Sheet, NO en el hosting)
└── README.md
```

100% estático: no hay paso de build ni dependencias de npm.

---

## Configuración

Toda la configuración vive en las primeras líneas de `js/app.js`:

```js
const SPREADSHEET_ID = "1jkW5jLHwoS1SZDIlzD4pGdBAl9u_kBuEDFvG4metQXM";
const GID = "0"; // pestaña del Sheet (0 = la primera)
```

Para apuntar el sitio a **tu propia planilla**:

1. Tomá el ID de la URL de tu Sheet:
   `https://docs.google.com/spreadsheets/d/`**`ESTE_ES_EL_ID`**`/edit`
2. Pegalo en `SPREADSHEET_ID` dentro de `js/app.js`.
3. Si tu catálogo está en otra pestaña, ajustá `GID`
   (el GID aparece en la URL al cambiar de pestaña: `.../edit#gid=123456`).

### Formato de la planilla

El parser detecta las columnas **por nombre de encabezado** (case-insensitive,
con o sin tildes), así que funciona tanto con la hoja cruda de respuestas del
Formulario como con una hoja limpia tipo "Álbumes":

| Dato buscado | Encabezados que reconoce |
|---|---|
| Título | `Título del Álbum`, `titulo`, `title` |
| Artista | `Nombre del Artista o Banda`, `artista`, `artist` |
| Año | `Año de Lanzamiento`, `anio`, `year` |
| Descripción | `Descripción del Álbum`, `descripcion` |
| Spotify | `Link de Spotify del Álbum`, `spotify` |
| YouTube | `Link de YouTube Music del Álbum`, `youtube` |
| Portada | `Link a la Portada del Álbum`, `portada`, `cover` |
| Web del artista | `Link a Web Oficial...`, `web`, `bandcamp` |

Notas:

- Las **columnas extra** (como `Marca temporal` o las columnas de auditoría
  `✅ APROBADO` / `⚠️ DUPLICADO`) se ignoran; las filas marcadas como
  `DUPLICADO` o `DESCARTADO` se descartan automáticamente.
- Solo se exigen **título y artista**; el resto de los campos es opcional y la
  UI se degrada con elegancia (botones que caen a búsqueda, gradiente de
  portada, etc.).

---

## Cómo se elige el disco del día

1. Cada álbum recibe un **ID estable** (ID de Spotify, o título + artista si no
   tiene link).
2. El catálogo completo se ordena por el **hash FNV-1a** de ese ID → un orden
   permanente que no depende del orden de filas del Sheet.
3. El disco mostrado es `orden[día_desde_01/01/2025 % total]`.
4. El álbum elegido queda **fijado en `localStorage`** con la clave de fecha:
   aunque edites la planilla a mitad del día, lo que ya se mostró hoy no cambia.
   A medianoche el fijado caduca solo.

Esto garantiza: consistencia global, cero reinicios al agregar discos, y
recorrido completo del catálogo antes de repetir.

---

## Desarrollo local

No hace falta servidor (el JSONP funciona con `file://`), pero si preferís uno:

```bash
# desde esta carpeta
python -m http.server 8000
# → http://localhost:8000
```

### Depuración

La consola del navegador registra toda la cadena de carga con el prefijo
`[Discos Tucumanos]`:

```
[Discos Tucumanos] Descargando catálogo vía JSONP (gviz, sin CORS)...
[Discos Tucumanos] JSONP OK — 14 filas de datos recibidas
[Discos Tucumanos] Catálogo procesado: 13 álbumes únicos (fuente: jsonp)
[Discos Tucumanos] Álbum de hoy: "Doble Urbana" — ... (edición #602, día 601, disco 8/13)
```

Para forzar una lectura fresca del Sheet, borrá las claves `dt_*` del
almacenamiento del sitio (DevTools → Application → Storage) o simplemente
abrí en ventana de incógnito. Las cachés de versiones anteriores se limpian
solas en cada arranque.

---

## Google Apps Script (`Code.gs`)

El archivo `Code.gs` **no se publica** con el sitio: va pegado en el editor de
Apps Script del Sheet (Extensiones → Apps Script) para procesar cada respuesta
del formulario: valida título/artista, detecta duplicados por ID de Spotify,
descarga la portada vía oEmbed y escribe el estado de auditoría en columnas
extra que el sitio luego filtra.

Instalación resumida:

1. Sheet vinculado al Form → **Extensiones → Apps Script**.
2. Pegar el contenido de `Code.gs` y guardar.
3. Ejecutar `instalarTrigger` una vez y autorizar los permisos.

---

## Créditos

Desarrollado con amor por [Paetí](https://paeti.com.ar).
¿Necesitás una web para tu banda, proyecto artístico, productora o sala?
[Contactame acá](https://wa.link/xy0ozj).

Proponé un álbum: [formulario público](https://forms.gle/GxFXStfQcStopraYA)

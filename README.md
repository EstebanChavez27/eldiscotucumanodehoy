# 💿 Discos Tucumanos — Un álbum por día

Una plataforma web minimalista dedicada a difundir la música de Tucumán (Argentina). El sitio presenta un álbum destacado de forma diaria, automatizando la gestión de contenido a través de Google Sheets.

## 🚀 Características
* **Gestión vía Google Sheets:** Utiliza una hoja de cálculo como sistema de gestión de contenidos (CMS) dinámico.
* **Automatización con Google Apps Script:** Procesa automáticamente las respuestas de un formulario, extrae portadas de Spotify y organiza el catálogo.
* **Consumo de Datos en Tiempo Real:** El frontend consume los datos publicados en formato CSV para una carga ligera y rápida.
* **Diseño Responsivo:** Interfaz moderna centrada en la experiencia visual del disco físico.

## 🛠️ Tecnologías utilizadas
* **Frontend:** HTML5, CSS3 (Variables, Flexbox, Grid) y Vanilla JavaScript.
* **Backend/Automatización:** Google Apps Script (JavaScript V8).
* **Fuentes de datos:** Google Sheets API (CSV Publication).
* **Integraciones:** Spotify oEmbed API para obtención de portadas.

## 📦 Estructura del Proyecto
* `/index.html`: Estructura principal del sitio.
* `/css/style.css`: Estilos, animaciones y diseño del "CD Case".
* `/js/app.js`: Lógica de consumo de CSV, caché de sesión y renderizado dinámico.
* `/assets/`: Favicon y recursos gráficos.
* `Google_Apps_Script.gs`: Código para el procesamiento automático en la nube.

## ⚙️ Configuración
Para replicar este proyecto:
1.  Configura un **Google Form** para la carga de álbumes.
2.  Vincula el formulario a una hoja de cálculo y pega el código de `Google_Apps_Script.gs`.
3.  Publica la hoja de destino ("Álbumes") como **CSV** (Archivo > Compartir > Publicar en la web).
4.  Actualiza la constante `SHEET_CSV_URL` en `js/app.js` con tu enlace generado.

## ✒️ Créditos
Desarrollado por **Esteban** (Paetí) con el objetivo de promover la cultura musical del Norte Argentino.

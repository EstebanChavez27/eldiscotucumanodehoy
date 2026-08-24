var SHEET_RESPUESTAS = "Respuestas de formulario 1"; 
var SHEET_ALBUMES    = "Álbumes";

// Mapeo del Formulario (No cambiar el orden aquí)
var COL = { TIMESTAMP: 1, TITULO: 2, ARTISTA: 3, ANIO: 4, DESCRIPCION: 5, SPOTIFY: 6, YOUTUBE: 7, WEB: 8 };

function instalarTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("onFormSubmit").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onFormSubmit().create();
  obtenerOCrearHojaAlbumes(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert("✅ Sistema listo.");
}

function onFormSubmit(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetForm = ss.getSheetByName(SHEET_RESPUESTAS);
  var sheetAlbums = obtenerOCrearHojaAlbumes(ss);
  var lastRow = sheetForm.getLastRow();
  var rowData = sheetForm.getRange(lastRow, 1, 1, sheetForm.getLastColumn()).getValues()[0];
  procesarFila(sheetForm, sheetAlbums, rowData, lastRow);
}

function reprocesarTodo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetForm = ss.getSheetByName(SHEET_RESPUESTAS);
  var sheetVieja = ss.getSheetByName(SHEET_ALBUMES);
  if (sheetVieja) ss.deleteSheet(sheetVieja);
  var sheetAlbums = obtenerOCrearHojaAlbumes(ss);
  var data = sheetForm.getRange(2, 1, sheetForm.getLastRow() - 1, sheetForm.getLastColumn()).getValues();
  data.forEach((row, i) => procesarFila(sheetForm, sheetAlbums, row, i + 2));
  SpreadsheetApp.getUi().alert("✅ Reprocesamiento completo.");
}

function procesarFila(sheetForm, sheetAlbums, rowData, rowIndex) {
  var t = limpiar(rowData[COL.TITULO - 1]);
  var a = limpiar(rowData[COL.ARTISTA - 1]);
  if (!t || !a) return;

  var cover = getCoverFromSpotify(limpiar(rowData[COL.SPOTIFY - 1]));
  
  // El orden de este array DEBE coincidir con los headers de obtenerOCrearHojaAlbumes
  sheetAlbums.appendRow([
    t, a, limpiar(rowData[COL.ANIO - 1]), 
    limpiar(rowData[COL.DESCRIPCION - 1]), limpiar(rowData[COL.SPOTIFY - 1]), 
    limpiar(rowData[COL.YOUTUBE - 1]), limpiar(rowData[COL.WEB - 1]),
    new Date().toISOString(), cover
  ]);

  marcarFila(sheetForm, rowIndex, "✅ PROCESADO", "#d9ead3");
}

function getCoverFromSpotify(url) {
  if (!url || !url.includes("spotify")) return "";
  try {
    var oembedUrl = "https://open.spotify.com/oembed?url=" + encodeURIComponent(url.trim());
    var response = UrlFetchApp.fetch(oembedUrl, { muteHttpExceptions: true });
    return response.getResponseCode() === 200 ? JSON.parse(response.getContentText()).thumbnail_url : "";
  } catch (e) { return ""; }
}

function obtenerOCrearHojaAlbumes(ss) {
  var sheet = ss.getSheetByName(SHEET_ALBUMES) || ss.insertSheet(SHEET_ALBUMES);
  if (sheet.getLastRow() === 0) {
    // ESTOS SON LOS HEADERS QUE LEE EL APP.JS
    var headers = ["title", "artist", "year", "description", "spotify", "youtube", "web", "timestamp", "cover"];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function marcarFila(sheet, rowIndex, estado, color) {
  var col = sheet.getLastColumn();
  sheet.getRange(rowIndex, col).setValue(estado);
  sheet.getRange(rowIndex, 1, 1, col).setBackground(color);
}

function limpiar(val) { return val ? String(val).trim() : ""; }
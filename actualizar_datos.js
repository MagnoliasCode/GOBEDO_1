// Regenera data.js (y una copia ligera en CSV) a partir de "Encuesta GOB EDO 2.xlsx".
//
// Uso, desde la raiz del proyecto:
//   node actualizar_datos.js            -> procesa el Excel una vez
//   node actualizar_datos.js --vigilar  -> se queda escuchando y regenera cada vez que se guarda el Excel
//
// El Excel trae formulas INDEX/MATCH contra un libro externo (INE BdD Definitiva.xlsx) y Excel
// guarda una copia en cache de ese libro (varios GB) dentro del .xlsx. Por eso aqui NO se usa una
// libreria de Excel: se lee el .zip a mano y solo se descomprimen las partes necesarias
// (hoja, sharedStrings, workbook), tomando el ultimo valor calculado de cada celda.
// Funciona aunque el archivo este abierto en Excel.

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var RAIZ = __dirname;
var ARCHIVO_EXCEL = path.join(RAIZ, 'Encuesta GOB EDO 2.xlsx');
var SALIDA_JS = path.join(RAIZ, 'data.js');
var SALIDA_CSV = path.join(RAIZ, 'Encuesta GOB EDO 2.csv');

// Encabezado del Excel -> nombre de campo usado por los dashboards (index, dashboard, resumen).
// Las preguntas se identifican por su numero ("1." / "2."), asi que el texto puede cambiar.
var MAPEO_COLUMNAS = [
  { prueba: /^n[uú]mero de tel[eé]fono$/i, campo: 'Numero de Telefono' },
  { prueba: /^fecha de la llamada$/i, campo: 'Fecha de la llamada' },
  { prueba: /^1\./, campo: 'Preferencia Partido' },
  { prueba: /^2\./, campo: 'Gubernatura' },
  { prueba: /^id$/i, campo: 'ID' },
  { prueba: /^colonia$/i, campo: 'Colonia' },
  { prueba: /^(cp|c[oó]digo postal)$/i, campo: 'Codigo Postal' },
  { prueba: /^sexo$/i, campo: 'Sexo' },
  { prueba: /^nombre completo$/i, campo: 'Nombre completo' },
  { prueba: /^lat$/i, campo: 'Lat' },
  { prueba: /^lon$/i, campo: 'Lon' },
  { prueba: /^direcci[oó]n completa$/i, campo: 'Direccion Completa' },
  { prueba: /^privadas$/i, campo: 'Privadas' },
  { prueba: /^edad/i, campo: 'Edad 2027' },
  { prueba: /^rango edad$/i, campo: 'Rango edad' },
  { prueba: /^partido$/i, campo: 'Partido' },
  { prueba: /^servidor p[uú]blico$/i, campo: 'Servidor Publico' },
  { prueba: /^beneficiario estado$/i, campo: 'Beneficiario Estado' },
  { prueba: /^programa estado$/i, campo: 'Programa Estado' },
  { prueba: /^programa federal$/i, campo: 'Programa Federal' },
  { prueba: /^distrito ?federal$/i, campo: 'Distrito Federal' },
  { prueba: /^distrito ?local$/i, campo: 'Distrito Local' },
  { prueba: /^municipio$/i, campo: 'Municipio' },
  { prueba: /^secci[oó]n$/i, campo: 'Seccion' },
  { prueba: /^nombre municipio$/i, campo: 'Nombre Municipio' }
];

var SEXO = { M: 'Mujer', F: 'Mujer', H: 'Hombre' };

// Respuestas de las preguntas: se normalizan mayusculas/acentos para que "Cruz Perez Cuellar"
// y "Cruz Pérez Cuellar" cuenten como la misma opcion. Lo que no este aqui se deja tal cual.
var RESPUESTAS = {
  'Preferencia Partido': { pan: 'PAN', pri: 'PRI', morena: 'MORENA', mc: 'MC' },
  'Gubernatura': {
    'marco bonilla': 'Marco Bonilla',
    'alfredo lozoya': 'Alfredo Lozoya',
    'alfredo chavez': 'Alfredo Lozoya', // en el Excel la opcion de MC se capturo como "Alfredo Chavez"
    'cruz perez cuellar': 'Cruz Pérez Cuellar'
  }
};

// ---------------- Lectura minima de .zip (solo las entradas que se piden) ----------------

function leerEntradasZip(archivo, nombresBuscados) {
  var fd = fs.openSync(archivo, 'r');
  try {
    var tam = fs.fstatSync(fd).size;
    var colaTam = Math.min(tam, 65557);
    var cola = Buffer.alloc(colaTam);
    fs.readSync(fd, cola, 0, colaTam, tam - colaTam);
    var eocd = -1;
    for (var i = colaTam - 22; i >= 0; i--) {
      if (cola.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('No parece un .xlsx valido (no se encontro el directorio del zip).');

    var cdTam = cola.readUInt32LE(eocd + 12);
    var cdOffset = cola.readUInt32LE(eocd + 16);
    // Zip64 (archivos de mas de 4 GB): el directorio real esta en el registro EOCD64
    if (cdOffset === 0xFFFFFFFF && eocd >= 20 && cola.readUInt32LE(eocd - 20) === 0x07064b50) {
      var eocd64 = Buffer.alloc(56);
      fs.readSync(fd, eocd64, 0, 56, Number(cola.readBigUInt64LE(eocd - 20 + 8)));
      cdTam = Number(eocd64.readBigUInt64LE(40));
      cdOffset = Number(eocd64.readBigUInt64LE(48));
    }
    var cd = Buffer.alloc(cdTam);
    fs.readSync(fd, cd, 0, cdTam, cdOffset);

    var resultado = {};
    var p = 0;
    while (p < cd.length && cd.readUInt32LE(p) === 0x02014b50) {
      var metodo = cd.readUInt16LE(p + 10);
      var compTam = cd.readUInt32LE(p + 20);
      var nomLen = cd.readUInt16LE(p + 28);
      var extraLen = cd.readUInt16LE(p + 30);
      var comLen = cd.readUInt16LE(p + 32);
      var localOffset = cd.readUInt32LE(p + 42);
      var nombre = cd.toString('utf8', p + 46, p + 46 + nomLen);
      var extra = cd.subarray(p + 46 + nomLen, p + 46 + nomLen + extraLen);
      var tamOriginal = cd.readUInt32LE(p + 24);
      p += 46 + nomLen + extraLen + comLen;
      if (nombresBuscados.indexOf(nombre) === -1) continue;

      // Campos Zip64 de la entrada: solo vienen los que en la cabecera valen 0xFFFFFFFF, en este orden
      for (var e = 0; e + 4 <= extra.length; e += 4 + extra.readUInt16LE(e + 2)) {
        if (extra.readUInt16LE(e) !== 0x0001) continue;
        var q = e + 4;
        if (tamOriginal === 0xFFFFFFFF) q += 8;
        if (compTam === 0xFFFFFFFF) { compTam = Number(extra.readBigUInt64LE(q)); q += 8; }
        if (localOffset === 0xFFFFFFFF) localOffset = Number(extra.readBigUInt64LE(q));
      }

      var cab = Buffer.alloc(30);
      fs.readSync(fd, cab, 0, 30, localOffset);
      var inicioDatos = localOffset + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
      var comp = Buffer.alloc(compTam);
      fs.readSync(fd, comp, 0, compTam, inicioDatos);
      resultado[nombre] = (metodo === 0 ? comp : zlib.inflateRawSync(comp)).toString('utf8');
    }
    return resultado;
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------- Lectura de la hoja (valores en cache) ----------------

function decodificarXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
    .replace(/&amp;/g, '&');
}

function leerSharedStrings(xml) {
  if (!xml) return [];
  var lista = [];
  var re = /<si>([\s\S]*?)<\/si>/g, m;
  while ((m = re.exec(xml))) {
    var texto = '';
    var reT = /<t[^>]*>([\s\S]*?)<\/t>/g, t;
    while ((t = reT.exec(m[1]))) texto += t[1];
    lista.push(decodificarXml(texto));
  }
  return lista;
}

function indiceColumna(ref) {
  var letras = ref.replace(/\d+/g, '');
  var n = 0;
  for (var i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
  return n - 1;
}

function leerFilas(xmlHoja, compartidos) {
  var filas = [];
  var reFila = /<row\b[^>]*>([\s\S]*?)<\/row>/g, mf;
  while ((mf = reFila.exec(xmlHoja))) {
    var fila = [];
    var reCelda = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, mc;
    while ((mc = reCelda.exec(mf[1]))) {
      var attrs = mc[1];
      var ref = /\br="([A-Z]+\d+)"/.exec(attrs);
      if (!ref) continue;
      var tipo = (/\bt="(\w+)"/.exec(attrs) || [])[1];
      var interior = mc[2] || '';
      var v = /<v>([\s\S]*?)<\/v>/.exec(interior);
      var valor = null;
      if (tipo === 'inlineStr') {
        var t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(interior);
        valor = t ? decodificarXml(t[1]) : null;
      } else if (v) {
        if (tipo === 's') valor = compartidos[+v[1]];
        else if (tipo === 'str' || tipo === 'e') valor = decodificarXml(v[1]);
        else if (tipo === 'b') valor = v[1] === '1';
        else valor = Number(v[1]);
      }
      if (tipo === 'e') valor = null; // #N/A, #REF!, etc.
      fila[indiceColumna(ref[1])] = valor;
    }
    filas.push(fila);
  }
  return filas;
}

// ---------------- Limpieza de cada registro ----------------

function sinAcentos(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function limpiarTexto(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  var t = v.trim();
  return t === '' ? null : t;
}

function normalizarRespuesta(campo, v) {
  v = limpiarTexto(v);
  if (v === null) return '-'; // sin respuesta: mismo criterio que la base anterior
  var texto = String(v);
  var clave = sinAcentos(texto).toLowerCase().replace(/\s+/g, ' ');
  return RESPUESTAS[campo][clave] || texto;
}

function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? v : n;
}

function construirRegistro(encabezados, fila) {
  var r = {};
  encabezados.forEach(function (campo, i) {
    if (campo) r[campo] = limpiarTexto(fila[i] === undefined ? null : fila[i]);
  });

  r['Preferencia Partido'] = normalizarRespuesta('Preferencia Partido', r['Preferencia Partido']);
  r['Gubernatura'] = normalizarRespuesta('Gubernatura', r['Gubernatura']);

  // INDEX() de Excel devuelve 0 cuando la celda de origen esta vacia
  ['Colonia', 'Sexo', 'Nombre completo', 'Direccion Completa', 'Privadas', 'Rango edad', 'Partido', 'Servidor Publico',
    'Beneficiario Estado', 'Programa Estado', 'Programa Federal', 'Nombre Municipio']
    .forEach(function (c) { if (r[c] === 0) r[c] = null; });

  if (typeof r['Sexo'] === 'string') r['Sexo'] = SEXO[r['Sexo'].toUpperCase()] || r['Sexo'];
  ['Distrito Federal', 'Distrito Local', 'Municipio', 'Seccion', 'Codigo Postal', 'Edad 2027', 'ID', 'Numero de Telefono']
    .forEach(function (c) { if (c in r) r[c] = aEntero(r[c]); });
  ['Lat', 'Lon'].forEach(function (c) {
    if (c in r) r[c] = typeof r[c] === 'number' ? r[c] : (r[c] === null ? null : Number(r[c]) || null);
  });
  if (r['Fecha de la llamada'] !== null && r['Fecha de la llamada'] !== undefined) {
    r['Fecha de la llamada'] = String(r['Fecha de la llamada']);
  }
  return r;
}

// ---------------- Salidas ----------------

function aCsv(registros, campos) {
  var esc = function (v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  var lineas = [campos.map(esc).join(',')];
  registros.forEach(function (r) { lineas.push(campos.map(function (c) { return esc(r[c]); }).join(',')); });
  return '﻿' + lineas.join('\r\n') + '\r\n'; // BOM para que Excel respete los acentos
}

function procesar() {
  var inicio = Date.now();
  var partes = leerEntradasZip(ARCHIVO_EXCEL, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml']);

  // Primera hoja del libro
  var rId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(partes['xl/workbook.xml'])[1];
  var reRel = new RegExp('<Relationship\\b[^>]*Id="' + rId + '"[^>]*Target="([^"]+)"');
  var destino = (reRel.exec(partes['xl/_rels/workbook.xml.rels']) ||
    new RegExp('<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="' + rId + '"').exec(partes['xl/_rels/workbook.xml.rels']))[1];
  var rutaHoja = destino.charAt(0) === '/' ? destino.slice(1) : 'xl/' + destino;
  var xmlHoja = leerEntradasZip(ARCHIVO_EXCEL, [rutaHoja])[rutaHoja];

  var filas = leerFilas(xmlHoja, leerSharedStrings(partes['xl/sharedStrings.xml']));
  if (!filas.length) throw new Error('La hoja esta vacia.');

  var faltantes = [];
  var encabezados = filas[0].map(function (h) {
    var texto = h === null || h === undefined ? '' : String(h).trim();
    var m = MAPEO_COLUMNAS.find(function (x) { return x.prueba.test(texto); });
    return m ? m.campo : (texto || null);
  });
  MAPEO_COLUMNAS.forEach(function (m) { if (encabezados.indexOf(m.campo) === -1) faltantes.push(m.campo); });

  var registros = filas.slice(1)
    .filter(function (f) { return f.some(function (v) { return v !== null && v !== undefined && v !== ''; }); })
    .map(function (f) { return construirRegistro(encabezados, f); });

  var campos = encabezados.filter(Boolean);
  fs.writeFileSync(SALIDA_JS,
    '// Generado por actualizar_datos.js a partir de "' + path.basename(ARCHIVO_EXCEL) + '" el ' +
    new Date().toLocaleString('es-MX') + '. No editar a mano.\n' +
    'var datos = ' + JSON.stringify(registros) + ';\n');
  fs.writeFileSync(SALIDA_CSV, aCsv(registros, campos));

  var sinCoords = registros.filter(function (r) { return typeof r.Lat !== 'number' || typeof r.Lon !== 'number'; }).length;
  console.log('[' + new Date().toLocaleTimeString('es-MX') + '] ' + registros.length + ' registros -> data.js y ' +
    path.basename(SALIDA_CSV) + ' (' + (Date.now() - inicio) + ' ms)');
  if (sinCoords) console.log('  Aviso: ' + sinCoords + ' registro(s) sin Lat/Lon no se veran en el mapa.');
  if (faltantes.length) console.log('  Aviso: columnas no encontradas en el Excel: ' + faltantes.join(', '));
}

function procesarSeguro() {
  try {
    procesar();
  } catch (e) {
    console.error('Error al procesar el Excel: ' + e.message);
    process.exitCode = 1;
  }
}

procesarSeguro();

if (process.argv.indexOf('--vigilar') !== -1) {
  console.log('Vigilando "' + path.basename(ARCHIVO_EXCEL) + '"... (Ctrl+C para salir)');
  var espera = null;
  fs.watchFile(ARCHIVO_EXCEL, { interval: 2000 }, function (actual, anterior) {
    if (actual.mtimeMs === anterior.mtimeMs) return;
    clearTimeout(espera);
    // Excel escribe el archivo en varias pasadas; se espera a que termine de guardar
    espera = setTimeout(function () { process.exitCode = 0; procesarSeguro(); }, 3000);
  });
}

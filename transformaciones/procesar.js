// Procesa pares .geojson + .lyrx (ArcGIS Pro) y genera archivos .js listos
// para usar con Leaflet: reproyecta a WGS84 y "hornea" en cada feature la
// simbologia (Clase/Color) leida directamente del renderer del .lyrx.
//
// Uso:
//   node procesar.js                -> procesa todo lo que haya en ./entrada, escribe en ./salida
//   node procesar.js archivo.geojson [archivo.lyrx] [nombreVariable]  -> procesa un par especifico
//
// Ver README.md para el flujo de trabajo (arrastrar archivos a ./entrada y correr el script).

const fs = require('fs');
const path = require('path');

const CARPETA_ENTRADA = path.join(__dirname, 'entrada');
const CARPETA_SALIDA = path.join(__dirname, 'salida');

// ---------------------------------------------------------------------------
// Utilidades generales
// ---------------------------------------------------------------------------

function normalizarNombre(nombre) {
  return nombre
    .toLowerCase()
    .replace(/\.[^.]+$/, '') // quitar extension
    .replace(/[^a-z0-9]/g, ''); // quitar espacios, guiones, parentesis, etc.
}

function aNombreVariable(nombre) {
  var base = nombre.replace(/\.[^.]+$/, '');
  var partes = base.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (partes.length === 0) return 'capa';
  var primero = partes[0] === partes[0].toUpperCase()
    ? partes[0].toLowerCase()
    : partes[0].charAt(0).toLowerCase() + partes[0].slice(1);
  var resto = partes.slice(1).map(function (p) {
    return p.charAt(0).toUpperCase() + p.slice(1);
  });
  var variable = [primero].concat(resto).join('');
  if (/^[0-9]/.test(variable)) variable = '_' + variable;
  return variable;
}

function rgbaAHex(values) {
  // CIM guarda [R, G, B, Alpha%] con R/G/B en 0-255 y alpha en 0-100
  var r = Math.round(values[0]);
  var g = Math.round(values[1]);
  var b = Math.round(values[2]);
  var hex = '#' + [r, g, b].map(function (v) {
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  }).join('');
  return hex;
}

// ---------------------------------------------------------------------------
// Reproyeccion UTM (EPSG:326xx / 327xx, WGS84) -> WGS84 lon/lat (EPSG:4326)
// Formulas de inversion estandar (Snyder). Cubre el caso mas comun en datos
// geoelectorales de Mexico (UTM zonas 11N-16N). Si el CRS ya es 4326 (o no
// tiene CRS declarado) no se hace nada.
// ---------------------------------------------------------------------------

var WGS84_A = 6378137.0;
var WGS84_F = 1 / 298.257223563;

function utmALatLon(easting, northing, zona, esSur) {
  var a = WGS84_A;
  var f = WGS84_F;
  var e2 = f * (2 - f);
  var e2p = e2 / (1 - e2);
  var k0 = 0.9996;

  var x = easting - 500000;
  var y = esSur ? northing - 10000000 : northing;
  var lon0 = ((zona - 1) * 6 - 180 + 3) * Math.PI / 180;

  var M = y / k0;
  var mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));

  var e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  var phi1 = mu
    + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
    + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu)
    + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);

  var N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) * Math.sin(phi1));
  var T1 = Math.tan(phi1) * Math.tan(phi1);
  var C1 = e2p * Math.cos(phi1) * Math.cos(phi1);
  var R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1) * Math.sin(phi1), 1.5);
  var D = x / (N1 * k0);

  var phi = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2p) * Math.pow(D, 4) / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e2p - 3 * C1 * C1) * Math.pow(D, 6) / 720
  );

  var lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2p + 24 * T1 * T1) * Math.pow(D, 5) / 120
  ) / Math.cos(phi1);

  return [lon * 180 / Math.PI, phi * 180 / Math.PI];
}

function detectarReproyeccion(geojson) {
  var nombreCrs = geojson.crs && geojson.crs.properties && geojson.crs.properties.name;
  if (!nombreCrs) return null; // sin CRS declarado: se asume que ya es lon/lat

  var m = /EPSG::?(\d+)/i.exec(nombreCrs);
  if (!m) {
    console.warn('  ! CRS "' + nombreCrs + '" no reconocido, se deja igual (revisa manualmente).');
    return null;
  }
  var codigo = parseInt(m[1], 10);
  if (codigo === 4326) return null; // ya es WGS84 lon/lat

  if (codigo >= 32601 && codigo <= 32660) {
    var zona = codigo - 32600;
    return function (coord) { return utmALatLon(coord[0], coord[1], zona, false); };
  }
  if (codigo >= 32701 && codigo <= 32760) {
    var zonaS = codigo - 32700;
    return function (coord) { return utmALatLon(coord[0], coord[1], zonaS, true); };
  }

  console.warn('  ! CRS EPSG:' + codigo + ' no soportado por este script (solo WGS84 UTM). Agrega la formula si lo necesitas.');
  return null;
}

function transformarCoordenadas(coords, transformar) {
  if (typeof coords[0] === 'number') {
    return transformar(coords);
  }
  return coords.map(function (c) { return transformarCoordenadas(c, transformar); });
}

function aplicarReproyeccion(geojson, transformar) {
  geojson.features.forEach(function (feature) {
    if (feature.geometry && feature.geometry.coordinates) {
      feature.geometry.coordinates = transformarCoordenadas(feature.geometry.coordinates, transformar);
    }
  });
  delete geojson.crs; // las coordenadas ya quedan en WGS84 (EPSG:4326, el default de GeoJSON)
}

// ---------------------------------------------------------------------------
// Simplificacion de geometria (Douglas-Peucker)
//
// Se aplica anillo por anillo / linea por linea de forma independiente (no
// preserva topologia entre poligonos vecinos), igual que hacen la mayoria de
// herramientas simples de simplificacion. Con una tolerancia chica (pocos
// metros) el efecto en secciones/poligonos adyacentes es imperceptible; con
// tolerancias grandes pueden aparecer micro-huecos o superposiciones entre
// vecinos.
// ---------------------------------------------------------------------------

function distanciaPuntoSegmento(p, a, b) {
  var dx = b[0] - a[0];
  var dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    dx = p[0] - a[0];
    dy = p[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  }
  var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  var px = a[0] + t * dx;
  var py = a[1] + t * dy;
  var ddx = p[0] - px;
  var ddy = p[1] - py;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

function douglasPeucker(puntos, tolerancia) {
  if (puntos.length <= 2) return puntos;

  var distMax = 0;
  var indiceMax = 0;
  var inicio = puntos[0];
  var fin = puntos[puntos.length - 1];

  for (var i = 1; i < puntos.length - 1; i++) {
    var d = distanciaPuntoSegmento(puntos[i], inicio, fin);
    if (d > distMax) {
      distMax = d;
      indiceMax = i;
    }
  }

  if (distMax <= tolerancia) return [inicio, fin];

  var izquierda = douglasPeucker(puntos.slice(0, indiceMax + 1), tolerancia);
  var derecha = douglasPeucker(puntos.slice(indiceMax), tolerancia);
  return izquierda.slice(0, -1).concat(derecha);
}

function simplificarAnillo(anillo, tolerancia, minPuntos) {
  if (anillo.length <= minPuntos) return anillo;
  var simplificado = douglasPeucker(anillo, tolerancia);
  return simplificado.length >= minPuntos ? simplificado : anillo;
}

function simplificarGeometria(geometry, tolerancia) {
  if (!geometry || !geometry.coordinates || tolerancia <= 0) return;
  switch (geometry.type) {
    case 'LineString':
      geometry.coordinates = simplificarAnillo(geometry.coordinates, tolerancia, 2);
      break;
    case 'MultiLineString':
      geometry.coordinates = geometry.coordinates.map(function (linea) {
        return simplificarAnillo(linea, tolerancia, 2);
      });
      break;
    case 'Polygon':
      geometry.coordinates = geometry.coordinates.map(function (anillo) {
        return simplificarAnillo(anillo, tolerancia, 4);
      });
      break;
    case 'MultiPolygon':
      geometry.coordinates = geometry.coordinates.map(function (poligono) {
        return poligono.map(function (anillo) {
          return simplificarAnillo(anillo, tolerancia, 4);
        });
      });
      break;
    default:
      break; // Point/MultiPoint: nada que simplificar
  }
}

function simplificarGeoJSON(geojson, tolerancia, unidad) {
  if (!tolerancia || tolerancia <= 0) return;
  var antes = contarVertices(geojson);
  geojson.features.forEach(function (feature) {
    simplificarGeometria(feature.geometry, tolerancia);
  });
  var despues = contarVertices(geojson);
  console.log('  Simplificado: ' + antes + ' -> ' + despues + ' vertices (tolerancia ' + tolerancia + ' ' + unidad + ', -' + (100 - Math.round(despues / antes * 100)) + '%)');
}

function contarVertices(geojson) {
  var total = 0;
  geojson.features.forEach(function (feature) {
    total += contarVerticesCoords(feature.geometry && feature.geometry.coordinates);
  });
  return total;
}

function contarVerticesCoords(coords) {
  if (!coords) return 0;
  if (typeof coords[0] === 'number') return 1;
  return coords.reduce(function (acc, c) { return acc + contarVerticesCoords(c); }, 0);
}

// ---------------------------------------------------------------------------
// Decodificacion de simbologia .lyrx (CIM JSON de ArcGIS Pro)
// ---------------------------------------------------------------------------

// Convencion de codigos de rango que usa ArcGIS Pro en el renderer bivariado
// segun el tamano de la grilla (de menor a mayor valor normalizado).
var CODIGOS_POR_GRILLA = {
  TwoByTwo: ['L', 'H'],
  ThreeByThree: ['L', 'M', 'H'],
  FourByFour: ['L', 'M1', 'M2', 'H'],
  FiveByFive: ['L', 'M1', 'M2', 'M3', 'H']
};

function obtenerColorDeSymbolReference(symbolRef) {
  if (!symbolRef || !symbolRef.symbol || !symbolRef.symbol.symbolLayers) return null;
  var capas = symbolRef.symbol.symbolLayers;
  // Tomar el ultimo CIMSolidFill visible (el relleno del poligono)
  for (var i = capas.length - 1; i >= 0; i--) {
    var capa = capas[i];
    if (capa.type === 'CIMSolidFill' && capa.enable !== false && capa.color && capa.color.values) {
      return rgbaAHex(capa.color.values);
    }
  }
  return null;
}

function obtenerValorNormalizado(props, campo, campoNorm, tipoNorm) {
  var v = Number(props[campo]);
  if (!isFinite(v)) return null;
  if (tipoNorm === 'Field' && campoNorm) {
    var n = Number(props[campoNorm]);
    if (!isFinite(n) || n === 0) return null;
    return v / n;
  }
  return v;
}

function indiceDeBin(valorNorm, upperBounds) {
  for (var i = 0; i < upperBounds.length; i++) {
    if (valorNorm <= upperBounds[i]) return i;
  }
  return upperBounds.length - 1;
}

function construirClasificadorBivariado(renderer) {
  var info = renderer.authoringInfo;
  var campos = info.fieldInfos;
  var codigos = CODIGOS_POR_GRILLA[info.gridSize];
  if (!codigos) {
    console.warn('  ! gridSize "' + info.gridSize + '" no reconocido, se usa FourByFour por defecto.');
    codigos = CODIGOS_POR_GRILLA.FourByFour;
  }

  // Mapa "codigoCombinado" -> color, leido directamente de las clases del renderer
  var colorPorCodigo = {};
  (renderer.groups || []).forEach(function (grupo) {
    (grupo.classes || []).forEach(function (clase) {
      var codigo = clase.values && clase.values[0] && clase.values[0].fieldValues && clase.values[0].fieldValues[0];
      var color = obtenerColorDeSymbolReference(clase.symbol);
      if (codigo && color) colorPorCodigo[codigo] = color;
    });
  });
  var colorPorDefecto = obtenerColorDeSymbolReference(renderer.defaultSymbol) || '#828282';

  return {
    tipo: 'bivariado',
    campos: campos.map(function (c) { return c.field; }),
    calcular: function (props) {
      var codigoCombinado = '';
      for (var i = 0; i < campos.length; i++) {
        var fi = campos[i];
        var valorNorm = obtenerValorNormalizado(props, fi.field, fi.normalizationField, fi.normalizationType);
        if (valorNorm === null) return { Clase: null, Color: colorPorDefecto };
        var idx = indiceDeBin(valorNorm, fi.upperBounds);
        codigoCombinado += codigos[idx];
      }
      return { Clase: codigoCombinado, Color: colorPorCodigo[codigoCombinado] || colorPorDefecto };
    },
    resumen: colorPorCodigo
  };
}

function construirClasificadorClassBreaks(renderer) {
  var campo = renderer.field;
  var campoNorm = renderer.normalizationField;
  var tipoNorm = renderer.normalizationType;
  var cortes = (renderer.breaks || []).map(function (b) {
    return { upperBound: b.upperBound, label: b.label, color: obtenerColorDeSymbolReference(b.symbol) };
  });
  var colorPorDefecto = obtenerColorDeSymbolReference(renderer.defaultSymbol) || '#828282';

  return {
    tipo: 'class-breaks',
    campos: [campo],
    calcular: function (props) {
      var valorNorm = obtenerValorNormalizado(props, campo, campoNorm, tipoNorm);
      if (valorNorm === null) return { Clase: null, Color: colorPorDefecto };
      for (var i = 0; i < cortes.length; i++) {
        if (valorNorm <= cortes[i].upperBound) {
          return { Clase: cortes[i].label || String(i), Color: cortes[i].color || colorPorDefecto };
        }
      }
      return { Clase: null, Color: colorPorDefecto };
    },
    resumen: cortes
  };
}

function construirClasificadorUniqueValue(renderer) {
  var campos = renderer.fields || [];
  var colorPorDefecto = obtenerColorDeSymbolReference(renderer.defaultSymbol) || '#828282';
  var reglas = [];
  (renderer.groups || []).forEach(function (grupo) {
    (grupo.classes || []).forEach(function (clase) {
      (clase.values || []).forEach(function (v) {
        reglas.push({ fieldValues: v.fieldValues, label: clase.label, color: obtenerColorDeSymbolReference(clase.symbol) });
      });
    });
  });

  return {
    tipo: 'unique-value',
    campos: campos,
    calcular: function (props) {
      var valoresFeature = campos.map(function (c) { return String(props[c]); });
      for (var i = 0; i < reglas.length; i++) {
        var r = reglas[i];
        var coincide = r.fieldValues.every(function (v, idx) { return String(v) === valoresFeature[idx]; });
        if (coincide) return { Clase: r.label, Color: r.color || colorPorDefecto };
      }
      return { Clase: null, Color: colorPorDefecto };
    },
    resumen: reglas
  };
}

function construirClasificadorSimple(renderer) {
  var color = obtenerColorDeSymbolReference(renderer.symbol) || '#828282';
  return {
    tipo: 'simple',
    campos: [],
    calcular: function () { return { Clase: null, Color: color }; },
    resumen: { color: color }
  };
}

function construirClasificador(renderer) {
  if (!renderer) return null;
  if (renderer.authoringInfo && renderer.authoringInfo.type === 'CIMBivariateRendererAuthoringInfo') {
    return construirClasificadorBivariado(renderer);
  }
  if (renderer.type === 'CIMClassBreaksRenderer') {
    return construirClasificadorClassBreaks(renderer);
  }
  if (renderer.type === 'CIMUniqueValueRenderer') {
    return construirClasificadorUniqueValue(renderer);
  }
  if (renderer.type === 'CIMSimpleRenderer') {
    return construirClasificadorSimple(renderer);
  }
  console.warn('  ! Tipo de renderer "' + renderer.type + '" no soportado, no se calculara Clase/Color.');
  return null;
}

function leerRendererDeLyrx(rutaLyrx) {
  var doc = JSON.parse(fs.readFileSync(rutaLyrx, 'utf8'));
  var definiciones = doc.layerDefinitions || [];
  var capaFeature = definiciones.find(function (d) { return d.type === 'CIMFeatureLayer' && d.renderer; });
  if (!capaFeature) {
    console.warn('  ! No se encontro un CIMFeatureLayer con renderer en el .lyrx');
    return null;
  }
  return capaFeature.renderer;
}

// ---------------------------------------------------------------------------
// Procesamiento de un par geojson/lyrx
// ---------------------------------------------------------------------------

var TOLERANCIA_DEFECTO_METROS = 2;
var METROS_POR_GRADO = 111320; // aproximacion en el ecuador, suficiente para elegir tolerancia de simplificacion

function procesarPar(rutaGeojson, rutaLyrx, nombreSalida, toleranciaMetros) {
  if (toleranciaMetros === undefined) toleranciaMetros = TOLERANCIA_DEFECTO_METROS;
  console.log('Procesando: ' + path.basename(rutaGeojson) + (rutaLyrx ? ' + ' + path.basename(rutaLyrx) : ' (sin .lyrx)'));

  var geojson = JSON.parse(fs.readFileSync(rutaGeojson, 'utf8'));

  // La simplificacion se hace ANTES de reproyectar, mientras las coordenadas
  // siguen en el CRS de origen: si es UTM (metros), la tolerancia se aplica
  // directo en metros; si el geojson ya viene en lon/lat, se convierte la
  // tolerancia a grados.
  var transformar = detectarReproyeccion(geojson);
  if (toleranciaMetros > 0) {
    var toleranciaEnUnidadOrigen = transformar ? toleranciaMetros : toleranciaMetros / METROS_POR_GRADO;
    simplificarGeoJSON(geojson, toleranciaEnUnidadOrigen, transformar ? 'm' : 'grados');
  }
  if (transformar) aplicarReproyeccion(geojson, transformar);

  var clasificador = null;
  if (rutaLyrx) {
    var renderer = leerRendererDeLyrx(rutaLyrx);
    clasificador = construirClasificador(renderer);
  }

  if (clasificador) {
    console.log('  Simbologia detectada: ' + clasificador.tipo + ' (campos: ' + clasificador.campos.join(', ') + ')');
    geojson.features.forEach(function (feature) {
      var resultado = clasificador.calcular(feature.properties || {});
      feature.properties.Clase = resultado.Clase === undefined ? null : resultado.Clase;
      feature.properties.Color = resultado.Color;
    });
  }

  var nombreVariable = aNombreVariable(nombreSalida);
  var rutaSalidaJs = path.join(CARPETA_SALIDA, nombreVariable + '.js');
  fs.writeFileSync(rutaSalidaJs, 'var ' + nombreVariable + ' = ' + JSON.stringify(geojson) + ';\n', 'utf8');
  console.log('  -> ' + path.relative(process.cwd(), rutaSalidaJs) + ' (' + geojson.features.length + ' features, variable "' + nombreVariable + '")');

  if (clasificador) {
    var rutaResumen = path.join(CARPETA_SALIDA, nombreVariable + '.simbologia.json');
    fs.writeFileSync(rutaResumen, JSON.stringify({ tipo: clasificador.tipo, campos: clasificador.campos, detalle: clasificador.resumen }, null, 2), 'utf8');
    console.log('  -> ' + path.relative(process.cwd(), rutaResumen) + ' (referencia de la simbologia decodificada)');
  }
}

// ---------------------------------------------------------------------------
// Modo batch: emparejar todo lo que haya en ./entrada
// ---------------------------------------------------------------------------

function correrBatch(toleranciaMetros) {
  if (!fs.existsSync(CARPETA_ENTRADA)) {
    console.error('No existe la carpeta ' + CARPETA_ENTRADA);
    process.exit(1);
  }
  if (!fs.existsSync(CARPETA_SALIDA)) fs.mkdirSync(CARPETA_SALIDA, { recursive: true });

  var archivos = fs.readdirSync(CARPETA_ENTRADA).filter(function (f) {
    return !f.startsWith('.');
  });

  var geojsons = archivos.filter(function (f) { return /\.geojson$/i.test(f); });
  var lyrxs = archivos.filter(function (f) { return /\.lyrx$/i.test(f); });

  if (geojsons.length === 0) {
    console.log('No hay archivos .geojson en ' + CARPETA_ENTRADA + '. Arrastra ahi tus capas y vuelve a correr el script.');
    return;
  }

  geojsons.forEach(function (nombreGeojson) {
    var clave = normalizarNombre(nombreGeojson);
    var nombreLyrx = lyrxs.find(function (f) { return normalizarNombre(f) === clave; });
    procesarPar(
      path.join(CARPETA_ENTRADA, nombreGeojson),
      nombreLyrx ? path.join(CARPETA_ENTRADA, nombreLyrx) : null,
      nombreGeojson,
      toleranciaMetros
    );
  });

  console.log('\nListo. Revisa ' + path.relative(process.cwd(), CARPETA_SALIDA));
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

function extraerFlags(argv) {
  var toleranciaMetros = TOLERANCIA_DEFECTO_METROS;
  var posicionales = [];
  argv.forEach(function (arg) {
    var m = /^--tolerancia=([\d.]+)$/.exec(arg);
    if (arg === '--sin-simplificar') {
      toleranciaMetros = 0;
    } else if (m) {
      toleranciaMetros = parseFloat(m[1]);
    } else {
      posicionales.push(arg);
    }
  });
  return { toleranciaMetros: toleranciaMetros, posicionales: posicionales };
}

var flags = extraerFlags(process.argv.slice(2));

if (flags.posicionales.length === 0) {
  correrBatch(flags.toleranciaMetros);
} else {
  var rutaGeojson = path.resolve(flags.posicionales[0]);
  var rutaLyrx = flags.posicionales[1] ? path.resolve(flags.posicionales[1]) : null;
  var nombreSalida = flags.posicionales[2] || path.basename(rutaGeojson);
  if (!fs.existsSync(CARPETA_SALIDA)) fs.mkdirSync(CARPETA_SALIDA, { recursive: true });
  procesarPar(rutaGeojson, rutaLyrx, nombreSalida, flags.toleranciaMetros);
}

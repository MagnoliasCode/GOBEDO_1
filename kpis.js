// Calculos compartidos entre index.html, dashboard.html y resumen.html a partir de data.js
// (generado con: node actualizar_datos.js)

// Las 2 preguntas de la encuesta: campo en data.js -> textos para la interfaz
var PREGUNTAS = [
  { campo: 'Preferencia Partido', titulo: 'Preferencia de partido', corto: 'Partido' },
  { campo: 'Gubernatura', titulo: 'Intención de voto — Gubernatura', corto: 'Gubernatura' }
];

// Orden y colores fijos de las opciones de cada pregunta (las que no esten aqui se agregan al final)
var OPCIONES_PREGUNTA = {
  'Preferencia Partido': ['PAN', 'PRI', 'MORENA', 'MC'],
  'Gubernatura': ['Marco Bonilla', 'Alfredo Lozoya', 'Cruz Pérez Cuellar']
};
var COLORES_OPCIONES = {
  'PAN': '#0047AB',
  'PRI': '#00953A',
  'MORENA': '#A50F2D',
  'MC': '#FF7A00',
  'Marco Bonilla': '#0047AB',      // PAN
  'Alfredo Lozoya': '#FF7A00',     // MC
  'Cruz Pérez Cuellar': '#A50F2D'  // MORENA
};
var COLOR_SIN_RESPUESTA = '#9aa0a6';
var SIN_RESPUESTA = '-';

function esSinRespuesta(v) {
  return v === undefined || v === null || v === '' || v === SIN_RESPUESTA || v === '(sin dato)';
}

function etiquetaLegible(etiqueta) {
  return esSinRespuesta(etiqueta) ? 'Sin respuesta' : String(etiqueta);
}

function colorOpcion(etiqueta) {
  return esSinRespuesta(etiqueta) ? COLOR_SIN_RESPUESTA : (COLORES_OPCIONES[etiqueta] || '#6b7280');
}

function contarPor(datos, campo) {
  var conteo = {};
  datos.forEach(function (d) {
    var v = d[campo];
    if (v === undefined || v === null || v === '') v = '(sin dato)';
    conteo[v] = (conteo[v] || 0) + 1;
  });
  return conteo;
}

function ordenarConteo(conteo) {
  return Object.keys(conteo)
    .map(function (k) { return { etiqueta: k, valor: conteo[k] }; })
    .sort(function (a, b) { return b.valor - a.valor; });
}

// Distribucion de una pregunta: [{ etiqueta, valor, pct }] con todas las opciones del
// cuestionario (aunque tengan 0), ordenada de mayor a menor y "sin respuesta" al final.
function distribucionPregunta(datos, campo) {
  var conteo = {};
  (OPCIONES_PREGUNTA[campo] || []).forEach(function (op) { conteo[op] = 0; });
  datos.forEach(function (d) {
    var v = esSinRespuesta(d[campo]) ? SIN_RESPUESTA : d[campo];
    conteo[v] = (conteo[v] || 0) + 1;
  });
  var total = datos.length;
  return Object.keys(conteo)
    .map(function (k) { return { etiqueta: k, valor: conteo[k], pct: total ? conteo[k] / total : 0 }; })
    .sort(function (a, b) {
      if (esSinRespuesta(a.etiqueta)) return 1;
      if (esSinRespuesta(b.etiqueta)) return -1;
      return b.valor - a.valor;
    });
}

// Para las preguntas, "sin respuesta" no debe competir por el primer lugar como si fuera una opcion valida.
function topConOpinion(conteoOrdenado) {
  return conteoOrdenado.filter(function (c) {
    return !esSinRespuesta(c.etiqueta) && c.valor > 0;
  })[0] || { etiqueta: 'N/D', valor: 0, pct: 0 };
}

function segundoConOpinion(conteoOrdenado) {
  return conteoOrdenado.filter(function (c) {
    return !esSinRespuesta(c.etiqueta) && c.valor > 0;
  })[1] || { etiqueta: 'N/D', valor: 0, pct: 0 };
}

function calcularEstadisticas(datos) {
  var total = datos.length;
  var valoresUnicos = function (campo) {
    return new Set(datos.map(function (d) { return d[campo]; }).filter(function (v) { return v !== null && v !== undefined && v !== '' && v !== 0; })).size;
  };

  var porPartido = distribucionPregunta(datos, 'Preferencia Partido');
  var porGubernatura = distribucionPregunta(datos, 'Gubernatura');

  var fechas = datos.map(function (d) { return d['Fecha de la llamada']; }).filter(Boolean).sort();

  return {
    total: total,
    telefonos: valoresUnicos('Numero de Telefono'),
    conUbicacion: datos.filter(function (d) { return typeof d.Lat === 'number' && typeof d.Lon === 'number'; }).length,
    distritosLocales: valoresUnicos('Distrito Local'),
    distritosFederales: valoresUnicos('Distrito Federal'),
    secciones: valoresUnicos('Seccion'),
    colonias: valoresUnicos('Colonia'),
    municipios: valoresUnicos('Nombre Municipio'),
    porPartido: porPartido,
    porGubernatura: porGubernatura,
    topPartido: topConOpinion(porPartido),
    segundoPartido: segundoConOpinion(porPartido),
    topGubernatura: topConOpinion(porGubernatura),
    segundoGubernatura: segundoConOpinion(porGubernatura),
    sinPartido: porPartido.find(function (c) { return esSinRespuesta(c.etiqueta); }) || { valor: 0, pct: 0 },
    sinGubernatura: porGubernatura.find(function (c) { return esSinRespuesta(c.etiqueta); }) || { valor: 0, pct: 0 },
    porSexo: ordenarConteo(contarPor(datos, 'Sexo')),
    porRangoEdad: ordenarConteo(contarPor(datos, 'Rango edad')),
    porColonia: ordenarConteo(contarPor(datos.filter(function (d) { return d['Colonia']; }), 'Colonia')).slice(0, 10),
    porMunicipio: ordenarConteo(contarPor(datos.filter(function (d) { return d['Nombre Municipio']; }), 'Nombre Municipio')).slice(0, 10),
    fechaInicio: fechas[0] || null,
    fechaFin: fechas[fechas.length - 1] || null
  };
}

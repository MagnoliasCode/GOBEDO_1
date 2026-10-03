// Funciones de las 3 secciones del dashboard (dashboard.html).
// Consume data.js (datos) y kpis.js (PREGUNTAS, distribucionPregunta, colores, etc.).

var COLORES_REGION = ['#1b84ff', '#50cd89', '#f1416c'];
var REGIONES = [
  { clave: 'resto', nombre: 'Resto del Estado' },
  { clave: 'juarez', nombre: 'Juárez' },
  { clave: 'chihuahua', nombre: 'Chihuahua' }
];
var FUENTE_NUMEROS = "'TitilliumWeb', sans-serif";

function pct1(v) {
  return (v * 100).toFixed(1);
}

function regionDe(d) {
  var mun = d['Nombre Municipio'];
  if (!mun) return null; // sin ubicacion: no entra al comparativo regional
  mun = String(mun).toUpperCase();
  if (mun === 'JUAREZ' || mun === 'JUÁREZ') return 'juarez';
  if (mun === 'CHIHUAHUA') return 'chihuahua';
  return 'resto';
}

// filtro = { dl: Set<number>, df: Set<number>, mun: Set<string> } (Set vacio = todos)
function filtrarDatos(filtro) {
  return datos.filter(function (d) {
    if (filtro.dl && filtro.dl.size && !filtro.dl.has(d['Distrito Local'])) return false;
    if (filtro.df && filtro.df.size && !filtro.df.has(d['Distrito Federal'])) return false;
    if (filtro.mun && filtro.mun.size && !filtro.mun.has(d['Nombre Municipio'])) return false;
    return true;
  });
}

function valoresUnicosOrdenados(campo, numerico) {
  return Array.from(new Set(datos.map(function (d) { return d[campo]; })))
    .filter(function (v) { return v !== null && v !== undefined && v !== '' && v !== 0; })
    .sort(function (a, b) { return numerico ? a - b : String(a).localeCompare(String(b), 'es'); });
}

// Alterna la categoria en labelIndex dentro de las ocultas por el usuario (clic en su
// etiqueta del eje), salvo que sea la ultima categoria visible, y llama a actualizar().
function alternarCategoria(el, listaVisible, labelIndex, actualizar) {
  var cat = listaVisible[labelIndex];
  if (!cat) return;
  var ocultando = !el.__ocultas[cat.etiqueta];
  if (ocultando && listaVisible.length <= 1) return; // no ocultar la ultima categoria
  el.__ocultas[cat.etiqueta] = ocultando;
  actualizar();
}

// Al ocultar una categoria (clic en su etiqueta) esta desaparece del eje, asi que no
// queda forma de volver a hacer clic en ella. Este contenedor muestra las categorias
// ocultas como "chips" clicables debajo del grafico para poder restaurarlas.
function pintarOcultas(el, actualizar) {
  if (!el.__ocultasEl) {
    var cont = document.createElement('div');
    cont.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;justify-content:center;padding:0 5px 10px;';
    el.insertAdjacentElement('afterend', cont);
    el.__ocultasEl = cont;
  }
  var cont = el.__ocultasEl;
  cont.innerHTML = '';
  var claves = Object.keys(el.__ocultas).filter(function (k) { return el.__ocultas[k]; });
  if (!claves.length) return;

  var titulo = document.createElement('span');
  titulo.textContent = 'Ocultas:';
  titulo.style.cssText = 'font-size:11px;color:var(--muted-foreground);';
  cont.appendChild(titulo);

  claves.forEach(function (etiqueta) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = etiquetaLegible(etiqueta);
    chip.title = 'Mostrar de nuevo';
    chip.style.cssText = 'font-size:11px;line-height:1;padding:4px 9px;border-radius:9999px;' +
      'border:1px solid var(--border);background:transparent;color:var(--muted-foreground);cursor:pointer;';
    chip.addEventListener('click', function () {
      el.__ocultas[etiqueta] = false;
      actualizar();
    });
    cont.appendChild(chip);
  });
}

// Prepara el contenedor para (re)dibujar un grafico conservando las categorias ocultas
// que sigan existiendo en la lista nueva.
function prepararContenedor(selector, lista) {
  var el = document.querySelector(selector);
  if (el.__chart) { el.__chart.destroy(); el.__chart = null; }
  el.__listaCompleta = lista;
  var vigentes = {};
  lista.forEach(function (c) { if (el.__ocultas && el.__ocultas[c.etiqueta]) vigentes[c.etiqueta] = true; });
  el.__ocultas = vigentes;
  return el;
}

// Grafico de barras horizontales con el % de cada opcion de una pregunta, coloreado por
// partido/candidato. Las etiquetas del eje son clicables para ocultar/mostrar esa opcion.
function graficoDistribucion(selector, lista, altura) {
  var el = prepararContenedor(selector, lista);

  function datosVisibles() {
    return el.__listaCompleta.filter(function (c) { return !el.__ocultas[c.etiqueta]; });
  }

  function opcionesSerie(visible) {
    return {
      series: [{ name: 'Porcentaje', data: visible.map(function (c) { return Number(pct1(c.pct)); }) }],
      xaxis: { categories: visible.map(function (c) { return etiquetaLegible(c.etiqueta); }) },
      colors: visible.map(function (c) { return colorOpcion(c.etiqueta); })
    };
  }

  function actualizar() {
    var visible = datosVisibles();
    el.__visibleActual = visible;
    el.__chart.updateOptions(opcionesSerie(visible));
    pintarOcultas(el, actualizar);
  }

  var visibleInicial = datosVisibles();
  el.__visibleActual = visibleInicial;
  var inicial = opcionesSerie(visibleInicial);
  var chart = new ApexCharts(el, {
    chart: {
      type: 'bar', height: altura || 280, toolbar: { show: false }, fontFamily: 'inherit',
      events: {
        xAxisLabelClick: function (event, chartContext, config) {
          alternarCategoria(el, el.__visibleActual, config.labelIndex, actualizar);
        }
      }
    },
    series: inicial.series,
    xaxis: {
      categories: inicial.xaxis.categories,
      labels: { formatter: function (v) { return v + '%'; }, style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' } }
    },
    colors: inicial.colors,
    plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 4, barHeight: '65%' } },
    legend: { show: false },
    dataLabels: {
      enabled: true,
      formatter: function (v, opts) {
        var c = el.__visibleActual[opts.dataPointIndex];
        return v + '%' + (c ? ' (' + c.valor.toLocaleString('es-MX') + ')' : '');
      },
      style: { colors: ['#fff'], fontFamily: FUENTE_NUMEROS, fontSize: '13px' }
    },
    tooltip: {
      y: {
        formatter: function (v, opts) {
          var c = el.__visibleActual[opts.dataPointIndex];
          return v + '%' + (c ? ' — ' + c.valor.toLocaleString('es-MX') + ' respuestas' : '');
        }
      },
      style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' }
    }
  });
  chart.render();
  el.__chart = chart;
  pintarOcultas(el, actualizar);
  return chart;
}

// Junta una pregunta de las 3 regiones en una sola lista [{ etiqueta, resto, juarez, chihuahua }]
// (proporciones), ordenada por el promedio simple de las 3 regiones.
function combinarRegiones(campo) {
  var porRegion = {};
  REGIONES.forEach(function (r) { porRegion[r.clave] = []; });
  datos.forEach(function (d) {
    var r = regionDe(d);
    if (r) porRegion[r].push(d);
  });

  var mapa = {};
  REGIONES.forEach(function (r) {
    distribucionPregunta(porRegion[r.clave], campo).forEach(function (c) {
      if (!mapa[c.etiqueta]) mapa[c.etiqueta] = { etiqueta: c.etiqueta, resto: 0, juarez: 0, chihuahua: 0 };
      mapa[c.etiqueta][r.clave] = c.pct;
    });
  });
  var lista = Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) {
    if (esSinRespuesta(a.etiqueta)) return 1;
    if (esSinRespuesta(b.etiqueta)) return -1;
    return (b.resto + b.juarez + b.chihuahua) - (a.resto + a.juarez + a.chihuahua);
  });
  lista.totales = {};
  REGIONES.forEach(function (r) { lista.totales[r.clave] = porRegion[r.clave].length; });
  return lista;
}

// Grafico de barras horizontales agrupadas comparando las 3 regiones.
// Mismo comportamiento de clic en etiqueta para ocultar/mostrar una categoria.
function graficoRegiones(selector, categorias, altura) {
  var el = prepararContenedor(selector, categorias);
  var totales = categorias.totales || {};

  function datosVisibles() {
    return el.__listaCompleta.filter(function (c) { return !el.__ocultas[c.etiqueta]; });
  }

  function series(visible) {
    return REGIONES.map(function (r) {
      return {
        name: r.nombre + ' (n=' + (totales[r.clave] || 0).toLocaleString('es-MX') + ')',
        data: visible.map(function (c) { return Number(pct1(c[r.clave])); })
      };
    });
  }

  function actualizar() {
    var visible = datosVisibles();
    el.__visibleActual = visible;
    el.__chart.updateOptions({
      series: series(visible),
      xaxis: { categories: visible.map(function (c) { return etiquetaLegible(c.etiqueta); }) }
    });
    pintarOcultas(el, actualizar);
  }

  var visibleInicial = datosVisibles();
  el.__visibleActual = visibleInicial;
  var chart = new ApexCharts(el, {
    chart: {
      type: 'bar', height: altura || 320, toolbar: { show: false }, fontFamily: 'inherit',
      events: {
        xAxisLabelClick: function (event, chartContext, config) {
          alternarCategoria(el, el.__visibleActual, config.labelIndex, actualizar);
        }
      }
    },
    series: series(visibleInicial),
    xaxis: {
      categories: visibleInicial.map(function (c) { return etiquetaLegible(c.etiqueta); }),
      labels: { formatter: function (v) { return v + '%'; }, style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' } }
    },
    colors: COLORES_REGION,
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '70%' } },
    legend: { position: 'bottom', horizontalAlign: 'center' },
    dataLabels: { enabled: false },
    tooltip: {
      y: { formatter: function (v) { return v + '%'; } },
      style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' }
    }
  });
  chart.render();
  el.__chart = chart;
  pintarOcultas(el, actualizar);
  return chart;
}

// Cruce de las 2 preguntas: para cada partido preferido, como se reparte la intencion de voto
// a la gubernatura (barras apiladas al 100%).
function graficoCruce(selector, registros, altura) {
  var el = document.querySelector(selector);
  if (el.__chart) { el.__chart.destroy(); el.__chart = null; }

  var partidos = distribucionPregunta(registros, 'Preferencia Partido')
    .filter(function (c) { return c.valor > 0; })
    .map(function (c) { return c.etiqueta; });
  var candidatos = distribucionPregunta(registros, 'Gubernatura').map(function (c) { return c.etiqueta; });

  var conteo = {};
  registros.forEach(function (d) {
    var p = esSinRespuesta(d['Preferencia Partido']) ? SIN_RESPUESTA : d['Preferencia Partido'];
    var g = esSinRespuesta(d['Gubernatura']) ? SIN_RESPUESTA : d['Gubernatura'];
    conteo[p + '|' + g] = (conteo[p + '|' + g] || 0) + 1;
  });

  var chart = new ApexCharts(el, {
    chart: { type: 'bar', height: altura || 300, stacked: true, stackType: '100%', toolbar: { show: false }, fontFamily: 'inherit' },
    series: candidatos.map(function (g) {
      return { name: etiquetaLegible(g), data: partidos.map(function (p) { return conteo[p + '|' + g] || 0; }) };
    }),
    xaxis: {
      categories: partidos.map(etiquetaLegible),
      labels: { formatter: function (v) { return v + '%'; }, style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' } }
    },
    colors: candidatos.map(colorOpcion),
    plotOptions: { bar: { horizontal: true, borderRadius: 2, barHeight: '65%' } },
    legend: { position: 'bottom', horizontalAlign: 'center' },
    dataLabels: {
      enabled: true,
      formatter: function (v) { return v >= 8 ? Math.round(v) + '%' : ''; },
      style: { colors: ['#fff'], fontFamily: FUENTE_NUMEROS, fontSize: '12px' }
    },
    tooltip: {
      y: { formatter: function (v) { return v.toLocaleString('es-MX') + ' respuestas'; } },
      style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' }
    },
    noData: { text: 'Sin datos' }
  });
  chart.render();
  el.__chart = chart;
  return chart;
}

// Rellena la fila de KPIs (5 tarjetas con divisores) a partir de un conjunto de registros.
function pintarKpis(prefijo, registros) {
  var fmt = function (n) { return n.toLocaleString('es-MX'); };
  var s = calcularEstadisticas(registros);
  var ventaja = s.topGubernatura.pct - s.segundoGubernatura.pct;

  document.getElementById(prefijo + '_total').textContent = fmt(s.total);
  document.getElementById(prefijo + '_partido').textContent = s.topPartido.etiqueta;
  document.getElementById(prefijo + '_partido_pct').textContent = pct1(s.topPartido.pct || 0) + '%';
  document.getElementById(prefijo + '_gub').textContent = s.topGubernatura.etiqueta;
  document.getElementById(prefijo + '_gub_pct').textContent = pct1(s.topGubernatura.pct || 0) + '%';
  document.getElementById(prefijo + '_ventaja').textContent = s.total ? pct1(ventaja) + ' pts' : '-';
  document.getElementById(prefijo + '_ventaja_sub').textContent = s.segundoGubernatura.valor
    ? 'sobre ' + s.segundoGubernatura.etiqueta
    : 'sin segundo lugar';
  document.getElementById(prefijo + '_sin').textContent = pct1(s.sinGubernatura.pct || 0) + '%';
}

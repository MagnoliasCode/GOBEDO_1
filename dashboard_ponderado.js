// Funciones compartidas para las 3 secciones del dashboard ponderado (dashboard.html).
// Consume ponderado.js (resumenEstado, resumenRegiones, opcionesFiltro, filasPonderadas).

var COLOR_PONDERADO = '#1b84ff';
var COLOR_NORMAL = '#99a1b7';
var COLORES_REGION = ['#1b84ff', '#50cd89', '#f1416c'];
var FUENTE_NUMEROS = "'TitilliumWeb', sans-serif";

function etiquetaLegible(etiqueta) {
  return etiqueta === '-' || etiqueta === '' ? 'Sin opinión' : etiqueta;
}

function pct1(v) {
  return (v * 100).toFixed(1);
}

function ordenarPorPonderado(lista) {
  return lista.slice().sort(function (a, b) {
    if (a.etiqueta === '-') return 1;
    if (b.etiqueta === '-') return -1;
    return b.ponderado - a.ponderado;
  });
}

function liderConOpinion(lista) {
  return ordenarPorPonderado(lista).filter(function (c) {
    return c.etiqueta !== '-' && c.etiqueta !== '';
  })[0] || { etiqueta: 'N/D', ponderado: 0 };
}

function coberturaConOpinion(lista) {
  var sinOpinion = lista.find(function (c) { return c.etiqueta === '-'; }) || { ponderado: 0 };
  return 1 - sinOpinion.ponderado;
}

// Calcula el mismo bloque de 4 categorias (partido, escenario1, escenario2, morena)
// que las hojas "Resumen*" del Excel, pero en vivo a partir de filasPonderadas,
// filtrando por Distrito Local / Distrito Federal / Municipio seleccionados.
// filtro = { dl: Set<number>|null, df: Set<number>|null, mun: Set<string>|null }
function calcularStatsFiltrado(filtro) {
  var idxPorCampo = { partido: 3, escenario1: 4, escenario2: 5, morena: 6 };
  var conteos = {
    partido: {}, escenario1: {}, escenario2: {}, morena: {}
  };
  var pesos = {
    partido: {}, escenario1: {}, escenario2: {}, morena: {}
  };
  var totalFilas = 0;
  var totalPeso = 0;

  filasPonderadas.forEach(function (f) {
    if (f[8] !== 1) return; // Incluir
    if (filtro.dl && filtro.dl.size && !filtro.dl.has(f[0])) return;
    if (filtro.df && filtro.df.size && !filtro.df.has(f[1])) return;
    if (filtro.mun && filtro.mun.size && !filtro.mun.has(f[2])) return;

    totalFilas++;
    totalPeso += f[7];

    Object.keys(idxPorCampo).forEach(function (campo) {
      var valor = f[idxPorCampo[campo]];
      conteos[campo][valor] = (conteos[campo][valor] || 0) + 1;
      pesos[campo][valor] = (pesos[campo][valor] || 0) + f[7];
    });
  });

  var resultado = { totalFilas: totalFilas, totalPeso: totalPeso };
  Object.keys(idxPorCampo).forEach(function (campo) {
    resultado[campo] = Object.keys(conteos[campo]).map(function (etiqueta) {
      return {
        etiqueta: etiqueta,
        normal: totalFilas ? conteos[campo][etiqueta] / totalFilas : 0,
        ponderado: totalPeso ? pesos[campo][etiqueta] / totalPeso : 0
      };
    });
  });
  return resultado;
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

// Grafico de barras horizontales agrupadas: Normal vs Ponderado, por categoria.
// Las etiquetas del eje son clicables para ocultar/mostrar esa categoria; el resto
// de las barras se redistribuye para ocupar el espacio libre (chart.updateOptions
// sobre la misma instancia, en vez de destruir y crear un grafico nuevo).
function graficoNormalVsPonderado(selector, lista, altura) {
  var el = document.querySelector(selector);
  if (el.__chart) { el.__chart.destroy(); el.__chart = null; }
  el.__listaCompleta = lista;
  var vigentes = {};
  lista.forEach(function (c) { if (el.__ocultas && el.__ocultas[c.etiqueta]) vigentes[c.etiqueta] = true; });
  el.__ocultas = vigentes;

  function datosVisibles() {
    return ordenarPorPonderado(el.__listaCompleta).filter(function (c) { return !el.__ocultas[c.etiqueta]; });
  }

  function actualizar() {
    var visible = datosVisibles();
    el.__visibleActual = visible;
    el.__chart.updateOptions({
      series: [
        { name: 'Normal', data: visible.map(function (c) { return Number(pct1(c.normal)); }) },
        { name: 'Ponderado', data: visible.map(function (c) { return Number(pct1(c.ponderado)); }) }
      ],
      xaxis: { categories: visible.map(function (c) { return etiquetaLegible(c.etiqueta); }) }
    });
    pintarOcultas(el, actualizar);
  }

  var visibleInicial = datosVisibles();
  el.__visibleActual = visibleInicial;
  var chart = new ApexCharts(el, {
    chart: {
      type: 'bar', height: altura || 300, toolbar: { show: false }, fontFamily: 'inherit',
      events: {
        xAxisLabelClick: function (event, chartContext, config) {
          alternarCategoria(el, el.__visibleActual, config.labelIndex, actualizar);
        }
      }
    },
    series: [
      { name: 'Normal', data: visibleInicial.map(function (c) { return Number(pct1(c.normal)); }) },
      { name: 'Ponderado', data: visibleInicial.map(function (c) { return Number(pct1(c.ponderado)); }) }
    ],
    xaxis: {
      categories: visibleInicial.map(function (c) { return etiquetaLegible(c.etiqueta); }),
      labels: { formatter: function (v) { return v + '%'; }, style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' } }
    },
    colors: [COLOR_NORMAL, COLOR_PONDERADO],
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '65%' } },
    legend: { position: 'bottom', horizontalAlign: 'center' },
    dataLabels: {
      enabled: true,
      formatter: function (v) { return v + '%'; },
      style: { colors: ['#5b5b5b'], fontFamily: FUENTE_NUMEROS, fontSize: '13px' }
    },
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

// Grafico de barras horizontales agrupadas comparando 3 regiones (usa "ponderado").
// Mismo comportamiento de clic en etiqueta para ocultar/mostrar una categoria.
function graficoRegiones(selector, categorias, altura) {
  var el = document.querySelector(selector);
  if (el.__chart) { el.__chart.destroy(); el.__chart = null; }
  el.__listaCompleta = categorias;
  var vigentes = {};
  categorias.forEach(function (c) { if (el.__ocultas && el.__ocultas[c.etiqueta]) vigentes[c.etiqueta] = true; });
  el.__ocultas = vigentes;

  function datosVisibles() {
    return el.__listaCompleta.filter(function (c) { return !el.__ocultas[c.etiqueta]; });
  }

  function actualizar() {
    var visible = datosVisibles();
    el.__visibleActual = visible;
    el.__chart.updateOptions({
      series: [
        { name: 'Resto del Estado', data: visible.map(function (c) { return Number(pct1(c.resto)); }) },
        { name: 'Juárez', data: visible.map(function (c) { return Number(pct1(c.juarez)); }) },
        { name: 'Chihuahua', data: visible.map(function (c) { return Number(pct1(c.chihuahua)); }) }
      ],
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
    series: [
      { name: 'Resto del Estado', data: visibleInicial.map(function (c) { return Number(pct1(c.resto)); }) },
      { name: 'Juárez', data: visibleInicial.map(function (c) { return Number(pct1(c.juarez)); }) },
      { name: 'Chihuahua', data: visibleInicial.map(function (c) { return Number(pct1(c.chihuahua)); }) }
    ],
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

// Junta un campo (partido/escenario1/escenario2/morena) de las 3 regiones en una sola lista,
// ordenada por el promedio simple de las 3 regiones (solo para fijar un orden estable).
function combinarRegiones(campo) {
  var mapa = {};
  ['resto', 'juarez', 'chihuahua'].forEach(function (region) {
    resumenRegiones[region][campo].forEach(function (c) {
      if (!mapa[c.etiqueta]) mapa[c.etiqueta] = { etiqueta: c.etiqueta, resto: 0, juarez: 0, chihuahua: 0 };
      mapa[c.etiqueta][region] = c.ponderado;
    });
  });
  return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) {
    if (a.etiqueta === '-') return 1;
    if (b.etiqueta === '-') return -1;
    var pa = (a.resto + a.juarez + a.chihuahua) / 3;
    var pb = (b.resto + b.juarez + b.chihuahua) / 3;
    return pb - pa;
  });
}

// Rellena la fila de KPIs (5 tarjetas con divisores) para un bloque de stats
// con la forma { partido, escenario1, escenario2, morena, totalFilas }.
function pintarKpis(prefijo, stats) {
  var fmt = function (n) { return n.toLocaleString('es-MX'); };
  var liderPartido = liderConOpinion(stats.partido);
  var liderEsc1 = liderConOpinion(stats.escenario1);
  var liderEsc2 = liderConOpinion(stats.escenario2);
  var coberturaMorena = coberturaConOpinion(stats.morena);

  document.getElementById(prefijo + '_total').textContent = fmt(stats.totalFilas);
  document.getElementById(prefijo + '_partido').textContent = liderPartido.etiqueta;
  document.getElementById(prefijo + '_partido_pct').textContent = pct1(liderPartido.ponderado) + '%';
  document.getElementById(prefijo + '_esc1').textContent = liderEsc1.etiqueta;
  document.getElementById(prefijo + '_esc1_pct').textContent = pct1(liderEsc1.ponderado) + '%';
  document.getElementById(prefijo + '_esc2').textContent = liderEsc2.etiqueta;
  document.getElementById(prefijo + '_esc2_pct').textContent = pct1(liderEsc2.ponderado) + '%';
  document.getElementById(prefijo + '_morena').textContent = pct1(coberturaMorena) + '%';
}

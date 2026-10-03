# Transformaciones: GeoJSON + .lyrx -> .js para Leaflet

Convierte capas exportadas de ArcGIS Pro (`.geojson` + `.lyrx`) a archivos
`.js` listos para usar en el mapa (`var nombreCapa = {...};`), reproyectando
a WGS84 y "horneando" en cada feature la simbologia (`Clase`/`Color`) leida
directamente del `.lyrx`, tal como se hizo a mano para la capa DL24.

## Uso

1. Arrastra a la carpeta [entrada/](entrada/) el `.geojson` y su `.lyrx`
   correspondiente. **Deben tener el mismo nombre de archivo** (se ignoran
   espacios, mayusculas y guiones, por lo que `"DL 24.geojson"` y
   `"DL24.lyrx"` sí se emparejan).
2. Corre desde la raiz del proyecto:
   ```
   node transformaciones/procesar.js
   ```
3. Los resultados quedan en [salida/](salida/):
   - `<nombre>.js` — la capa lista para `<script src="transformaciones/salida/<nombre>.js"></script>`.
   - `<nombre>.simbologia.json` — referencia legible de los colores/cortes que se decodificaron del `.lyrx`, para verificar que la leyenda del mapa coincide.

Puedes soltar varias capas a la vez (varios pares geojson/lyrx); el script
procesa todo lo que encuentre en `entrada/` en una sola corrida.

Si solo arrastras un `.geojson` sin su `.lyrx`, igual se reproyecta y se
genera el `.js`, pero sin `Clase`/`Color` (simbologia por defecto).

### Modo de un solo archivo (rutas explicitas)

```
node transformaciones/procesar.js "ruta/a/capa.geojson" "ruta/a/capa.lyrx" nombreVariable
```

### Controlar la simplificacion de geometria

Por defecto se simplifica con una tolerancia de **2 metros** (Douglas-Peucker,
aplicado anillo por anillo antes de reproyectar). Se puede ajustar con flags,
en modo batch o de un solo archivo:

```
node transformaciones/procesar.js --tolerancia=10
node transformaciones/procesar.js --sin-simplificar
node transformaciones/procesar.js "capa.geojson" "capa.lyrx" nombreVariable --tolerancia=10
```

Referencia con la capa DL24 (298,716 vertices en el `.geojson` original):

| Tolerancia | Vertices resultantes | Reduccion |
|---|---|---|
| 2 m (default) | 220,214 | -26% |
| 5 m | 200,404 | -33% |
| 10 m | 178,660 | -40% |
| 20 m | 149,904 | -50% |
| sin simplificar | 298,716 | 0% |

El `dl24.js` original (hecho a mano) tiene 130,515 vertices, equivalente a
una tolerancia de entre 20 y 30 m aprox. Para secciones electorales (poligonos
del tamano de una colonia/manzana) tolerancias de hasta ~10-15 m no suelen
notarse en el mapa; si la capa tiene poligonos muy pequenos o se hace zoom
muy cercano, conviene usar 2-5 m o `--sin-simplificar`.

## Que hace exactamente

1. **Reproyecta** de UTM WGS84 (EPSG:326xx Norte / 327xx Sur — lo que usan
   la mayoria de los shapefiles/geodatabases de INE/INEGI) a lon/lat
   (EPSG:4326), que es lo que Leaflet necesita. Si el `.geojson` no declara
   CRS, se asume que ya viene en lon/lat y no se toca.
2. **Lee el renderer del `.lyrx`** (formato CIM/JSON de ArcGIS Pro) y lo
   decodifica segun su tipo:
   - `CIMUniqueValueRenderer` con `authoringInfo` bivariado (como DL24: PAN x
     MORENA) -> calcula el codigo de rango (`L`/`M1`/`M2`/`H` en una grilla
     4x4) para cada campo usando los `upperBounds` ya calculados por ArcGIS
     Pro, y busca el color exacto de esa combinacion dentro del propio
     `.lyrx`.
   - `CIMClassBreaksRenderer` (choropleth de un solo campo).
   - `CIMUniqueValueRenderer` simple (categorico, uno o varios campos).
   - `CIMSimpleRenderer` (un solo color fijo).
3. **Agrega `Clase` y `Color`** a las `properties` de cada feature con el
   resultado.
4. **Escribe el `.js`** envolviendo el GeoJSON resultante en
   `var <nombre> = {...};`, igual que `dl24.js`.

## Limitaciones conocidas

- La reproyeccion solo cubre EPSG:4326 y UTM WGS84 (326xx/327xx). Si llega
  una capa con otro CRS, el script avisa por consola y no reproyecta —
  hay que agregar la formula correspondiente en `procesar.js`
  (`detectarReproyeccion`).
- El renombrado de campos (p. ej. `F15_PAN` -> `PAN`) que se hizo a mano
  para DL24 **no** se generaliza aqui a proposito, porque cada capa trae
  sus propios nombres de campo; el script conserva los nombres originales
  del `.geojson` y solo agrega `Clase`/`Color`. Si el HTML necesita nombres
  amigables, se mapean en el JS del dashboard (como ya se hace con
  `MAPEO_FILTRO_DL24` en `index.html`).
- El orden de codigos `L`/`M1`/`M2`/`H` para renderers bivariados asume la
  convencion estandar de ArcGIS Pro para grillas 4x4 (2x2 y 3x3 tambien
  estan soportadas). Si una capa usa una grilla distinta o los colores no
  coinciden con lo esperado, revisa el `.simbologia.json` generado.

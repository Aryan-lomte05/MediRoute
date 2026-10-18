/**
 * ==============================================================================
 * MEDIROUTE - MAPBOX LAYER HELPERS (lib/mapLayers.js)
 * ==============================================================================
 *
 * WHY THIS EXISTS:
 * Both the landing hero and the login background inserted their traffic layer
 * with a hardcoded beforeId of 'road-label'. No such layer exists in the
 * current Mapbox dark style, so addLayer threw every time and the live traffic
 * congestion overlay was never drawn — the feature appeared to work only
 * because the error was swallowed by the surrounding try/catch.
 *
 * Mapbox renames style layers between style versions, so a literal id is never
 * safe. These helpers resolve a real insertion point from the loaded style.
 * ==============================================================================
 */

/**
 * The id of the first symbol (text/icon) layer in the loaded style.
 *
 * Inserting below it keeps road names and place labels legible on top of an
 * overlay. Returns undefined when the style has no symbol layers, in which case
 * addLayer should be called without a beforeId so the layer goes on top.
 *
 * @param {import('mapbox-gl').Map} map
 * @returns {string|undefined}
 */
export function firstSymbolLayerId(map) {
  try {
    const layers = map.getStyle()?.layers || []
    return layers.find((l) => l.type === 'symbol' && l.layout?.['text-field'])?.id
  } catch {
    return undefined
  }
}

/**
 * Add a layer, inserting it beneath the style's labels when possible.
 *
 * Swallows nothing silently: a genuine failure is logged with the layer id so a
 * broken overlay is visible in the console instead of simply not appearing.
 *
 * @param {import('mapbox-gl').Map} map
 * @param {object} layer A Mapbox layer specification.
 * @returns {boolean} whether the layer was added.
 */
export function addLayerBelowLabels(map, layer) {
  if (!map || !layer?.id) return false
  if (map.getLayer(layer.id)) return true

  const beforeId = firstSymbolLayerId(map)

  try {
    // Passing an undefined beforeId is not the same as omitting it, so the two
    // cases are called separately.
    if (beforeId) map.addLayer(layer, beforeId)
    else map.addLayer(layer)
    return true
  } catch (err) {
    console.warn(`[map] could not add layer "${layer.id}":`, err.message)
    return false
  }
}

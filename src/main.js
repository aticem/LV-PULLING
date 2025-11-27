import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";

const totalValueEl = document.getElementById("lv-total-value");
const selectionListEl = document.getElementById("lv-selection-list");
const resetButton = document.getElementById("lv-reset");
const statusEl = document.getElementById("lv-status");

const TABLE_ID_REGEX = /-STR\d+$/i;
const TABLE_LAYER_DEFAULT_STYLE = {
  color: "#475569",
  weight: 1,
  opacity: 0.85,
  fillColor: "#cbd5f5",
  fillOpacity: 0.08
};
const TABLE_LAYER_HOVER_STYLE = {
  color: "#0ea5e9",
  weight: 2,
  opacity: 0.95,
  fillColor: "#38bdf8",
  fillOpacity: 0.18
};

const state = {
  totalMeters: 0,
  selected: new Map(),
  markers: new Map()
};

const LV_CSV_CANDIDATES = ["/LV.CSV", "/lv.csv"];

function normalizeId(id) {
  if (typeof id !== "string") return "";
  const trimmed = id.trim();
  if (!trimmed) return "";
  const withoutSpacesBeforeDigits = trimmed.replace(/\s+(?=\d)/g, "");
  return withoutSpacesBeforeDigits.replace(/\d+/g, (segment) => String(Number(segment)));
}

function setStatus(message) {
  if (!statusEl) return;
  statusEl.textContent = message ?? "";
}

function detectDelimiter(line = "") {
  if (line.includes(",")) return ",";
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

function parseLengths(csvText) {
  const rows = csvText
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row.length);

  if (!rows.length) return new Map();

  const delimiter = detectDelimiter(rows[0]);
  const headerCells = rows[0]
    .split(delimiter)
    .map((cell) => cell.trim().toLowerCase());

  const idIndex = headerCells.findIndex((cell) => cell === "id" || cell === "di");
  const lengthIndex = headerCells.findIndex((cell) => cell.includes("length"));

  const lengths = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i].split(delimiter).map((cell) => cell.trim());
    const id = cells[idIndex >= 0 ? idIndex : 0];
    const rawLength = cells[lengthIndex >= 0 ? lengthIndex : 1];
    const parsedLength = Number(rawLength?.replace?.(",", "."));

    const normalizedId = normalizeId(id);
    if (!normalizedId || Number.isNaN(parsedLength)) continue;
    lengths.set(normalizedId, parsedLength);
  }

  return lengths;
}

async function loadCableLengths() {
  for (const url of LV_CSV_CANDIDATES) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const text = await response.text();
      return parseLengths(text);
    } catch (error) {
      console.warn(`Failed to fetch ${url}:`, error);
    }
  }

  throw new Error("LV cable length CSV could not be loaded.");
}

async function loadInverterGeojson() {
  const response = await fetch("/text.geojson");
  if (!response.ok) {
    throw new Error("text.geojson could not be loaded.");
  }
  return response.json();
}

async function loadTableGeojson() {
  const response = await fetch("/file.geojson");
  if (!response.ok) {
    throw new Error("file.geojson could not be loaded.");
  }
  return response.json();
}

function getFeatureId(feature) {
  return (
    feature?.properties?.name ||
    feature?.properties?.text ||
    feature?.properties?.id ||
    null
  );
}

function isTableLabelFeature(feature) {
  const id = getFeatureId(feature);
  return typeof id === "string" && TABLE_ID_REGEX.test(id);
}

function extractCoordinates(tuple = []) {
  if (!Array.isArray(tuple) || tuple.length < 2) return null;
  return [Number(tuple[0]), Number(tuple[1])];
}

function pointInRing(point, ring = []) {
  if (!point || !Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const xi = pi[0];
    const yi = pi[1];
    const xj = pj[0];
    const yj = pj[1];
    const intersect = yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function getRingsFromGeometry(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return geometry.coordinates?.map((ring) => ring.map(extractCoordinates).filter(Boolean)) ?? [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      ?.flatMap((poly) => poly.map((ring) => ring.map(extractCoordinates).filter(Boolean))) ?? [];
  }
  if (geometry.type === "LineString") {
    return [geometry.coordinates?.map(extractCoordinates).filter(Boolean) ?? []];
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates?.map((line) => line.map(extractCoordinates).filter(Boolean)) ?? [];
  }
  return [];
}

function ensureClosedRing(ring) {
  if (!ring.length) return ring;
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  if (Math.abs(firstLng - lastLng) < 1e-12 && Math.abs(firstLat - lastLat) < 1e-12) {
    return ring;
  }
  return [...ring, [firstLng, firstLat]];
}

function convertLineStringToPolygon(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates) return null;
  const ring = coordinates.map(extractCoordinates).filter(Boolean);
  if (ring.length < 3) return null;
  return {
    ...feature,
    geometry: {
      type: "Polygon",
      coordinates: [ensureClosedRing(ring)]
    }
  };
}

function convertMultiLineStringToPolygon(feature) {
  const lines = feature?.geometry?.coordinates;
  if (!Array.isArray(lines)) return null;
  const polygons = [];
  for (const line of lines) {
    const ring = (line ?? []).map(extractCoordinates).filter(Boolean);
    if (ring.length >= 3) {
      polygons.push([ensureClosedRing(ring)]);
    }
  }
  if (!polygons.length) return null;
  return {
    ...feature,
    geometry: {
      type: "MultiPolygon",
      coordinates: polygons
    }
  };
}

function convertTablesToPolygons(tableGeojson) {
  const features = tableGeojson?.features ?? [];
  const converted = [];

  for (const feature of features) {
    if (!feature?.geometry) continue;
    if (feature.geometry.type === "LineString") {
      const polyFeature = convertLineStringToPolygon(feature);
      if (polyFeature) converted.push(polyFeature);
    } else if (feature.geometry.type === "MultiLineString") {
      const polyFeature = convertMultiLineStringToPolygon(feature);
      if (polyFeature) converted.push(polyFeature);
    } else {
      converted.push(feature);
    }
  }

  return {
    type: "FeatureCollection",
    features: converted
  };
}

function findTableLabelsForGeometry(geometry, tableLabelPoints) {
  const rings = getRingsFromGeometry(geometry).filter((ring) => ring.length >= 3);
  if (!rings.length) return [];

  const matches = [];
  for (const label of tableLabelPoints) {
    const [lng, lat] = label.coordinates;
    for (const ring of rings) {
      if (pointInRing([lng, lat], ring)) {
        matches.push(label.id);
        break;
      }
    }
  }
  return matches;
}

function partitionLabelFeatures(labelGeojson) {
  const features = labelGeojson?.features ?? [];
  const inverterFeatures = [];
  const tableLabelPoints = [];

  for (const feature of features) {
    const id = getFeatureId(feature);
    if (!id || feature?.geometry?.type !== "Point") continue;
    if (isTableLabelFeature(feature)) {
      const coords = extractCoordinates(feature.geometry.coordinates);
      if (!coords) continue;
      tableLabelPoints.push({ id, coordinates: coords });
    } else {
      inverterFeatures.push(feature);
    }
  }

  return {
    inverterGeojson: {
      type: "FeatureCollection",
      features: inverterFeatures
    },
    tableLabelPoints
  };
}

function setMarkerSelected(marker, isSelected) {
  marker.lvSelected = isSelected;
  const element = marker.getElement();
  if (element) {
    element.classList.toggle("lv-inverter-label--selected", Boolean(isSelected));
  }
}

function updateSelectionUI() {
  if (totalValueEl) {
    totalValueEl.textContent = state.totalMeters.toLocaleString(undefined, {
      maximumFractionDigits: 2
    });
  }

  if (!selectionListEl) return;

  if (!state.selected.size) {
    selectionListEl.innerHTML =
      '<p class="lv-selection__empty">No inverters selected yet.</p>';
    return;
  }

  const chips = [];
  for (const [id, length] of state.selected.entries()) {
    chips.push(
      `<div class="lv-chip"><span>${id}</span><span class="lv-chip__length">${length} m</span></div>`
    );
  }
  selectionListEl.innerHTML = chips.join("");
}

function handleMarkerClick(id, marker, lengthsMap) {
  if (!id) return;

  const matchingLength = lengthsMap.get(normalizeId(id));
  if (matchingLength == null) {
    setStatus(`No LV length found for ${id}.`);
    return;
  }

  if (state.selected.has(id)) {
    setStatus(`${id} already counted.`);
    return;
  }

  const scaledLength = Number(matchingLength);
  state.selected.set(id, scaledLength);
  state.totalMeters += scaledLength;
  setMarkerSelected(marker, true);
  updateSelectionUI();
  setStatus(`Added ${id}: ${scaledLength} m`);
}

function resetSelections() {
  state.totalMeters = 0;
  state.selected.clear();

  for (const marker of state.markers.values()) {
    setMarkerSelected(marker, false);
  }

  updateSelectionUI();
  setStatus("Selection reset.");
}

function createMarker(feature, latlng, lengthsMap) {
  const inverterId = getFeatureId(feature);
  if (!inverterId) return null;

  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: "lv-inverter-label",
      html: `<span>${inverterId}</span>`
    })
  });

  marker.on("click", () => handleMarkerClick(inverterId, marker, lengthsMap));
  marker.on("add", () => setMarkerSelected(marker, state.selected.has(inverterId)));
  state.markers.set(inverterId, marker);
  return marker;
}

function createTableLayer(tableGeojson, tableLabelPoints) {
  return L.geoJSON(tableGeojson, {
    style: () => TABLE_LAYER_DEFAULT_STYLE,
    filter: (feature) => feature?.geometry && feature.geometry.type !== "Point",
    onEachFeature: (feature, layer) => {
      const labels = findTableLabelsForGeometry(feature.geometry, tableLabelPoints);
      if (labels.length) {
        layer.bindTooltip(labels.join("<br>"), {
          sticky: true,
          className: "lv-table-tooltip",
          direction: "center"
        });
      }

      layer.on("mouseover", () => {
        layer.setStyle(TABLE_LAYER_HOVER_STYLE);
        if (layer.getTooltip()) {
          layer.openTooltip();
        }
      });

      layer.on("mouseout", () => {
        layer.setStyle(TABLE_LAYER_DEFAULT_STYLE);
        if (layer.getTooltip()) {
          layer.closeTooltip();
        }
      });
    }
  });
}

function initializeMap(lengthsMap, inverterGeojson, tableGeojson, tableLabelPoints) {
  const map = L.map("map", {
    zoomControl: true,
    preferCanvas: true
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 20
  }).addTo(map);

  const tableLayer = tableGeojson
    ? createTableLayer(tableGeojson, tableLabelPoints)
    : null;
  if (tableLayer) {
    tableLayer.addTo(map);
  }

  const inverterLayer = L.geoJSON(inverterGeojson, {
    pointToLayer: (feature, latlng) => createMarker(feature, latlng, lengthsMap),
    filter: (feature) => feature?.geometry?.type === "Point" && !!getFeatureId(feature)
  }).addTo(map);

  let combinedBounds = null;
  const includeBounds = (layer) => {
    if (!layer || !layer.getBounds) return;
    const bounds = layer.getBounds();
    if (!bounds.isValid()) return;
    combinedBounds = combinedBounds ? combinedBounds.extend(bounds) : bounds;
  };

  includeBounds(tableLayer);
  includeBounds(inverterLayer);

  if (combinedBounds) {
    map.fitBounds(combinedBounds.pad(0.2));
  } else {
    map.setView([0, 0], 2);
  }

  resetButton?.addEventListener("click", resetSelections);
  updateSelectionUI();
  setStatus("Tap an inverter to start pulling lengths.");
}

async function bootstrap() {
  try {
    const [lengthsMap, labelGeojson, tableGeojson] = await Promise.all([
      loadCableLengths(),
      loadInverterGeojson(),
      loadTableGeojson()
    ]);
    const { inverterGeojson, tableLabelPoints } = partitionLabelFeatures(labelGeojson);
    const polygonizedTables = convertTablesToPolygons(tableGeojson);
    initializeMap(lengthsMap, inverterGeojson, polygonizedTables, tableLabelPoints);
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
}

bootstrap();

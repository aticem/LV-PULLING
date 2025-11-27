export const TABLE_ID_REGEX = /-STR\d+$/i;

export const TABLE_LAYER_DEFAULT_STYLE = {
  color: "#475569",
  weight: 1,
  opacity: 0.85,
  fillColor: "#cbd5f5",
  fillOpacity: 0.08
};

export const TABLE_LAYER_HOVER_STYLE = {
  color: "#0ea5e9",
  weight: 2,
  opacity: 0.95,
  fillColor: "#38bdf8",
  fillOpacity: 0.18
};

export function getFeatureId(feature) {
  return (
    feature?.properties?.name ||
    feature?.properties?.text ||
    feature?.properties?.id ||
    null
  );
}

export function isTableLabelFeature(feature) {
  const id = getFeatureId(feature);
  return typeof id === "string" && TABLE_ID_REGEX.test(id);
}

export function extractCoordinates(tuple = []) {
  if (!Array.isArray(tuple) || tuple.length < 2) return null;
  return [Number(tuple[0]), Number(tuple[1])];
}

export function pointInRing(point, ring = []) {
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

export function getRingsFromGeometry(geometry) {
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

export function convertTablesToPolygons(tableGeojson) {
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

export function findTableLabelsForGeometry(geometry, tableLabelPoints) {
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

export function partitionLabelFeatures(labelGeojson) {
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

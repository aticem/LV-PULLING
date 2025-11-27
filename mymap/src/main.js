import maplibregl from "maplibre-gl";
import * as turf from "@turf/turf";

function renderStatusMessage(text) {
  const container = document.getElementById("map");
  if (!container) return;
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-family:sans-serif;font-size:1rem;color:#333;text-align:center;padding:1rem;">${text}</div>`;
}

const PANEL_LAYER_CANDIDATES = new Set([
  "SOMBREADO SUB 06",
  "panels",
  "panel",
  "inv",
  "inv point"
]);

function isPanelLabel(properties = {}) {
  return (
    typeof properties.text === "string" &&
    properties.text.includes("-STR")
  );
}

function isInverterLabel(properties = {}) {
  if (typeof properties.text !== "string") return false;
  return properties.text.includes("INV") && !properties.text.includes("-STR");
}

function isPanelLine(feature) {
  if (feature.geometry?.type !== "LineString") return false;
  const layerName = feature.properties?.layer;
  if (!layerName) return true;
  return PANEL_LAYER_CANDIDATES.has(layerName);
}

function getSegmentBearing(line, segmentIndex) {
  const coords = line.geometry?.coordinates ?? [];
  if (coords.length < 2) return 0;
  const startIndex = Math.min(Math.max(segmentIndex, 0), coords.length - 2);
  const start = coords[startIndex];
  const end = coords[startIndex + 1];
  if (!start || !end) return 0;
  return turf.bearing(turf.point(start), turf.point(end));
}

function getLineCenter(line) {
  const coords = line.geometry?.coordinates ?? [];
  if (!coords.length) return null;
  const first = coords[0];
  const last = coords[coords.length - 1];
  const isClosed = first && last && first[0] === last[0] && first[1] === last[1];
  if (isClosed && coords.length >= 4) {
    try {
      const polygon = turf.polygon([coords]);
      return turf.centerOfMass(polygon).geometry.coordinates;
    } catch (err) {
      console.warn("Failed to compute polygon center:", err);
    }
  }
  return turf.center(turf.lineString(coords)).geometry.coordinates;
}

function enhanceLabels(features) {
  const lineFeatures = features.filter(isPanelLine);
  if (!lineFeatures.length) return;

  const pointFeatures = features.filter(
    (feature) => feature.geometry?.type === "Point"
  );

  for (const point of pointFeatures) {
    if (!isPanelLabel(point.properties) && !isInverterLabel(point.properties)) {
      continue;
    }

    let closestMatch = null;
    let shortestDistance = Infinity;
    const pointGeom = turf.point(point.geometry.coordinates);

    for (const line of lineFeatures) {
      const snap = turf.nearestPointOnLine(line, pointGeom, { units: "meters" });
      if (snap.properties.dist < shortestDistance) {
        shortestDistance = snap.properties.dist;
        closestMatch = {
          line,
          snap
        };
      }
    }

    if (!closestMatch) continue;

    const bearing = getSegmentBearing(
      closestMatch.line,
      closestMatch.snap.properties.index
    );

    point.properties = {
      ...point.properties,
      computedAngle: bearing
    };

    const centerCoords = getLineCenter(closestMatch.line);
    if (centerCoords) {
      point.geometry = {
        ...point.geometry,
        coordinates: centerCoords
      };
    }
  }
}

async function loadGeojson() {
  const sources = ["/file.geojson", "/text.geojson"];
  const responses = await Promise.allSettled(
    sources.map((url) => fetch(url))
  );

  const datasets = await Promise.all(
    responses.map(async (result, index) => {
      if (result.status === "fulfilled" && result.value.ok) {
        try {
          return await result.value.json();
        } catch (err) {
          console.warn(`${sources[index]} could not be parsed:`, err);
          return null;
        }
      }

      console.warn(`${sources[index]} could not be loaded.`);
      return null;
    })
  );

  const successfulDatasets = datasets.filter(Boolean);
  if (!successfulDatasets.length) {
    throw new Error("No GeoJSON files could be loaded.");
  }

  const features = successfulDatasets.flatMap((data) => data.features ?? []);

  return {
    data: {
      type: "FeatureCollection",
      features
    },
    allSourcesEmpty: features.length === 0
  };
}

(async function initMap() {
  try {
    const { data: geojsonData, allSourcesEmpty } = await loadGeojson();
    if (allSourcesEmpty) {
      renderStatusMessage("Both GeoJSON files are empty.");
      return;
    }

    const hasFeatures = geojsonData.features?.length;
    const defaultCenter = hasFeatures
      ? turf.center(geojsonData).geometry.coordinates
      : [0, 0];
    const defaultZoom = hasFeatures ? 15 : 2;

    const map = new maplibregl.Map({
      container: "map",
      style: "https://demotiles.maplibre.org/style.json",
      center: defaultCenter,
      zoom: defaultZoom
    });

    map.on("load", () => {
      map.addSource("mydata", {
        type: "geojson",
        data: geojsonData
      });

      // Lines
      map.addLayer({
        id: "lines",
        type: "line",
        source: "mydata",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#ff0000",
          "line-width": 2
        }
      });

      const rotationExpression = [
        "coalesce",
        ["get", "computedAngle"],
        ["get", "angle"],
        0
      ];

      // All text labels (tables + inverter dots)
      map.addLayer({
        id: "labels",
        type: "symbol",
        source: "mydata",
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "text-field": ["get", "text"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "height"], 1],
            0.5,
            11,
            2,
            16
          ],
          "text-anchor": "center",
          "text-justify": "center",
          "text-offset": [0, 0],
          "text-rotation-alignment": "map",
          "text-keep-upright": false,
          "text-rotate": rotationExpression,
          "text-allow-overlap": true,
          "text-ignore-placement": true
        },
        paint: {
          "text-color": "#cc0000",
          "text-halo-color": "#ffffff",
          "text-halo-width": 0.75
        }
      });

      if (hasFeatures) {
        const bbox = turf.bbox(geojsonData);
        map.fitBounds(bbox, { padding: 20, duration: 0 });
      }
    });
  } catch (error) {
    console.error("Map failed to load:", error);
    renderStatusMessage("Unable to load map data.");
  }
})();

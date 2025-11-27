import { useCallback, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  findTableLabelsForGeometry,
  getFeatureId,
  TABLE_LAYER_DEFAULT_STYLE,
  TABLE_LAYER_HOVER_STYLE
} from "../lib/geoUtils.js";

export default function PanelMap({
  features,
  tableGeojson,
  tableLabelPoints,
  onToggleStatus,
  loading
}) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const inverterLayerRef = useRef(null);
  const tableLayerRef = useRef(null);
  const boundsLockedRef = useRef(false);

  useEffect(() => {
    if (mapRef.current) {
      console.log("Leaflet map already initialized");
      return;
    }
    if (!containerRef.current) {
      console.error("Map container ref is not set");
      return;
    }
    console.log("Initializing Leaflet map", containerRef.current);
    console.log("Container dimensions:", containerRef.current.clientWidth, containerRef.current.clientHeight);
    const map = L.map(containerRef.current, {
      zoomControl: true,
      preferCanvas: true
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 20
    }).addTo(map);

    mapRef.current = map;
    console.log("Leaflet map initialized", map);

    return () => {
      map.remove();
      mapRef.current = null;
      console.log("Leaflet map destroyed");
    };
  }, []);

  const handleBounds = useCallback((layer) => {
    if (!layer || boundsLockedRef.current) return;
    const bounds = layer.getBounds?.();
    if (bounds?.isValid()) {
      mapRef.current?.fitBounds(bounds.pad(0.2));
      boundsLockedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (tableLayerRef.current) {
      tableLayerRef.current.remove();
      tableLayerRef.current = null;
    }
    if (!tableGeojson) return;

    const layer = L.geoJSON(tableGeojson, {
      style: () => TABLE_LAYER_DEFAULT_STYLE,
      filter: (feature) => feature?.geometry && feature.geometry.type !== "Point",
      onEachFeature: (feature, layerRef) => {
        const labels = findTableLabelsForGeometry(feature.geometry, tableLabelPoints);
        if (labels.length) {
          layerRef.bindTooltip(labels.join("<br>"), {
            sticky: true,
            className: "lv-table-tooltip",
            direction: "center"
          });
        }

        layerRef.on("mouseover", () => {
          layerRef.setStyle(TABLE_LAYER_HOVER_STYLE);
          if (layerRef.getTooltip()) {
            layerRef.openTooltip();
          }
        });
        layerRef.on("mouseout", () => {
          layerRef.setStyle(TABLE_LAYER_DEFAULT_STYLE);
          if (layerRef.getTooltip()) {
            layerRef.closeTooltip();
          }
        });
      }
    });

    layer.addTo(mapRef.current);
    tableLayerRef.current = layer;
    handleBounds(layer);
  }, [handleBounds, tableGeojson, tableLabelPoints]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (inverterLayerRef.current) {
      inverterLayerRef.current.remove();
      inverterLayerRef.current = null;
    }
    if (!features?.length) return;

    const layer = L.geoJSON({ type: "FeatureCollection", features }, {
      filter: (feature) => feature?.geometry?.type === "Point" && !!getFeatureId(feature),
      pointToLayer: (feature, latlng) => {
        const inverterId = getFeatureId(feature);
        if (!inverterId) return null;
        const status = feature?.properties?.status;
        const className = status === "done"
          ? "lv-inverter-label lv-inverter-label--selected"
          : "lv-inverter-label";
        const marker = L.marker(latlng, {
          icon: L.divIcon({
            className,
            html: `<span>${inverterId}</span>`
          })
        });
        marker.on("click", () => onToggleStatus?.(inverterId));
        return marker;
      }
    });

    layer.addTo(mapRef.current);
    inverterLayerRef.current = layer;
    handleBounds(layer);
  }, [features, handleBounds, onToggleStatus]);

  return (
    <div className="lv-map-wrapper">
      {loading && <div className="lv-map__loading">Loading map</div>}
      <div ref={containerRef} className="lv-map" aria-label="Panel map" />
    </div>
  );
}

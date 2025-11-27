import { useCallback, useEffect, useMemo, useState } from "react";
import PanelMap from "./components/PanelMap.jsx";
import ProgressStats from "./components/ProgressStats.jsx";
import SubmitModal from "./components/SubmitModal.jsx";
import useDailyLog from "./components/useDailyLog.js";
import { useChartExport } from "./components/useChartExport.js";
import {
  loadCableLengths,
  loadLabelGeojson,
  loadTableGeojson,
  LENGTH_MULTIPLIER,
  normalizeId
} from "./lib/dataLoader.js";
import {
  convertTablesToPolygons,
  getFeatureId,
  partitionLabelFeatures
} from "./lib/geoUtils.js";

export default function App() {
  const [features, setFeatures] = useState([]);
  const [tableGeojson, setTableGeojson] = useState(null);
  const [tableLabelPoints, setTableLabelPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [lengthsMap, setLengthsMap] = useState(new Map());
  const [isModalOpen, setModalOpen] = useState(false);

  const { dailyLog, addRecord, resetLog } = useDailyLog();
  const { exportToExcel } = useChartExport();

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        setLoading(true);
        setError("");
        console.log("Starting data load...");
        const [lengthsMap, labelGeojson, rawTableGeojson] = await Promise.all([
          loadCableLengths(),
          loadLabelGeojson(),
          loadTableGeojson()
        ]);
        console.log("Data loaded", { lengthsMap, labelGeojson, rawTableGeojson });

        if (!active) return;

        const { inverterGeojson, tableLabelPoints: labelPoints } = partitionLabelFeatures(labelGeojson);
        const polygonTables = convertTablesToPolygons(rawTableGeojson);
        console.log("Processed geojson", { inverterGeojson, polygonTables });

        const enrichedFeatures = (inverterGeojson.features ?? []).map((feature) => {
          const inverterId = getFeatureId(feature);
          const normalizedId = normalizeId(inverterId ?? "");
          const meters = lengthsMap.get(normalizedId) ?? 0;
          const totalPanels = Number(meters * LENGTH_MULTIPLIER) || 1;
          return {
            ...feature,
            properties: {
              ...feature.properties,
              inverter_id: inverterId,
              normalizedId,
              total_panels: totalPanels,
              status: "pending"
            }
          };
        });

        setFeatures(enrichedFeatures);
        setTableGeojson(polygonTables);
        setTableGeojson(polygonTables);
        setTableLabelPoints(labelPoints);
        setLengthsMap(lengthsMap);
        console.log("Features and tables set", { enrichedFeatures, labelPoints });
      } catch (err) {
        console.error("Data load error:", err);
        if (active) {
          setError(err?.message ?? "Failed to load map data.");
        }
      } finally {
        if (active) {
          setLoading(false);
          console.log("Data load finished");
        }
      }
    }

    loadData();
    return () => {
      active = false;
    };
  }, []);

  const totalMeters = useMemo(() => {
    return Array.from(lengthsMap.values()).reduce((sum, meters) => sum + meters, 0);
  }, [lengthsMap]);

  const completedMeters = useMemo(() => {
    return features
      .filter((feature) => feature?.properties?.status === "done")
      .reduce((sum, feature) => {
        const normalizedId = feature?.properties?.normalizedId;
        const meters = lengthsMap.get(normalizedId) || 0;
        return sum + meters;
      }, 0);
  }, [features, lengthsMap]);

  const completionPercentage = useMemo(() => {
    return totalMeters > 0 ? Math.round((completedMeters / totalMeters) * 100) : 0;
  }, [completedMeters, totalMeters]);

  const remainingMeters = useMemo(() => {
    return totalMeters - completedMeters;
  }, [totalMeters, completedMeters]);

  const dailyInstalled = useMemo(() => {
    return features
      .filter((feature) => feature?.properties?.status === "done")
      .reduce((sum, feature) => sum + (feature?.properties?.total_panels ?? 1), 0);
  }, [features]);

  const latestRecord = dailyLog[dailyLog.length - 1];

  const handleToggleStatus = useCallback((id) => {
    setHistory((prev) => [...prev, features]);
    setRedoStack([]); // Clear redo on new action
    setFeatures((prev) =>
      prev.map((feature) => {
        const inverterId = getFeatureId(feature);
        if (inverterId !== id) return feature;
        const nextStatus = feature?.properties?.status === "done" ? "pending" : "done";
        return {
          ...feature,
          properties: {
            ...feature.properties,
            status: nextStatus
          }
        };
      })
    );
  }, [features]);

  const handleUndo = useCallback(() => {
    if (history.length > 0) {
      setRedoStack((prev) => [...prev, features]);
      setFeatures(history[history.length - 1]);
      setHistory((prev) => prev.slice(0, -1));
    }
  }, [features, history]);

  const handleRedo = useCallback(() => {
    if (redoStack.length > 0) {
      setHistory((prev) => [...prev, features]);
      setFeatures(redoStack[redoStack.length - 1]);
      setRedoStack((prev) => prev.slice(0, -1));
    }
  }, [features, redoStack]);

  const handleSubmitModal = useCallback(
    (payload) => {
      addRecord({
        ...payload,
        installed_panels: dailyInstalled
      });
      setModalOpen(false);
    },
    [addRecord, dailyInstalled]
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'z' && !event.shiftKey) {
          event.preventDefault();
          handleUndo();
        } else if ((event.key === 'y') || (event.key === 'z' && event.shiftKey)) {
          event.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  return (
    <div className="lv-app">
      <ProgressStats
        totalMeters={totalMeters}
        completedMeters={completedMeters}
        completionPercentage={completionPercentage}
        remainingMeters={remainingMeters}
      />

      <section className="lv-actions">
        <div className="lv-actions__group">
          <button type="button" className="lv-button lv-button--ghost" onClick={handleUndo} disabled={!history.length}>
            ↶ Undo
          </button>
          <button type="button" className="lv-button lv-button--ghost" onClick={handleRedo} disabled={!redoStack.length}>
            ↷ Redo
          </button>
          <button type="button" className="lv-button" onClick={() => setModalOpen(true)}>
            Submit Daily Work
          </button>
          <button
            type="button"
            className="lv-button lv-button--secondary"
            disabled={!dailyLog.length}
            onClick={() => exportToExcel(dailyLog)}
          >
            Export Excel
          </button>
          <button
            type="button"
            className="lv-button lv-button--ghost"
            disabled={!dailyLog.length}
            onClick={resetLog}
          >
            Reset Log
          </button>
        </div>
        {error && <p className="lv-error">{error}</p>}
      </section>

      <PanelMap
        features={features}
        tableGeojson={tableGeojson}
        tableLabelPoints={tableLabelPoints}
        onToggleStatus={handleToggleStatus}
        loading={loading}
      />

      <section className="lv-log">
        <header>
          <h2>Daily Log</h2>
          <p>Submit → LocalStorage → Chart → Excel</p>
        </header>
        {!dailyLog.length ? (
          <p className="lv-selection__empty">No records yet.</p>
        ) : (
          <ul>
            {dailyLog.map((record, index) => (
              <li key={`${record.date}-${index}`}>
                <strong>{record.date}</strong>
                <span>{record.installed_panels.toLocaleString()} installed</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SubmitModal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmitModal}
        dailyInstalled={dailyInstalled}
      />

      <canvas id="dailyChart" width="800" height="400" style={{ display: "none" }} />
    </div>
  );
}

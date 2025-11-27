import { useCallback, useEffect, useState } from "react";

function safeGetStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage ?? null;
}

export default function useDailyLog() {
  const [dailyLog, setDailyLog] = useState([]);

  useEffect(() => {
    const storage = safeGetStorage();
    if (!storage) return;
    const stored = storage.getItem("dailyLog");
    if (stored) {
      try {
        setDailyLog(JSON.parse(stored));
      } catch (error) {
        console.warn("Failed to parse dailyLog from storage", error);
      }
    }
  }, []);

  const addRecord = useCallback((record) => {
    setDailyLog((prev) => {
      const updated = [...prev, record];
      const storage = safeGetStorage();
      storage?.setItem("dailyLog", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const resetLog = useCallback(() => {
    setDailyLog(() => {
      const storage = safeGetStorage();
      storage?.removeItem("dailyLog");
      return [];
    });
  }, []);

  return { dailyLog, addRecord, resetLog };
}

import { useCallback } from "react";
import Chart from "chart.js/auto";
import ChartDataLabels from "chartjs-plugin-datalabels";
import ExcelJS from "exceljs";

Chart.register(ChartDataLabels);

function normalizeLogRows(rows = []) {
  return rows
    .map((row) => ({
      date: row?.date ?? "",
      subcontractor: row?.subcontractor?.trim() ?? "",
      subcontractorLabel: (row?.subcontractor ?? "").slice(0, 2).toUpperCase(),
      workers: Number(row?.workers ?? 0) || 0,
      installed_panels: Number(row?.installed_panels ?? 0) || 0
    }))
    .filter((row) => !!row.date);
}

function aggregateByDate(rows = []) {
  const grouped = new Map();

  rows.forEach((row) => {
    const entry = grouped.get(row.date) ?? {
      date: row.date,
      workers: 0,
      installed_panels: 0,
      subcontractorInitials: new Set(),
      subcontractorNames: new Set()
    };

    entry.workers += row.workers;
    entry.installed_panels += row.installed_panels;
    if (row.subcontractorLabel) {
      entry.subcontractorInitials.add(row.subcontractorLabel);
    }
    if (row.subcontractor) {
      entry.subcontractorNames.add(row.subcontractor);
    }

    grouped.set(row.date, entry);
  });

  return Array.from(grouped.values())
    .map((entry) => ({
      date: entry.date,
      workers: entry.workers,
      installed_panels: entry.installed_panels,
      subcontractorLabel: Array.from(entry.subcontractorInitials).join(" & "),
      subcontractorNames: Array.from(entry.subcontractorNames).join(" / ")
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function buildChartImage(aggregated) {
  const canvas = document.getElementById("dailyChart");
  if (!canvas) {
    throw new Error("Hidden chart canvas not found.");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context could not be created.");
  }

  if (canvas.__chartInstance) {
    canvas.__chartInstance.destroy();
  }

  const labels = aggregated.map((row) => row.date);
  const data = aggregated.map((row) => row.installed_panels);
  const maxValue = Math.max(...data);
  const suggestedYMax = Math.max(Math.ceil(maxValue * 1.1), 10);

  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Installed Panels",
          data,
          backgroundColor: "rgba(34, 197, 94, 0.7)",
          borderColor: "#16a34a",
          borderWidth: 1,
          datalabels: {
            anchor: "end",
            align: "start",
            formatter: (_, context) => {
              const row = aggregated[context.dataIndex];
              return `${row.subcontractorLabel}-${row.workers}`;
            },
            color: "#0f172a",
            font: {
              weight: "600",
              size: 12
            }
          }
        }
      ]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Date'
          },
          ticks: { color: "#0f172a" }
        },
        y: {
          beginAtZero: true,
          suggestedMax: suggestedYMax,
          title: {
            display: true,
            text: 'Installed Panels'
          },
          ticks: { color: "#0f172a" }
        }
      }
    }
  });

  canvas.__chartInstance = chart;
  chart.update();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const base64 = chart.toBase64Image();
  chart.destroy();
  canvas.__chartInstance = null;
  return base64;
}

async function buildWorkbook(aggregatedRows, chartImage) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Daily Log");
  sheet.columns = [
    { header: "Date", key: "date", width: 15 },
    { header: "Subcontractor", key: "subcontractor", width: 20 },
    { header: "Workers", key: "workers", width: 12 },
    { header: "Installed", key: "installed_panels", width: 14 }
  ];

  aggregatedRows.forEach((row) => {
    sheet.addRow({
      date: row.date,
      subcontractor: row.subcontractorNames || row.subcontractorLabel,
      workers: row.workers,
      installed_panels: row.installed_panels
    });
  });

  sheet.getRow(1).font = { bold: true };

  const chartSheet = workbook.addWorksheet("Chart");
  const imageId = workbook.addImage({
    base64: chartImage,
    extension: "png"
  });
  chartSheet.addImage(imageId, {
    tl: { col: 0, row: 0 },
    ext: { width: 800, height: 400 }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `daily-log-${new Date().toISOString().slice(0, 10)}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function useChartExport() {
  const exportToExcel = useCallback(async (dailyLog) => {
    if (!dailyLog?.length) {
      console.warn("Daily log is empty; nothing to export.");
      return;
    }
    const normalized = normalizeLogRows(dailyLog);
    if (!normalized.length) {
      console.warn("No valid rows to export.");
      return;
    }
    const aggregated = aggregateByDate(normalized);
    if (!aggregated.length) {
      console.warn("No daily sums could be produced.");
      return;
    }
    const chartImage = await buildChartImage(aggregated);
    await buildWorkbook(aggregated, chartImage);
  }, []);

  return { exportToExcel };
}

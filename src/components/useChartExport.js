import { useCallback } from "react";
import Chart from "chart.js/auto";
import ChartDataLabels from "chartjs-plugin-datalabels";
import ExcelJS from "exceljs";

Chart.register(ChartDataLabels);

function groupByDate(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const date = row?.date ?? "";
    if (!date) continue;
    const entry = grouped.get(date) ?? {
      date,
      workers: 0,
      installed_panels: 0,
      subcontractors: new Set()
    };
    entry.workers += Number(row?.workers ?? 0) || 0;
    entry.installed_panels += Number(row?.installed_panels ?? 0) || 0;
    if (row?.subcontractor) {
      entry.subcontractors.add(row.subcontractor);
    }
    grouped.set(date, entry);
  }

  return Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      subcontractorLabel: Array.from(entry.subcontractors)
        .map((name) => name.slice(0, 2).toUpperCase())
        .join(" & ")
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
  const data = aggregated.map((row) => row.installed_panels / 3); // Convert panels to meters
  const maxValue = Math.max(...data);

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
              return row.subcontractorLabel ? `${row.subcontractorLabel}-${row.workers}` : `${row.workers}`;
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
          min: 0,
          max: 2000,
          title: {
            display: true,
            text: 'Pulled Cable Amount'
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

async function buildWorkbook(aggregated, chartImage) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Daily Summary");
  sheet.columns = [
    { header: "Date", key: "date", width: 15 },
    { header: "Subcontractor", key: "subcontractor", width: 20 },
    { header: "Workers", key: "workers", width: 12 },
    { header: "Installed", key: "installed_panels", width: 14 }
  ];

  aggregated.forEach((row) => {
    sheet.addRow({
      date: row.date,
      subcontractor: row.subcontractorLabel,
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
    const aggregated = groupByDate(dailyLog);
    if (!aggregated.length) {
      console.warn("No valid rows to export.");
      return;
    }
    const chartImage = await buildChartImage(aggregated);
    await buildWorkbook(aggregated, chartImage);
  }, []);

  return { exportToExcel };
}

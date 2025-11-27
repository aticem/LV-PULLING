const LV_CSV_CANDIDATES = ["/LV.CSV", "/lv.csv"];
export const LENGTH_MULTIPLIER = 3;

export function normalizeId(id) {
  if (typeof id !== "string") return "";
  const trimmed = id.trim();
  if (!trimmed) return "";
  const withoutSpacesBeforeDigits = trimmed.replace(/\s+(?=\d)/g, "");
  return withoutSpacesBeforeDigits.replace(/\d+/g, (segment) => String(Number(segment)));
}

function detectDelimiter(line = "") {
  if (line.includes(",")) return ",";
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

export function parseLengths(csvText) {
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

export async function loadCableLengths() {
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

export async function loadLabelGeojson() {
  const response = await fetch("/text.geojson");
  if (!response.ok) {
    throw new Error("text.geojson could not be loaded.");
  }
  return response.json();
}

export async function loadTableGeojson() {
  const response = await fetch("/file.geojson");
  if (!response.ok) {
    throw new Error("file.geojson could not be loaded.");
  }
  return response.json();
}

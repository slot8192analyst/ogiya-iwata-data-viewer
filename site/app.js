// ==============================
// 定数
// ==============================
const SQL_JS_VERSION = "1.14.2";
const SQL_WASM_CDN = `https://cdn.jsdelivr.net/npm/sql.js@${SQL_JS_VERSION}/dist/`;

const DIGIT_MIN = 0;
const DIGIT_MAX = 9;

const PERCENT_MULTIPLIER = 100.0;
const ROUND_DECIMALS = 1;

// Wilson score interval 95%
const Z_SCORE_95 = 1.96;

// 閾値分析の対象範囲（累積差枚）
const THRESHOLD_RANGE_MIN = -30000;
const THRESHOLD_RANGE_MAX = 30000;
const DEFAULT_THRESHOLD_STEP = 1000;

// 設置台数グループの固定バケット
const MACHINE_COUNT_BUCKETS = [
  { min: 1,  max: 2,    label: "1~2台" },
  { min: 3,  max: 4,    label: "3~4台" },
  { min: 5,  max: 6,    label: "5~6台" },
  { min: 7,  max: 9,    label: "7~9台" },
  { min: 10, max: 15,   label: "10~15台" },
  { min: 16, max: 20,   label: "16~20台" },
  { min: 21, max: null, label: "21台以上" },
];

// 複合条件スコア探索: 各種定数
const COMBO_LOOKBACK_MIN = 1;
const COMBO_LOOKBACK_MAX = 10;
const DEFAULT_COMBO_MIN_N = 30;
const ComboSortMode = { CONFIDENCE: "confidence", SCORE: "score" };

const COMBO_RANK_MIN = 1;
const COMBO_RANK_MAX = 5;

const ComboPatternMode = {
  RANK:      "rank",
  THRESHOLD: "threshold",
  COMBINED:  "combined",
};

const ComboRankDirection = { WORST: "worst", TOP: "top" };
const COMBO_RANK_DIRECTION_LABEL = {
  [ComboRankDirection.WORST]: "💀",
  [ComboRankDirection.TOP]:   "👑",
};
const COMBO_RANK_DIRECTION_COLUMN = {
  [ComboRankDirection.WORST]: "rank_worst",
  [ComboRankDirection.TOP]:   "rank_best",
};

// 設置台数→対象順位数の対応
const RANK_WITHIN_BUCKETS = [
  { min: 10, targetN: 5 },
  { min: 6,  targetN: 3 },
  { min: 2,  targetN: 1 },
];

// ==============================
// SqlDriver
// ==============================
const SqlDriver = (() => {
  let engine   = null;
  let database = null;

  async function init() {
    engine = await initSqlJs({ locateFile: (f) => SQL_WASM_CDN + f });
  }
  function loadFile(buf) {
    database = new engine.Database(new Uint8Array(buf));
  }
  function run(sql) { database.run(sql); }
  function query(sql) { return database.exec(sql); }
  function isReady() { return database !== null; }

  return { init, loadFile, run, query, isReady };
})();

// ==============================
// WilsonScore: 勝率の信頼区間計算
// ==============================
const WilsonScore = (() => {
  function computeInterval(wins, n) {
    if (n <= 0) return { low: 0, high: 0 };
    const p   = wins / n;
    const z2  = Z_SCORE_95 * Z_SCORE_95;
    const den = 1 + z2 / n;
    const ctr = p + z2 / (2 * n);
    const mar = Z_SCORE_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    return {
      low:  Math.max(0, (ctr - mar) / den) * PERCENT_MULTIPLIER,
      high: Math.min(1, (ctr + mar) / den) * PERCENT_MULTIPLIER,
    };
  }
  return { computeInterval };
})();

// ==============================
// ZScore: 標準化
// ==============================
const ZScore = (() => {
  function computeStats(values) {
    const n = values.length;
    if (n === 0) return { mean: 0, std: 0 };
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    return { mean, std: Math.sqrt(variance) };
  }
  function standardize(value, stats) {
    return stats.std === 0 ? 0 : (value - stats.mean) / stats.std;
  }
  return { computeStats, standardize };
})();

// キャッシュ
let lastComboResult = null;

function winCaseExpression() {
  return "CASE WHEN diff > 0 THEN 1 ELSE 0 END";
}

// ==============================
// ステータス表示
// ==============================
function setStatus(text) {
  document.getElementById("statusText").textContent = text;
}

// ==============================
// DB読込
// ==============================
async function loadDbFromArrayBuffer(buf) {
  SqlDriver.loadFile(buf);
  SqlDriver.run(`
    CREATE INDEX IF NOT EXISTS idx_hall_data_date      ON hall_data(date);
    CREATE INDEX IF NOT EXISTS idx_hall_data_name_date ON hall_data(machine_name, date);
    CREATE INDEX IF NOT EXISTS idx_hall_data_no_date   ON hall_data(machine_no, date);
    CREATE INDEX IF NOT EXISTS idx_hall_data_date_name ON hall_data(date, machine_name);
  `);
  const res = SqlDriver.query("SELECT COUNT(*) AS c, MIN(date) AS min_d, MAX(date) AS max_d FROM hall_data");
  const row = res[0].values[0];
  setStatus(`読み込み完了：${row[0]}行（${row[1]} ～ ${row[2]}）`);
  document.getElementById("welcomeCard").style.display = "none";
  document.getElementById("comboPanel").style.display  = "";
}

// ==============================
// 共通ユーティリティ
// ==============================
function escapeSql(str) {
  return String(str).replace(/'/g, "''");
}

// ==============================
// 設置台数グループ
// ==============================
function buildCountGroupCaseExpression(col) {
  const when = MACHINE_COUNT_BUCKETS.map(({ min, max, label }) => {
    const up = max === null ? "" : ` AND ${col} <= ${max}`;
    return `WHEN ${col} >= ${min}${up} THEN '${label}'`;
  });
  return `CASE ${when.join(" ")} END`;
}

// ==============================
// 共通CTE
// ==============================
function buildBaseCte({ dayDigits, lookbackDays, startDate, endDate }) {
  const digitFilter = dayDigits.length
    ? `AND CAST(strftime('%d', date) AS INTEGER) % 10 IN (${dayDigits.join(",")})`
    : "";
  const rangeFilter = startDate && endDate
    ? `AND date BETWEEN '${startDate}' AND '${endDate}'` : "";
  const countGroupCase = buildCountGroupCaseExpression("mc.machine_count");

  return `
    WITH digit_days AS (
      SELECT DISTINCT date FROM hall_data WHERE 1=1 ${digitFilter} ${rangeFilter}
    ),
    machine_counts AS (
      SELECT date, machine_name, COUNT(DISTINCT machine_no) AS machine_count
      FROM hall_data GROUP BY date, machine_name
    ),
    dated AS (
      SELECT h.date, h.machine_no, h.machine_name, h.diff,
        CAST(julianday(h.date) AS INTEGER) AS day_num,
        ${countGroupCase} AS count_group
      FROM hall_data h
      JOIN machine_counts mc ON mc.date = h.date AND mc.machine_name = h.machine_name
    ),
    rolling AS (
      SELECT date, machine_no, machine_name, diff, count_group,
        SUM(diff) OVER (
          PARTITION BY machine_no ORDER BY day_num
          RANGE BETWEEN ${lookbackDays} PRECEDING AND 1 PRECEDING
        ) AS cum_diff,
        COUNT(*) OVER (
          PARTITION BY machine_no ORDER BY day_num
          RANGE BETWEEN ${lookbackDays} PRECEDING AND 1 PRECEDING
        ) AS lookback_days_count
      FROM dated
    ),
    target AS (
      SELECT r.* FROM rolling r
      JOIN digit_days d ON d.date = r.date
      WHERE r.lookback_days_count >= 1
    ),
    ranked AS (
      SELECT t.*,
        RANK() OVER (PARTITION BY t.date, t.machine_name ORDER BY t.cum_diff ASC)  AS rank_worst,
        RANK() OVER (PARTITION BY t.date, t.machine_name ORDER BY t.cum_diff DESC) AS rank_best,
        COUNT(*) OVER (PARTITION BY t.date, t.machine_name) AS group_size
      FROM target t
    ),
    joined AS (
      SELECT r.*, r.diff AS target_diff, ${winCaseExpression()} AS is_win FROM ranked r
    )
  `;
}

// ==============================
// 重み取得
// ==============================
function getScoreWeights() {
  return {
    winRate:    parseFloat(document.getElementById("weightWinRate").value)    || 0,
    avgDiff:    parseFloat(document.getElementById("weightAvgDiff").value)    || 0,
    medianDiff: parseFloat(document.getElementById("weightMedianDiff").value) || 0,
    ciLow:      parseFloat(document.getElementById("weightCiLow").value)      || 0,
  };
}

// ==============================
// 複合条件スコア探索
// ==============================
function getSelectedComboLookbacks() {
  return Array.from(document.querySelectorAll("#comboLookbackCheckboxes input:checked"))
    .map((el) => parseInt(el.value, 10)).sort((a, b) => a - b);
}

function getSelectedComboRanks() {
  return Array.from(document.querySelectorAll("#comboRankCheckboxes input:checked"))
    .map((el) => parseInt(el.value, 10)).sort((a, b) => a - b);
}

function getSelectedComboPatternMode() {
  const el = document.querySelector('input[name="comboPattern"]:checked');
  return el ? el.value : ComboPatternMode.THRESHOLD;
}

function comboPatternUsesBin(mode) {
  return mode === ComboPatternMode.THRESHOLD || mode === ComboPatternMode.COMBINED;
}
function comboPatternUsesRank(mode) {
  return mode === ComboPatternMode.RANK || mode === ComboPatternMode.COMBINED;
}

function buildTargetNCaseExpression(col) {
  const when = RANK_WITHIN_BUCKETS.map(
    ({ min, targetN }) => `WHEN ${col} >= ${min} THEN ${targetN}`
  );
  return `CASE ${when.join(" ")} ELSE NULL END`;
}

function buildComboSingleDirectionFragment(mode, step, ranks, direction) {
  const usesBin      = comboPatternUsesBin(mode);
  const usesRank     = direction !== null;
  const rankColumn   = usesRank ? COMBO_RANK_DIRECTION_COLUMN[direction] : null;
  const dirLabel     = usesRank ? COMBO_RANK_DIRECTION_LABEL[direction]  : null;
  const targetNExpr  = buildTargetNCaseExpression("group_size");
  const binIndexExpr = `CAST(FLOOR((cum_diff - (${THRESHOLD_RANGE_MIN})) / ${step}) AS INTEGER)`;

  const l1Select = [
    "machine_name", "target_diff", "is_win",
    usesRank ? `${targetNExpr} AS target_n`  : null,
    usesRank ? `${rankColumn} AS rank_value` : null,
    usesBin  ? `${binIndexExpr} AS bin_index`: null,
  ].filter(Boolean).join(",\n      ");
  const l1Where = usesBin
    ? `WHERE cum_diff >= (${THRESHOLD_RANGE_MIN}) AND cum_diff < (${THRESHOLD_RANGE_MAX})` : "";
  const l1 = `SELECT\n      ${l1Select}\n    FROM joined\n    ${l1Where}`;

  const l2Select = [
    "machine_name", "target_diff", "is_win",
    usesBin  ? "bin_index"  : null,
    usesRank ? "rank_value" : null,
  ].filter(Boolean).join(",\n      ");
  const l2WhereParts = [];
  if (usesRank) {
    l2WhereParts.push("target_n IS NOT NULL", "rank_value <= target_n",
      `rank_value IN (${ranks.join(",")})`);
  }
  const l2Where = l2WhereParts.length ? `WHERE ${l2WhereParts.join(" AND ")}` : "";
  const l2 = `SELECT\n      ${l2Select}\n    FROM (${l1})\n    ${l2Where}`;

  const groupCols = [
    "machine_name",
    usesRank ? "rank_value" : null,
    usesBin  ? "bin_index"  : null,
  ].filter(Boolean);
  const gcSql = groupCols.join(", ");

  const l3Select = [
    "machine_name", "target_diff", "is_win",
    usesRank ? "rank_value" : null,
    usesBin  ? "bin_index"  : null,
    `ROW_NUMBER() OVER (PARTITION BY ${gcSql} ORDER BY target_diff) AS rn`,
    `COUNT(*) OVER (PARTITION BY ${gcSql}) AS cnt`,
  ].filter(Boolean).join(",\n      ");
  const l3 = `SELECT\n      ${l3Select}\n    FROM (${l2})`;

  const binLower = `bin_index * ${step} + (${THRESHOLD_RANGE_MIN})`;
  const binUpper = `${binLower} + ${step}`;

  const outerSelect = [
    "machine_name",
    usesRank ? `'${dirLabel}' AS rank_direction` : null,
    usesRank ? "rank_value"                      : null,
    usesBin  ? `${binLower} AS bin_lower`        : null,
    usesBin  ? `${binUpper} AS bin_upper`        : null,
    "COUNT(*) AS n",
    "SUM(is_win) AS wins",
    `ROUND(${PERCENT_MULTIPLIER} * SUM(is_win) / COUNT(*), ${ROUND_DECIMALS}) AS win_rate`,
    `ROUND(AVG(target_diff), ${ROUND_DECIMALS}) AS avg_diff`,
    `ROUND(AVG(CASE WHEN rn IN ((cnt+1)/2,(cnt+2)/2) THEN target_diff END), ${ROUND_DECIMALS}) AS median_diff`,
    `CASE WHEN COUNT(*)>1 THEN (SUM(target_diff*target_diff)-COUNT(*)*AVG(target_diff)*AVG(target_diff))/(COUNT(*)-1) ELSE NULL END AS diff_variance`,
  ].filter(Boolean).join(",\n      ");

  return `SELECT\n      ${outerSelect}\n    FROM (${l3})\n    GROUP BY ${gcSql}`;
}

function buildComboRankFragment(mode, step, ranks) {
  if (!comboPatternUsesRank(mode)) {
    return buildComboSingleDirectionFragment(mode, step, ranks, null);
  }
  return [ComboRankDirection.WORST, ComboRankDirection.TOP]
    .map((d) => buildComboSingleDirectionFragment(mode, step, ranks, d))
    .join(" UNION ALL ");
}

function queryComboRankRows(cte, mode, step, ranks, lookbackDays) {
  const sql = `${cte} ${buildComboRankFragment(mode, step, ranks)};`;
  const res = SqlDriver.query(sql);
  const rows = res.length ? res[0].values : [];
  const usesRank = comboPatternUsesRank(mode);
  const usesBin  = comboPatternUsesBin(mode);

  return rows.map((row) => {
    let i = 0;
    const machineName   = row[i++];
    const rankDirection = usesRank ? row[i++] : null;
    const rankValue     = usesRank ? row[i++] : null;
    const binLower      = usesBin  ? row[i++] : null;
    const binUpper      = usesBin  ? row[i++] : null;
    const n             = row[i++];
    const wins          = row[i++];
    const winRate       = row[i++];
    const avgDiff       = row[i++];
    const medianDiff    = row[i++];
    const diffVariance  = row[i++];
    return { machineName, lookbackDays, rankDirection, rankValue,
             binLower, binUpper, n, wins, winRate, avgDiff, medianDiff, diffVariance };
  });
}

function resolveReferenceDate(endDate) {
  if (endDate) return endDate;
  const res = SqlDriver.query("SELECT MAX(date) FROM hall_data");
  return res.length && res[0].values.length ? res[0].values[0][0] : null;
}

function resolvePresentMachineSet(endDate) {
  const ref = resolveReferenceDate(endDate);
  if (!ref) return new Set();
  const res = SqlDriver.query(
    `SELECT DISTINCT machine_name FROM hall_data WHERE date = '${escapeSql(ref)}'`
  );
  return res.length ? new Set(res[0].values.map((r) => r[0])) : new Set();
}

// 重み付きenrich
function enrichComboRow(row, statsByField, weights) {
  const { low, high } = WilsonScore.computeInterval(row.wins, row.n);

  const zWinRate    = ZScore.standardize(row.winRate,    statsByField.winRate);
  const zAvgDiff    = ZScore.standardize(row.avgDiff,    statsByField.avgDiff);
  const zMedianDiff = ZScore.standardize(row.medianDiff, statsByField.medianDiff);
  // ciLow は既にパーセント値なので他指標と同じ軸で標準化する
  const zCiLow      = ZScore.standardize(low,            statsByField.ciLow);

  const totalScore =
    weights.winRate    * zWinRate    +
    weights.avgDiff    * zAvgDiff    +
    weights.medianDiff * zMedianDiff +
    weights.ciLow      * zCiLow;

  return { ...row, ciLow: low, ciHigh: high, totalScore };
}

function sortComboRows(rows, sortMode) {
  if (sortMode === ComboSortMode.SCORE) {
    return [...rows].sort((a, b) => b.totalScore - a.totalScore);
  }
  return [...rows].sort((a, b) => b.ciLow - a.ciLow);
}

function comboTableHeaders(mode) {
  const usesRank = comboPatternUsesRank(mode);
  const usesBin  = comboPatternUsesBin(mode);
  const h = ["機種", "LB日数"];
  if (usesRank) h.push("順位");
  if (usesBin)  h.push("累積差枚 下限", "累積差枚 上限（未満）");
  h.push("件数", "勝ち数", "勝率(%)", "信頼区間(95%)", "平均差枚", "差枚中央値", "総合スコア");
  return h;
}

function buildComboTableRow(row, mode) {
  const ci = `${row.ciLow.toFixed(ROUND_DECIMALS)}% ~ ${row.ciHigh.toFixed(ROUND_DECIMALS)}%`;
  const usesRank = comboPatternUsesRank(mode);
  const usesBin  = comboPatternUsesBin(mode);
  const cells = [row.machineName, row.lookbackDays];
  if (usesRank) cells.push(`${row.rankDirection}${row.rankValue}`);
  if (usesBin)  cells.push(row.binLower, row.binUpper);
  cells.push(row.n, row.wins, row.winRate, ci, row.avgDiff, row.medianDiff,
             row.totalScore.toFixed(2));
  return cells;
}

function updateComboPatternFieldVisibility() {
  const mode = getSelectedComboPatternMode();
  document.getElementById("comboThresholdStepField").style.display =
    comboPatternUsesBin(mode)  ? "" : "none";
  document.getElementById("comboRankField").style.display =
    comboPatternUsesRank(mode) ? "" : "none";
}

// ==============================
// 設定エリア 開閉
// ==============================
function collapseSettings() {
  document.getElementById("settingsBody").style.display  = "none";
  document.getElementById("settingsCaret").textContent   = "▼";
  document.getElementById("settingsToggleBtn").setAttribute("aria-expanded", "false");
  document.getElementById("showSettingsBtn").style.display = "";
}

function expandSettings() {
  document.getElementById("settingsBody").style.display  = "";
  document.getElementById("settingsCaret").textContent   = "▲";
  document.getElementById("settingsToggleBtn").setAttribute("aria-expanded", "true");
  document.getElementById("showSettingsBtn").style.display = "none";
}

function toggleSettings() {
  const open = document.getElementById("settingsBody").style.display !== "none";
  open ? collapseSettings() : expandSettings();
}

// ==============================
// 分析実行
// ==============================
function runComboAnalysis() {
  const lookbacks = getSelectedComboLookbacks();
  if (!lookbacks.length) { alert("ルックバック日数を1つ以上選択してください。"); return; }

  const mode     = getSelectedComboPatternMode();
  const usesRank = comboPatternUsesRank(mode);
  const ranks    = usesRank ? getSelectedComboRanks() : [];
  if (usesRank && !ranks.length) { alert("表示する順位を1つ以上選択してください。"); return; }

  const dayDigits = Array.from(document.querySelectorAll("#digitCheckboxes input:checked"))
    .map((el) => el.value);
  const startDate = document.getElementById("startDate").value;
  const endDate   = document.getElementById("endDate").value;
  const step  = parseInt(document.getElementById("comboThresholdStep").value, 10) || DEFAULT_THRESHOLD_STEP;
  const minN  = parseInt(document.getElementById("comboMinN").value, 10) || DEFAULT_COMBO_MIN_N;
  const weights = getScoreWeights();

  let allRows = [];
  for (const lb of lookbacks) {
    const cte = buildBaseCte({ dayDigits, lookbackDays: lb, startDate, endDate });
    allRows = allRows.concat(queryComboRankRows(cte, mode, step, ranks, lb));
  }

  const filteredRows = allRows.filter((r) => r.n >= minN);
  const headers      = comboTableHeaders(mode);

  if (!filteredRows.length) {
    renderTable("comboPresentTable", [], headers);
    renderTable("comboAbsentTable",  [], headers);
    lastComboResult = null;
    document.getElementById("comboResults").style.display = "";
    // 設定を折りたたんで結果へスクロール
    collapseSettings();
    alert("最低件数フィルタを満たす組み合わせが見つかりませんでした。フィルタを緩めてください。");
    return;
  }

  // ciLow のみ事前計算しておく（統計用）
  const rawCiLows = filteredRows.map((r) => WilsonScore.computeInterval(r.wins, r.n).low);
  const statsByField = {
    winRate:    ZScore.computeStats(filteredRows.map((r) => r.winRate)),
    avgDiff:    ZScore.computeStats(filteredRows.map((r) => r.avgDiff)),
    medianDiff: ZScore.computeStats(filteredRows.map((r) => r.medianDiff)),
    ciLow:      ZScore.computeStats(rawCiLows),
  };

  const enriched    = filteredRows.map((r) => enrichComboRow(r, statsByField, weights));
  const presentSet  = resolvePresentMachineSet(endDate);
  const presentRows = enriched.filter((r) =>  presentSet.has(r.machineName));
  const absentRows  = enriched.filter((r) => !presentSet.has(r.machineName));

  lastComboResult = { presentRows, absentRows, mode };
  renderComboResults();

  // 結果を表示して設定エリアを折りたたむ
  document.getElementById("comboResults").style.display = "";
  collapseSettings();

  // 結果エリアへスムーズスクロール
  setTimeout(() => {
    document.getElementById("comboResults").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
}

function renderComboResults() {
  if (!lastComboResult) return;
  const { mode } = lastComboResult;
  const sortMode  = document.getElementById("comboSortMode").value;
  const headers   = comboTableHeaders(mode);
  renderTable("comboPresentTable",
    sortComboRows(lastComboResult.presentRows, sortMode).map((r) => buildComboTableRow(r, mode)),
    headers);
  renderTable("comboAbsentTable",
    sortComboRows(lastComboResult.absentRows, sortMode).map((r) => buildComboTableRow(r, mode)),
    headers);
}

// ==============================
// 表描画
// ==============================
function renderTable(elementId, rows, headerLabels) {
  const table = document.getElementById(elementId);
  table.innerHTML = "";
  if (!rows.length) {
    table.innerHTML = "<tr><td>該当データがありません。</td></tr>";
    return;
  }
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  headerLabels.forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

// ==============================
// 計算中インジケーター
// ==============================
async function runWithIndicator(btn, fn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.8s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> 計算中...`;

  await new Promise((r) => setTimeout(r, 0));
  try { fn(); }
  catch (e) {
    console.error(e);
    alert("分析中にエラーが発生しました。コンソールを確認してください。");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> 分析実行`;
  }
}

// ==============================
// UI初期化
// ==============================
function setupDigitCheckboxes() {
  const c = document.getElementById("digitCheckboxes");
  for (let i = DIGIT_MIN; i <= DIGIT_MAX; i++) {
    const lbl = document.createElement("label");
    const inp = document.createElement("input");
    inp.type = "checkbox"; inp.value = i;
    lbl.appendChild(inp); lbl.appendChild(document.createTextNode(i));
    c.appendChild(lbl);
  }
}

function setupComboLookbackCheckboxes() {
  const c = document.getElementById("comboLookbackCheckboxes");
  for (let i = COMBO_LOOKBACK_MIN; i <= COMBO_LOOKBACK_MAX; i++) {
    const lbl = document.createElement("label");
    const inp = document.createElement("input");
    inp.type = "checkbox"; inp.value = i;
    lbl.appendChild(inp); lbl.appendChild(document.createTextNode(`${i}日`));
    c.appendChild(lbl);
  }
}

function setupComboRankCheckboxes() {
  const c = document.getElementById("comboRankCheckboxes");
  for (let i = COMBO_RANK_MIN; i <= COMBO_RANK_MAX; i++) {
    const lbl = document.createElement("label");
    const inp = document.createElement("input");
    inp.type = "checkbox"; inp.value = i; inp.checked = true;
    lbl.appendChild(inp); lbl.appendChild(document.createTextNode(`${i}位`));
    c.appendChild(lbl);
  }
}

// スライダーと数値表示を同期するセットアップ
function setupWeightSliders() {
  const pairs = [
    ["weightWinRate",    "weightWinRateVal"],
    ["weightAvgDiff",    "weightAvgDiffVal"],
    ["weightMedianDiff", "weightMedianDiffVal"],
    ["weightCiLow",      "weightCiLowVal"],
  ];
  for (const [sliderId, valId] of pairs) {
    const slider = document.getElementById(sliderId);
    const valEl  = document.getElementById(valId);
    slider.addEventListener("input", () => {
      valEl.textContent = parseFloat(slider.value).toFixed(1);
    });
  }
}

function setupHandlers() {
  document.getElementById("uploadBtn").addEventListener("click", () => {
    document.getElementById("dbFileInput").click();
  });
  document.getElementById("uploadBtnMain").addEventListener("click", () => {
    document.getElementById("dbFileInput").click();
  });
  document.getElementById("dbFileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStatus("読み込み中...");
    await loadDbFromArrayBuffer(await file.arrayBuffer());
  });

  document.getElementById("runComboBtn").addEventListener("click", (e) => {
    if (!SqlDriver.isReady()) { alert("データベースが読み込まれていません。"); return; }
    runWithIndicator(e.currentTarget, runComboAnalysis);
  });

  // 「条件を編集」ボタン → 設定を再展開してスクロール
  document.getElementById("showSettingsBtn").addEventListener("click", () => {
    expandSettings();
    document.getElementById("settingsContainer").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // 設定トグルボタン（ヘッダー部分クリック）
  document.getElementById("settingsToggleBtn").addEventListener("click", toggleSettings);

  // 並び順変更 → 再描画のみ
  document.getElementById("comboSortMode").addEventListener("change", renderComboResults);

  // 探索パターン切り替え → キャッシュクリア
  document.querySelectorAll('input[name="comboPattern"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      lastComboResult = null;
      document.getElementById("comboResults").style.display = "none";
      const h = comboTableHeaders(getSelectedComboPatternMode());
      renderTable("comboPresentTable", [], h);
      renderTable("comboAbsentTable",  [], h);
      updateComboPatternFieldVisibility();
    });
  });
}

// ==============================
// エントリーポイント
// ==============================
window.addEventListener("DOMContentLoaded", async () => {
  setupDigitCheckboxes();
  setupComboLookbackCheckboxes();
  setupComboRankCheckboxes();
  setupWeightSliders();
  setupHandlers();
  updateComboPatternFieldVisibility();
  setStatus("SQLiteエンジンを初期化しています...");
  await SqlDriver.init();
  setStatus("DBファイルを選択してください");
});

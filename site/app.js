// ==============================
// 定数
// ==============================
const SQL_JS_VERSION = "1.14.2";
const SQL_WASM_CDN = `https://cdn.jsdelivr.net/npm/sql.js@${SQL_JS_VERSION}/dist/`;

const DEFAULT_LOOKBACK_DAYS = 7;
const DIGIT_MIN = 0;
const DIGIT_MAX = 9;

const PERCENT_MULTIPLIER = 100.0;
const ROUND_DECIMALS = 1;
const CHART_Y_AXIS_MAX = 100;

const ComparisonDirection = { LE: "le", GE: "ge" };
const TrendMode = { RANK: "rank", THRESHOLD: "threshold" };

// 機種を複数選択したときに内訳表示へ切り替えるためのモード
const BreakdownMode = { AGGREGATE: "aggregate", BY_MACHINE: "by_machine" };

// フィルタサイドパネルの開閉状態
const SidebarState = { OPEN: "open", CLOSED: "closed" };

const CHART_TEXT_COLOR = "#e4e4e4";
const CHART_AXIS_COLOR = "#999999";
const CHART_GRID_COLOR = "#333333";

// 機種別グラフの色。選択機種数がこれを超えたら循環して再利用する
const CHART_COLOR_PALETTE = [
  { border: "#4f9eff", fill: "rgba(79,158,255,0.15)" },
  { border: "#ff6b6b", fill: "rgba(255,107,107,0.15)" },
  { border: "#51cf66", fill: "rgba(81,207,102,0.15)" },
  { border: "#ffa94d", fill: "rgba(255,169,77,0.15)" },
  { border: "#cc5de8", fill: "rgba(204,93,232,0.15)" },
  { border: "#20c997", fill: "rgba(32,201,151,0.15)" },
  { border: "#ffd43b", fill: "rgba(255,212,59,0.15)" },
  { border: "#845ef7", fill: "rgba(132,94,247,0.15)" },
];

// ==============================
// SqlDriver: sql.jsの直接操作をここに閉じ込める抽象化層
// ==============================
const SqlDriver = (() => {
  let engine = null;
  let database = null;

  async function init() {
    engine = await initSqlJs({ locateFile: (file) => SQL_WASM_CDN + file });
  }

  function loadFile(arrayBuffer) {
    database = new engine.Database(new Uint8Array(arrayBuffer));
  }

  function run(sql) {
    database.run(sql);
  }

  function query(sql) {
    return database.exec(sql);
  }

  function isReady() {
    return database !== null;
  }

  return { init, loadFile, run, query, isReady };
})();

let trendChartInstance = null;

// 勝ちの定義。基準変更時はここだけ書き換える
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

  // 分析用インデックス。メモリ上DBのため毎回作成し直す
  SqlDriver.run(`
    CREATE INDEX IF NOT EXISTS idx_hall_data_date ON hall_data(date);
    CREATE INDEX IF NOT EXISTS idx_hall_data_name_date ON hall_data(machine_name, date);
    CREATE INDEX IF NOT EXISTS idx_hall_data_no_date ON hall_data(machine_no, date);
  `);

  populateMachineFilter();

  const countRes = SqlDriver.query(
    "SELECT COUNT(*) AS c, MIN(date) AS min_d, MAX(date) AS max_d FROM hall_data"
  );
  const row = countRes[0].values[0];
  setStatus(`読み込み完了：${row[0]}行（${row[1]} ～ ${row[2]}）`);
}

// ==============================
// 機種フィルタ（複数選択）
//
// 並び順:
//   1. 基準日（endDate指定時はそれ、未指定時はテーブル全体の最終日）
//      に存在する機種を設置台数が多い順に表示
//   2. 基準日に存在しない機種は機種名順で末尾に表示
// ==============================
function resolveReferenceDate(endDate) {
  if (endDate) {
    return endDate;
  }

  const res = SqlDriver.query("SELECT MAX(date) AS max_d FROM hall_data");
  if (!res.length || !res[0].values.length) {
    return null;
  }
  return res[0].values[0][0];
}

function buildMachineOptionLabel(name, count) {
  if (count > 0) {
    return `${name}（${count}台）`;
  }
  return name;
}

function queryMachineRankingRows(startDate, endDate, referenceDate) {
  const rangeFilter =
    startDate && endDate ? `WHERE date BETWEEN '${startDate}' AND '${endDate}'` : "";

  if (!referenceDate) {
    // 基準日が取得できない場合は機種名順のみにフォールバック
    return SqlDriver.query(`
      SELECT DISTINCT machine_name, 0 AS end_day_count
      FROM hall_data
      ${rangeFilter}
      ORDER BY machine_name ASC;
    `);
  }

  return SqlDriver.query(`
    WITH all_names AS (
      SELECT DISTINCT machine_name FROM hall_data ${rangeFilter}
    ),
    end_day_counts AS (
      SELECT machine_name, COUNT(DISTINCT machine_no) AS cnt
      FROM hall_data
      WHERE date = '${escapeSql(referenceDate)}'
      GROUP BY machine_name
    )
    SELECT a.machine_name, COALESCE(e.cnt, 0) AS end_day_count
    FROM all_names a
    LEFT JOIN end_day_counts e ON e.machine_name = a.machine_name
    ORDER BY
      (COALESCE(e.cnt, 0) > 0) DESC,
      COALESCE(e.cnt, 0) DESC,
      a.machine_name ASC;
  `);
}

function populateMachineFilter(startDate = "", endDate = "") {
  const select = document.getElementById("machineFilter");
  const previousSelected = new Set(
    Array.from(select.selectedOptions).map((opt) => opt.value)
  );

  const referenceDate = resolveReferenceDate(endDate);
  const res = queryMachineRankingRows(startDate, endDate, referenceDate);

  select.innerHTML = "";

  if (!res.length) {
    return;
  }

  for (const [name, count] of res[0].values) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = buildMachineOptionLabel(name, count);
    opt.selected = previousSelected.has(name);
    select.appendChild(opt);
  }
}

function getSelectedMachineNames() {
  const select = document.getElementById("machineFilter");
  return Array.from(select.selectedOptions).map((opt) => opt.value);
}

function resolveBreakdownMode(machineNames) {
  return machineNames.length > 0 ? BreakdownMode.BY_MACHINE : BreakdownMode.AGGREGATE;
}

// ==============================
// 共通フィルタ値
// ==============================
function escapeSql(str) {
  return String(str).replace(/'/g, "''");
}

function getCommonFilters() {
  const digitBoxes = document.querySelectorAll("#digitCheckboxes input:checked");
  const dayDigits = Array.from(digitBoxes).map((el) => el.value);
  const lookbackDays = parseInt(document.getElementById("lookbackDays").value, 10) || DEFAULT_LOOKBACK_DAYS;
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const machineNames = getSelectedMachineNames();
  return { dayDigits, lookbackDays, startDate, endDate, machineNames };
}

// ==============================
// 共通CTE（ウィンドウ関数版・自己結合なし）
// ==============================
function buildBaseCte({ dayDigits, lookbackDays, startDate, endDate, machineNames }) {
  const digitFilter = dayDigits.length
    ? `AND CAST(strftime('%d', date) AS INTEGER) % 10 IN (${dayDigits.join(",")})`
    : "";
  const rangeFilter =
    startDate && endDate ? `AND date BETWEEN '${startDate}' AND '${endDate}'` : "";
  const machineFilterRolling = machineNames.length
    ? `WHERE machine_name IN (${machineNames.map((n) => `'${escapeSql(n)}'`).join(",")})`
    : "";

  return `
    WITH digit_days AS (
      SELECT DISTINCT date
      FROM hall_data
      WHERE 1=1 ${digitFilter} ${rangeFilter}
    ),
    -- 日付をJulian日数の整数に変換。RANGE BETWEENでカレンダー日数
    -- ベースのウィンドウを組むために必要（ROWS版は行数ベースのため
    -- 欠損日があると遡って件数を埋めてしまい不採用）
    dated AS (
      SELECT
        date, machine_no, machine_name, diff,
        CAST(julianday(date) AS INTEGER) AS day_num
      FROM hall_data
      ${machineFilterRolling}
    ),
    -- ルックバックはカレンダー日数ベース。欠損日があれば遡らず、
    -- 実在するデータの日数分だけで集計する
    rolling AS (
      SELECT
        date, machine_no, machine_name, diff,
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
      SELECT r.*
      FROM rolling r
      JOIN digit_days d ON d.date = r.date
      WHERE r.lookback_days_count >= 1
    ),
    ranked AS (
      SELECT
        t.*,
        RANK() OVER (PARTITION BY t.date, t.machine_name ORDER BY t.cum_diff ASC)  AS rank_worst,
        RANK() OVER (PARTITION BY t.date, t.machine_name ORDER BY t.cum_diff DESC) AS rank_best,
        COUNT(*) OVER (PARTITION BY t.date, t.machine_name) AS group_size
      FROM target t
    ),
    joined AS (
      SELECT r.*, r.diff AS target_diff, ${winCaseExpression()} AS is_win
      FROM ranked r
    )
  `;
}

// ==============================
// 分析1: ランキング別勝率
// ==============================
function runRankingAnalysis() {
  const filters = getCommonFilters();
  const cte = buildBaseCte(filters);
  const breakdownMode = resolveBreakdownMode(filters.machineNames);
  const byMachine = breakdownMode === BreakdownMode.BY_MACHINE;

  const selectCols = byMachine ? "machine_name, rank_worst," : "rank_worst,";
  const groupCols = byMachine ? "machine_name, rank_worst" : "rank_worst";
  const orderCols = byMachine ? "machine_name, rank_worst" : "rank_worst";

  const sql = `
    ${cte}
    SELECT
      ${selectCols}
      ROUND(AVG(group_size), ${ROUND_DECIMALS}) AS avg_group_size,
      COUNT(*) AS n,
      SUM(is_win) AS wins,
      ROUND(${PERCENT_MULTIPLIER} * SUM(is_win) / COUNT(*), ${ROUND_DECIMALS}) AS win_rate
    FROM joined
    GROUP BY ${groupCols}
    ORDER BY ${orderCols};
  `;
  const res = SqlDriver.query(sql);
  const headers = byMachine
    ? ["機種名", "ワースト順位", "平均設置台数", "件数", "勝ち数", "勝率(%)"]
    : ["ワースト順位", "平均設置台数", "件数", "勝ち数", "勝率(%)"];
  renderTable("rankingTable", res, headers);
}

// ==============================
// 分析2: 閾値別勝率
// ==============================
function parseThresholds(rawValues) {
  return rawValues
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "")
    .map(Number);
}

function buildThresholdSelect(threshold, op, byMachine) {
  const selectCols = byMachine ? "machine_name," : "";
  const groupClause = byMachine ? "GROUP BY machine_name" : "";

  return `
    SELECT
      ${selectCols}
      ${threshold} AS threshold,
      COUNT(*) AS n,
      SUM(is_win) AS wins,
      ROUND(${PERCENT_MULTIPLIER} * SUM(is_win) / COUNT(*), ${ROUND_DECIMALS}) AS win_rate
    FROM joined
    WHERE cum_diff ${op} ${threshold}
    ${groupClause}
  `;
}

function runThresholdAnalysis() {
  const filters = getCommonFilters();
  const cte = buildBaseCte(filters);
  const breakdownMode = resolveBreakdownMode(filters.machineNames);
  const byMachine = breakdownMode === BreakdownMode.BY_MACHINE;

  const direction = document.getElementById("thresholdDirection").value;
  const op = direction === ComparisonDirection.LE ? "<=" : ">=";
  const thresholds = parseThresholds(document.getElementById("thresholdValues").value);

  if (thresholds.length === 0) {
    alert("閾値を1つ以上入力してください。");
    return;
  }

  const unionParts = thresholds.map((t) => buildThresholdSelect(t, op, byMachine));
  const orderCols = byMachine ? "machine_name, threshold" : "threshold";
  const sql = `${cte} ${unionParts.join(" UNION ALL ")} ORDER BY ${orderCols};`;
  const res = SqlDriver.query(sql);

  const label = direction === ComparisonDirection.LE ? "以下" : "以上";
  const headers = byMachine
    ? ["機種名", `累積差枚 ${label}`, "件数", "勝ち数", "勝率(%)"]
    : [`累積差枚 ${label}`, "件数", "勝ち数", "勝率(%)"];
  renderTable("thresholdTable", res, headers);
}

// ==============================
// 分析3: 月次トレンド
// ==============================
function buildTrendWhereClause(mode) {
  if (mode === TrendMode.RANK) {
    const rankValue = parseInt(document.getElementById("trendRankValue").value, 10) || 1;
    return `rank_worst = ${rankValue}`;
  }

  const direction = document.getElementById("trendThresholdDirection").value;
  const op = direction === ComparisonDirection.LE ? "<=" : ">=";
  const thresholdValue = Number(document.getElementById("trendThresholdValue").value);
  return `cum_diff ${op} ${thresholdValue}`;
}

function runTrendAnalysis() {
  const filters = getCommonFilters();
  const cte = buildBaseCte(filters);
  const breakdownMode = resolveBreakdownMode(filters.machineNames);
  const byMachine = breakdownMode === BreakdownMode.BY_MACHINE;

  const mode = document.getElementById("trendMode").value;
  const whereClause = buildTrendWhereClause(mode);

  const selectCols = byMachine
    ? "machine_name, strftime('%Y-%m', date) AS ym,"
    : "strftime('%Y-%m', date) AS ym,";
  const groupCols = byMachine ? "machine_name, ym" : "ym";
  const orderCols = byMachine ? "machine_name, ym" : "ym";

  const sql = `
    ${cte}
    SELECT
      ${selectCols}
      COUNT(*) AS n,
      SUM(is_win) AS wins,
      ROUND(${PERCENT_MULTIPLIER} * SUM(is_win) / COUNT(*), ${ROUND_DECIMALS}) AS win_rate
    FROM joined
    WHERE ${whereClause}
    GROUP BY ${groupCols}
    ORDER BY ${orderCols};
  `;
  const res = SqlDriver.query(sql);

  const headers = byMachine
    ? ["機種名", "年月", "件数", "勝ち数", "勝率(%)"]
    : ["年月", "件数", "勝ち数", "勝率(%)"];
  renderTable("trendTable", res, headers);
  renderTrendChart(res, breakdownMode);
}

// ==============================
// 表描画
// ==============================
function renderTable(elementId, execResult, headerLabels) {
  const table = document.getElementById(elementId);
  table.innerHTML = "";

  if (!execResult.length) {
    table.innerHTML = "<tr><td>該当データがありません。</td></tr>";
    return;
  }

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of headerLabels) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of execResult[0].values) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

// ==============================
// グラフ描画（月次トレンド用・機種別内訳対応）
// ==============================
function groupRowsByMachine(rows, breakdownMode) {
  if (breakdownMode !== BreakdownMode.BY_MACHINE) {
    return { "": rows.map((r) => [r[0], r[1], r[2], r[3]]) };
  }

  const grouped = {};
  for (const [machineName, ym, n, wins, winRate] of rows) {
    if (!grouped[machineName]) {
      grouped[machineName] = [];
    }
    grouped[machineName].push([ym, n, wins, winRate]);
  }
  return grouped;
}

function extractSortedLabels(grouped) {
  const allYm = new Set();
  for (const rows of Object.values(grouped)) {
    for (const [ym] of rows) {
      allYm.add(ym);
    }
  }
  return Array.from(allYm).sort();
}

function pickChartColor(idx) {
  return CHART_COLOR_PALETTE[idx % CHART_COLOR_PALETTE.length];
}

function buildTrendDatasets(grouped, labels) {
  const names = Object.keys(grouped);
  const singleSeries = names.length <= 1;

  return names.map((name, idx) => {
    const color = pickChartColor(idx);
    const valueByYm = new Map(grouped[name].map((row) => [row[0], row[3]]));

    return {
      label: name || "全体",
      data: labels.map((ym) => (valueByYm.has(ym) ? valueByYm.get(ym) : null)),
      borderColor: color.border,
      backgroundColor: color.fill,
      tension: 0.2,
      fill: singleSeries,
      spanGaps: true,
    };
  });
}

function renderTrendChart(execResult, breakdownMode) {
  const ctx = document.getElementById("trendChart").getContext("2d");

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  if (!execResult.length) {
    return;
  }

  const grouped = groupRowsByMachine(execResult[0].values, breakdownMode);
  const labels = extractSortedLabels(grouped);
  const datasets = buildTrendDatasets(grouped, labels);

  trendChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      plugins: {
        legend: { labels: { color: CHART_TEXT_COLOR } },
      },
      scales: {
        x: { ticks: { color: CHART_AXIS_COLOR }, grid: { color: CHART_GRID_COLOR } },
        y: {
          beginAtZero: true,
          suggestedMax: CHART_Y_AXIS_MAX,
          ticks: { color: CHART_AXIS_COLOR },
          grid: { color: CHART_GRID_COLOR },
        },
      },
    },
  });
}

// ==============================
// 計算中インジケーター
// ==============================
async function runWithIndicator(button, fn) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "計算中...";

  // 1フレーム待ち、ボタン状態を先に描画させる
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    fn();
  } catch (e) {
    console.error(e);
    alert("分析中にエラーが発生しました。コンソールを確認してください。");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

// ==============================
// フィルタサイドパネル開閉
// ==============================
function setFilterSidebarState(state) {
  const isOpen = state === SidebarState.OPEN;

  document.getElementById("filterPanel").classList.toggle("open", isOpen);
  document.getElementById("filterBackdrop").classList.toggle("visible", isOpen);
  document.getElementById("filterToggleBtn").setAttribute("aria-expanded", isOpen);
}

function toggleFilterSidebar() {
  const isOpen = document.getElementById("filterPanel").classList.contains("open");
  setFilterSidebarState(isOpen ? SidebarState.CLOSED : SidebarState.OPEN);
}

// ==============================
// UI初期化
// ==============================
function setupDigitCheckboxes() {
  const container = document.getElementById("digitCheckboxes");
  for (let i = DIGIT_MIN; i <= DIGIT_MAX; i++) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = i;
    label.appendChild(input);
    label.appendChild(document.createTextNode(i));
    container.appendChild(label);
  }
}

function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      for (const b of buttons) {
        b.classList.remove("active");
      }
      for (const panel of document.querySelectorAll(".tab-panel")) {
        panel.classList.remove("active");
      }
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  }
}

function refreshMachineFilter() {
  if (!SqlDriver.isReady()) {
    return;
  }
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  populateMachineFilter(startDate, endDate);
}

function guardDbReady() {
  if (!SqlDriver.isReady()) {
    alert("データベースが読み込まれていません。");
    return false;
  }
  return true;
}

function setupHandlers() {
  document.getElementById("uploadBtn").addEventListener("click", () => {
    document.getElementById("dbFileInput").click();
  });

  document.getElementById("dbFileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) {
      return;
    }
    setStatus("読み込み中...");
    const buf = await file.arrayBuffer();
    await loadDbFromArrayBuffer(buf);
  });

  document.getElementById("startDate").addEventListener("change", refreshMachineFilter);
  document.getElementById("endDate").addEventListener("change", refreshMachineFilter);

  document.getElementById("clearMachineFilterBtn").addEventListener("click", () => {
    const select = document.getElementById("machineFilter");
    for (const opt of select.options) {
      opt.selected = false;
    }
  });

  document.getElementById("runRankingBtn").addEventListener("click", (e) => {
    if (!guardDbReady()) {
      return;
    }
    runWithIndicator(e.target, runRankingAnalysis);
  });

  document.getElementById("runThresholdBtn").addEventListener("click", (e) => {
    if (!guardDbReady()) {
      return;
    }
    runWithIndicator(e.target, runThresholdAnalysis);
  });

  document.getElementById("runTrendBtn").addEventListener("click", (e) => {
    if (!guardDbReady()) {
      return;
    }
    runWithIndicator(e.target, runTrendAnalysis);
  });

  document.getElementById("trendMode").addEventListener("change", (e) => {
    const isRank = e.target.value === TrendMode.RANK;
    document.getElementById("trendRankField").style.display = isRank ? "" : "none";
    document.getElementById("trendThresholdField").style.display = isRank ? "none" : "";
  });

  document.getElementById("filterToggleBtn").addEventListener("click", toggleFilterSidebar);

  document.getElementById("filterCloseBtn").addEventListener("click", () => {
    setFilterSidebarState(SidebarState.CLOSED);
  });

  document.getElementById("filterBackdrop").addEventListener("click", () => {
    setFilterSidebarState(SidebarState.CLOSED);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") {
      return;
    }
    setFilterSidebarState(SidebarState.CLOSED);
  });
}

// ==============================
// エントリーポイント
// ==============================
window.addEventListener("DOMContentLoaded", async () => {
  setupDigitCheckboxes();
  setupTabs();
  setupHandlers();
  setStatus("SQLiteエンジンを初期化しています...");
  await SqlDriver.init();
  setStatus("左上のボタンからhall_data.dbを選択してください。");
});
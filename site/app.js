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

// Wilson score intervalの信頼水準95%に対応するz値
const Z_SCORE_95 = 1.96;

// 件数(n)がこれ未満の行は参考値として表示を弱める
const MIN_RELIABLE_N = 30;

// 閾値分析の対象範囲（累積差枚）と選択可能な刻み幅
const THRESHOLD_RANGE_MIN = -30000;
const THRESHOLD_RANGE_MAX = 30000;
const DEFAULT_THRESHOLD_STEP = 1000;

// 月次トレンド・順位モードで選択可能なワースト順位の範囲
const TREND_RANK_MIN = 1;
const TREND_RANK_MAX = 10;
const DEFAULT_TREND_RANK = 1;

// 順位ごとの濃淡（明度）の変化量。0が最も濃い（元の色）
const RANK_SHADE_STEP = 0.09;
const RANK_SHADE_MAX = 0.75;

// 設置台数グループの固定バケット。判定は対象日・機種名ごとの
// 実測稼働台数（COUNT DISTINCT machine_no）で、他のフィルタとは
// 無関係にhall_data全体から算出する。maxがnullの場合は上限なし
const MACHINE_COUNT_BUCKETS = [
  { min: 1, max: 2, label: "1~2台" },
  { min: 3, max: 4, label: "3~4台" },
  { min: 5, max: 6, label: "5~6台" },
  { min: 7, max: 9, label: "7~9台" },
  { min: 10, max: 15, label: "10~15台" },
  { min: 16, max: 20, label: "16~20台" },
  { min: 21, max: null, label: "21台以上" },
];

const ComparisonDirection = { LE: "le", GE: "ge" };
const TrendMode = { RANK: "rank", THRESHOLD: "threshold" };

// 機種フィルタ・設置台数グループフィルタは互いに独立した「軸」。
// どちらかが1件以上選択されていれば、選択された軸ごとに独立集計した
// 系列を単純に並べて重ね描きする（クロス集計ではない）
const BreakdownMode = { AGGREGATE: "aggregate", BY_SERIES: "by_series" };

// ランキング結果テーブルの並び順。グラフのx軸は常に順位順で固定する
// （順位が上がるほど勝率がどう変化するかという「傾向」を見せるための
// ものなので、並び替え対象は表のみに限定する設計判断）
const RankingSortMode = { RANK: "rank", CONFIDENCE: "confidence" };

// フィルタサイドパネルの開閉状態
const SidebarState = { OPEN: "open", CLOSED: "closed" };

// グラフを持つ分析タブの識別子。canvas要素IDとChartインスタンスの
// 紐付けに使う
const ChartTarget = { RANKING: "ranking", THRESHOLD: "threshold", TREND: "trend" };

const CHART_CANVAS_ID = {
  [ChartTarget.RANKING]: "rankingChart",
  [ChartTarget.THRESHOLD]: "thresholdChart",
  [ChartTarget.TREND]: "trendChart",
};

const CHART_TEXT_COLOR = "#e4e4e4";
const CHART_AXIS_COLOR = "#999999";
const CHART_GRID_COLOR = "#333333";

// 系列グラフの色。系列数がこれを超えたら循環して再利用する
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

// ==============================
// WilsonScore: 勝率の信頼区間計算のみを担当する統計層。
// サンプル数が少ないほど区間が広がり、数字の見た目だけでは
// 判断できない「ブレの大きさ」を可視化するために使う。
//
// 例: 勝率70%でも
//   n=10  → 区間は[35%, 93%]付近（広い＝信用しにくい）
//   n=200 → 区間は[63%, 76%]付近（狭い＝信用できる）
// ==============================
const WilsonScore = (() => {
  function computeInterval(wins, n) {
    if (n <= 0) {
      return { low: 0, high: 0 };
    }

    const p = wins / n;
    const z2 = Z_SCORE_95 * Z_SCORE_95;
    const denominator = 1 + z2 / n;
    const center = p + z2 / (2 * n);
    const margin = Z_SCORE_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

    const lowRaw = (center - margin) / denominator;
    const highRaw = (center + margin) / denominator;

    return {
      low: Math.max(0, lowRaw) * PERCENT_MULTIPLIER,
      high: Math.min(1, highRaw) * PERCENT_MULTIPLIER,
    };
  }

  return { computeInterval };
})();

// タブごとのChartインスタンス。再描画時にdestroy()するために保持する
const chartInstances = {
  [ChartTarget.RANKING]: null,
  [ChartTarget.THRESHOLD]: null,
  [ChartTarget.TREND]: null,
};

// ランキング分析の直前のSQL結果。並び順切り替え時にDBへ再クエリせず
// JS側の再ソート・再描画だけで反映するためのキャッシュ
let lastRankingResult = null;

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

  // 分析用インデックス。メモリ上DBのため毎回作成し直す。
  // (date, machine_name)は設置台数グループ判定の集計で使う
  SqlDriver.run(`
    CREATE INDEX IF NOT EXISTS idx_hall_data_date ON hall_data(date);
    CREATE INDEX IF NOT EXISTS idx_hall_data_name_date ON hall_data(machine_name, date);
    CREATE INDEX IF NOT EXISTS idx_hall_data_no_date ON hall_data(machine_no, date);
    CREATE INDEX IF NOT EXISTS idx_hall_data_date_name ON hall_data(date, machine_name);
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

function getSelectedCountGroupLabels() {
  const boxes = document.querySelectorAll("#countGroupCheckboxes input:checked");
  return Array.from(boxes).map((el) => el.value);
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
  const countGroupLabels = getSelectedCountGroupLabels();
  return { dayDigits, lookbackDays, startDate, endDate, machineNames, countGroupLabels };
}

// ==============================
// 独立軸（機種フィルタ／設置台数グループフィルタ）の解決
//
// 両フィルタは互いのWHERE条件に干渉しない。選択された軸ごとに
// 独立集計したクエリをUNION ALLで単純に並べ、同じグラフ上に
// 重ね描きする（クロス集計ではない）。
// 例: 機種1つ＋グループ2つ選択 → 3系列（機種1本＋グループ2本）
// ==============================
function resolveActiveAxes(machineNames, countGroupLabels) {
  const axes = [];

  if (machineNames.length) {
    const list = machineNames.map((n) => `'${escapeSql(n)}'`).join(",");
    axes.push({ column: "machine_name", filterSql: `machine_name IN (${list})` });
  }

  if (countGroupLabels.length) {
    const list = countGroupLabels.map((l) => `'${escapeSql(l)}'`).join(",");
    axes.push({ column: "count_group", filterSql: `count_group IN (${list})` });
  }

  return axes;
}

function resolveBreakdownMode(axes) {
  return axes.length > 0 ? BreakdownMode.BY_SERIES : BreakdownMode.AGGREGATE;
}

// ==============================
// 設置台数グループ判定
// ==============================

// machine_count(実測稼働台数)をバケットラベルに変換するCASE式
function buildCountGroupCaseExpression(countColumn) {
  const whenClauses = MACHINE_COUNT_BUCKETS.map(({ min, max, label }) => {
    const upperCond = max === null ? "" : ` AND ${countColumn} <= ${max}`;
    return `WHEN ${countColumn} >= ${min}${upperCond} THEN '${label}'`;
  });
  return `CASE ${whenClauses.join(" ")} END`;
}

// ==============================
// 共通CTE（ウィンドウ関数版・自己結合なし）
//
// 機種名・設置台数グループによる絞り込みはここでは行わない。
// 設置台数グループ軸の集計には全機種のデータが必要なため、
// 土台は常に全データで計算し、絞り込みは各分析クエリ側
// （軸ごとのSELECT）で個別に適用する
// ==============================
function buildBaseCte({ dayDigits, lookbackDays, startDate, endDate }) {
  const digitFilter = dayDigits.length
    ? `AND CAST(strftime('%d', date) AS INTEGER) % 10 IN (${dayDigits.join(",")})`
    : "";
  const rangeFilter =
    startDate && endDate ? `AND date BETWEEN '${startDate}' AND '${endDate}'` : "";
  const countGroupCase = buildCountGroupCaseExpression("mc.machine_count");

  return `
    WITH digit_days AS (
      SELECT DISTINCT date
      FROM hall_data
      WHERE 1=1 ${digitFilter} ${rangeFilter}
    ),
    -- 日付・機種名ごとの実測設置台数。他の絞り込み条件と無関係に
    -- hall_data全体から算出する（機種フィルタや期間フィルタを変えても
    -- グループ判定の基準がぶれないようにするため）
    machine_counts AS (
      SELECT date, machine_name, COUNT(DISTINCT machine_no) AS machine_count
      FROM hall_data
      GROUP BY date, machine_name
    ),
    -- 日付をJulian日数の整数に変換。RANGE BETWEENでカレンダー日数
    -- ベースのウィンドウを組むために必要（ROWS版は行数ベースのため
    -- 欠損日があると遡って件数を埋めてしまい不採用）。
    -- 機種名フィルタはここでは適用しない（設置台数グループ軸の
    -- 集計に全機種のデータが必要なため）
    dated AS (
      SELECT
        h.date, h.machine_no, h.machine_name, h.diff,
        CAST(julianday(h.date) AS INTEGER) AS day_num,
        ${countGroupCase} AS count_group
      FROM hall_data h
      JOIN machine_counts mc ON mc.date = h.date AND mc.machine_name = h.machine_name
    ),
    -- ルックバックはカレンダー日数ベース。欠損日があれば遡らず、
    -- 実在するデータの日数分だけで集計する
    rolling AS (
      SELECT
        date, machine_no, machine_name, diff, count_group,
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

// 中央値はSQLiteに標準関数がないため、ROW_NUMBER/COUNTの
// window関数トリックで算出する。
// rn IN ((cnt+1)/2, (cnt+2)/2) は整数除算により
// 奇数件数なら中央1件、偶数件数なら中央2件の平均を指す
function buildRankingFragment(axis) {
  const innerSeriesSelect = axis ? `${axis.column} AS series_label,` : "";
  const outerSeriesSelect = axis ? "series_label," : "";
  const seriesGroupBy = axis ? "series_label, " : "";
  const partitionBy = axis ? "series_label, rank_worst" : "rank_worst";
  const whereClause = axis ? `WHERE ${axis.filterSql}` : "";

  return `
    SELECT
      ${outerSeriesSelect}
      rank_worst,
      ROUND(AVG(group_size), ${ROUND_DECIMALS}) AS avg_group_size,
      COUNT(*) AS n,
      SUM(is_win) AS wins,
      ROUND(${PERCENT_MULTIPLIER} * SUM(is_win) / COUNT(*), ${ROUND_DECIMALS}) AS win_rate,
      ROUND(AVG(target_diff), ${ROUND_DECIMALS}) AS avg_diff,
      ROUND(AVG(CASE WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN target_diff END), ${ROUND_DECIMALS}) AS median_diff
    FROM (
      SELECT
        ${innerSeriesSelect}
        rank_worst, group_size, is_win, target_diff,
        ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY target_diff) AS rn,
        COUNT(*) OVER (PARTITION BY ${partitionBy}) AS cnt
      FROM joined
      ${whereClause}
    )
    GROUP BY ${seriesGroupBy}rank_worst
  `;
}

// 列の並びは常に固定:
// [series_label?, rank_worst, avg_group_size, n, wins, win_rate, avg_diff, median_diff]
// 列追加でrow.length基準のインデックスが崩れるため、hasSeriesによる
// 固定オフセットで位置を決める
function enrichRankingRow(row, hasSeries) {
  const offset = hasSeries ? 1 : 0;
  const n = row[offset + 2];
  const wins = row[offset + 3];
  const { low, high } = WilsonScore.computeInterval(wins, n);
  const ciLabel = `${low.toFixed(ROUND_DECIMALS)}% ~ ${high.toFixed(ROUND_DECIMALS)}%`;

  return {
    tableRow: [...row, ciLabel],
    ciLow: low,
    ciHigh: high,
    isReliable: n >= MIN_RELIABLE_N,
  };
}

// 信頼度順は「CI下限が高い順」で表の行だけを並べ替える。
// 順位順（SQLのORDER BYそのまま）ならソート不要でそのまま返す
function sortEnrichedForTable(enriched, sortMode) {
  if (sortMode !== RankingSortMode.CONFIDENCE) {
    return enriched;
  }
  return [...enriched].sort((a, b) => b.ciLow - a.ciLow);
}

// SQL結果(rows)からテーブル・グラフを再構築する。DBへの再クエリを
// 伴わないため、並び順切り替えなど表示だけの変更に使う
function renderRankingResults(rows, breakdownMode) {
  const hasSeries = breakdownMode === BreakdownMode.BY_SERIES;
  const enriched = rows.map((row) => enrichRankingRow(row, hasSeries));

  const sortMode = document.getElementById("rankingSortMode").value;
  const sortedForTable = sortEnrichedForTable(enriched, sortMode);
  const tableRows = sortedForTable.map((e) => e.tableRow);
  const rowClassFn = (idx) => (sortedForTable[idx].isReliable ? null : "low-confidence");

  const headers = hasSeries
    ? ["系列", "ワースト順位", "平均設置台数", "件数", "勝ち数", "勝率(%)", "平均差枚", "差枚中央値", "信頼区間(95%)"]
    : ["ワースト順位", "平均設置台数", "件数", "勝ち数", "勝率(%)", "平均差枚", "差枚中央値", "信頼区間(95%)"];

  renderTable("rankingTable", tableRows, headers, rowClassFn);

  // グラフは常に順位順で描画する（並び替え対象は表のみ）
  renderRankingChart(rows, enriched, breakdownMode);
}

function runRankingAnalysis() {
  const filters = getCommonFilters();
  const cte = buildBaseCte(filters);
  const axes = resolveActiveAxes(filters.machineNames, filters.countGroupLabels);
  const breakdownMode = resolveBreakdownMode(axes);
  const hasSeries = breakdownMode === BreakdownMode.BY_SERIES;

  const fragments = hasSeries
    ? axes.map((axis) => buildRankingFragment(axis))
    : [buildRankingFragment(null)];
  const orderCols = hasSeries ? "series_label, rank_worst" : "rank_worst";
  const sql = `${cte} ${fragments.join(" UNION ALL ")} ORDER BY ${orderCols};`;
  const res = SqlDriver.query(sql);
  const rows = res.length ? res[0].values : [];

  lastRankingResult = { rows, breakdownMode };
  renderRankingResults(rows, breakdownMode);
}

// ==============================
// 分析2: 閾値別勝率（区間集計）
// ==============================

// 固定範囲(THRESHOLD_RANGE_MIN ～ THRESHOLD_RANGE_MAX)を
// 指定刻み幅で分割し、[下限, 上限)の半開区間ペアを生成する
function generateThresholdBins(step) {
  const bins = [];
  for (let lower = THRESHOLD_RANGE_MIN; lower < THRESHOLD_RANGE_MAX; lower += step) {
    bins.push([lower, lower + step]);
  }
  return bins;
}

function buildThresholdFragment(axis, lowerBound, upperBound) {
  const seriesSelect = axis ? `${axis.column} AS series_label,` : "";
  const groupClause = axis ? "GROUP BY series_label" : "";
  const axisFilter = axis ? `AND ${axis.filterSql}` : "";

  return `
    SELECT
      ${seriesSelect}
      ${lowerBound} AS bin_lower,
      ${upperBound} AS bin_upper,
      COUNT(*) AS n,
      SUM(is_win) AS wins,
      ROUND(${PERCENT_MULTIPLIER} * SUM(is_win) / COUNT(*), ${ROUND_DECIMALS}) AS win_rate
    FROM joined
    WHERE cum_diff >= ${lowerBound} AND cum_diff < ${upperBound} ${axisFilter}
    ${groupClause}
  `;
}

function runThresholdAnalysis() {
  const filters = getCommonFilters();
  const cte = buildBaseCte(filters);
  const axes = resolveActiveAxes(filters.machineNames, filters.countGroupLabels);
  const breakdownMode = resolveBreakdownMode(axes);
  const hasSeries = breakdownMode === BreakdownMode.BY_SERIES;

  const step = parseInt(document.getElementById("thresholdStep").value, 10) || DEFAULT_THRESHOLD_STEP;
  const bins = generateThresholdBins(step);

  const fragments = [];
  for (const [lower, upper] of bins) {
    if (!hasSeries) {
      fragments.push(buildThresholdFragment(null, lower, upper));
      continue;
    }
    for (const axis of axes) {
      fragments.push(buildThresholdFragment(axis, lower, upper));
    }
  }

  const orderCols = hasSeries ? "series_label, bin_lower" : "bin_lower";
  const sql = `${cte} ${fragments.join(" UNION ALL ")} ORDER BY ${orderCols};`;
  const res = SqlDriver.query(sql);
  const rows = res.length ? res[0].values : [];

  const headers = hasSeries
    ? ["系列", "累積差枚 下限", "累積差枚 上限（未満）", "件数", "勝ち数", "勝率(%)"]
    : ["累積差枚 下限", "累積差枚 上限（未満）", "件数", "勝ち数", "勝率(%)"];
  renderTable("thresholdTable", rows, headers);
  renderThresholdChart(res, breakdownMode);
}

// ==============================
// 分析3: 月次トレンド
// ==============================
function getSelectedTrendRanks() {
  const boxes = document.querySelectorAll("#trendRankCheckboxes input:checked");
  return Array.from(boxes)
    .map((el) => parseInt(el.value, 10))
    .sort((a, b) => a - b);
}

function buildTrendThresholdWhereClause() {
  const direction = document.getElementById("trendThresholdDirection").value;
  const op = direction === ComparisonDirection.LE ? "<=" : ">=";
  const thresholdValue = Number(document.getElementById("trendThresholdValue").value);
  return `cum_diff ${op} ${thresholdValue}`;
}

function buildTrendRankFragment(axis, ranks) {
  const seriesSelect = axis ? `${axis.column} AS series_label,` : "";
  const seriesGroupBy = axis ? "series_label, " : "";
  const axisFilter = axis ? `AND ${axis.filterSql}` : "";

  return `
    SELECT
      ${seriesSelect}
      rank_worst,
      strftime('%Y-%m', date) AS ym,
      COUNT(*) AS n,
      SUM(is_win) AS wins,
      ROUND(${PERCENT_MULTIPLIER} * SUM(is_win) / COUNT(*), ${ROUND_DECIMALS}) AS win_rate
    FROM joined
    WHERE rank_worst IN (${ranks.join(",")}) ${axisFilter}
    GROUP BY ${seriesGroupBy}rank_worst, ym
  `;
}

// 順位モード: 複数のワースト順位をまとめて取得し、
// 「順位ごとの年月別勝率」を1系列ずつ描画する
function runTrendRankAnalysis(cte, axes, breakdownMode) {
  const ranks = getSelectedTrendRanks();
  if (ranks.length === 0) {
    alert("ワースト順位を1つ以上選択してください。");
    return;
  }

  const hasSeries = breakdownMode === BreakdownMode.BY_SERIES;
  const fragments = hasSeries
    ? axes.map((axis) => buildTrendRankFragment(axis, ranks))
    : [buildTrendRankFragment(null, ranks)];
  const orderCols = hasSeries ? "series_label, rank_worst, ym" : "rank_worst, ym";
  const sql = `${cte} ${fragments.join(" UNION ALL ")} ORDER BY ${orderCols};`;
  const res = SqlDriver.query(sql);
  const rows = res.length ? res[0].values : [];

  const headers = hasSeries
    ? ["系列", "ワースト順位", "年月", "件数", "勝ち数", "勝率(%)"]
    : ["ワースト順位", "年月", "件数", "勝ち数", "勝率(%)"];
  renderTable("trendTable", rows, headers);
  renderTrendRankChart(res, breakdownMode);
}

function buildTrendThresholdFragment(axis, whereClause) {
  const seriesSelect = axis ? `${axis.column} AS series_label,` : "";
  const seriesGroupBy = axis ? "series_label, " : "";
  const axisFilter = axis ? `AND ${axis.filterSql}` : "";

  return `
    SELECT
      ${seriesSelect}
      strftime('%Y-%m', date) AS ym,
      COUNT(*) AS n,
      SUM(is_win) AS wins,
      ROUND(${PERCENT_MULTIPLIER} * SUM(is_win) / COUNT(*), ${ROUND_DECIMALS}) AS win_rate
    FROM joined
    WHERE ${whereClause} ${axisFilter}
    GROUP BY ${seriesGroupBy}ym
  `;
}

function runTrendAnalysis() {
  const filters = getCommonFilters();
  const cte = buildBaseCte(filters);
  const axes = resolveActiveAxes(filters.machineNames, filters.countGroupLabels);
  const breakdownMode = resolveBreakdownMode(axes);

  const mode = document.getElementById("trendMode").value;
  if (mode === TrendMode.RANK) {
    runTrendRankAnalysis(cte, axes, breakdownMode);
    return;
  }

  const hasSeries = breakdownMode === BreakdownMode.BY_SERIES;
  const whereClause = buildTrendThresholdWhereClause();
  const fragments = hasSeries
    ? axes.map((axis) => buildTrendThresholdFragment(axis, whereClause))
    : [buildTrendThresholdFragment(null, whereClause)];
  const orderCols = hasSeries ? "series_label, ym" : "ym";
  const sql = `${cte} ${fragments.join(" UNION ALL ")} ORDER BY ${orderCols};`;
  const res = SqlDriver.query(sql);
  const rows = res.length ? res[0].values : [];

  const headers = hasSeries
    ? ["系列", "年月", "件数", "勝ち数", "勝率(%)"]
    : ["年月", "件数", "勝ち数", "勝率(%)"];
  renderTable("trendTable", rows, headers);
  renderTrendChart(res, breakdownMode);
}

// ==============================
// 表描画
// ==============================
function renderTable(elementId, rows, headerLabels, rowClassFn = null) {
  const table = document.getElementById(elementId);
  table.innerHTML = "";

  if (!rows.length) {
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
  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    const rowClass = rowClassFn ? rowClassFn(idx) : null;
    if (rowClass) {
      tr.classList.add(rowClass);
    }

    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

// ==============================
// グラフ描画（閾値・月次トレンド共通）
//
// SQL結果の列構成は分析ごとに異なる（例: 閾値分析には
// bin_lower/bin_upperが挟まる）が、グラフに必要なのは常に
// 「先頭列（ラベル）」と「末尾列（勝率）」だけなので、
// そこだけ抽出して汎用化する。
// ==============================
function extractLabelAndWinRate(row) {
  return [row[0], row[row.length - 1]];
}

// 先頭列（series_label。機種名または設置台数グループラベルの
// いずれか一方が入る）を系列キーとしてグルーピングする
function groupRowsBySeries(rows, hasSeries) {
  if (!hasSeries) {
    return { "": rows.map(extractLabelAndWinRate) };
  }

  const grouped = {};
  for (const row of rows) {
    const seriesLabel = row[0];
    const [label, winRate] = extractLabelAndWinRate(row.slice(1));

    if (!grouped[seriesLabel]) {
      grouped[seriesLabel] = [];
    }
    grouped[seriesLabel].push([label, winRate]);
  }
  return grouped;
}

function extractSortedLabels(grouped, compareFn) {
  const labels = new Set();
  for (const rows of Object.values(grouped)) {
    for (const [label] of rows) {
      labels.add(label);
    }
  }
  return Array.from(labels).sort(compareFn);
}

// ランキングの順位・閾値の累積差枚は数値ラベルのため、既定の
// 文字列ソートだと負の値の大小関係が崩れる（例: "-1000" < "-2000"）。
// 数値として比較する
function numericLabelCompare(a, b) {
  return a - b;
}

function pickChartColor(idx) {
  return CHART_COLOR_PALETTE[idx % CHART_COLOR_PALETTE.length];
}

function buildLineDatasets(grouped, labels) {
  const names = Object.keys(grouped);
  const singleSeries = names.length <= 1;

  return names.map((name, idx) => {
    const color = pickChartColor(idx);
    const valueByLabel = new Map(grouped[name]);

    return {
      label: name || "全体",
      data: labels.map((label) => (valueByLabel.has(label) ? valueByLabel.get(label) : null)),
      borderColor: color.border,
      backgroundColor: color.fill,
      tension: 0.2,
      fill: singleSeries,
      spanGaps: true,
    };
  });
}

function buildChartOptions() {
  return {
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
  };
}

function renderLineChart(target, execResult, breakdownMode, labelCompareFn) {
  const canvas = document.getElementById(CHART_CANVAS_ID[target]);
  const ctx = canvas.getContext("2d");

  if (chartInstances[target]) {
    chartInstances[target].destroy();
  }

  if (!execResult.length) {
    return;
  }

  const hasSeries = breakdownMode === BreakdownMode.BY_SERIES;
  const grouped = groupRowsBySeries(execResult[0].values, hasSeries);
  const labels = extractSortedLabels(grouped, labelCompareFn);
  const datasets = buildLineDatasets(grouped, labels);

  chartInstances[target] = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: buildChartOptions(),
  });
}

function renderThresholdChart(execResult, breakdownMode) {
  renderLineChart(ChartTarget.THRESHOLD, execResult, breakdownMode, numericLabelCompare);
}

function renderTrendChart(execResult, breakdownMode) {
  // 年月(YYYY-MM)は文字列の辞書順ソートで時系列順になるため
  // 比較関数は既定（未指定）のままでよい
  renderLineChart(ChartTarget.TREND, execResult, breakdownMode);
}

// ==============================
// グラフ描画（ランキング専用・信頼区間バンド付き）
//
// 系列ごとに3本のデータセットを重ねる：
//   1. 信頼区間下限（透明線、塗りなし）
//   2. 信頼区間上限（透明線、直前のデータセットまで塗りつぶし→帯になる）
//   3. 勝率本体（実線）
// 凡例には帯の2本は出さず、勝率本体だけを表示する。
// x軸は常に順位順（並び替え対象は表のみ）
// ==============================
function extractRankingLabels(grouped) {
  const labels = new Set();
  for (const entries of Object.values(grouped)) {
    for (const entry of entries) {
      labels.add(entry.rankWorst);
    }
  }
  return Array.from(labels).sort(numericLabelCompare);
}

// 列の並びは常に固定:
// [series_label?, rank_worst, avg_group_size, n, wins, win_rate, avg_diff, median_diff]
// hasSeriesによる固定オフセットでwin_rateの位置を特定する
function groupRankingRowsBySeries(rows, enriched, hasSeries) {
  const grouped = {};
  const offset = hasSeries ? 1 : 0;

  rows.forEach((row, idx) => {
    const seriesLabel = hasSeries ? row[0] : "";
    const rankWorst = row[offset];
    const winRate = row[offset + 4];
    const { ciLow, ciHigh } = enriched[idx];

    if (!grouped[seriesLabel]) {
      grouped[seriesLabel] = [];
    }
    grouped[seriesLabel].push({ rankWorst, winRate, ciLow, ciHigh });
  });

  return grouped;
}

function buildRankingDatasets(grouped, labels) {
  const names = Object.keys(grouped);
  const datasets = [];

  names.forEach((name, idx) => {
    const color = pickChartColor(idx);
    const byRank = new Map(grouped[name].map((entry) => [entry.rankWorst, entry]));
    const pick = (field) =>
      labels.map((rank) => (byRank.has(rank) ? byRank.get(rank)[field] : null));

    datasets.push({
      label: `${name || "全体"}（信頼区間）`,
      data: pick("ciLow"),
      borderColor: "transparent",
      pointRadius: 0,
      fill: false,
      spanGaps: true,
      isConfidenceBand: true,
    });
    datasets.push({
      label: `${name || "全体"}（信頼区間）`,
      data: pick("ciHigh"),
      borderColor: "transparent",
      backgroundColor: color.fill,
      pointRadius: 0,
      fill: "-1",
      spanGaps: true,
      isConfidenceBand: true,
    });
    datasets.push({
      label: name || "全体",
      data: pick("winRate"),
      borderColor: color.border,
      backgroundColor: color.fill,
      tension: 0.2,
      fill: false,
      spanGaps: true,
    });
  });

  return datasets;
}

function buildRankingChartOptions() {
  const options = buildChartOptions();
  options.plugins.legend.labels.filter = (item, data) =>
    !data.datasets[item.datasetIndex].isConfidenceBand;
  return options;
}

function renderRankingChart(rows, enriched, breakdownMode) {
  const canvas = document.getElementById(CHART_CANVAS_ID[ChartTarget.RANKING]);
  const ctx = canvas.getContext("2d");

  if (chartInstances[ChartTarget.RANKING]) {
    chartInstances[ChartTarget.RANKING].destroy();
  }

  if (!rows.length) {
    return;
  }

  const hasSeries = breakdownMode === BreakdownMode.BY_SERIES;
  const grouped = groupRankingRowsBySeries(rows, enriched, hasSeries);
  const labels = extractRankingLabels(grouped);
  const datasets = buildRankingDatasets(grouped, labels);

  chartInstances[ChartTarget.RANKING] = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: buildRankingChartOptions(),
  });
}

// ==============================
// グラフ描画（月次トレンド・順位モード専用）
//
// 色相（系列: 機種名または設置台数グループ）と明度（順位）を
// 分離して割り当てる。
// 例: 系列Aのワースト1は濃い青、系列Aのワースト3は薄い青、
//     系列Bのワースト1は濃い赤、系列Bのワースト3は薄い赤
// ==============================
function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

// ratio: 0で元の色、1で白に近づく（明度を上げて薄くする）
function lightenColor(hex, ratio) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c) => Math.round(c + (255 - c) * ratio);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function shadeRatioForIndex(idx) {
  return Math.min(idx * RANK_SHADE_STEP, RANK_SHADE_MAX);
}

function extractTrendRankRow(row, hasSeries) {
  const offset = hasSeries ? 1 : 0;
  return {
    seriesLabel: hasSeries ? row[0] : "",
    rank: row[offset],
    ym: row[offset + 1],
    winRate: row[row.length - 1],
  };
}

function groupTrendRankRows(rows, hasSeries) {
  const grouped = {};
  const seriesOrder = [];

  for (const rawRow of rows) {
    const { seriesLabel, rank, ym, winRate } = extractTrendRankRow(rawRow, hasSeries);
    const key = `${seriesLabel}\u0000${rank}`;

    if (!grouped[key]) {
      grouped[key] = { seriesLabel, rank, points: [] };
      if (!seriesOrder.includes(seriesLabel)) {
        seriesOrder.push(seriesLabel);
      }
    }
    grouped[key].points.push([ym, winRate]);
  }

  return { grouped, seriesOrder };
}

function buildTrendRankDatasets(grouped, seriesOrder, labels) {
  const distinctRanks = Array.from(new Set(Object.values(grouped).map((g) => g.rank))).sort(
    (a, b) => a - b
  );

  return Object.values(grouped).map((series) => {
    const seriesIdx = seriesOrder.indexOf(series.seriesLabel);
    const baseColor = pickChartColor(seriesIdx);
    const shadeRatio = shadeRatioForIndex(distinctRanks.indexOf(series.rank));
    const lineColor = lightenColor(baseColor.border, shadeRatio);
    const labelPrefix = series.seriesLabel ? `${series.seriesLabel} - ` : "";
    const valueByYm = new Map(series.points);

    return {
      label: `${labelPrefix}ワースト${series.rank}`,
      data: labels.map((ym) => (valueByYm.has(ym) ? valueByYm.get(ym) : null)),
      borderColor: lineColor,
      backgroundColor: lineColor,
      tension: 0.2,
      fill: false,
      spanGaps: true,
    };
  });
}

function renderTrendRankChart(execResult, breakdownMode) {
  const canvas = document.getElementById(CHART_CANVAS_ID[ChartTarget.TREND]);
  const ctx = canvas.getContext("2d");

  if (chartInstances[ChartTarget.TREND]) {
    chartInstances[ChartTarget.TREND].destroy();
  }

  if (!execResult.length) {
    return;
  }

  const hasSeries = breakdownMode === BreakdownMode.BY_SERIES;
  const rows = execResult[0].values;
  const ymColIdx = hasSeries ? 2 : 1;
  const labels = Array.from(new Set(rows.map((r) => r[ymColIdx]))).sort();

  const { grouped, seriesOrder } = groupTrendRankRows(rows, hasSeries);
  const datasets = buildTrendRankDatasets(grouped, seriesOrder, labels);

  chartInstances[ChartTarget.TREND] = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: buildChartOptions(),
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

function setupCountGroupCheckboxes() {
  const container = document.getElementById("countGroupCheckboxes");
  for (const bucket of MACHINE_COUNT_BUCKETS) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = bucket.label;
    label.appendChild(input);
    label.appendChild(document.createTextNode(bucket.label));
    container.appendChild(label);
  }
}

function setupTrendRankCheckboxes() {
  const container = document.getElementById("trendRankCheckboxes");
  for (let i = TREND_RANK_MIN; i <= TREND_RANK_MAX; i++) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = i;
    input.checked = i === DEFAULT_TREND_RANK;
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

  // 並び順の切り替えはDBへ再クエリせず、直前の結果をキャッシュから
  // 再ソート・再描画するだけで済ませる
  document.getElementById("rankingSortMode").addEventListener("change", () => {
    if (!lastRankingResult) {
      return;
    }
    renderRankingResults(lastRankingResult.rows, lastRankingResult.breakdownMode);
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
  setupCountGroupCheckboxes();
  setupTrendRankCheckboxes();
  setupTabs();
  setupHandlers();
  setFilterSidebarState(SidebarState.CLOSED);
  setStatus("SQLiteエンジンを初期化しています...");
  await SqlDriver.init();
  setStatus("左上のボタンからhall_data.dbを選択してください。");
});

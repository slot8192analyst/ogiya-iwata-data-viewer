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

// Wilson score interval・差枚の正規近似信頼区間、共に95%を採用するz値
const Z_SCORE_95 = 1.96;

// 件数(n)がこれ未満の行は参考値として表示を弱める。
// 統計的に「正しい」境界値があるわけではなく運用上の目安。
// 実データを見て違和感があれば調整してよい
const MIN_RELIABLE_N = 20;

// 総合スコアの重み。勝率・平均差枚・差枚中央値はいずれも
// 「値が大きいほど良い」で向きが揃っているため符号反転は不要。
// 現時点ではどの指標が将来の勝敗をよく予測するか未検証のため、
// まず均等重みで試し、後のバックテストで調整する
const SCORE_WEIGHTS = { winRate: 1, avgDiff: 1, medianDiff: 1 };

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
const RankingSortMode = { RANK: "rank", CONFIDENCE: "confidence", SCORE: "score" };

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

// 順位効果相関分析の対象期間(直近1年固定・共通フィルタの
// 対象期間とは独立。「今の傾向」を見たいという要望に基づく)
const CORRELATION_LOOKBACK_YEARS = 1;

// 相関計算に使う最小データ点数(その機種/グループで観測された
// ワースト順位の種類数)。統計的に厳密な閾値ではなく、
// 点が少なすぎる相関係数は信用できないための足切り
const MIN_CORRELATION_POINTS = 4;

const CorrelationAxisColumn = { MACHINE: "machine_name", COUNT_GROUP: "count_group" };

// 複合条件スコア探索: ルックバック日数の候補範囲、最低件数の
// デフォルト、並び順の選択肢
const COMBO_LOOKBACK_MIN = 1;
const COMBO_LOOKBACK_MAX = 10;
const DEFAULT_COMBO_MIN_N = 30;
const ComboSortMode = { CONFIDENCE: "confidence", SCORE: "score" };

// 複合条件スコア探索: 累積差枚順位パターンで選択できる順位の範囲。
// RANK_WITHIN_BUCKETSの最大targetN(5)に合わせている。
// ここで選んだ順位(例: 1,2,3)は、後述のtarget_n（その日の設置台数
// から見て意味を持つ順位の上限）と両方を満たす行だけが、その順位の
// グループとして個別に集計される
const COMBO_RANK_MIN = 1;
const COMBO_RANK_MAX = 5;

// 複合条件スコア探索: 5つの探索パターン。
//   rank_worst/rank_top   … 累積差枚の相対順位のみ（しきい値は使わない）
//   threshold              … 累積差枚のしきい値のみ（従来の集計方式）
//   combined_worst/top     … 相対順位×しきい値ビンの複合集計
const ComboPatternMode = {
  RANK_WORST: "rank_worst",
  RANK_TOP: "rank_top",
  THRESHOLD: "threshold",
  COMBINED_WORST: "combined_worst",
  COMBINED_TOP: "combined_top",
};

// 累積差枚の相対順位判定で使う「設置台数→対象順位数」の対応。
// 上から順に評価し、最初に条件を満たした行のtargetNを採用する
// （10台以上→5位以内、6～9台→3位以内、2～5台→1位以内）。
// 1台のみ設置の日はどの条件にも当たらずNULL（判定不能として除外）
const RANK_WITHIN_BUCKETS = [
  { min: 10, targetN: 5 },
  { min: 6, targetN: 3 },
  { min: 2, targetN: 1 },
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

// ==============================
// ZScore: 複数指標のスケールを揃えるための標準化のみを担当する統計層。
// 勝率(0~100)と差枚(数千~数万)のようにスケールが大きく異なる指標を
// そのまま足し合わせると、桁の大きい指標だけがスコアを支配してしまう
// ため、各指標を平均0・標準偏差1に変換してから合成する。
// ==============================
const ZScore = (() => {
  function computeStats(values) {
    const n = values.length;
    if (n === 0) {
      return { mean: 0, std: 0 };
    }
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / n;
    return { mean, std: Math.sqrt(variance) };
  }

  // std=0（全行が同一値で差がつけられない）場合は0を返す
  function standardize(value, stats) {
    if (stats.std === 0) {
      return 0;
    }
    return (value - stats.mean) / stats.std;
  }

  return { computeStats, standardize };
})();

// ==============================
// SpearmanCorrelation: 2つの数列の順位相関係数のみを担当する統計層。
// 値そのものではなく「順位」で相関を見るため、外れ値の影響を
// 受けにくい(Pearsonの相関係数より頑健)。
// 例: 大当たりが1回だけ極端に多かった月があっても、
// 順位に変換してしまえば影響が抑えられる
// ==============================
const SpearmanCorrelation = (() => {
  // 同順位(タイ)がある場合は平均順位を割り当てる
  function toRanks(values) {
    const indexed = values.map((value, idx) => ({ value, idx }));
    indexed.sort((a, b) => a.value - b.value);

    const ranks = new Array(values.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) {
        j++;
      }
      const averageRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) {
        ranks[indexed[k].idx] = averageRank;
      }
      i = j + 1;
    }
    return ranks;
  }

  function pearson(xs, ys) {
    const n = xs.length;
    const meanX = xs.reduce((sum, v) => sum + v, 0) / n;
    const meanY = ys.reduce((sum, v) => sum + v, 0) / n;

    let cov = 0;
    let varX = 0;
    let varY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }

    // 分散0(全点が同じ値)の場合は相関を定義できないため0扱いにする
    if (varX === 0 || varY === 0) {
      return 0;
    }
    return cov / Math.sqrt(varX * varY);
  }

  function compute(xs, ys) {
    return pearson(toRanks(xs), toRanks(ys));
  }

  return { compute };
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

// 複合条件スコア探索の直前の集計結果（present/absentに分割・
// enrich済み・どのパターンで計算したかを保持）。並び順切り替え時に
// DBへ再クエリせず再ソートのみで反映するためのキャッシュ
let lastComboResult = null;

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
//
// 平均差枚の分散(diff_variance)も同様にSQL側で計算しておく。
// SQLiteにはSTDEV/VARIANCEの組み込み関数がないため、
// s^2 = (Σx^2 - n*mean^2) / (n-1) の展開形をSUM/AVG/COUNTだけで
// 計算する。平方根(標準誤差)を取る部分はsql.jsのSQRT対応状況に
// 依存させたくないため、JS側（computeDiffConfidenceInterval）で行う。
// n=1のときは分散が定義できないためNULLにする。
//
// 差枚中央値の信頼区間は、正規近似のような単純な式が使えず
// 本来ブートストラップ法などが必要になるため、今回は対象外とする
function buildRankingFragment(axis) {
  const innerSeriesSelect = axis ? `${axis.column} AS series_label,` : "";
  const outerSeriesSelect = axis ? "series_label," : "";
  const seriesGroupBy = axis ? "series_label, " : "";
  // ROW_NUMBER()/COUNT()のPARTITION BYは、同じSELECT文内で定義した
  // 出力エイリアス(series_label)を参照できない（ウィンドウ関数は
  // FROM句時点の実列だけを見て評価されるため）。そのため実列名
  // (axis.column＝machine_nameまたはcount_group)を直接指定する
  const partitionBy = axis ? `${axis.column}, rank_worst` : "rank_worst";
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
      ROUND(AVG(CASE WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN target_diff END), ${ROUND_DECIMALS}) AS median_diff,
      CASE
        WHEN COUNT(*) > 1 THEN
          (SUM(target_diff * target_diff) - COUNT(*) * AVG(target_diff) * AVG(target_diff)) / (COUNT(*) - 1)
        ELSE NULL
      END AS diff_variance
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

// 平均差枚の95%信頼区間。正規分布への近似（勝率のWilson区間と
// 同じ発想）のため、nが極端に小さい場合や差枚分布が大きく歪んで
// いる場合は実態より狭い区間になりうる点に注意。
// n<=1で分散が定義できない場合はnullを返す
function computeDiffConfidenceInterval(avgDiff, variance, n) {
  if (variance === null || n <= 1) {
    return null;
  }
  // 浮動小数の丸め誤差でわずかに負になるケースの保険
  const safeVariance = Math.max(0, variance);
  const se = Math.sqrt(safeVariance / n);
  const margin = Z_SCORE_95 * se;
  return { low: avgDiff - margin, high: avgDiff + margin, se };
}

// SQLの生の行を構造化する。列の並びは常に固定:
// [series_label?, rank_worst, avg_group_size, n, wins, win_rate, avg_diff, median_diff, diff_variance]
// 列追加でrow.length基準のインデックスが崩れるため、hasSeriesによる
// 固定オフセットで位置を決める
function parseRankingRow(row, hasSeries) {
  const offset = hasSeries ? 1 : 0;
  return {
    hasSeries,
    seriesLabel: hasSeries ? row[0] : "",
    rankWorst: row[offset],
    avgGroupSize: row[offset + 1],
    n: row[offset + 2],
    wins: row[offset + 3],
    winRate: row[offset + 4],
    avgDiff: row[offset + 5],
    medianDiff: row[offset + 6],
    diffVariance: row[offset + 7],
  };
}

// 各行を信頼区間・z-score・総合スコア付きに拡張する。
// statsByFieldは表示中の全行を対象に計算した平均・標準偏差
// （renderRankingResultsで一度だけ計算して全行に共通で渡す）
function enrichRankingRow(parsed, statsByField) {
  const { n, wins, winRate, avgDiff, medianDiff, diffVariance } = parsed;

  const { low, high } = WilsonScore.computeInterval(wins, n);
  const ciLabel = `${low.toFixed(ROUND_DECIMALS)}% ~ ${high.toFixed(ROUND_DECIMALS)}%`;

  const diffCi = computeDiffConfidenceInterval(avgDiff, diffVariance, n);
  const diffCiLabel = diffCi
    ? `${diffCi.low.toFixed(ROUND_DECIMALS)} ~ ${diffCi.high.toFixed(ROUND_DECIMALS)}`
    : "算出不可(n=1)";

  // 勝率・平均差枚・差枚中央値はいずれも「値が大きいほど良い」で
  // 向きが揃っているため、符号反転なしでそのまま加算できる
  const zWinRate = ZScore.standardize(winRate, statsByField.winRate);
  const zAvgDiff = ZScore.standardize(avgDiff, statsByField.avgDiff);
  const zMedianDiff = ZScore.standardize(medianDiff, statsByField.medianDiff);

  const totalScore =
    SCORE_WEIGHTS.winRate * zWinRate +
    SCORE_WEIGHTS.avgDiff * zAvgDiff +
    SCORE_WEIGHTS.medianDiff * zMedianDiff;

  return {
    tableRow: buildRankingTableRow(parsed, ciLabel, diffCiLabel, totalScore),
    ciLow: low,
    ciHigh: high,
    totalScore,
    isReliable: n >= MIN_RELIABLE_N,
  };
}

// 表示用の並びを組み立てる。SQLの生の列順とは別に、
// 「勝率の隣に勝率CI」「平均差枚の隣に平均差枚CI」「末尾に総合スコア」
// となるよう明示的に並べ替える（diff_varianceは内部計算専用のため
// 表には出さない）
function buildRankingTableRow(parsed, ciLabel, diffCiLabel, totalScore) {
  const seriesPart = parsed.hasSeries ? [parsed.seriesLabel] : [];

  return [
    ...seriesPart,
    parsed.rankWorst,
    parsed.avgGroupSize,
    parsed.n,
    parsed.wins,
    parsed.winRate,
    ciLabel,
    parsed.avgDiff,
    diffCiLabel,
    parsed.medianDiff,
    totalScore.toFixed(2),
  ];
}

// 表の並び替え。順位順（SQLのORDER BYそのまま）ならソート不要でそのまま返し、
// 信頼度順は「CI下限が高い順」、スコア順は「総合スコアが高い順」で並べる
function sortEnrichedForTable(enriched, sortMode) {
  if (sortMode === RankingSortMode.CONFIDENCE) {
    return [...enriched].sort((a, b) => b.ciLow - a.ciLow);
  }
  if (sortMode === RankingSortMode.SCORE) {
    return [...enriched].sort((a, b) => b.totalScore - a.totalScore);
  }
  return enriched;
}

// SQL結果(rows)からテーブル・グラフを再構築する。DBへの再クエリを
// 伴わないため、並び順切り替えなど表示だけの変更に使う
function renderRankingResults(rows, breakdownMode) {
  const hasSeries = breakdownMode === BreakdownMode.BY_SERIES;
  const parsedRows = rows.map((row) => parseRankingRow(row, hasSeries));

  // z-score化のための平均・標準偏差は、現在表示中の全行（信頼度に
  // 関わらず全行）を対象に計算する。信頼度が低い行の影響を除きたい
  // 場合は、将来的にn>=MIN_RELIABLE_Nの行だけに絞る方針へ変更する
  const statsByField = {
    winRate: ZScore.computeStats(parsedRows.map((p) => p.winRate)),
    avgDiff: ZScore.computeStats(parsedRows.map((p) => p.avgDiff)),
    medianDiff: ZScore.computeStats(parsedRows.map((p) => p.medianDiff)),
  };

  const enriched = parsedRows.map((parsed) => enrichRankingRow(parsed, statsByField));

  const sortMode = document.getElementById("rankingSortMode").value;
  const sortedForTable = sortEnrichedForTable(enriched, sortMode);
  const tableRows = sortedForTable.map((e) => e.tableRow);
  const rowClassFn = (idx) => (sortedForTable[idx].isReliable ? null : "low-confidence");

  const headers = hasSeries
    ? [
        "系列",
        "ワースト順位",
        "平均設置台数",
        "件数",
        "勝ち数",
        "勝率(%)",
        "信頼区間(勝率,95%)",
        "平均差枚",
        "平均差枚 信頼区間(95%)",
        "差枚中央値",
        "総合スコア",
      ]
    : [
        "ワースト順位",
        "平均設置台数",
        "件数",
        "勝ち数",
        "勝率(%)",
        "信頼区間(勝率,95%)",
        "平均差枚",
        "平均差枚 信頼区間(95%)",
        "差枚中央値",
        "総合スコア",
      ];

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
// 分析4: 順位効果ランキング(機種・設置台数グループ別の相関分析)
//
// これまでの手作業での前半/後半見比べで、「ワースト順位が下ほど
// 勝ちやすい」傾向は一部の機種でのみ確認できた(全機種共通の法則
// ではない)。この傾向を機種・グループごとに自動判定するための分析。
// フィルタパネルの機種フィルタ・設置台数グループフィルタの選択状態
// には影響されず、常に全機種・全グループを対象に集計する
// ==============================

// ISO日付文字列(YYYY-MM-DD)をnYear分シフトする
function shiftYears(isoDate, years) {
  const d = new Date(isoDate);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

// 相関計算の対象期間(データ末尾からCORRELATION_LOOKBACK_YEARS年分)を
// 解決する。共通フィルタのstartDate/endDateとは独立
function resolveCorrelationDateRange() {
  const res = SqlDriver.query("SELECT MAX(date) AS max_d FROM hall_data");
  if (!res.length || !res[0].values.length) {
    return null;
  }
  const maxDate = res[0].values[0][0];
  return { startDate: shiftYears(maxDate, -CORRELATION_LOOKBACK_YEARS), endDate: maxDate };
}

// 機種・設置台数グループ共通の相関計算用集計フラグメント。
// axisによる絞り込みは行わず、columnそのものをGROUP BYの対象にして
// 存在するすべての値を一度に集計する
function buildCorrelationFragment(column) {
  return `
    SELECT
      ${column} AS group_key,
      rank_worst,
      COUNT(*) AS n,
      ROUND(${PERCENT_MULTIPLIER} * SUM(is_win) / COUNT(*), ${ROUND_DECIMALS}) AS win_rate,
      ROUND(AVG(target_diff), ${ROUND_DECIMALS}) AS avg_diff
    FROM joined
    GROUP BY group_key, rank_worst
  `;
}

function queryCorrelationRows(cte, column) {
  const sql = `${cte} ${buildCorrelationFragment(column)} ORDER BY group_key, rank_worst;`;
  const res = SqlDriver.query(sql);
  return res.length ? res[0].values : [];
}

// group_key(機種名または設置台数グループラベル)ごとに行をまとめる
function groupCorrelationRowsByKey(rows) {
  const grouped = new Map();
  for (const [groupKey, rankWorst, n, winRate, avgDiff] of rows) {
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey).push({ rankWorst, n, winRate, avgDiff });
  }
  return grouped;
}

// group_keyごとに「ワースト順位が下ほど有利」という仮説の
// 強さを1つの数値にまとめる。
// correlation(rank_worst, 指標)が負であるほど仮説を支持するため、
// 符号反転して「強さ(正の値ほど仮説を支持)」として扱う。
// 点数不足(MIN_CORRELATION_POINTS未満)の場合はnullを返す
function computeRankEffectStrength(entries) {
  if (entries.length < MIN_CORRELATION_POINTS) {
    return null;
  }

  const rankWorsts = entries.map((e) => e.rankWorst);
  const winRates = entries.map((e) => e.winRate);
  const avgDiffs = entries.map((e) => e.avgDiff);

  const winRateCorr = SpearmanCorrelation.compute(rankWorsts, winRates);
  const avgDiffCorr = SpearmanCorrelation.compute(rankWorsts, avgDiffs);

  return {
    winRateCorr,
    avgDiffCorr,
    strength: -(winRateCorr + avgDiffCorr) / 2,
  };
}

function computeCorrelationResults(rows) {
  const grouped = groupCorrelationRowsByKey(rows);
  const results = [];

  for (const [groupKey, entries] of grouped) {
    const totalN = entries.reduce((sum, e) => sum + e.n, 0);
    const effect = computeRankEffectStrength(entries);
    results.push({ groupKey, pointCount: entries.length, totalN, effect });
  }

  // 算出不可の行は末尾に、それ以外は強さが高い順に並べる
  return results.sort((a, b) => {
    const strengthA = a.effect ? a.effect.strength : -Infinity;
    const strengthB = b.effect ? b.effect.strength : -Infinity;
    return strengthB - strengthA;
  });
}

function buildCorrelationTableRow(result) {
  if (!result.effect) {
    return [result.groupKey, result.pointCount, result.totalN, "算出不可(順位種類数不足)", "-", "-"];
  }
  const { winRateCorr, avgDiffCorr, strength } = result.effect;
  return [
    result.groupKey,
    result.pointCount,
    result.totalN,
    strength.toFixed(2),
    winRateCorr.toFixed(2),
    avgDiffCorr.toFixed(2),
  ];
}

function renderCorrelationResults(tableId, results, keyLabel) {
  const headers = [keyLabel, "順位の種類数", "合計件数", "順位効果の強さ", "勝率との相関", "平均差枚との相関"];
  renderTable(tableId, results.map(buildCorrelationTableRow), headers);
}

function runCorrelationAnalysis() {
  const range = resolveCorrelationDateRange();
  if (!range) {
    alert("データが読み込まれていません。");
    return;
  }

  const digitBoxes = document.querySelectorAll("#digitCheckboxes input:checked");
  const dayDigits = Array.from(digitBoxes).map((el) => el.value);
  const lookbackDays =
    parseInt(document.getElementById("lookbackDays").value, 10) || DEFAULT_LOOKBACK_DAYS;

  const cte = buildBaseCte({
    dayDigits,
    lookbackDays,
    startDate: range.startDate,
    endDate: range.endDate,
  });

  const machineResults = computeCorrelationResults(
    queryCorrelationRows(cte, CorrelationAxisColumn.MACHINE)
  );
  const groupResults = computeCorrelationResults(
    queryCorrelationRows(cte, CorrelationAxisColumn.COUNT_GROUP)
  );

  renderCorrelationResults("machineCorrelationTable", machineResults, "機種");
  renderCorrelationResults("countGroupCorrelationTable", groupResults, "設置台数グループ");
}

// ==============================
// 分析5: 複合条件スコア探索(機種×累積差枚条件×ルックバック日数)
//
// 最終目的は「機種×累積差枚条件×ルックバック日数の組み合わせで
// 勝率スコアの高いものを見つける」こと。ここでは機種軸のみを対象に、
// 選択された複数のルックバック日数それぞれでCTEを作り直してクエリし、
// 結果をJS側で合流させる。
//
// 累積差枚条件は5パターンから切り替え式で選ぶ:
//   1. 累積差枚の相対順位のみ（ワースト側/TOP側）
//      → 対象日と同じ日の同機種内で、ルックバック期間の累積差枚が
//        何番目に悪い/良いかを見る。設置台数に応じた対象順位数
//        (target_n)を「その日において意味のある順位の上限」として
//        残しつつ、ユーザーが選択した個別の順位（1位、2位…）ごとに
//        行を分けて集計する（ワースト1位とワースト2位の違いを
//        直接比較できるようにするため）
//   2. 累積差枚のしきい値のみ（従来方式）
//   3. 複合（個別順位×しきい値ビン）
//
// どのパターンも同じ`joined`テーブル(group_size・rank_worst・
// rank_best・cum_diffを持つ)を土台にしているため、集計方法だけを
// 切り替える形でbuildComboRankFragmentひとつに統一している。
//
// 組み合わせ数が多いほど偶然良い結果(多重比較問題)が混ざりやすい
// ため、最低件数フィルタと信頼区間下限を主軸にした並び順を
// デフォルトとし、総合スコア順とは別に選べるようにしている
// ==============================

function getSelectedComboLookbacks() {
  const boxes = document.querySelectorAll("#comboLookbackCheckboxes input:checked");
  return Array.from(boxes)
    .map((el) => parseInt(el.value, 10))
    .sort((a, b) => a - b);
}

// 累積差枚順位を使うパターンで、結果テーブルに個別の行として
// 表示したい順位(1位、2位…)の集合。ワースト側/TOP側どちらの
// パターンでも同じチェックボックス群を共有し、どちら向きかは
// getSelectedComboPatternMode側のラジオボタンで決まる
function getSelectedComboRanks() {
  const boxes = document.querySelectorAll("#comboRankCheckboxes input:checked");
  return Array.from(boxes)
    .map((el) => parseInt(el.value, 10))
    .sort((a, b) => a - b);
}

function getSelectedComboPatternMode() {
  const checked = document.querySelector('input[name="comboPattern"]:checked');
  return checked ? checked.value : ComboPatternMode.THRESHOLD;
}

// パターンが「しきい値ビン」を使うかどうか
function comboPatternUsesBin(mode) {
  return (
    mode === ComboPatternMode.THRESHOLD ||
    mode === ComboPatternMode.COMBINED_WORST ||
    mode === ComboPatternMode.COMBINED_TOP
  );
}

// パターンが「累積差枚の相対順位」を使うかどうか
function comboPatternUsesRank(mode) {
  return (
    mode === ComboPatternMode.RANK_WORST ||
    mode === ComboPatternMode.RANK_TOP ||
    mode === ComboPatternMode.COMBINED_WORST ||
    mode === ComboPatternMode.COMBINED_TOP
  );
}

// ワースト側かTOP側かに応じて参照する順位列を切り替える
function comboPatternRankColumn(mode) {
  const isTopSide = mode === ComboPatternMode.RANK_TOP || mode === ComboPatternMode.COMBINED_TOP;
  return isTopSide ? "rank_best" : "rank_worst";
}

// 設置台数(group_size)から対象順位数(target_n)を求めるCASE式。
// 上から順に評価され、最初に条件を満たした行のtargetNが採用される。
// どの条件にも当たらない場合(1台のみ設置)はNULL(判定不能)になる
function buildTargetNCaseExpression(groupSizeColumn) {
  const whenClauses = RANK_WITHIN_BUCKETS.map(
    ({ min, targetN }) => `WHEN ${groupSizeColumn} >= ${min} THEN ${targetN}`
  );
  return `CASE ${whenClauses.join(" ")} ELSE NULL END`;
}

// 機種×(累積差枚の相対順位・個別)×(累積差枚のしきい値ビン)の
// 集計フラグメント。機種フィルタの選択状態には影響されず、常に
// 全機種をGROUP BYの対象にする(順位効果ランキングのbuildCorrelationFragment
// と同じ考え方)。
//
// SQLは3段階のサブクエリに分けている:
//   level1: joinedの実列(group_size・rank_worst/rank_best・cum_diff)
//           だけから計算できる派生列(target_n・rank_value・bin_index)を追加
//   level2: level1のtarget_n・rank_valueを使って、「その日の設置台数
//           から見て意味を持つ順位の上限(target_n)以内」かつ
//           「ユーザーが表示対象として選んだ順位(ranks)」の両方を
//           満たす行だけに絞り込む(1台設置日はtarget_n=NULLのため除外)
//   level3: 中央値計算用のROW_NUMBER/COUNTウィンドウを、最終的な
//           GROUP BY対象と同じ単位で付与
function buildComboRankFragment(mode, step, ranks) {
  const usesBin = comboPatternUsesBin(mode);
  const usesRank = comboPatternUsesRank(mode);
  const rankColumn = comboPatternRankColumn(mode);
  const targetNExpr = buildTargetNCaseExpression("group_size");
  const binIndexExpr = `CAST(FLOOR((cum_diff - (${THRESHOLD_RANGE_MIN})) / ${step}) AS INTEGER)`;

  const level1SelectParts = [
    "machine_name",
    "target_diff",
    "is_win",
    usesRank ? `${targetNExpr} AS target_n` : null,
    usesRank ? `${rankColumn} AS rank_value` : null,
    usesBin ? `${binIndexExpr} AS bin_index` : null,
  ].filter(Boolean).join(",\n      ");

  const level1WhereClause = usesBin
    ? `WHERE cum_diff >= (${THRESHOLD_RANGE_MIN}) AND cum_diff < (${THRESHOLD_RANGE_MAX})`
    : "";

  const level1 = `
    SELECT
      ${level1SelectParts}
    FROM joined
    ${level1WhereClause}
  `;

  const level2SelectParts = [
    "machine_name",
    "target_diff",
    "is_win",
    usesBin ? "bin_index" : null,
    usesRank ? "rank_value" : null,
  ].filter(Boolean).join(",\n      ");

  // rank_valueは「その日の設置台数で有効な順位の上限(target_n)以内」
  // かつ「ユーザーが表示対象として選んだ順位(ranks)」の両方を
  // 満たす行だけを残す。1台のみ設置の日はtarget_nがNULLになるため
  // 判定不能として除外する
  const level2WhereParts = [];
  if (usesRank) {
    level2WhereParts.push("target_n IS NOT NULL");
    level2WhereParts.push("rank_value <= target_n");
    level2WhereParts.push(`rank_value IN (${ranks.join(",")})`);
  }
  const level2WhereClause = level2WhereParts.length ? `WHERE ${level2WhereParts.join(" AND ")}` : "";

  const level2 = `
    SELECT
      ${level2SelectParts}
    FROM (${level1})
    ${level2WhereClause}
  `;

  const groupCols = [
    "machine_name",
    usesRank ? "rank_value" : null,
    usesBin ? "bin_index" : null,
  ].filter(Boolean);
  const groupColsSql = groupCols.join(", ");

  const level3SelectParts = [
    "machine_name",
    "target_diff",
    "is_win",
    usesRank ? "rank_value" : null,
    usesBin ? "bin_index" : null,
    `ROW_NUMBER() OVER (PARTITION BY ${groupColsSql} ORDER BY target_diff) AS rn`,
    `COUNT(*) OVER (PARTITION BY ${groupColsSql}) AS cnt`,
  ].filter(Boolean).join(",\n      ");

  const level3 = `
    SELECT
      ${level3SelectParts}
    FROM (${level2})
  `;

  const binLowerExpr = `bin_index * ${step} + (${THRESHOLD_RANGE_MIN})`;
  const binUpperExpr = `${binLowerExpr} + ${step}`;

  const outerSelectParts = [
    "machine_name",
    usesRank ? "rank_value" : null,
    usesBin ? `${binLowerExpr} AS bin_lower` : null,
    usesBin ? `${binUpperExpr} AS bin_upper` : null,
    "COUNT(*) AS n",
    "SUM(is_win) AS wins",
    `ROUND(${PERCENT_MULTIPLIER} * SUM(is_win) / COUNT(*), ${ROUND_DECIMALS}) AS win_rate`,
    `ROUND(AVG(target_diff), ${ROUND_DECIMALS}) AS avg_diff`,
    `ROUND(AVG(CASE WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN target_diff END), ${ROUND_DECIMALS}) AS median_diff`,
    `CASE WHEN COUNT(*) > 1 THEN (SUM(target_diff * target_diff) - COUNT(*) * AVG(target_diff) * AVG(target_diff)) / (COUNT(*) - 1) ELSE NULL END AS diff_variance`,
  ].filter(Boolean).join(",\n      ");

  return `
    SELECT
      ${outerSelectParts}
    FROM (${level3})
    GROUP BY ${groupColsSql}
  `;
}

// SQL結果の列レイアウトはパターンによって(rank_value・bin_lower/upperの
// 有無が)変わるため、モードを見て可変長にパースする
function queryComboRankRows(cte, mode, step, ranks, lookbackDays) {
  const sql = `${cte} ${buildComboRankFragment(mode, step, ranks)};`;
  const res = SqlDriver.query(sql);
  const rows = res.length ? res[0].values : [];
  const usesRank = comboPatternUsesRank(mode);
  const usesBin = comboPatternUsesBin(mode);

  return rows.map((row) => {
    let idx = 0;
    const machineName = row[idx++];
    const rankValue = usesRank ? row[idx++] : null;
    const binLower = usesBin ? row[idx++] : null;
    const binUpper = usesBin ? row[idx++] : null;
    const n = row[idx++];
    const wins = row[idx++];
    const winRate = row[idx++];
    const avgDiff = row[idx++];
    const medianDiff = row[idx++];
    const diffVariance = row[idx++];

    return {
      machineName,
      lookbackDays,
      rankValue,
      binLower,
      binUpper,
      n,
      wins,
      winRate,
      avgDiff,
      medianDiff,
      diffVariance,
    };
  });
}

// 対象期間の最終日にその機種が設置されているかどうかの判定。
// 既存の機種フィルタ(resolveReferenceDate)と同じ基準日ロジックを流用
function resolvePresentMachineSet(endDate) {
  const referenceDate = resolveReferenceDate(endDate);
  if (!referenceDate) {
    return new Set();
  }
  const res = SqlDriver.query(`
    SELECT DISTINCT machine_name
    FROM hall_data
    WHERE date = '${escapeSql(referenceDate)}'
  `);
  if (!res.length) {
    return new Set();
  }
  return new Set(res[0].values.map((row) => row[0]));
}

// ランキング分析のenrichRankingRowと同じ考え方で、信頼区間・
// z-score・総合スコアを付与する
function enrichComboRow(row, statsByField) {
  const { low, high } = WilsonScore.computeInterval(row.wins, row.n);
  const zWinRate = ZScore.standardize(row.winRate, statsByField.winRate);
  const zAvgDiff = ZScore.standardize(row.avgDiff, statsByField.avgDiff);
  const zMedianDiff = ZScore.standardize(row.medianDiff, statsByField.medianDiff);
  const totalScore =
    SCORE_WEIGHTS.winRate * zWinRate +
    SCORE_WEIGHTS.avgDiff * zAvgDiff +
    SCORE_WEIGHTS.medianDiff * zMedianDiff;

  return { ...row, ciLow: low, ciHigh: high, totalScore };
}

function sortComboRows(rows, sortMode) {
  if (sortMode === ComboSortMode.SCORE) {
    return [...rows].sort((a, b) => b.totalScore - a.totalScore);
  }
  return [...rows].sort((a, b) => b.ciLow - a.ciLow);
}

// パターンごとに表示する列構成を切り替える
function comboTableHeaders(mode) {
  const usesRank = comboPatternUsesRank(mode);
  const usesBin = comboPatternUsesBin(mode);

  const headers = ["機種", "ルックバック日数"];
  if (usesRank) {
    headers.push("順位");
  }
  if (usesBin) {
    headers.push("累積差枚 下限", "累積差枚 上限（未満）");
  }
  headers.push(
    "件数",
    "勝ち数",
    "勝率(%)",
    "信頼区間(勝率,95%)",
    "平均差枚",
    "差枚中央値",
    "総合スコア"
  );
  return headers;
}

// 実際の順位の数値(rank_value)を、ワースト側/TOP側それぞれの
// 文言に変換する（例: ワースト側でrank_value=2なら「ワースト2」）
function comboRankConditionLabel(mode, rankValue) {
  const isWorstSide = mode === ComboPatternMode.RANK_WORST || mode === ComboPatternMode.COMBINED_WORST;
  const label = isWorstSide ? "ワースト" : "TOP";
  return `${label}${rankValue}`;
}

function buildComboTableRow(row, mode) {
  const ciLabel = `${row.ciLow.toFixed(ROUND_DECIMALS)}% ~ ${row.ciHigh.toFixed(ROUND_DECIMALS)}%`;
  const usesRank = comboPatternUsesRank(mode);
  const usesBin = comboPatternUsesBin(mode);

  const cells = [row.machineName, row.lookbackDays];
  if (usesRank) {
    cells.push(comboRankConditionLabel(mode, row.rankValue));
  }
  if (usesBin) {
    cells.push(row.binLower, row.binUpper);
  }
  cells.push(row.n, row.wins, row.winRate, ciLabel, row.avgDiff, row.medianDiff, row.totalScore.toFixed(2));
  return cells;
}

// パターン切り替え時、しきい値刻み幅の入力・順位選択のチェックボックスを
// それぞれ使うパターンのときだけ表示する
function updateComboPatternFieldVisibility() {
  const mode = getSelectedComboPatternMode();
  const usesBin = comboPatternUsesBin(mode);
  const usesRank = comboPatternUsesRank(mode);
  document.getElementById("comboThresholdStepField").style.display = usesBin ? "" : "none";
  document.getElementById("comboRankField").style.display = usesRank ? "" : "none";
}

function runComboAnalysis() {
  const lookbacks = getSelectedComboLookbacks();
  if (lookbacks.length === 0) {
    alert("ルックバック日数を1つ以上選択してください。");
    return;
  }

  const mode = getSelectedComboPatternMode();
  const usesRank = comboPatternUsesRank(mode);
  const ranks = usesRank ? getSelectedComboRanks() : [];
  if (usesRank && ranks.length === 0) {
    alert("表示する順位を1つ以上選択してください。");
    return;
  }

  const digitBoxes = document.querySelectorAll("#digitCheckboxes input:checked");
  const dayDigits = Array.from(digitBoxes).map((el) => el.value);
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;
  const step = parseInt(document.getElementById("comboThresholdStep").value, 10) || DEFAULT_THRESHOLD_STEP;
  const minN = parseInt(document.getElementById("comboMinN").value, 10) || DEFAULT_COMBO_MIN_N;

  // ルックバック日数はbuildBaseCteのウィンドウ関数幅として埋め込まれる
  // ため、候補ごとにCTEを作り直して個別にクエリし、JS側で合流させる
  let allRows = [];
  for (const lookbackDays of lookbacks) {
    const cte = buildBaseCte({ dayDigits, lookbackDays, startDate, endDate });
    allRows = allRows.concat(queryComboRankRows(cte, mode, step, ranks, lookbackDays));
  }

  const filteredRows = allRows.filter((r) => r.n >= minN);
  const headers = comboTableHeaders(mode);

  if (filteredRows.length === 0) {
    renderTable("comboPresentTable", [], headers);
    renderTable("comboAbsentTable", [], headers);
    lastComboResult = null;
    alert("最低件数フィルタを満たす組み合わせが見つかりませんでした。フィルタを緩めてください。");
    return;
  }

  const statsByField = {
    winRate: ZScore.computeStats(filteredRows.map((r) => r.winRate)),
    avgDiff: ZScore.computeStats(filteredRows.map((r) => r.avgDiff)),
    medianDiff: ZScore.computeStats(filteredRows.map((r) => r.medianDiff)),
  };
  const enriched = filteredRows.map((r) => enrichComboRow(r, statsByField));

  const presentSet = resolvePresentMachineSet(endDate);
  const presentRows = enriched.filter((r) => presentSet.has(r.machineName));
  const absentRows = enriched.filter((r) => !presentSet.has(r.machineName));

  lastComboResult = { presentRows, absentRows, mode };
  renderComboResults();
}

// 並び順切り替え時はDBへ再クエリせず、キャッシュ済みの結果を
// 再ソート・再描画するだけで済ませる
function renderComboResults() {
  if (!lastComboResult) {
    return;
  }
  const { mode } = lastComboResult;
  const sortMode = document.getElementById("comboSortMode").value;
  const presentSorted = sortComboRows(lastComboResult.presentRows, sortMode);
  const absentSorted = sortComboRows(lastComboResult.absentRows, sortMode);
  const headers = comboTableHeaders(mode);

  renderTable("comboPresentTable", presentSorted.map((r) => buildComboTableRow(r, mode)), headers);
  renderTable("comboAbsentTable", absentSorted.map((r) => buildComboTableRow(r, mode)), headers);
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

// グラフに使うのは勝率（win_rate）とその信頼区間のみのため、
// ここではグラフ用の抽出だけを行う。表示用の並びとは無関係
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

function setupComboLookbackCheckboxes() {
  const container = document.getElementById("comboLookbackCheckboxes");
  for (let i = COMBO_LOOKBACK_MIN; i <= COMBO_LOOKBACK_MAX; i++) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = i;
    label.appendChild(input);
    label.appendChild(document.createTextNode(`${i}日`));
    container.appendChild(label);
  }
}

// 累積差枚順位を使うパターンで表示したい順位(1位～5位)のチェックボックス。
// デフォルトは全順位チェック済み（「ワースト1,2,3,4,5でどう違うか」を
// 一度に見比べたいという要望に基づく）
function setupComboRankCheckboxes() {
  const container = document.getElementById("comboRankCheckboxes");
  for (let i = COMBO_RANK_MIN; i <= COMBO_RANK_MAX; i++) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = i;
    input.checked = true;
    label.appendChild(input);
    label.appendChild(document.createTextNode(`${i}位`));
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

  document.getElementById("runCorrelationBtn").addEventListener("click", (e) => {
    if (!guardDbReady()) {
      return;
    }
    runWithIndicator(e.target, runCorrelationAnalysis);
  });

  document.getElementById("runComboBtn").addEventListener("click", (e) => {
    if (!guardDbReady()) {
      return;
    }
    runWithIndicator(e.target, runComboAnalysis);
  });

  // 並び順の切り替えはDBへ再クエリせず、直前の結果をキャッシュから
  // 再ソート・再描画するだけで済ませる
  document.getElementById("comboSortMode").addEventListener("change", () => {
    renderComboResults();
  });

  // 探索パターンの切り替え時は、集計方法が根本的に変わるため
  // 直前の結果はクリアし、再度「分析実行」を押してもらう。
  // 併せてしきい値刻み幅・順位選択チェックボックスの表示/非表示も切り替える
  document.querySelectorAll('input[name="comboPattern"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      lastComboResult = null;
      const headers = comboTableHeaders(getSelectedComboPatternMode());
      renderTable("comboPresentTable", [], headers);
      renderTable("comboAbsentTable", [], headers);
      updateComboPatternFieldVisibility();
    });
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
  setupComboLookbackCheckboxes();
  setupComboRankCheckboxes();
  setupTabs();
  setupHandlers();
  setFilterSidebarState(SidebarState.CLOSED);
  updateComboPatternFieldVisibility();
  setStatus("SQLiteエンジンを初期化しています...");
  await SqlDriver.init();
  setStatus("左上のボタンからhall_data.dbを選択してください。");
});

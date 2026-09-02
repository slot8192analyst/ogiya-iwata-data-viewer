# パチスロ解析サイト 設計書

## 概要
静的サイト上でSQLite(hall_data.db)をブラウザ内解析する。
サーバー不要。GitHub Pages/Cloudflare Pagesで配信。

## データスキーマ

```sql
CREATE TABLE hall_data (
    date TEXT NOT NULL,        -- 'YYYY-MM-DD'
    machine_no INTEGER NOT NULL,
    machine_name TEXT NOT NULL,
    games INTEGER NOT NULL,
    diff INTEGER NOT NULL,     -- 差枚
    bb INTEGER NOT NULL,
    rb INTEGER NOT NULL,
    art INTEGER NOT NULL,
    PRIMARY KEY (date, machine_no)
);
```

## 主要な定義

- 勝ち: `diff > 0`（変更可能、`winCaseExpression()`に集約）
- ルックバック: 対象日を含まない直前Nカレンダー日（既定7日）。
  日付ベースのウィンドウ（RANGE BETWEEN）で計算するため、
  欠損日があれば遡らず、実在するデータの日数分だけで集計する
  （例: 直前7日中1日欠損なら6日分で計算）。
  データ収録開始直後などでN日分の履歴が全く無い台も、ある分だけで計算対象に含める（0日は除外）。
- ランキング: 同一`machine_name`・同一`date`内の絶対順位（`RANK()`）。
  台数の異なる機種間は正規化していない（意図的）。
- 機種フィルタの並び順: 基準日（終了日指定時はその日、
  未指定時はテーブル全体の最終日）の設置台数が多い順。
  基準日に存在しない機種は末尾に機種名順で表示。
  選択肢テキストには基準日の設置台数を付記する。
- 機種フィルタ: 複数選択可（Ctrl/Cmdクリック）。1件以上選択時は
  ランキング表・閾値表・トレンドグラフすべてが機種別内訳になる
  （BreakdownMode.BY_MACHINE）。未選択時は全機種を合算した
  従来の集計（BreakdownMode.AGGREGATE）。
- 設置台数グループ: 対象日・機種名ごとの実測稼働台数
  (`COUNT(DISTINCT machine_no)`)を7段階の固定バケットに分類する。
  1~2台／3~4台／5~6台／7~9台／10~15台／16~20台／21台以上。
  判定はhall_data全体から算出し、日付末尾フィルタ・対象期間・
  機種フィルタとは無関係（絞り込みでグループ判定がぶれない）。
  日付ごとに動的に再評価するため、同一機種でも月によって
  異なるグループに属し得る（例: 1月は14台グループ、6月は20台
  グループ）。

- 機種フィルタと設置台数グループフィルタは独立した別軸。
  両方未選択はAGGREGATE、機種のみでBY_MACHINE、グループのみで
  BY_COUNT_GROUP、両方選択でBY_MACHINE_AND_COUNT_GROUP
  （機種×グループの組み合わせ単位で系列分け、機種の絞り込みは
  グループ集計に含める対象を制限するだけで系列分けには関与しない
  設計ではなく、両軸それぞれが内訳キーとして系列名に反映される）。

## アーキテクチャ

```
+---------------------------------+
| UI層 (DOM操作・イベント・描画)      |
+----------------+----------------+
                 | 呼び出し
+----------------v----------------+
| 分析層 (SQL組み立て・集計ロジック)   |
+----------------+----------------+
                 | 呼び出し
+----------------v----------------+
| SqlDriver層 (sql.jsラッパー)      |
+----------------+----------------+
                 | 呼び出し
+----------------v----------------+
| sql.js (WebAssembly SQLite)     |
+---------------------------------+
```

UI層はSqlDriverを直接呼ばない。分析層を経由する。

## モジュール一覧

| モジュール | 責務 |
|---|---|
| SqlDriver | sql.jsの初期化・DB読込・クエリ実行のみ担当 |
| buildBaseCte | 共通CTE（ルックバック・ランキング・勝敗）組み立て |
| runRankingAnalysis / runThresholdAnalysis / runTrendAnalysis | 各分析のSQL組み立てと実行 |
| populateMachineFilter | 機種フィルタの選択肢構築・並び替え |
| renderTable / renderTrendChart | 結果描画 |

## ファイル構成

| ファイル | 内容 |
|---|---|
| site/index.html | 画面構成（フィルタ・タブ・各分析パネル） |
| site/style.css | ダークテーマのスタイル |
| site/app.js | ロジック全般（本設計書のモジュール一覧に対応） |
| data/hall_data.db | 実戦データ本体。Git管理は継続するがCloudflare Pagesの配信対象外（Build output directory設定で分離。Pagesの1ファイル25MiB制限を回避するため） |
| buildCountGroupCaseExpression | 実測台数→バケットラベルのCASE式組み立て |
| buildCountGroupFilter | 選択中バケットへのWHERE句組み立て |
| buildBreakdownColumns / breakdownColumnCount | BreakdownModeから内訳SELECT列（機種名・グループ）を決定 |
| groupRowsBySeries | 系列グルーピング（機種名・グループの組み合わせキーに一般化。旧groupRowsByMachineを置き換え） |
| groupTrendRankRows / buildTrendRankDatasets | 月次トレンド順位モードの系列キーを機種名・グループ組み合わせに一般化（旧machineName軸をseriesKey軸に拡張） |

## 制約・今後の検討事項

- DBはローカルアップロード方式に統一。自動読込は廃止済み。
- 利用者3人限定。認証は未実装。必要ならCloudflare Access検討。
- 自由SQL入力は非対応方針。
- 動作確認はローカルHTTPサーバー経由が必須
  （file://直接オープンではsql.jsのwasm読込がCORSで失敗する）。
- 設置台数グループ判定用のmachine_countsCTEはhall_data全体を
  (date, machine_name)単位で集計するため、既存インデックスに加えて
  idx_hall_data_date_name (date, machine_name)を追加。

## 未実装の候補機能（提案済み・優先度は自由）

- スランプグラフ（台単位の差枚推移）
- ボーナス確率分析（bb/rb/art活用）
- 台番号（設置位置）の傾向分析
- サマリーダッシュボード
- CSVエクスポート

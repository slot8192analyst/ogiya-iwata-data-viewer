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
| data/hall_data.db | 実戦データ本体。Git管理は継続するが
  Cloudflare Pagesの配信対象外（Build output directory
  設定で分離。Pagesの1ファイル25MiB制限を回避するため） |

## 制約・今後の検討事項

- DBはローカルアップロード方式に統一。自動読込は廃止済み。
- 利用者3人限定。認証は未実装。必要ならCloudflare Access検討。
- 自由SQL入力は非対応方針。
- 動作確認はローカルHTTPサーバー経由が必須
  （file://直接オープンではsql.jsのwasm読込がCORSで失敗する）。

## 未実装の候補機能（提案済み・優先度は自由）

- スランプグラフ（台単位の差枚推移）
- ボーナス確率分析（bb/rb/art活用）
- 台番号（設置位置）の傾向分析
- サマリーダッシュボード
- CSVエクスポート

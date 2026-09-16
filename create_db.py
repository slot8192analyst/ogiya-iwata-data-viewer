#!/usr/bin/env python3
"""
パチスロ実戦データ → SQLiteデータベース変換スクリプト

JSONデータ構造:
  data/YYYY_MM.json = {
    "YYYY_MM_DD": [
      { "機種名": str, "台番号": int/str, "G数": int, "差枚": int,
        "BB": int, "RB": int, "ART": int },
      ...
    ],
    ...
  }

生成するテーブル: hall_data
  date         TEXT     -- "YYYY-MM-DD"
  machine_name TEXT     -- 機種名
  machine_no   TEXT     -- 台番号
  games        INTEGER  -- G数
  diff         INTEGER  -- 差枚
  bb           INTEGER  -- BB回数
  rb           INTEGER  -- RB回数
  art          INTEGER  -- ART回数
"""

import json
import sqlite3
import sys
from pathlib import Path


# ──────────────────────────────────────────────
# ユーティリティ
# ──────────────────────────────────────────────

def ask_directory() -> Path:
    """データディレクトリのパスを対話形式で取得する。"""
    while True:
        raw = input("\nJSONデータが格納されているディレクトリのパスを入力してください\n> ").strip()
        if not raw:
            print("  ✗ パスが入力されていません。再入力してください。")
            continue
        path = Path(raw).expanduser().resolve()
        if not path.exists():
            print(f"  ✗ ディレクトリが見つかりません: {path}")
            continue
        if not path.is_dir():
            print(f"  ✗ 指定されたパスはディレクトリではありません: {path}")
            continue
        return path


def ask_output_path(default: Path) -> Path:
    """出力DBファイルのパスを対話形式で取得する。"""
    print(f"\n出力するSQLiteファイルのパスを入力してください")
    print(f"  (未入力でデフォルト: {default})")
    while True:
        raw = input("> ").strip()
        if not raw:
            return default

        path = Path(raw).expanduser().resolve()

        # ディレクトリを指定した場合はその中にデフォルトファイル名で保存
        if path.is_dir():
            path = path / "hall_data.db"
            print(f"  ディレクトリが指定されたため、出力先を {path} に設定します。")

        # 拡張子がなければ .db を補完
        if path.suffix == "":
            path = path.with_suffix(".db")
            print(f"  拡張子がないため .db を補完しました: {path}")

        return path


def ask_overwrite(path: Path) -> bool:
    """既存ファイルの上書き確認。ディレクトリなら即エラー。"""
    if path.is_dir():
        print(f"  ✗ '{path}' はディレクトリです。ファイルパスを指定してください。")
        return False
    while True:
        ans = input(f"\n  '{path}' はすでに存在します。上書きしますか？ [y/N] > ").strip().lower()
        if ans in ("y", "yes"):
            return True
        if ans in ("", "n", "no"):
            return False
        print("  y または n を入力してください。")


# ──────────────────────────────────────────────
# JSONパース
# ──────────────────────────────────────────────

# app.js が参照する列名に合わせたキーマッピング。
# JSONのキー → DBカラム名
_KEY_MAP = {
    "機種名": "machine_name",
    "台番号": "machine_no",
    "G数":   "games",
    "差枚":  "diff",
    "BB":    "bb",
    "RB":    "rb",
    "ART":   "art",
}

_REQUIRED_KEYS = {"機種名", "台番号", "差枚"}   # 最低限必要なキー


def parse_record(date_str: str, raw: dict) -> dict | None:
    """
    1レコード（dict）を DB挿入用の dict に変換する。
    必須キーが欠けている場合は None を返す。
    """
    missing = _REQUIRED_KEYS - raw.keys()
    if missing:
        return None

    return {
        "date":         date_str,
        "machine_name": str(raw["機種名"]),
        "machine_no":   str(raw["台番号"]),
        "games":        int(raw.get("G数",  0) or 0),
        "diff":         int(raw.get("差枚", 0) or 0),
        "bb":           int(raw.get("BB",   0) or 0),
        "rb":           int(raw.get("RB",   0) or 0),
        "art":          int(raw.get("ART",  0) or 0),
    }


def load_json_file(json_path: Path) -> list[dict]:
    """
    YYYY_MM.json を読み込み、DB挿入用レコードのリストを返す。
    日付キーの形式は "YYYY_MM_DD" を想定し、"-" 区切りに正規化する。
    """
    records: list[dict] = []
    skip_count = 0

    try:
        with json_path.open(encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"  ⚠ JSON解析エラー ({json_path.name}): {e}")
        return records
    except UnicodeDecodeError:
        # UTF-8 で読めない場合は CP932 (Shift-JIS) にフォールバック
        try:
            with json_path.open(encoding="cp932") as f:
                data = json.load(f)
        except Exception as e:
            print(f"  ⚠ ファイル読み込みエラー ({json_path.name}): {e}")
            return records

    if not isinstance(data, dict):
        print(f"  ⚠ 予期しないJSON形式 ({json_path.name}): トップレベルがオブジェクトではありません")
        return records

    for date_key, day_records in data.items():
        # "YYYY_MM_DD" → "YYYY-MM-DD" に正規化
        date_str = date_key.replace("_", "-")

        if not isinstance(day_records, list):
            skip_count += 1
            continue

        for raw in day_records:
            if not isinstance(raw, dict):
                skip_count += 1
                continue
            parsed = parse_record(date_str, raw)
            if parsed is None:
                skip_count += 1
                continue
            records.append(parsed)

    if skip_count:
        print(f"    スキップしたレコード: {skip_count} 件 ({json_path.name})")

    return records


# ──────────────────────────────────────────────
# DB操作
# ──────────────────────────────────────────────

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS hall_data (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT    NOT NULL,
    machine_name TEXT    NOT NULL,
    machine_no   TEXT    NOT NULL,
    games        INTEGER NOT NULL DEFAULT 0,
    diff         INTEGER NOT NULL DEFAULT 0,
    bb           INTEGER NOT NULL DEFAULT 0,
    rb           INTEGER NOT NULL DEFAULT 0,
    art          INTEGER NOT NULL DEFAULT 0
);
"""

# app.js の loadDbFromArrayBuffer() が生成するインデックスと同じ構成
_CREATE_INDEX_SQLS = [
    "CREATE INDEX IF NOT EXISTS idx_hall_data_date      ON hall_data(date);",
    "CREATE INDEX IF NOT EXISTS idx_hall_data_name_date ON hall_data(machine_name, date);",
    "CREATE INDEX IF NOT EXISTS idx_hall_data_no_date   ON hall_data(machine_no, date);",
    "CREATE INDEX IF NOT EXISTS idx_hall_data_date_name ON hall_data(date, machine_name);",
]

_INSERT_SQL = """
INSERT INTO hall_data (date, machine_name, machine_no, games, diff, bb, rb, art)
VALUES (:date, :machine_name, :machine_no, :games, :diff, :bb, :rb, :art);
"""


def init_db(conn: sqlite3.Connection) -> None:
    """テーブルとインデックスを作成する。"""
    conn.execute(_CREATE_TABLE_SQL)
    for sql in _CREATE_INDEX_SQLS:
        conn.execute(sql)
    conn.commit()


def insert_records(conn: sqlite3.Connection, records: list[dict]) -> int:
    """レコードをバルクインサートし、挿入件数を返す。"""
    if not records:
        return 0
    conn.executemany(_INSERT_SQL, records)
    conn.commit()
    return len(records)


# ──────────────────────────────────────────────
# メイン処理
# ──────────────────────────────────────────────

def collect_json_files(data_dir: Path) -> list[Path]:
    """
    ディレクトリ内の YYYY_MM.json に合致するファイルを
    ファイル名昇順で返す。
    """
    files = sorted(data_dir.glob("????_??.json"))
    return files


def main() -> None:
    print("=" * 55)
    print("  パチスロ実戦データ → SQLite 変換スクリプト")
    print("=" * 55)

    # ── 1. データディレクトリ選択 ──
    data_dir = ask_directory()

    json_files = collect_json_files(data_dir)
    if not json_files:
        print(f"\n✗ '{data_dir}' に YYYY_MM.json 形式のファイルが見つかりませんでした。")
        sys.exit(1)

    print(f"\n  見つかったJSONファイル: {len(json_files)} 件")
    for f in json_files:
        print(f"    - {f.name}")

    # ── 2. 出力先選択（確定するまでループ） ──
    default_output = data_dir / "hall_data.db"
    while True:
        output_path = ask_output_path(default_output)

        if output_path.is_dir():
            # ask_output_path 内で補完済みのはずだが念のため
            print(f"  ✗ '{output_path}' はディレクトリです。再入力してください。")
            continue

        if output_path.exists():
            if not ask_overwrite(output_path):
                # ask_overwrite が False を返す2ケース:
                #   (a) ディレクトリだった → 再入力
                #   (b) ユーザーが N と答えた → 中断
                if output_path.is_dir():
                    continue          # (a) 再入力
                print("\n  処理を中断しました。")
                sys.exit(0)           # (b) 中断
            output_path.unlink()      # 上書き確定：既存ファイルを削除

        break   # パスが確定したのでループを抜ける

    # ── 3. DB作成・データ投入 ──
    print(f"\n  出力先: {output_path}")
    print("  変換を開始します...\n")

    conn = sqlite3.connect(output_path)
    init_db(conn)

    total_inserted = 0

    for json_path in json_files:
        print(f"  読み込み中: {json_path.name}")
        records = load_json_file(json_path)
        inserted = insert_records(conn, records)
        total_inserted += inserted
        print(f"    → {inserted} 件を挿入")

    conn.close()

    # ── 4. サマリー ──
    print("\n" + "=" * 55)
    print(f"  完了！")
    print(f"  合計挿入件数 : {total_inserted:,} 件")
    print(f"  出力ファイル : {output_path}")
    print("=" * 55)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n  割り込みにより処理を中断しました。")
        sys.exit(130)

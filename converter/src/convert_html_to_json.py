#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HTMLファイルを月別JSONに統合するスクリプト（CSV同時出力対応）
v3: グローバル機種マスター辞書(machines_master.json)方式。

使い方:
    python convert_html_to_json.py [HTMLフォルダパス]

月別JSON構造（v3）:
    {
      "version": 3,
      "days": {
        "2026_08_19": {
          "u":   [881, 882, ...],   # 台番号
          "m":   [0, 1, ...],       # machines_master.json の id を直接参照
          "g":   [4140, 3578, ...],
          "d":   [-529, -948, ...],
          "bb":  [13, 9, ...],
          "rb":  [11, 10, ...],
          "art": [0, 0, ...]
        }
      }
    }

機種名 → id の対応は月別JSONではなく data/machines_master.json に
全期間共通で1つだけ保持する。新機種は追記専用でidを発行する。
既存のv1/v2形式の月別JSONに遭遇した場合、この場を借りてv3へ自動アップグレード
される（そのファイルがこの実行で更新対象になった場合のみ）。
このスクリプトが触らない過去の月ファイルを一括でv3化したい場合は、
別ファイルの migrate_to_master_dict.py を一度だけ実行すること。

確率4列（合成確率/BB確率/RB確率/ART確率）は保存しない。
フロントエンドで以下の式により算出する（分母0の場合は表示側で "-" 等にフォールバック）:
    合成確率 = G数 / (BB + RB)
    BB確率   = G数 / BB
    RB確率   = G数 / RB
    ART確率  = G数 / ART

CSV出力（converter/*.csv）はv1と完全に同じ形式（元の11列を文字列のまま）を維持する。
"""

import os
import sys
import glob
from pathlib import Path
from collections import defaultdict

import pandas as pd
import lxml.html

import pachislot_common as pc


# =========================================================
# ファイル探索
# =========================================================

def get_html_files(input_folder: str) -> list:
    if not os.path.exists(input_folder):
        return []
    return glob.glob(os.path.join(input_folder, "*.html"))


def parse_date_from_filename(filepath: str) -> tuple:
    stem = Path(filepath).stem
    date_part = stem.split()[0]

    parts = date_part.split('_')
    if len(parts) >= 3 and all(p.isdigit() for p in parts[:3]):
        date_key = f"{parts[0]}_{parts[1]}_{parts[2]}"
        year_month = f"{parts[0]}_{parts[1]}"
        return date_key, year_month

    return None, None


def group_html_files_by_month(html_files: list) -> dict:
    groups = defaultdict(list)

    for filepath in html_files:
        date_key, year_month = parse_date_from_filename(filepath)
        if date_key and year_month:
            groups[year_month].append({
                'filepath': filepath,
                'date_key': date_key
            })

    for year_month in groups:
        groups[year_month].sort(key=lambda x: x['date_key'])

    return dict(sorted(groups.items()))


# =========================================================
# HTML→DataFrame抽出
# =========================================================

def extract_table_from_html(filepath: str) -> pd.DataFrame:
    try:
        tree = lxml.html.parse(filepath)
        tables_with_id = tree.xpath('//table[@id]')

        if not tables_with_id:
            return None

        first_table_node = tables_with_id[0]
        target_table_html = lxml.html.tostring(first_table_node, encoding='unicode')

        dfs = pd.read_html(target_table_html)
        if dfs:
            return dfs[0]

        return None

    except Exception as e:
        print(f"    エラー: テーブル抽出失敗 - {e}")
        return None


# =========================================================
# DataFrame → 列指向データ（機種はmasterのidで直接記録）
# =========================================================

def dataframe_to_columnar(df: pd.DataFrame, master: dict, lookup: dict,
                           filename: str, anomalies: list) -> dict:
    col_map = pc.identify_columns(list(df.columns))
    missing = [k for k in pc.REQUIRED_KEYS if k not in col_map]
    if missing:
        raise ValueError(
            f"必須列が見つかりません: {missing} / 検出された列: {list(df.columns)}"
        )

    df = df.fillna('')

    day_cols = {'u': [], 'm': [], 'g': [], 'd': [], 'bb': [], 'rb': [], 'art': []}

    for idx, row in df.iterrows():
        ctx = {'file': filename, 'row': int(idx)}

        unit_val = pc.safe_int(row[col_map['unit']], {**ctx, 'col': '台番号'}, anomalies)
        m_id = pc.resolve_machine_id(row[col_map['machine']], master, lookup)
        games_val = pc.safe_int(row[col_map['games']], {**ctx, 'col': 'G数'}, anomalies)
        diff_val = pc.safe_int(row[col_map['diff']], {**ctx, 'col': '差枚'}, anomalies)
        bb_val = pc.safe_int(row[col_map['bb']], {**ctx, 'col': 'BB'}, anomalies)
        rb_val = pc.safe_int(row[col_map['rb']], {**ctx, 'col': 'RB'}, anomalies)
        art_val = pc.safe_int(row[col_map['art']], {**ctx, 'col': 'ART'}, anomalies)

        day_cols['u'].append(unit_val)
        day_cols['m'].append(m_id)
        day_cols['g'].append(games_val)
        day_cols['d'].append(diff_val)
        day_cols['bb'].append(bb_val)
        day_cols['rb'].append(rb_val)
        day_cols['art'].append(art_val)

    return day_cols


def save_csv(df: pd.DataFrame, csv_path: str) -> bool:
    try:
        df.to_csv(csv_path, index=False, encoding='utf-8-sig')
        return True
    except Exception as e:
        print(f"    エラー: CSV保存失敗 - {e}")
        return False


# =========================================================
# メイン変換処理
# =========================================================

def convert_html_to_json(input_folder: str) -> dict:
    data_dir = pc.get_data_dir()
    csv_dir = pc.get_csv_dir()

    if not os.path.exists(data_dir):
        print(f"エラー: dataディレクトリが見つかりません: {data_dir}")
        return {'success': False}

    html_files = get_html_files(input_folder)

    if not html_files:
        print("エラー: HTMLファイルが見つかりませんでした")
        return {'success': False}

    grouped = group_html_files_by_month(html_files)

    if not grouped:
        print("エラー: 有効な日付形式のHTMLファイルが見つかりませんでした")
        print("  期待する形式: YYYY_MM_DD *.html")
        return {'success': False}

    print(f"\n検出されたHTMLファイル: {len(html_files)}件")
    print(f"対象年月: {', '.join(grouped.keys())}")

    # マスター辞書は全期間・全月を通して1つだけ。ここで一度だけ読み込む。
    master = pc.load_master_dict()
    lookup = pc.build_name_lookup(master)
    master_machines_before = len(master['machines'])
    print(f"機種マスター辞書: {master_machines_before}件（既存）")

    stats = {
        'success': True,
        'total_files': len(html_files),
        'months_processed': [],
        'csv_created': 0,
        'csv_files': [],
        'json_updated': 0,
        'errors': 0,
        'anomalies_total': 0,
        'converted_html_files': []
    }

    for year_month, file_infos in grouped.items():
        print(f"\n{'='*50}")
        print(f"{year_month} の処理を開始 ({len(file_infos)}ファイル)")
        print('='*50)

        json_path = os.path.join(data_dir, f"{year_month}.json")

        raw_existing = pc.load_json_file(json_path) or {}
        anomalies = []
        days = pc.upgrade_month_data_to_v3(raw_existing, master, lookup, year_month, anomalies)
        existing_dates = set(days.keys())
        existing_day_count = len(days)

        if existing_day_count:
            version_before = pc.detect_month_json_version(raw_existing)
            if version_before != 3:
                print(f"  既存JSONはv{version_before}形式でした → v3へアップグレードします")
            print(f"  既存JSON: {existing_day_count}日分のデータ")

        new_count = 0
        update_count = 0

        for file_info in file_infos:
            filepath = file_info['filepath']
            date_key = file_info['date_key']
            filename = os.path.basename(filepath)

            print(f"\n  処理中: {filename}")

            df = extract_table_from_html(filepath)

            if df is None or df.empty:
                print(f"    ✗ データなし（スキップ）")
                stats['errors'] += 1
                continue

            # CSV保存（v1と同じ形式・全列そのまま）
            csv_path = os.path.join(csv_dir, f"{date_key}.csv")
            if save_csv(df, csv_path):
                print(f"    ✓ CSV保存: {date_key}.csv ({len(df)}件)")
                stats['csv_created'] += 1
                stats['csv_files'].append(csv_path)

            try:
                day_cols = dataframe_to_columnar(df, master, lookup, filename, anomalies)
            except ValueError as e:
                print(f"    ✗ 列認識エラー: {e}")
                stats['errors'] += 1
                continue

            row_count = len(day_cols['u'])

            if date_key in existing_dates:
                update_count += 1
                print(f"    ↻ JSON更新: {date_key} ({row_count}件)")
            else:
                new_count += 1
                print(f"    ✓ JSON追加: {date_key} ({row_count}件)")

            days[date_key] = day_cols
            stats['converted_html_files'].append(filepath)

        sorted_days = dict(sorted(days.items()))
        output_data = {'version': 3, 'days': sorted_days}

        if pc.save_json_file(output_data, json_path):
            stats['json_updated'] += 1

            file_size = os.path.getsize(json_path) / 1024
            print(f"\n  {year_month}.json 保存完了 (v3形式)")
            print(f"    総日数: {len(sorted_days)}日分")
            print(f"    - 既存維持: {existing_day_count - update_count}日")
            print(f"    - 新規追加: {new_count}日")
            print(f"    - 更新: {update_count}日")
            print(f"    ファイルサイズ: {file_size:.1f} KB")

            if anomalies:
                pc.write_anomaly_log(anomalies, year_month)
                stats['anomalies_total'] += len(anomalies)

            stats['months_processed'].append({
                'year_month': year_month,
                'total_days': len(sorted_days),
                'new': new_count,
                'updated': update_count,
                'anomalies': len(anomalies),
            })

    # マスター辞書は全月の処理が終わった後に一度だけ保存
    master_machines_after = len(master['machines'])
    if master_machines_after != master_machines_before:
        pc.save_master_dict(master)
        print(f"\n機種マスター辞書を更新しました: {master_machines_before}件 → {master_machines_after}件")
    else:
        print(f"\n機種マスター辞書に変更はありませんでした（{master_machines_after}件）")

    return stats


# =========================================================
# 後処理（HTML削除・CSV削除・files.json更新）
# =========================================================

def delete_converted_html_files(html_files: list):
    if not html_files:
        print("\n削除対象のHTMLファイルはありません")
        return

    print(f"\n変換元のHTMLファイルを削除しますか？")
    print(f"対象: {len(html_files)}ファイル")

    if len(html_files) <= 10:
        for f in html_files:
            print(f"  - {os.path.basename(f)}")
    else:
        for f in html_files[:5]:
            print(f"  - {os.path.basename(f)}")
        print(f"  ... (他 {len(html_files) - 10}件)")
        for f in html_files[-5:]:
            print(f"  - {os.path.basename(f)}")

    response = input("\n削除する場合は 'yes' と入力: ").strip().lower()

    if response == 'yes':
        deleted = 0
        for filepath in html_files:
            try:
                os.remove(filepath)
                deleted += 1
            except Exception as e:
                print(f"  エラー: {os.path.basename(filepath)} - {e}")
        print(f"削除完了: {deleted}ファイル")
    else:
        print("削除をスキップしました")


def delete_csv_files(csv_files: list):
    if not csv_files:
        return

    print(f"\n作成したCSVファイルを削除しますか？")
    print(f"対象: {len(csv_files)}ファイル")

    response = input("削除する場合は 'yes' と入力: ").strip().lower()

    if response == 'yes':
        deleted = 0
        for filepath in csv_files:
            try:
                os.remove(filepath)
                deleted += 1
            except Exception as e:
                print(f"  エラー: {os.path.basename(filepath)} - {e}")
        print(f"削除完了: {deleted}ファイル")
    else:
        print("CSVファイルを保持しました")


def update_files_json():
    data_dir = pc.get_data_dir()
    files_json_path = pc.get_files_json_path()

    json_files = glob.glob(os.path.join(data_dir, "*.json"))

    monthly_files = []

    for filepath in sorted(json_files):
        filename = os.path.basename(filepath)
        if filename == 'machines_master.json':
            continue
        parts = filename.replace('.json', '').split('_')

        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            relative_path = f"data/{filename}"
            monthly_files.append(relative_path)

    monthly_files.sort(reverse=True)

    files_data = {
        "monthly": monthly_files
    }

    try:
        with open(files_json_path, 'w', encoding='utf-8') as f:
            import json
            json.dump(files_data, f, ensure_ascii=False, indent=2)

        print(f"\nfiles.json を更新しました")
        print(f"  月別JSON: {len(monthly_files)}ファイル")

    except Exception as e:
        print(f"\nエラー: files.json の更新に失敗 - {e}")


def show_summary(stats: dict):
    print("\n" + "="*50)
    print("変換完了サマリー")
    print("="*50)
    print(f"処理HTMLファイル: {stats['total_files']}件")
    print(f"作成CSV: {stats['csv_created']}件")
    print(f"更新JSON: {stats['json_updated']}件")
    if stats['errors'] > 0:
        print(f"エラー: {stats['errors']}件")
    if stats.get('anomalies_total'):
        print(f"異常値（0埋め対応）: {stats['anomalies_total']}件 ※各月のanomalies_*.logを確認してください")

    if stats['months_processed']:
        print("\n月別詳細:")
        for m in stats['months_processed']:
            print(f"  {m['year_month']}: {m['total_days']}日分 "
                  f"(新規{m['new']}, 更新{m['updated']}, 異常値{m['anomalies']}件)")


def main():
    print("="*60)
    print("HTML → JSON 統合変換スクリプト (v3: 機種マスター辞書方式)")
    print("="*60)

    data_dir = pc.get_data_dir()
    csv_dir = pc.get_csv_dir()

    if not os.path.exists(data_dir):
        print(f"\nエラー: dataディレクトリが見つかりません")
        print(f"  期待パス: {data_dir}")
        sys.exit(1)

    print(f"\nJSON出力先: {data_dir}")
    print(f"CSV出力先: {csv_dir}")
    print(f"機種マスター辞書: {pc.get_master_dict_path()}")

    if len(sys.argv) > 1:
        input_folder = sys.argv[1]
    else:
        print("\nHTMLファイルが格納されているフォルダのパスを入力してください")
        print("例: C:/Downloads/html_data")
        input_folder = input("\nパス: ").strip()
        input_folder = input_folder.strip('"\'')

    if not os.path.exists(input_folder):
        print(f"\nエラー: 指定されたパスが存在しません")
        print(f"  入力: {input_folder}")
        sys.exit(1)

    if not os.path.isdir(input_folder):
        print(f"\nエラー: 指定されたパスはディレクトリではありません")
        sys.exit(1)

    print(f"HTML入力元: {input_folder}")

    stats = convert_html_to_json(input_folder)

    if not stats.get('success'):
        sys.exit(1)

    show_summary(stats)

    if stats.get('converted_html_files'):
        delete_converted_html_files(stats['converted_html_files'])

    if stats.get('csv_files'):
        delete_csv_files(stats['csv_files'])

    print("\nfiles.json を更新しますか？")
    response = input("更新する場合は 'yes' と入力: ").strip().lower()

    if response == 'yes':
        update_files_json()

    print("\n処理が完了しました")


if __name__ == '__main__':
    main()

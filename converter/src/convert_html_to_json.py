#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HTMLファイルを月別JSON(v2: 列指向+機種名グローバル辞書)に統合するスクリプト

使い方:
    python convert_html_to_json.py [HTMLフォルダパス]

例:
    python convert_html_to_json.py C:/Downloads/html_data
    → 指定フォルダ内の YYYY_MM_DD *.html を読み込んで
      data/YYYY_MM.json (v2形式) を生成/更新

    python convert_html_to_json.py
    → 対話形式でHTMLフォルダを指定

機能:
    - HTMLテーブルを読み込み、列指向+機種名辞書形式のJSONに変換
    - 既存のJSON(v2)がある場合、機種名辞書は追記のみ（既存IDは変更しない）
    - 同じ日付のデータがある場合はHTMLで上書き
    - 変換後のHTMLファイル削除オプション
    - files.json の自動更新

注意:
    このスクリプトはv2形式のJSONを前提としています。
    旧形式(行指向)のJSONが残っている場合は、先に
    migrate_to_columnar.py を実行して変換しておいてください。
"""

import os
import sys
import json
import glob
from pathlib import Path
from collections import defaultdict

import pandas as pd
import lxml.html


NEEDED_FIELDS = ['機種名', '台番号', 'G数', '差枚', 'BB', 'RB', 'ART']


def get_script_dir() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def get_data_dir() -> str:
    """dataディレクトリのパスを取得（converter/src から2階層上 → public/data）"""
    script_dir = get_script_dir()
    project_root = os.path.dirname(os.path.dirname(script_dir))
    return os.path.join(project_root, 'public', 'data')

def get_files_json_path() -> str:
    script_dir = get_script_dir()
    parent_dir = os.path.dirname(script_dir)
    return os.path.join(parent_dir, 'files.json')


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
            groups[year_month].append({'filepath': filepath, 'date_key': date_key})
    for year_month in groups:
        groups[year_month].sort(key=lambda x: x['date_key'])
    return dict(sorted(groups.items()))


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


def to_int(raw) -> int:
    if isinstance(raw, bool):
        raise ValueError(f"bool型は想定外: {raw}")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float):
        return int(raw)
    s = str(raw).strip().replace(',', '')
    return int(s)


def build_day_cols(df: pd.DataFrame, machines: list, machine_index: dict) -> dict:
    """
    DataFrame1日分を、共有machines辞書を参照するcols形式に変換する。
    machines / machine_index は呼び出し元で保持され、未登場の機種名は
    末尾に追記される（既存IDは変更しない）。
    """
    missing = [c for c in NEEDED_FIELDS if c not in df.columns]
    if missing:
        raise ValueError(f"必要な列が見つかりません: {missing}")

    cols = {'u': [], 'm': [], 'g': [], 'd': [], 'bb': [], 'rb': [], 'art': []}

    for _, row in df.iterrows():
        name = str(row['機種名']).strip()
        if name in machine_index:
            mid = machine_index[name]
        else:
            mid = len(machines)
            machines.append(name)
            machine_index[name] = mid

        cols['u'].append(to_int(row['台番号']))
        cols['m'].append(mid)
        cols['g'].append(to_int(row['G数']))
        cols['d'].append(to_int(row['差枚']))
        cols['bb'].append(to_int(row['BB']))
        cols['rb'].append(to_int(row['RB']))
        cols['art'].append(to_int(row['ART']))

    return cols


def load_existing_month_json(json_path: str) -> dict:
    """v2形式の月JSONを読み込む。存在しなければ空のv2構造を返す。"""
    if not os.path.exists(json_path):
        return {'schema': 'v2', 'machines': [], 'dates': {}}

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"    警告: 既存JSONの読み込みに失敗 - {e}")
        return {'schema': 'v2', 'machines': [], 'dates': {}}

    if not isinstance(data, dict) or data.get('schema') != 'v2' or 'dates' not in data:
        raise RuntimeError(
            f"{json_path} は旧形式(v1)のようです。"
            f"先に migrate_to_columnar.py を実行して変換してください。"
        )

    data.setdefault('machines', [])
    data.setdefault('dates', {})
    return data


def save_json(data: dict, json_path: str) -> bool:
    """
    辞書をJSONとして保存（折衷フォーマット）
    - トップレベル(schema, machines)は改行して可読性を残す
    - dates以下は日付1件につき1行にコンパクトにまとめる
    """
    try:
        lines = [
            '{',
            f'  "schema": {json.dumps(data["schema"], ensure_ascii=False)},',
            f'  "machines": {json.dumps(data["machines"], ensure_ascii=False, separators=(",", ":"))},',
            '  "dates": {',
        ]

        date_entries = []
        for date_key in sorted(data['dates'].keys()):
            day = data['dates'][date_key]
            cols = day['cols']
            cols_str = '{' + ','.join(
                f'"{col}":{json.dumps(cols[col], separators=(",", ":"))}'
                for col in ['u', 'm', 'g', 'd', 'bb', 'rb', 'art']
            ) + '}'
            entry = (
                f'    {json.dumps(date_key, ensure_ascii=False)}:'
                f'{{"count":{day["count"]},"cols":{cols_str}}}'
            )
            date_entries.append(entry)

        body = ',\n'.join(date_entries)

        full_text = '\n'.join(lines) + '\n'
        if body:
            full_text += body + '\n'
        full_text += '  }\n'
        full_text += '}\n'

        with open(json_path, 'w', encoding='utf-8') as f:
            f.write(full_text)
        return True
    except Exception as e:
        print(f"    エラー: JSON保存失敗 - {e}")
        return False


def convert_html_to_json(input_folder: str) -> dict:
    data_dir = get_data_dir()

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

    stats = {
        'success': True,
        'total_files': len(html_files),
        'months_processed': [],
        'json_updated': 0,
        'errors': 0,
        'converted_html_files': [],
    }

    for year_month, file_infos in grouped.items():
        print(f"\n{'='*50}")
        print(f"{year_month} の処理を開始 ({len(file_infos)}ファイル)")
        print('='*50)

        json_path = os.path.join(data_dir, f"{year_month}.json")

        try:
            month_data = load_existing_month_json(json_path)
        except RuntimeError as e:
            print(f"  ✗ {e}")
            stats['errors'] += 1
            continue

        machines = month_data['machines']
        machine_index = {name: i for i, name in enumerate(machines)}
        dates = month_data['dates']

        print(f"  既存: {len(dates)}日分 / 機種{len(machines)}種")

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

            try:
                cols = build_day_cols(df, machines, machine_index)
            except Exception as e:
                print(f"    ✗ 変換失敗: {e}")
                stats['errors'] += 1
                continue

            if date_key in dates:
                update_count += 1
                print(f"    ↻ JSON更新: {date_key} ({len(df)}件)")
            else:
                new_count += 1
                print(f"    ✓ JSON追加: {date_key} ({len(df)}件)")

            dates[date_key] = {'count': len(df), 'cols': cols}
            stats['converted_html_files'].append(filepath)

        month_data['dates'] = dict(sorted(dates.items()))
        month_data['machines'] = machines

        if save_json(month_data, json_path):
            stats['json_updated'] += 1
            file_size = os.path.getsize(json_path) / 1024
            print(f"\n  {year_month}.json 保存完了")
            print(f"    総日数: {len(month_data['dates'])}日分 / 機種{len(machines)}種")
            print(f"    - 新規追加: {new_count}日")
            print(f"    - 更新: {update_count}日")
            print(f"    ファイルサイズ: {file_size:.1f} KB")

            stats['months_processed'].append({
                'year_month': year_month,
                'total_days': len(month_data['dates']),
                'new': new_count,
                'updated': update_count,
            })

    return stats


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


def update_files_json():
    data_dir = get_data_dir()
    files_json_path = get_files_json_path()

    json_files = glob.glob(os.path.join(data_dir, "*.json"))
    monthly_files = []

    for filepath in sorted(json_files):
        filename = os.path.basename(filepath)
        parts = filename.replace('.json', '').split('_')
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            monthly_files.append(f"data/{filename}")

    monthly_files.sort(reverse=True)

    files_data = {"monthly": monthly_files}

    try:
        with open(files_json_path, 'w', encoding='utf-8') as f:
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
    print(f"更新JSON: {stats['json_updated']}件")
    if stats['errors'] > 0:
        print(f"エラー: {stats['errors']}件")

    if stats['months_processed']:
        print("\n月別詳細:")
        for m in stats['months_processed']:
            print(f"  {m['year_month']}: {m['total_days']}日分 "
                  f"(新規{m['new']}, 更新{m['updated']})")


def main():
    print("="*60)
    print("HTML → JSON(v2) 統合変換スクリプト")
    print("="*60)

    data_dir = get_data_dir()

    if not os.path.exists(data_dir):
        print(f"\nエラー: dataディレクトリが見つかりません")
        print(f"  期待パス: {data_dir}")
        sys.exit(1)

    print(f"\nJSON出力先: {data_dir}")

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

    print("\nfiles.json を更新しますか？")
    response = input("更新する場合は 'yes' と入力: ").strip().lower()

    if response == 'yes':
        update_files_json()

    print("\n処理が完了しました")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
既存の行指向 data/YYYY_MM.json を列指向＋機種名グローバル辞書形式(v2)に
一括移行するスクリプト。

実行前に自動でバックアップフォルダを作成してから変換します。

使い方:
    python migrate_to_columnar.py
"""

import os
import sys
import json
import glob
import shutil
import datetime


def get_script_dir() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def get_data_dir() -> str:
    """dataディレクトリのパスを取得（converter/src から2階層上 → public/data）"""
    script_dir = get_script_dir()
    project_root = os.path.dirname(os.path.dirname(script_dir))
    return os.path.join(project_root, 'public', 'data')


NEEDED_FIELDS = ['機種名', '台番号', 'G数', '差枚', 'BB', 'RB', 'ART']


def to_int(raw) -> int:
    """文字列/数値を確実にintへ変換する"""
    if isinstance(raw, bool):
        raise ValueError(f"bool型は想定外: {raw}")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float):
        return int(raw)
    s = str(raw).strip().replace(',', '')
    return int(s)


def is_monthly_json(filename: str) -> bool:
    """ファイル名が YYYY_MM.json 形式かを判定"""
    parts = filename.replace('.json', '').split('_')
    return len(parts) == 2 and all(p.isdigit() for p in parts)


def backup_data_dir(data_dir: str) -> str:
    """dataディレクトリ全体をタイムスタンプ付きでバックアップ"""
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    parent_dir = os.path.dirname(data_dir)
    backup_dir = os.path.join(parent_dir, f'data_backup_v1_{timestamp}')
    shutil.copytree(data_dir, backup_dir)
    return backup_dir


def convert_day_records(old_records: list) -> dict:
    """
    旧形式の1日分レコード(dictのlist、全フィールド文字列)を
    機種名付きのcols形式に変換する（機種IDはまだ割り振らない）。
    """
    cols = {'u': [], 'm_name': [], 'g': [], 'd': [], 'bb': [], 'rb': [], 'art': []}

    for rec in old_records:
        missing = [f for f in NEEDED_FIELDS if f not in rec]
        if missing:
            raise ValueError(f"必要なフィールドが不足: {missing} / record={rec}")

        cols['u'].append(to_int(rec['台番号']))
        cols['m_name'].append(str(rec['機種名']).strip())
        cols['g'].append(to_int(rec['G数']))
        cols['d'].append(to_int(rec['差枚']))
        cols['bb'].append(to_int(rec['BB']))
        cols['rb'].append(to_int(rec['RB']))
        cols['art'].append(to_int(rec['ART']))

    return cols

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


def migrate_month_file(json_path: str) -> dict:
    """1つの月ファイルを旧形式→v2形式に変換して上書き保存する"""
    with open(json_path, 'r', encoding='utf-8') as f:
        old_data = json.load(f)

    if isinstance(old_data, dict) and old_data.get('schema') == 'v2':
        return {'skipped': True}

    machines = []
    machine_index = {}
    dates = {}
    total_records = 0

    for date_key in sorted(old_data.keys()):
        old_records = old_data[date_key]
        cols_with_names = convert_day_records(old_records)

        m_ids = []
        for name in cols_with_names['m_name']:
            if name in machine_index:
                m_ids.append(machine_index[name])
            else:
                mid = len(machines)
                machines.append(name)
                machine_index[name] = mid
                m_ids.append(mid)

        dates[date_key] = {
            'count': len(old_records),
            'cols': {
                'u': cols_with_names['u'],
                'm': m_ids,
                'g': cols_with_names['g'],
                'd': cols_with_names['d'],
                'bb': cols_with_names['bb'],
                'rb': cols_with_names['rb'],
                'art': cols_with_names['art'],
            }
        }
        total_records += len(old_records)

    new_data = {'schema': 'v2', 'machines': machines, 'dates': dates}

    old_size = os.path.getsize(json_path)
    save_json(new_data, json_path)
    new_size = os.path.getsize(json_path)

    return {
        'skipped': False,
        'dates': len(dates),
        'machines': len(machines),
        'records': total_records,
        'old_size': old_size,
        'new_size': new_size,
    }


def main():
    data_dir = get_data_dir()
    if not os.path.exists(data_dir):
        print(f"エラー: dataディレクトリが見つかりません: {data_dir}")
        sys.exit(1)

    json_files = sorted(glob.glob(os.path.join(data_dir, '*.json')))
    json_files = [f for f in json_files if is_monthly_json(os.path.basename(f))]

    if not json_files:
        print("対象のJSONファイルが見つかりませんでした")
        sys.exit(1)

    print(f"対象ファイル: {len(json_files)}件")
    for f in json_files:
        print(f"  - {os.path.basename(f)}")

    print("\nバックアップを作成しています...")
    backup_dir = backup_data_dir(data_dir)
    print(f"バックアップ完了: {backup_dir}")

    total_old = 0
    total_new = 0
    total_records = 0
    errors = []

    for filepath in json_files:
        filename = os.path.basename(filepath)
        print(f"\n処理中: {filename}")
        try:
            result = migrate_month_file(filepath)
        except Exception as e:
            print(f"  ✗ エラー: {e}")
            errors.append((filename, str(e)))
            continue

        if result.get('skipped'):
            print(f"  スキップ（既にv2形式）")
            continue

        total_old += result['old_size']
        total_new += result['new_size']
        total_records += result['records']

        reduction = (1 - result['new_size'] / result['old_size']) * 100 if result['old_size'] else 0
        print(f"  ✓ 完了: {result['dates']}日分, 機種{result['machines']}種, "
              f"{result['records']}レコード")
        print(f"    サイズ: {result['old_size']/1024:.1f}KB → "
              f"{result['new_size']/1024:.1f}KB ({reduction:.1f}%削減)")

    print("\n" + "=" * 50)
    print("移行完了サマリー")
    print("=" * 50)
    print(f"処理レコード数: {total_records}件")
    if total_old:
        overall_reduction = (1 - total_new / total_old) * 100
        print(f"総サイズ: {total_old/1024/1024:.2f}MB → "
              f"{total_new/1024/1024:.2f}MB ({overall_reduction:.1f}%削減)")

    if errors:
        print(f"\nエラー: {len(errors)}件")
        for filename, msg in errors:
            print(f"  - {filename}: {msg}")
        print("\n※ エラーが発生したファイルは変換されていません。")
        print(f"  バックアップ: {backup_dir}")
        sys.exit(1)
    else:
        print(f"\n全ファイルの変換が完了しました。")
        print(f"バックアップ（旧形式）: {backup_dir}")


if __name__ == '__main__':
    main()

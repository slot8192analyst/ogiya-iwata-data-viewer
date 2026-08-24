    #!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert_html_to_json.py / migrate_to_master_dict.py の共有ロジック。

機種名の正規化・列名判定・数値の安全なキャスト・マスター辞書の読み書きは
両スクリプトで完全に同一のルールで動作する必要があるため、ここに集約する。
片方だけロジックを変更してズレが生じると、マスター辞書に重複登録が起きる
などの静かな不整合につながるため、変更は必ずこのファイルに対して行うこと。
"""

import os
import re
import sys
import json
import unicodedata


# =========================================================
# パス関連
# =========================================================

def get_script_dir() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    else:
        return os.path.dirname(os.path.abspath(__file__))


def get_data_dir() -> str:
    script_dir = get_script_dir()
    parent_dir = os.path.dirname(script_dir)
    return os.path.join(parent_dir, 'data')


def get_csv_dir() -> str:
    return get_script_dir()


def get_files_json_path() -> str:
    script_dir = get_script_dir()
    parent_dir = os.path.dirname(script_dir)
    return os.path.join(parent_dir, 'files.json')


def get_master_dict_path() -> str:
    """全期間で共有する機種マスター辞書のパス"""
    return os.path.join(get_data_dir(), 'machines_master.json')


def get_anomaly_log_path(label: str) -> str:
    """異常値ログの出力パス（converterディレクトリ配下）"""
    return os.path.join(get_csv_dir(), f"anomalies_{label}.log")


# =========================================================
# 列名マッピング・正規化
# =========================================================

PROBABILITY_ALIASES = ['合成確率', 'bb確率', 'rb確率', 'art確率']

BASE_ALIASES = {
    'unit':    ['台番号', '台番', 'no.', 'no'],
    'machine': ['機種名', '機種'],
    'games':   ['g数', 'ｇ数', 'ゲーム数'],
    'diff':    ['差枚数', '差枚', '差玉'],
    'bb':      ['bb回数', 'bb'],
    'rb':      ['rb回数', 'rb'],
    'art':     ['art回数', 'art'],
}

REQUIRED_KEYS = ['unit', 'machine', 'games', 'diff', 'bb', 'rb', 'art']


def identify_columns(columns: list) -> dict:
    """
    DataFrameの列名（またはレガシーJSONのdictキー）から
    unit/machine/games/diff/bb/rb/art の実カラム名を特定する。
    確率4列は先に除外し、"BB確率"が"BB"に誤マッチしないようにする。
    """
    normalized = {c: str(c).strip().lower() for c in columns}

    prob_cols = set()
    for c, name in normalized.items():
        if any(alias in name for alias in PROBABILITY_ALIASES):
            prob_cols.add(c)

    result = {}
    used = set()

    for key, aliases in BASE_ALIASES.items():
        for c, name in normalized.items():
            if c in used or c in prob_cols:
                continue
            if name in aliases:
                result[key] = c
                used.add(c)
                break

    for key, aliases in BASE_ALIASES.items():
        if key in result:
            continue
        for c, name in normalized.items():
            if c in used or c in prob_cols:
                continue
            if any(alias in name for alias in aliases):
                result[key] = c
                used.add(c)
                break

    return result


def normalize_machine_name(name) -> str:
    """
    機種名の表記揺れ（全角半角混在・前後空白・連続空白）を吸収する。
    マスター辞書のキーとして使うため、必ずこの関数を通してから比較・登録する。
    """
    if name is None:
        return ''
    s = str(name)
    s = unicodedata.normalize('NFKC', s)
    s = s.strip()
    s = re.sub(r'\s+', ' ', s)
    return s


def safe_int(value, ctx: dict, anomalies: list) -> int:
    """
    数値5列（G数/差枚/BB/RB/ART）および台番号を安全にintへ変換する。
    パース失敗時は0にフォールバックし、anomaliesへ記録する（行は削除しない）。
    """
    if value is None:
        anomalies.append({**ctx, 'value': repr(value), 'reason': 'None'})
        return 0

    s = str(value).strip()
    if s == '' or s.lower() == 'nan':
        anomalies.append({**ctx, 'value': repr(value), 'reason': 'empty'})
        return 0

    s2 = s.replace(',', '').replace('，', '')
    try:
        return int(float(s2))
    except (ValueError, TypeError):
        anomalies.append({**ctx, 'value': repr(value), 'reason': 'unparsable'})
        return 0


# =========================================================
# マスター辞書（グローバル機種辞書）
# =========================================================

def new_empty_master() -> dict:
    return {'version': 1, 'machines': [], 'next_id': 0}


def load_master_dict() -> dict:
    """
    機種マスター辞書を読み込む。存在しない場合は空の辞書を返す
    （初回実行時に新規作成されるケースを想定）。
    """
    path = get_master_dict_path()
    if not os.path.exists(path):
        return new_empty_master()
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if 'machines' not in data or 'next_id' not in data:
            print(f"    警告: machines_master.jsonの形式が不正なため初期化します")
            return new_empty_master()
        return data
    except Exception as e:
        print(f"    警告: machines_master.jsonの読み込みに失敗 - {e}")
        return new_empty_master()


def save_master_dict(master: dict) -> bool:
    path = get_master_dict_path()
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(master, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"    エラー: machines_master.jsonの保存に失敗 - {e}")
        return False


def build_name_lookup(master: dict) -> dict:
    """
    name / aliases のどちらからでも id を逆引きできるルックアップ表を作る。
    以後の resolve_machine_id はこのlookupを使い回すこと
    （呼び出しごとに再構築すると、同一実行内での新規追加が反映されない）。
    """
    lookup = {}
    for entry in master['machines']:
        lookup[entry['name']] = entry['id']
        for alias in entry.get('aliases', []):
            lookup[alias] = entry['id']
    return lookup


def resolve_machine_id(raw_name, master: dict, lookup: dict) -> int:
    """
    正規化した機種名からマスター辞書のidを取得する。
    未登録の場合は新規idを発行してmasterに追記する（追記専用。
    既存idの変更・削除・再利用は行わない）。
    """
    name = normalize_machine_name(raw_name)
    if name in lookup:
        return lookup[name]

    new_id = master['next_id']
    master['machines'].append({'id': new_id, 'name': name, 'aliases': []})
    master['next_id'] = new_id + 1
    lookup[name] = new_id
    return new_id


# =========================================================
# 汎用JSON読み書き
# =========================================================

def load_json_file(path: str):
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"    警告: JSON読み込み失敗 ({os.path.basename(path)}) - {e}")
        return None


def save_json_file(data, path: str) -> bool:
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"    エラー: JSON保存失敗 ({os.path.basename(path)}) - {e}")
        return False


def write_anomaly_log(anomalies: list, label: str):
    if not anomalies:
        return
    log_path = get_anomaly_log_path(label)
    try:
        with open(log_path, 'w', encoding='utf-8') as f:
            json.dump(anomalies, f, ensure_ascii=False, indent=2)
        print(f"    ⚠ 異常値ログを出力: {os.path.basename(log_path)} ({len(anomalies)}件)")
    except Exception as e:
        print(f"    警告: 異常値ログの出力に失敗 - {e}")


# =========================================================
# 月別JSONのバージョン判定・アップグレード
# =========================================================

def detect_month_json_version(raw) -> int:
    """
    月別JSONのバージョンを判定する。
    v1: {date_key: [ {列名: 値, ...}, ... ]}  ("version"キーを持たない)
    v2: {"version": 2, "machines": [...], "days": {...}}  (月ローカルindex)
    v3: {"version": 3, "days": {...}}  (masterのid直接参照)
    """
    if not isinstance(raw, dict) or not raw:
        return 1  # 空 or 形式不明はv1扱い（呼び出し側で空データとして処理される）
    if raw.get('version') == 3 and 'days' in raw:
        return 3
    if raw.get('version') == 2 and 'machines' in raw and 'days' in raw:
        return 2
    return 1


def upgrade_month_data_to_v3(raw, master: dict, lookup: dict,
                              source_label: str, anomalies: list) -> dict:
    """
    v1/v2/v3のいずれの月別JSONを受け取っても、v3形式の"days"辞書
    （台番号/機種master-id/G数/差枚/BB/RB/ARTの列指向）に統一して返す。
    機種名の解決は必ずresolve_machine_idを通し、masterへの追記も
    ここで発生する（呼び出し側でmaster/lookupを保持し続けること）。
    """
    version = detect_month_json_version(raw)

    if version == 3:
        return raw.get('days', {})

    if version == 2:
        local_machines = raw.get('machines', [])
        local_days = raw.get('days', {})

        # ローカルindex → masterのid への対応表を先に作る
        local_to_master = {}
        for local_idx, name in enumerate(local_machines):
            local_to_master[local_idx] = resolve_machine_id(name, master, lookup)

        new_days = {}
        for date_key, cols in local_days.items():
            new_days[date_key] = {
                'u': list(cols.get('u', [])),
                'm': [local_to_master.get(i, i) for i in cols.get('m', [])],
                'g': list(cols.get('g', [])),
                'd': list(cols.get('d', [])),
                'bb': list(cols.get('bb', [])),
                'rb': list(cols.get('rb', [])),
                'art': list(cols.get('art', [])),
            }
        return new_days

    # version == 1（レガシー: date_key -> レコードのリスト）
    days = {}
    if not isinstance(raw, dict):
        return days

    for date_key in sorted(raw.keys()):
        records = raw.get(date_key) or []
        if not records:
            days[date_key] = {'u': [], 'm': [], 'g': [], 'd': [], 'bb': [], 'rb': [], 'art': []}
            continue

        col_map = identify_columns(list(records[0].keys()))
        missing = [k for k in REQUIRED_KEYS if k not in col_map]
        if missing:
            print(f"    警告: 列を特定できませんでした({source_label}:{date_key}): {missing}")
            continue

        day_cols = {'u': [], 'm': [], 'g': [], 'd': [], 'bb': [], 'rb': [], 'art': []}
        for i, rec in enumerate(records):
            ctx = {'file': f'<legacy:{source_label}:{date_key}>', 'row': i}

            unit_val = safe_int(rec.get(col_map['unit']), {**ctx, 'col': '台番号'}, anomalies)
            m_id = resolve_machine_id(rec.get(col_map['machine']), master, lookup)
            games_val = safe_int(rec.get(col_map['games']), {**ctx, 'col': 'G数'}, anomalies)
            diff_val = safe_int(rec.get(col_map['diff']), {**ctx, 'col': '差枚'}, anomalies)
            bb_val = safe_int(rec.get(col_map['bb']), {**ctx, 'col': 'BB'}, anomalies)
            rb_val = safe_int(rec.get(col_map['rb']), {**ctx, 'col': 'RB'}, anomalies)
            art_val = safe_int(rec.get(col_map['art']), {**ctx, 'col': 'ART'}, anomalies)

            day_cols['u'].append(unit_val)
            day_cols['m'].append(m_id)
            day_cols['g'].append(games_val)
            day_cols['d'].append(diff_val)
            day_cols['bb'].append(bb_val)
            day_cols['rb'].append(rb_val)
            day_cols['art'].append(art_val)

        days[date_key] = day_cols

    return days

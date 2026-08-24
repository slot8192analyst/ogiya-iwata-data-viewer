#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
既存の月別JSON（v1: 日付→レコードのリスト形式 / v2: ローカル機種辞書形式）を
一括でv3形式（machines_master.json + 各月JSONのm配列がmasterのidを直接参照）
へ移行する、一度きりの実行を想定したスクリプト。

【重要】実行前に必ず data/ フォルダ全体をバックアップしてください。
このスクリプトは対象ファイルを直接上書きします（.bak を残しますが、
本番運用では別途バックアップを取ることを強く推奨します）。

使い方:
    python migrate_to_master_dict.py
    → 対話式でパスの入力を求める（ディレクトリまたは個別ファイルをスペース区切りで複数指定可）
      何も入力せずEnterするとデフォルトのdataディレクトリを対象にする。

    python migrate_to_master_dict.py path/to/dir
    python migrate_to_master_dict.py 2024_01.json 2024_02.json
    python migrate_to_master_dict.py data/ some_extra_dir/2024_03.json
    → コマンドライン引数でパスを直接指定する（ディレクトリとファイルの混在可、複数可）
"""

import os
import glob
import shlex
import shutil
import argparse

import pachislot_common as pc


def is_month_json_filename(filename: str) -> bool:
    """ファイル名が月別JSON（YYYY_MM.json）の命名規則に合っているか判定する"""
    if filename == 'machines_master.json':
        return False
    parts = filename.replace('.json', '').split('_')
    return len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit()


def resolve_target_files(paths: list) -> list:
    """
    指定されたパス（ディレクトリ or 個別ファイル）のリストから、
    実際に処理対象となる月別JSONファイルのパス一覧を組み立てる。
    ディレクトリが指定された場合はその直下の YYYY_MM.json をすべて対象にし、
    ファイルが指定された場合はそのファイル自体を対象にする（命名規則チェックあり）。
    """
    result = []
    seen = set()
    for p in paths:
        p = p.strip()
        if not p:
            continue
        if not os.path.exists(p):
            print(f"  ⚠ 指定されたパスが存在しません: {p}")
            continue
        if os.path.isdir(p):
            candidates = glob.glob(os.path.join(p, "*.json"))
            for c in sorted(candidates):
                if is_month_json_filename(os.path.basename(c)):
                    key = os.path.abspath(c)
                    if key not in seen:
                        result.append(c)
                        seen.add(key)
        elif os.path.isfile(p):
            filename = os.path.basename(p)
            if filename == 'machines_master.json':
                print(f"  ⚠ machines_master.json は対象外です: {p}")
                continue
            if not is_month_json_filename(filename):
                print(f"  ⚠ 命名規則（YYYY_MM.json）に一致しないためスキップ: {p}")
                continue
            key = os.path.abspath(p)
            if key not in seen:
                result.append(p)
                seen.add(key)
        else:
            print(f"  ⚠ ファイルでもディレクトリでもありません: {p}")
    return result


def prompt_for_paths() -> list:
    """対話式で移行対象のパスを入力してもらう"""
    print("\n移行対象のパスを入力してください。")
    print("  - ディレクトリを指定すると、その中の YYYY_MM.json をすべて対象にします")
    print("  - 個別のファイルパスを直接指定することもできます")
    print("  - 複数指定する場合はスペースで区切ってください（パスにスペースを含む場合は\"で囲む）")
    print(f"  - 何も入力せず Enter を押すとデフォルトのdataディレクトリを使います: {pc.get_data_dir()}")
    raw = input("\nパス: ").strip()
    if not raw:
        return [pc.get_data_dir()]
    try:
        return shlex.split(raw)
    except ValueError:
        return raw.split()


def main():
    parser = argparse.ArgumentParser(
        description="既存の月別JSON（v1/v2）をv3形式へ移行するスクリプト"
    )
    parser.add_argument(
        'paths',
        nargs='*',
        help="移行対象のディレクトリまたはファイルパス（複数指定可）。省略時は対話式で入力を求めます。"
    )
    args = parser.parse_args()

    print("=" * 60)
    print("machines_master.json 一括移行スクリプト（v1/v2 → v3）")
    print("=" * 60)

    input_paths = args.paths if args.paths else prompt_for_paths()

    month_files = resolve_target_files(input_paths)
    if not month_files:
        print("\n対象となる月別JSONが見つかりませんでした")
        return

    print(f"\n対象ファイル: {len(month_files)}件")
    for f in month_files:
        print(f"  - {f}")

    print(f"\nマスター辞書出力先: {pc.get_master_dict_path()}")
    print("\n※このスクリプトは対象ファイルを直接書き換えます。")
    print("※実行前に対象データのバックアップを取ることを強く推奨します。")
    response = input("\n移行を実行する場合は 'yes' と入力: ").strip().lower()
    if response != 'yes':
        print("移行を中止しました")
        return

    master = pc.load_master_dict()
    lookup = pc.build_name_lookup(master)
    master_before = len(master['machines'])

    migrated_count = 0
    skipped_count = 0
    total_anomalies = 0

    for filepath in month_files:
        filename = os.path.basename(filepath)
        label = filename.replace('.json', '')
        print(f"\n処理中: {filename}")

        raw = pc.load_json_file(filepath)
        if raw is None:
            print(f"  ✗ 読み込み失敗のためスキップ")
            skipped_count += 1
            continue

        version_before = pc.detect_month_json_version(raw)
        if version_before == 3:
            print(f"  スキップ（既にv3形式）")
            skipped_count += 1
            continue

        # 上書き前に .bak を残す（簡易バックアップ。本番バックアップの代替にはしないこと）
        backup_path = filepath + '.bak'
        if not os.path.exists(backup_path):
            shutil.copy2(filepath, backup_path)

        anomalies = []
        days = pc.upgrade_month_data_to_v3(raw, master, lookup, label, anomalies)

        output_data = {'version': 3, 'days': dict(sorted(days.items()))}

        if pc.save_json_file(output_data, filepath):
            print(f"  ✓ v{version_before} → v3 移行完了 "
                  f"({len(days)}日分, 異常値{len(anomalies)}件)")
            migrated_count += 1
            total_anomalies += len(anomalies)
            if anomalies:
                pc.write_anomaly_log(anomalies, f"migrate_{label}")
        else:
            print(f"  ✗ 保存に失敗しました")
            skipped_count += 1

    master_after = len(master['machines'])
    if master_after != master_before:
        pc.save_master_dict(master)

    print("\n" + "=" * 60)
    print("移行完了サマリー")
    print("=" * 60)
    print(f"移行成功: {migrated_count}ファイル")
    print(f"スキップ: {skipped_count}ファイル")
    print(f"異常値合計: {total_anomalies}件")
    print(f"機種マスター辞書: {master_before}件 → {master_after}件")
    print("\n各対象ファイルと同じ場所に *.json.bak として元データを残しています。")
    print("動作確認後、不要であれば削除してください。")


if __name__ == '__main__':
    main()

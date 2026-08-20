# -*- coding: utf-8 -*-
"""
数据源采集脚本（定时运行的第 1 步）
====================================
下载 LiteLLM 与 models 两个数据源，输出带日期快照，供 gen_two_tables.py 使用。

用法：
  python fetch_data_sources.py                      # 使用今天日期，下载两个数据源
  python fetch_data_sources.py --date 20260814      # 指定快照日期
  python fetch_data_sources.py --models-url <URL>   # 覆盖 models 数据源地址（直连 models.dev 超时时可换镜像）
  python fetch_data_sources.py --skip-models        # 只采集 LiteLLM

输出（工作区 data_snapshots/ 目录）：
  LiteLLM_model_prices_and_context_window_<date>.json
  models_providers_<date>.json
成功与否打印在 stdout，失败不中断（供后续判断）。
"""
import argparse
import datetime
import os
import sys
import urllib.request

LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
# models.dev 直连可能超时（网络限制），可通过 --models-url 替换为镜像/CDN 地址
MODELS_URL = "https://models.dev/api.json"

SNAP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_snapshots")


def fetch(url, dest, timeout=60):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "data-fetch/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        with open(dest, "wb") as f:
            f.write(data)
        return True, len(data)
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def main():
    ap = argparse.ArgumentParser(description="采集 LiteLLM 与 models 数据源快照")
    ap.add_argument("--date", default=datetime.date.today().strftime("%Y%m%d"),
                    help="快照日期，格式 YYYYMMDD（默认今天）")
    ap.add_argument("--models-url", default=MODELS_URL, help="models 数据源 URL（覆盖默认）")
    ap.add_argument("--litellm-url", default=LITELLM_URL, help="LiteLLM 数据源 URL（覆盖默认）")
    ap.add_argument("--skip-models", action="store_true", help="跳过 models 数据源采集")
    ap.add_argument("--skip-litellm", action="store_true", help="跳过 LiteLLM 数据源采集")
    args = ap.parse_args()

    os.makedirs(SNAP_DIR, exist_ok=True)
    results = {}

    if not args.skip_litellm:
        dest = os.path.join(SNAP_DIR, f"LiteLLM_model_prices_and_context_window_{args.date}.json")
        ok, info = fetch(args.litellm_url, dest)
        results["LiteLLM"] = (ok, info)
        print(f"[LiteLLM] {'OK' if ok else 'FAIL'} -> {dest} ({info})")

    if not args.skip_models:
        dest = os.path.join(SNAP_DIR, f"models_providers_{args.date}.json")
        ok, info = fetch(args.models_url, dest)
        results["models"] = (ok, info)
        print(f"[models] {'OK' if ok else 'FAIL'} -> {dest} ({info})")

    failed = [k for k, (ok, _) in results.items() if not ok]
    if failed:
        print("部分数据源采集失败:", ", ".join(failed))
        sys.exit(2)
    print("全部数据源采集完成，快照目录:", SNAP_DIR)


if __name__ == "__main__":
    main()

"""Run one OpenAI-compatible channel probe without persisting the API key.

The Node API pipes the request JSON to this helper.  Keeping the network call
in Python lets us explicitly control direct/proxy connections on Windows,
where Node's built-in fetch does not consistently honor HTTP_PROXY.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import asyncio
from typing import Any

import aiohttp


def number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def content_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict) and item.get("text") is not None:
                parts.append(str(item["text"]))
            elif item is not None:
                parts.append(str(item))
        return "".join(parts)
    return "" if value is None else str(value)


def endpoint_for(api_base: str) -> str:
    base = api_base.strip().rstrip("/")
    if base.lower().endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _error_payload(raw_text: str) -> dict[str, Any] | None:
    """Parse an OpenAI-compatible error body, including bodies with a stray prefix."""
    text = (raw_text or "").replace("\ufffd", "").strip()
    if not text:
        return None
    candidates = [text]
    start = text.find("{")
    if start > 0:
        candidates.append(text[start:])
    for candidate in candidates:
        try:
            payload = json.loads(candidate)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            return payload
    return None


def readable_http_error(status: int, raw_text: str, requested_model: str) -> str:
    """Turn an upstream JSON error into a short, actionable Chinese message."""
    payload = _error_payload(raw_text)
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        detail = str(error.get("message") or "").strip()
        error_code = str(error.get("code") or "").strip()
    elif isinstance(payload, dict):
        detail = str(payload.get("message") or "").strip()
        error_code = str(payload.get("code") or "").strip()
    else:
        detail = (raw_text or "").replace("\ufffd", "").strip()
        error_code = ""
    detail = re.sub(r"\s+", " ", detail).strip(" \r\n\t\"'")
    model_match = re.search(
        r"supported API model names are (?P<supported>.+?),?\s+but you passed (?P<passed>[^.]+)",
        detail,
        flags=re.IGNORECASE,
    )
    if model_match:
        supported = model_match.group("supported").strip(" .")
        passed = model_match.group("passed").strip(" .") or requested_model
        return f"模型名不受支持（HTTP {status}）：当前渠道支持 {supported}；本次提交 {passed}。请修改“测试模型”，或在“自定义模型名”中填写支持的名称。"
    if status == 401:
        return f"API Key 无效或已过期（HTTP {status}）。请检查密钥是否属于当前渠道。"
    if status == 403:
        return f"API Key 没有调用权限（HTTP {status}）。请确认账号权限、模型权限和渠道余额。"
    if status == 404:
        return f"接口地址不存在（HTTP {status}）。请检查 API Base，系统会在其后请求 /chat/completions。"
    if status == 429:
        return f"请求过于频繁或余额受限（HTTP {status}）。请稍后重试，或检查渠道限流和余额。"
    prefix = f"上游接口拒绝请求（HTTP {status}）"
    if error_code:
        prefix += f" [{error_code}]"
    return f"{prefix}：{detail or '渠道未返回具体原因。'}"


def empty_metrics(endpoint: str) -> dict[str, Any]:
    return {
        "ok": False,
        "endpoint": endpoint,
        "statusCode": None,
        "contentType": "",
        "ttfbMs": None,
        "ttftMs": None,
        "totalMs": None,
        "throughput": None,
        "peakThroughput": None,
        "peakTps": None,
        "tpsCurve": [],
        "itlMs": None,
        "outputTokens": None,
        "tokenCountSource": "未测量",
        "streamStability": "未测量",
        "successRate": 0,
        "errorRate": 100,
        "concurrency": "单请求",
        "rateLimit": "未触发",
        "costAccuracy": "未提供 usage",
        "protocol": "未知",
        "security": "HTTPS" if endpoint.lower().startswith("https://") else "HTTP 风险",
        "responseModel": None,
        "usage": None,
        "outputPreview": "",
        "connectionModeUsed": None,
    }


def parse_choice(payload: dict[str, Any]) -> tuple[str, str | None]:
    choices = payload.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return "", payload.get("model")
    choice = choices[0]
    delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}
    message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
    # Reasoning models may stream their first tokens in reasoning_content (or
    # reasoning/thinking) before content appears. Treat every textual delta as
    # output for timing purposes so TTFT is not left blank for those models.
    for value in (
        delta.get("content"),
        delta.get("reasoning_content"),
        delta.get("reasoning"),
        delta.get("thinking"),
        choice.get("text"),
        message.get("content"),
        message.get("reasoning_content"),
    ):
        text = content_text(value)
        if text:
            return text, payload.get("model")
    return "", payload.get("model")


async def perform_once(request: dict[str, Any], mode: str) -> dict[str, Any]:
    endpoint = endpoint_for(str(request.get("apiBase") or ""))
    metrics = empty_metrics(endpoint)
    started = time.perf_counter()
    proxy = str(request.get("proxy") or os.environ.get("HTTPS_PROXY") or "").strip()
    proxies = {"http": proxy, "https": proxy} if mode == "proxy" and proxy else None
    payload = {
        "model": str(request.get("model") or "").strip(),
        "messages": [{"role": "user", "content": str(request.get("prompt") or "请只回复：测试成功")}],
        "stream": True,
        "max_tokens": max(1, int(number(request.get("maxTokens")) or 32)),
        "temperature": 0,
    }
    headers = {
        "Authorization": f"Bearer {str(request.get('apiKey') or '').strip()}",
        "Accept": "text/event-stream, application/json",
        "Content-Type": "application/json",
        "User-Agent": "ModelLedger-ChannelCheck/1.0",
    }
    output: list[str] = []
    token_times: list[float] = []
    token_events: list[float] = []
    usage = None
    response_model = None
    first_token_at = None
    try:
        timeout = aiohttp.ClientTimeout(total=35, connect=10)
        async with aiohttp.ClientSession(trust_env=False) as session:
            async with session.post(
                endpoint,
                headers=headers,
                json=payload,
                proxy=proxy if mode == "proxy" and proxy else None,
                timeout=timeout,
            ) as response:
                ttfb_at = time.perf_counter()
                metrics["ttfbMs"] = round((ttfb_at - started) * 1000)
                metrics["statusCode"] = response.status
                metrics["contentType"] = response.headers.get("content-type", "")
                metrics["connectionModeUsed"] = mode
                metrics["rateLimit"] = "已触发" if response.status == 429 else "未触发"
                is_sse = "text/event-stream" in metrics["contentType"].lower()
                metrics["protocol"] = "SSE 兼容" if is_sse else "JSON 响应"
                if response.status < 200 or response.status >= 300:
                    error_text = (await response.text(errors="replace"))[:500].strip()
                    metrics["totalMs"] = round((time.perf_counter() - started) * 1000)
                    return {"ok": False, "message": readable_http_error(response.status, error_text, payload["model"]), "metrics": metrics}

                if is_sse:
                    buffer = ""
                    async for chunk in response.content.iter_chunked(4096):
                        buffer += chunk.decode("utf-8", errors="replace")
                        lines = buffer.splitlines(keepends=True)
                        buffer = lines.pop() if lines and not lines[-1].endswith(("\n", "\r")) else ""
                        for raw_line in lines:
                            line = raw_line.strip()
                            if not line or not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if not data or data == "[DONE]":
                                continue
                            try:
                                event = json.loads(data)
                            except json.JSONDecodeError:
                                continue
                            if event.get("usage"):
                                usage = event["usage"]
                            text, model_name = parse_choice(event)
                            response_model = response_model or model_name
                            if text:
                                now = time.perf_counter()
                                first_token_at = first_token_at or now
                                token_times.append(now)
                                # Chunk boundaries are not token boundaries. Use a
                                # conservative character estimate for the speed curve;
                                # the final count prefers the provider's usage field.
                                estimated_tokens = max(1, round(len(text) / 4))
                                token_events.extend([now] * estimated_tokens)
                                output.append(text)
                    if buffer.strip().startswith("data:"):
                        data = buffer.strip()[5:].strip()
                        if data and data != "[DONE]":
                            try:
                                event = json.loads(data)
                            except json.JSONDecodeError:
                                event = {}
                            if event.get("usage"):
                                usage = event["usage"]
                else:
                    try:
                        event = await response.json(content_type=None)
                    except (ValueError, json.JSONDecodeError):
                        event = {}
                    if isinstance(event, dict):
                        usage = event.get("usage")
                        text, response_model = parse_choice(event)
                        if text:
                            first_token_at = time.perf_counter()
                            token_events.extend([first_token_at] * max(1, round(len(text) / 4)))
                            output.append(text)

        ended = time.perf_counter()
        output_text = "".join(output)
        usage_tokens = number((usage or {}).get("completion_tokens"))
        if usage_tokens is not None:
            token_count = max(0, int(usage_tokens))
            token_count_source = "usage"
        elif output_text:
            token_count = max(1, round(len(output_text) / 4))
            token_count_source = "文本估算"
        else:
            token_count = None
            token_count_source = "未返回"
        metrics["ttftMs"] = round((first_token_at - started) * 1000) if first_token_at else None
        metrics["totalMs"] = round((ended - started) * 1000)
        metrics["throughput"] = round(token_count / max((ended - (first_token_at or ended)), 0.001), 2) if first_token_at else None
        metrics["outputTokens"] = int(token_count) if token_count is not None else None
        metrics["tokenCountSource"] = token_count_source
        metrics["itlMs"] = round(sum((b - a) * 1000 for a, b in zip(token_times, token_times[1:])) / (len(token_times) - 1)) if len(token_times) > 1 else None
        if token_events and first_token_at:
            offsets = [max(0.0, event - started) for event in token_events]
            curve_length = max(1, int((max(offsets) // 1000) + 1))
            tps_curve = [0] * curve_length
            for offset in offsets:
                bucket = min(curve_length - 1, int(offset // 1000))
                tps_curve[bucket] += 1
            metrics["tpsCurve"] = tps_curve
            metrics["peakTps"] = max(tps_curve)
            if len(token_events) > 1:
                window_size = min(10, len(token_events))
                peak_speed = 0.0
                for index in range(0, len(token_events) - window_size + 1):
                    duration = max(token_events[index + window_size - 1] - token_events[index], 0.05)
                    peak_speed = max(peak_speed, (window_size - 1) / duration)
                metrics["peakThroughput"] = round(peak_speed, 2)
        has_output = token_count is not None and token_count > 0
        metrics["ok"] = has_output
        metrics["successRate"] = 100 if has_output else 0
        metrics["errorRate"] = 0 if has_output else 100
        metrics["streamStability"] = "正常" if is_sse and first_token_at else ("无流式 token" if is_sse else "非流式响应")
        metrics["costAccuracy"] = "已返回 usage" if usage else "未提供 usage"
        metrics["responseModel"] = response_model
        metrics["usage"] = usage
        metrics["outputPreview"] = output_text[:500]
        return {
            "ok": has_output,
            "message": f"请求成功，读取到 {int(token_count)} 个输出 token" if has_output else "HTTP 请求成功，但没有读取到输出 token。渠道可能返回了空流，或使用了未兼容的流式字段。",
            "metrics": metrics,
        }
    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        metrics["totalMs"] = round((time.perf_counter() - started) * 1000)
        return {"ok": False, "message": f"{exc.__class__.__name__}: {str(exc)[:300]}", "metrics": metrics}


async def async_main() -> None:
    try:
        raw_request = sys.stdin.buffer.read().decode("utf-8")
        request = json.loads(raw_request)
    except Exception:
        # Keep the subprocess protocol ASCII-only on Windows; Node decodes stdout as UTF-8.
        print(json.dumps({"ok": False, "message": "检测请求不是有效 JSON"}, ensure_ascii=True))
        return
    mode = str(request.get("connectionMode") or "auto").strip().lower()
    modes = ["direct", "proxy"] if mode == "auto" else [mode if mode in {"direct", "proxy"} else "direct"]
    result = None
    for candidate in modes:
        result = await perform_once(request, candidate)
        if result.get("ok") or candidate == modes[-1] or result.get("metrics", {}).get("statusCode") is not None:
            break
    result = result or {"ok": False, "message": "未执行检测"}
    # Escaped Unicode is decoded back to normal text by JSON.parse in server.mjs.
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()

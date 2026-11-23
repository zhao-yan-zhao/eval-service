"""
F1 V4 常驻 Python 科学计算 Worker 进程 (stdin/stdout JSON-RPC)

职责：
1. 预加载 pandas / numpy / math / datetime（可选 shapely），消除每次执行的冷启动开销。
2. 逐行读取 JSON-RPC 请求（ping / execute），通过独立协议 stdout 返回单行 JSON 响应；
   执行期间严格重定向 sys.stdout / sys.stderr 至 StringIO 日志缓冲，防止脚本 print() 污染协议流。
3. AST 静态安全沙箱验证（validate_script_ast）：
   - 仅允许白名单科学计算模块；
   - 拦截 eval / exec / compile / open / __import__ / getattr / setattr / delattr / globals / locals / vars / dir 等危险调用；
   - 拦截双下划线 dunder 属性与标识符访问（__subclasses__ / __globals__ / __builtins__ / __class__ / __dict__ 等）。
4. 注入受限 __builtins__ 与统一数据契约变量（input_df_dict, prev_output_df, params, T, C, in_polygon），
   要求脚本产出 output_df (pandas.DataFrame)，并安全序列化为 TableDataset（含列类型推断与 NaN/NaT/NumPy 清洗）。
"""

from __future__ import annotations

import ast
import builtins as _py_builtins
import collections
import datetime
import functools
import io
import itertools
import json
import math
import os
import re
import statistics
import sys
import time
import traceback
import typing

import numpy as np
import pandas as pd

try:
    import shapely  # type: ignore
    from shapely import geometry as shapely_geometry  # type: ignore
except ImportError:
    shapely = None
    shapely_geometry = None


if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# 保存真实 JSON-RPC 通信流，防止用户脚本 print() 或 stderr 污染协议管道
PROTO_STDOUT = sys.stdout
PROTO_STDERR = sys.stderr

ALLOWED_MODULES: frozenset[str] = frozenset(
    {
        "pandas",
        "numpy",
        "math",
        "datetime",
        "time",
        "re",
        "json",
        "collections",
        "itertools",
        "functools",
        "statistics",
        "typing",
        "shapely",
        "shapely.geometry",
    }
)

DANGEROUS_MODULES: frozenset[str] = frozenset(
    {
        "os",
        "sys",
        "subprocess",
        "socket",
        "http",
        "urllib",
        "requests",
        "pathlib",
        "shutil",
        "importlib",
        "ctypes",
        "pickle",
        "builtins",
        "io",
        "posix",
        "nt",
        "pty",
        "threading",
        "multiprocessing",
        "signal",
        "inspect",
        "gc",
        "codecs",
        "marshal",
        "tempfile",
        "glob",
        "socketserver",
        "asyncio",
        "concurrent",
        "traceback",
        "_thread",
    }
)

BANNED_CALLS: frozenset[str] = frozenset(
    {
        "eval",
        "exec",
        "compile",
        "open",
        "__import__",
        "getattr",
        "setattr",
        "delattr",
        "globals",
        "locals",
        "vars",
        "dir",
        "breakpoint",
        "input",
        "exit",
        "quit",
        "memoryview",
        "help",
        "__build_class__",
    }
)

BANNED_ATTR_METHODS: frozenset[str] = frozenset(
    {
        "eval",
        "exec",
        "compile",
        "open",
        "__import__",
        "getattr",
        "setattr",
        "delattr",
        "globals",
        "locals",
        "vars",
        "dir",
        "breakpoint",
        "input",
        "exit",
        "quit",
        "system",
        "popen",
        "spawn",
        "fork",
        "read_csv",
        "read_excel",
        "read_json",
        "read_parquet",
        "read_pickle",
        "read_sql",
        "read_hdf",
        "read_feather",
        "read_table",
        "read_xml",
        "to_csv",
        "to_excel",
        "to_parquet",
        "to_pickle",
        "to_sql",
        "to_hdf",
        "to_feather",
        "to_xml",
    }
)

_PRELOADED_MODULES: dict[str, typing.Any] = {
    "pandas": pd,
    "numpy": np,
    "math": math,
    "datetime": datetime,
    "time": time,
    "re": re,
    "json": json,
    "collections": collections,
    "itertools": itertools,
    "functools": functools,
    "statistics": statistics,
    "typing": typing,
}
if shapely is not None:
    _PRELOADED_MODULES["shapely"] = shapely
if shapely_geometry is not None:
    _PRELOADED_MODULES["shapely.geometry"] = shapely_geometry


def _security_error(message: str) -> dict[str, typing.Any]:
    return {
        "valid": False,
        "status": "unavailable",
        "securityBlocked": True,
        "securityError": message,
        "error": message,
    }


def _validate_and_parse(code: str) -> tuple[dict[str, typing.Any], ast.Module | None]:
    if not isinstance(code, str):
        return (
            {
                "valid": False,
                "status": "unavailable",
                "securityBlocked": False,
                "securityError": None,
                "error": "Script code must be a string",
            },
            None,
        )

    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        return (
            {
                "valid": False,
                "status": "unavailable",
                "securityBlocked": False,
                "securityError": None,
                "error": f"SyntaxError: {exc.msg} (line {exc.lineno}, offset {exc.offset})",
            },
            None,
        )

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                mod = alias.name
                root_mod = mod.split(".")[0]
                if root_mod in DANGEROUS_MODULES:
                    return (
                        _security_error(
                            f"[SECURITY_VIOLATION] Dangerous import '{mod}' is blocked (line {node.lineno})"
                        ),
                        None,
                    )
                if mod not in ALLOWED_MODULES:
                    return (
                        _security_error(
                            f"[SECURITY_VIOLATION] Non-whitelisted import '{mod}' is blocked (line {node.lineno})"
                        ),
                        None,
                    )
        elif isinstance(node, ast.ImportFrom):
            if node.level != 0 or not node.module:
                return (
                    _security_error(
                        f"[SECURITY_VIOLATION] Relative import is blocked (line {node.lineno})"
                    ),
                    None,
                )
            mod = node.module
            root_mod = mod.split(".")[0]
            if root_mod in DANGEROUS_MODULES:
                return (
                    _security_error(
                        f"[SECURITY_VIOLATION] Dangerous import from '{mod}' is blocked (line {node.lineno})"
                    ),
                    None,
                )
            if mod not in ALLOWED_MODULES:
                return (
                    _security_error(
                        f"[SECURITY_VIOLATION] Non-whitelisted import from '{mod}' is blocked (line {node.lineno})"
                    ),
                    None,
                )
            for alias in node.names:
                if alias.name.startswith("_"):
                    return (
                        _security_error(
                            f"[SECURITY_VIOLATION] Private/dunder import '{alias.name}' from '{mod}' is blocked (line {node.lineno})"
                        ),
                        None,
                    )
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__"):
                return (
                    _security_error(
                        f"[SECURITY_VIOLATION] Dunder attribute access '.{node.attr}' is blocked (line {node.lineno})"
                    ),
                    None,
                )
            if node.attr in BANNED_ATTR_METHODS:
                return (
                    _security_error(
                        f"[SECURITY_VIOLATION] Banned attribute/method '.{node.attr}' is blocked (line {node.lineno})"
                    ),
                    None,
                )
        elif isinstance(node, ast.Name):
            if node.id in BANNED_CALLS:
                return (
                    _security_error(
                        f"[SECURITY_VIOLATION] Banned builtin/symbol '{node.id}' is blocked (line {node.lineno})"
                    ),
                    None,
                )
            if node.id.startswith("__"):
                return (
                    _security_error(
                        f"[SECURITY_VIOLATION] Dunder identifier '{node.id}' is blocked (line {node.lineno})"
                    ),
                    None,
                )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if node.name.startswith("__"):
                return (
                    _security_error(
                        f"[SECURITY_VIOLATION] Dunder definition '{node.name}' is blocked (line {node.lineno})"
                    ),
                    None,
                )

    return (
        {
            "valid": True,
            "status": "ok",
            "securityBlocked": False,
            "securityError": None,
            "error": None,
        },
        tree,
    )


def validate_script_ast(code: str) -> dict[str, typing.Any]:
    """公开 AST 安全审查入口：返回结构化验证结果（不执行脚本）。"""
    result, _ = _validate_and_parse(code)
    return result


def _safe_import(
    name: str,
    globals: dict[str, typing.Any] | None = None,
    locals: dict[str, typing.Any] | None = None,
    fromlist: tuple[str, ...] = (),
    level: int = 0,
) -> typing.Any:
    if level != 0:
        raise ImportError("[SECURITY_VIOLATION] Relative imports are blocked in sandbox")
    if name not in ALLOWED_MODULES:
        raise ImportError(f"[SECURITY_VIOLATION] Import of module '{name}' is not allowed in sandbox")
    if fromlist:
        for item in fromlist:
            if isinstance(item, str) and item.startswith("_"):
                raise ImportError(
                    f"[SECURITY_VIOLATION] Private import '{item}' from '{name}' is not allowed in sandbox"
                )
    if name not in _PRELOADED_MODULES:
        raise ImportError(f"No module named '{name}'")
    if name == "shapely.geometry" and not fromlist:
        return _PRELOADED_MODULES["shapely"]
    return _PRELOADED_MODULES[name]


BASE_SAFE_BUILTINS: dict[str, typing.Any] = {
    "__import__": _safe_import,
    "len": len,
    "range": range,
    "min": min,
    "max": max,
    "sum": sum,
    "abs": abs,
    "round": round,
    "sorted": sorted,
    "enumerate": enumerate,
    "zip": zip,
    "map": map,
    "filter": filter,
    "any": any,
    "all": all,
    "int": int,
    "float": float,
    "str": str,
    "bool": bool,
    "list": list,
    "dict": dict,
    "set": set,
    "tuple": tuple,
    "isinstance": isinstance,
    "hasattr": hasattr,
    "next": next,
    "reversed": reversed,
    "iter": iter,
    "slice": slice,
    "pow": pow,
    "divmod": divmod,
    "repr": repr,
    "format": format,
    "frozenset": frozenset,
    "True": True,
    "False": False,
    "None": None,
    "Exception": Exception,
    "ValueError": ValueError,
    "TypeError": TypeError,
    "KeyError": KeyError,
    "IndexError": IndexError,
    "ZeroDivisionError": ZeroDivisionError,
    "RuntimeError": RuntimeError,
    "StopIteration": StopIteration,
    "LookupError": LookupError,
    "ArithmeticError": ArithmeticError,
    "AssertionError": AssertionError,
    "AttributeError": AttributeError,
    "NameError": NameError,
}


def _raw_to_dataframe(raw: typing.Any) -> pd.DataFrame:
    """将 { columns?, rows? } 或 Array<Record> 转换为 pandas.DataFrame。"""
    if raw is None:
        return pd.DataFrame()
    if isinstance(raw, pd.DataFrame):
        return raw.copy()
    if isinstance(raw, list):
        return pd.DataFrame(raw)
    if isinstance(raw, dict):
        raw_cols = raw.get("columns") or raw.get("schema") or []
        col_names: list[str] = []
        for col in raw_cols:
            if isinstance(col, str) and col:
                col_names.append(col)
            elif isinstance(col, dict) and col.get("name"):
                col_names.append(str(col["name"]))

        if "rows" in raw and isinstance(raw["rows"], list):
            rows = raw["rows"]
            if rows:
                df = pd.DataFrame(rows)
                for col_name in col_names:
                    if col_name not in df.columns:
                        df[col_name] = None
                if col_names:
                    ordered = [c for c in col_names if c in df.columns] + [
                        c for c in df.columns if c not in col_names
                    ]
                    df = df[ordered]
                return df
            return pd.DataFrame(columns=col_names)

        if not raw:
            return pd.DataFrame()
        if all(isinstance(v, list) for v in raw.values()):
            return pd.DataFrame(raw)
        return pd.DataFrame([raw])
    return pd.DataFrame()


def _build_input_df_dict(raw_dict: typing.Any) -> dict[str, pd.DataFrame]:
    result: dict[str, pd.DataFrame] = {}
    if not isinstance(raw_dict, dict):
        return result
    for raw_name, raw_val in raw_dict.items():
        df = _raw_to_dataframe(raw_val)
        key_str = str(raw_name).strip()
        base_key = key_str[:-4] if key_str.lower().endswith(".csv") else key_str
        csv_key = base_key + ".csv"
        result[base_key] = df
        result[csv_key] = df.copy()
    return result


_CSV_CACHE: collections.OrderedDict[
    tuple[str, str, int, tuple[str, ...]],
    pd.DataFrame,
] = collections.OrderedDict()
_CSV_CACHE_MAX_ENTRIES = 24

_CSV_TABLE_ALIASES: dict[str, tuple[str, ...]] = {
    "unitdamaged": ("damage",),
    "damage": ("unitdamaged",),
}


def _strip_csv_ext(name: str) -> str:
    clean = str(name).strip()
    return clean[:-4] if clean.lower().endswith(".csv") else clean


def _norm_table_key(name: str) -> str:
    return _strip_csv_ext(name).lower()


def _scan_csv_entries(csv_dir: str) -> list[os.DirEntry[str]]:
    entries: list[os.DirEntry[str]] = []
    with os.scandir(csv_dir) as it:
        for entry in it:
            if entry.is_file() and entry.name.lower().endswith(".csv"):
                entries.append(entry)
    return entries


def _resolve_csv_entry(
    entries: list[os.DirEntry[str]],
    table_name: str,
) -> os.DirEntry[str] | None:
    base_lower = _norm_table_key(table_name)
    if not base_lower:
        return None
    candidates = (base_lower, *_CSV_TABLE_ALIASES.get(base_lower, ()))

    for cand in candidates:
        exact_name = f"{cand}.csv"
        for entry in entries:
            if entry.name.lower() == exact_name:
                return entry

    for cand in candidates:
        suffix = f"_{cand}.csv"
        matched = [entry for entry in entries if entry.name.lower().endswith(suffix)]
        if matched:
            matched.sort(key=lambda e: e.name.lower())
            return matched[-1]

    return None


def _resolve_table_columns(
    table_columns: typing.Any,
    table_name: str,
) -> list[str] | None:
    if not isinstance(table_columns, dict) or not table_columns:
        return None
    base_name = _strip_csv_ext(table_name)
    base_lower = base_name.lower()

    raw_cols: typing.Any = None
    if base_name in table_columns:
        raw_cols = table_columns[base_name]
    elif f"{base_name}.csv" in table_columns:
        raw_cols = table_columns[f"{base_name}.csv"]
    else:
        for k, v in table_columns.items():
            if _norm_table_key(str(k)) == base_lower:
                raw_cols = v
                break

    if not isinstance(raw_cols, (list, tuple, set)):
        return None
    cleaned = [str(c).lstrip("\ufeff").strip() for c in raw_cols if str(c).strip()]
    return cleaned if cleaned else None


def _load_csv_with_cache(
    csv_dir: str,
    table_name: str,
    filepath: str,
    wanted_cols: list[str] | None = None,
) -> pd.DataFrame:
    st = os.stat(filepath)
    mtime_ns = int(st.st_mtime_ns)
    norm_wanted = tuple(sorted(set(wanted_cols))) if wanted_cols else ()
    cache_key = (
        os.path.normcase(os.path.abspath(csv_dir)),
        _norm_table_key(table_name),
        mtime_ns,
        norm_wanted,
    )

    cached = _CSV_CACHE.get(cache_key)
    if cached is not None:
        _CSV_CACHE.move_to_end(cache_key)
        return cached.copy()

    if st.st_size == 0:
        df = pd.DataFrame()
    else:
        try:
            if norm_wanted:
                hdr_df = pd.read_csv(filepath, encoding="utf-8-sig", nrows=0)
                wanted_set = set(norm_wanted)
                selected_raw = [
                    col
                    for col in hdr_df.columns
                    if str(col).lstrip("\ufeff").strip() in wanted_set
                ]
                if not selected_raw:
                    df = pd.DataFrame()
                else:
                    df = pd.read_csv(
                        filepath,
                        encoding="utf-8-sig",
                        usecols=selected_raw,
                        low_memory=False,
                    )
            else:
                df = pd.read_csv(filepath, encoding="utf-8-sig", low_memory=False)
            df.columns = [str(c).lstrip("\ufeff").strip() for c in df.columns]
        except pd.errors.EmptyDataError:
            df = pd.DataFrame()

    _CSV_CACHE[cache_key] = df
    _CSV_CACHE.move_to_end(cache_key)
    while len(_CSV_CACHE) > _CSV_CACHE_MAX_ENTRIES:
        _CSV_CACHE.popitem(last=False)

    return df.copy()


def in_polygon(x: typing.Any, y: typing.Any, poly: typing.Any) -> bool:
    """
    纯 Python 射线法点在多边形内判定（等价于 GeoSeries.within(Polygon)，边界不计入），
    匹配 metrics_calculation_guide.html 口径，零 shapely 强依赖。
    """
    if poly is None:
        return False
    try:
        n = len(poly)
    except TypeError:
        return False
    if n < 3:
        return False

    try:
        px = float(x)
        py = float(y)
    except (TypeError, ValueError):
        return False
    if not (math.isfinite(px) and math.isfinite(py)):
        return False

    pts: list[tuple[float, float]] = []
    for p in poly:
        try:
            if isinstance(p, dict):
                lon = p.get("lon", p.get("x"))
                lat = p.get("lat", p.get("y"))
                pts.append((float(lon), float(lat)))
            else:
                pts.append((float(p[0]), float(p[1])))
        except (TypeError, ValueError, KeyError, IndexError):
            return False

    inside = False
    pt_count = len(pts)
    for i in range(pt_count):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % pt_count]
        if (y1 > py) != (y2 > py):
            xin = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
            if px < xin:
                inside = not inside
    return inside


def _to_json_safe(obj: typing.Any) -> typing.Any:
    if obj is None or obj is pd.NA or obj is pd.NaT:
        return None
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, pd.Timestamp):
        return None if pd.isna(obj) else obj.isoformat()
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    if isinstance(obj, (pd.Timedelta, datetime.timedelta)):
        if isinstance(obj, pd.Timedelta) and pd.isna(obj):
            return None
        return float(obj.total_seconds())
    if isinstance(obj, np.datetime64):
        ts = pd.Timestamp(obj)
        return None if pd.isna(ts) else ts.isoformat()
    if isinstance(obj, np.timedelta64):
        td = pd.Timedelta(obj)
        return None if pd.isna(td) else float(td.total_seconds())
    if isinstance(obj, str):
        return obj
    if isinstance(obj, np.ndarray):
        return [_to_json_safe(item) for item in obj.tolist()]
    if isinstance(obj, pd.Series):
        return [_to_json_safe(item) for item in obj.tolist()]
    if isinstance(obj, (list, tuple, set)):
        return [_to_json_safe(item) for item in obj]
    if isinstance(obj, dict):
        return {str(k): _to_json_safe(v) for k, v in obj.items()}
    try:
        na_flag = pd.isna(obj)
        if isinstance(na_flag, (bool, np.bool_)) and bool(na_flag):
            return None
    except Exception:
        pass
    return str(obj)


def _infer_column_type(series: pd.Series) -> str:
    dtype = series.dtype
    if pd.api.types.is_bool_dtype(dtype):
        return "boolean"
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return "datetime"
    if pd.api.types.is_numeric_dtype(dtype):
        return "number"

    non_null = series.dropna()
    if non_null.empty:
        return "string"

    sample = non_null.iloc[:200].tolist()
    if all(isinstance(v, (bool, np.bool_)) for v in sample):
        return "boolean"
    if all(
        isinstance(v, (int, float, np.integer, np.floating))
        and not isinstance(v, (bool, np.bool_))
        for v in sample
    ):
        return "number"
    if all(
        isinstance(v, (pd.Timestamp, datetime.datetime, datetime.date, np.datetime64))
        for v in sample
    ):
        return "datetime"
    return "string"


def _serialize_dataframe(df: pd.DataFrame) -> dict[str, typing.Any]:
    col_names: list[str] = [
        "_".join(str(part) for part in col) if isinstance(col, tuple) else str(col)
        for col in df.columns
    ]

    columns: list[dict[str, typing.Any]] = []
    for idx, col_name in enumerate(col_names):
        col_series = df.iloc[:, idx]
        col_type = _infer_column_type(col_series)
        columns.append(
            {
                "name": col_name,
                "displayName": col_name,
                "type": col_type,
            }
        )

    rows: list[dict[str, typing.Any]] = []
    for row_tuple in df.itertuples(index=False, name=None):
        rows.append(
            {col_names[i]: _to_json_safe(row_tuple[i]) for i in range(len(col_names))}
        )

    return {
        "columns": columns,
        "schema": columns,
        "rows": rows,
        "totalRows": len(rows),
    }


def _execute_request(req: dict[str, typing.Any]) -> dict[str, typing.Any]:
    t0 = time.perf_counter()
    req_id = req.get("id")
    code = req.get("code", "")

    validation, tree = _validate_and_parse(code)
    if not validation["valid"] or tree is None:
        return {
            "id": req_id,
            "ok": False,
            "status": "unavailable",
            "securityBlocked": bool(validation.get("securityBlocked")),
            "securityError": validation.get("securityError"),
            "error": validation.get("error"),
            "logs": "",
            "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
        }

    override_df_dict = _build_input_df_dict(req.get("input_df_dict"))
    override_lower_keys = {_norm_table_key(k) for k in override_df_dict.keys()}

    raw_csv_dir = req.get("csv_dir") if req.get("csv_dir") is not None else req.get("csvDir")
    csv_dir_str = str(raw_csv_dir).strip() if isinstance(raw_csv_dir, str) and raw_csv_dir.strip() else None

    raw_required = req.get("required_tables") if req.get("required_tables") is not None else req.get("requiredTables")
    required_tables = [str(t).strip() for t in raw_required if str(t).strip()] if isinstance(raw_required, list) else []

    raw_optional = req.get("optional_tables") if req.get("optional_tables") is not None else req.get("optionalTables")
    optional_tables = [str(t).strip() for t in raw_optional if str(t).strip()] if isinstance(raw_optional, list) else []

    table_columns = req.get("table_columns") if req.get("table_columns") is not None else req.get("tableColumns")
    if not isinstance(table_columns, dict):
        table_columns = {}

    input_df_dict: dict[str, pd.DataFrame] = {}
    csv_entries: list[os.DirEntry[str]] = []
    probed_csv_misses: set[str] = set()

    if csv_dir_str is not None:
        if not os.path.isdir(csv_dir_str):
            missing_on_bad_dir = [
                _strip_csv_ext(t) for t in required_tables if _norm_table_key(t) not in override_lower_keys
            ]
            return {
                "id": req_id,
                "ok": False,
                "status": "unavailable",
                "securityBlocked": False,
                "missingTables": missing_on_bad_dir,
                "error": (
                    f"缺少必需推演事件底表（CSV 目录不存在: {csv_dir_str}）: {missing_on_bad_dir}"
                    if missing_on_bad_dir
                    else f"推演事件 CSV 目录不存在: {csv_dir_str}"
                ),
                "logs": "",
                "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
            }

        csv_entries = _scan_csv_entries(csv_dir_str)
        missing_tables: list[str] = []
        resolved_entries: dict[str, os.DirEntry[str]] = {}

        for tbl in required_tables:
            norm_key = _norm_table_key(tbl)
            if norm_key in override_lower_keys:
                continue
            entry = _resolve_csv_entry(csv_entries, tbl)
            if entry is None:
                missing_tables.append(_strip_csv_ext(tbl))
            else:
                resolved_entries[norm_key] = entry

        if missing_tables:
            return {
                "id": req_id,
                "ok": False,
                "status": "unavailable",
                "securityBlocked": False,
                "missingTables": missing_tables,
                "error": f"缺少必需推演事件底表: {missing_tables}",
                "logs": "",
                "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
            }

        for tbl in [*required_tables, *optional_tables]:
            norm_key = _norm_table_key(tbl)
            if not norm_key or norm_key in override_lower_keys:
                continue
            base_name = _strip_csv_ext(tbl)
            if base_name in input_df_dict:
                continue
            entry = resolved_entries.get(norm_key) or _resolve_csv_entry(csv_entries, tbl)
            if entry is None:
                probed_csv_misses.add(norm_key)
                continue
            wanted_cols = _resolve_table_columns(table_columns, tbl)
            df_loaded = _load_csv_with_cache(csv_dir_str, base_name, entry.path, wanted_cols)
            input_df_dict[base_name] = df_loaded
            input_df_dict[base_name + ".csv"] = df_loaded.copy()

    for k, v in override_df_dict.items():
        input_df_dict[k] = v

    input_df_lower_index: dict[str, str] = {
        k.lower(): k for k in input_df_dict.keys()
    }

    raw_prev = req.get("prev_output_df")
    prev_output_df = _raw_to_dataframe(raw_prev) if raw_prev is not None else None
    raw_params = req.get("params")
    params = dict(raw_params) if isinstance(raw_params, dict) else {}

    def _helper_t(name: str) -> pd.DataFrame:
        key = str(name).strip()
        if key in input_df_dict:
            return input_df_dict[key].copy()
        alt = key[:-4] if key.lower().endswith(".csv") else key + ".csv"
        if alt in input_df_dict:
            return input_df_dict[alt].copy()

        norm_key = _norm_table_key(key)
        ci_key = input_df_lower_index.get(norm_key) or input_df_lower_index.get(f"{norm_key}.csv")
        if ci_key and ci_key in input_df_dict:
            return input_df_dict[ci_key].copy()

        if csv_dir_str is not None and norm_key and norm_key not in probed_csv_misses:
            entry = _resolve_csv_entry(csv_entries, key)
            if entry is None:
                probed_csv_misses.add(norm_key)
            else:
                base_name = _strip_csv_ext(key)
                wanted_cols = _resolve_table_columns(table_columns, key)
                df_loaded = _load_csv_with_cache(csv_dir_str, base_name, entry.path, wanted_cols)
                input_df_dict[base_name] = df_loaded
                input_df_dict[base_name + ".csv"] = df_loaded.copy()
                input_df_lower_index[norm_key] = base_name
                input_df_lower_index[f"{norm_key}.csv"] = base_name + ".csv"
                return df_loaded.copy()

        return pd.DataFrame()

    def _helper_c(
        df: pd.DataFrame | None,
        name: str,
        default: typing.Any = None,
    ) -> pd.Series:
        if df is None or not isinstance(df, pd.DataFrame):
            return pd.Series(dtype=object)
        if name in df.columns:
            return df[name]
        return pd.Series(default, index=df.index, dtype=object)

    log_buf = io.StringIO()

    def _sandbox_print(*args: typing.Any, **kwargs: typing.Any) -> None:
        clean_kwargs = {k: v for k, v in kwargs.items() if k != "file"}
        _py_builtins.print(*args, file=log_buf, **clean_kwargs)

    sandbox_builtins = dict(BASE_SAFE_BUILTINS)
    sandbox_builtins["print"] = _sandbox_print

    exec_env: dict[str, typing.Any] = {
        "__builtins__": sandbox_builtins,
        "pd": pd,
        "np": np,
        "math": math,
        "datetime": datetime,
        "input_df_dict": input_df_dict,
        "prev_output_df": prev_output_df,
        "params": params,
        "T": _helper_t,
        "C": _helper_c,
        "in_polygon": in_polygon,
    }

    old_stdout = sys.stdout
    old_stderr = sys.stderr
    try:
        sys.stdout = log_buf
        sys.stderr = log_buf
        compiled = compile(tree, "<sandbox>", "exec")
        _py_builtins.exec(compiled, exec_env, exec_env)
    except ImportError as exc:
        err_str = str(exc)
        is_sec = "[SECURITY_VIOLATION]" in err_str
        return {
            "id": req_id,
            "ok": False,
            "status": "unavailable",
            "securityBlocked": is_sec,
            "securityError": err_str if is_sec else None,
            "error": f"{type(exc).__name__}: {err_str}",
            "logs": log_buf.getvalue(),
            "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
        }
    except Exception as exc:
        tb_lines = traceback.format_exc().strip().splitlines()
        short_tb = tb_lines[-1] if tb_lines else f"{type(exc).__name__}: {exc}"
        return {
            "id": req_id,
            "ok": False,
            "status": "unavailable",
            "securityBlocked": False,
            "error": f"{type(exc).__name__}: {exc} | {short_tb}",
            "logs": log_buf.getvalue(),
            "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
        }
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    if "output_df" not in exec_env or exec_env["output_df"] is None:
        return {
            "id": req_id,
            "ok": False,
            "status": "unavailable",
            "securityBlocked": False,
            "error": "Script must assign a pandas.DataFrame to 'output_df'",
            "logs": log_buf.getvalue(),
            "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
        }

    out_df = exec_env["output_df"]
    if not isinstance(out_df, pd.DataFrame):
        return {
            "id": req_id,
            "ok": False,
            "status": "unavailable",
            "securityBlocked": False,
            "error": f"'output_df' must be a pandas.DataFrame, got {type(out_df).__name__}",
            "logs": log_buf.getvalue(),
            "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
        }

    dataset = _serialize_dataframe(out_df)
    return {
        "id": req_id,
        "ok": True,
        "status": "ok",
        "dataset": dataset,
        "logs": log_buf.getvalue(),
        "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
    }


def _handle_ping(req: dict[str, typing.Any]) -> dict[str, typing.Any]:
    t0 = time.perf_counter()
    return {
        "id": req.get("id"),
        "ok": True,
        "status": "ok",
        "result": {
            "pong": True,
            "pythonVersion": sys.version.split()[0],
            "pandasVersion": pd.__version__,
            "numpyVersion": np.__version__,
            "shapelyAvailable": shapely is not None,
            "pid": os.getpid(),
        },
        "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
    }


def _write_protocol_response(payload: dict[str, typing.Any]) -> None:
    try:
        serialized = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    except Exception as exc:
        fallback = {
            "id": payload.get("id"),
            "ok": False,
            "status": "unavailable",
            "securityBlocked": False,
            "error": f"Response JSON serialization failed: {exc}",
        }
        serialized = json.dumps(fallback, ensure_ascii=False, allow_nan=False)
    PROTO_STDOUT.write(serialized + "\n")
    PROTO_STDOUT.flush()


def main() -> None:
    while True:
        raw_line = sys.stdin.readline()
        if not raw_line:
            break
        line = raw_line.strip()
        if not line:
            continue

        req_id: typing.Any = None
        try:
            req = json.loads(line)
            if not isinstance(req, dict):
                raise ValueError("JSON-RPC request must be an object")
            req_id = req.get("id")
            method = req.get("method")
            if method == "ping":
                resp = _handle_ping(req)
            elif method == "execute":
                resp = _execute_request(req)
            else:
                resp = {
                    "id": req_id,
                    "ok": False,
                    "status": "unavailable",
                    "securityBlocked": False,
                    "error": f"Unsupported JSON-RPC method: {method!r}",
                }
        except Exception as exc:
            resp = {
                "id": req_id,
                "ok": False,
                "status": "unavailable",
                "securityBlocked": False,
                "error": f"Worker dispatch error: {type(exc).__name__}: {exc}",
            }

        _write_protocol_response(resp)


if __name__ == "__main__":
    main()

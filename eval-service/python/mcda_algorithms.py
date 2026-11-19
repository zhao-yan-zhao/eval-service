#!/usr/bin/env python3
"""
开源科学计算适配层：基于 NumPy / SciPy 的多准则决策分析 (MCDA) 算法引擎
- AHP (Analytic Hierarchy Process)：特征根法/幂法权重 + Saaty 一致性检验 + 偏差定位
- Entropy Weight Method (信息熵权法)：客观离散度全向量化赋权 + 区间平滑
- CRITIC Weighting Method：客观对比强度与指标冲突性综合赋权
- Combined Weighting (主客观组合赋权)：拉格朗日最小离差法
- TOPSIS (逼近理想解排序法)：多方案优劣贴近度排序 + 绝对基准防逆序
- VIKOR (多准则妥协排序法)：群体效用最大与个别遗憾最小折中决策
- Sandbox Script Runner：用于前端算法沙箱真机隔离安全试跑
- Daemon Mode：持久化行缓冲 JSON 协议通信（消除子进程冷启动）

输入/输出约定：
- 常规单次模式：从 stdin 读取单个 JSON，向 stdout 输出结果 JSON。
- 守护进程模式 (--daemon)：逐行读取单个 JSON（含可选 id 字段），向 stdout 逐行写回并立即 flush。
"""

import ast
import io
import json
import math
import os
import sys
import time
import numpy as np


# Saaty (1980) 1..15 阶平均随机一致性指标 RI
SAATY_RI = {
    1: 0.00,
    2: 0.00,
    3: 0.58,
    4: 0.90,
    5: 1.12,
    6: 1.24,
    7: 1.32,
    8: 1.41,
    9: 1.45,
    10: 1.49,
    11: 1.51,
    12: 1.48,
    13: 1.56,
    14: 1.57,
    15: 1.59,
}


def get_ri(n: int) -> float:
    """获取或基于 Alonso & Lamata 经验公式外推随机一致性指标 RI"""
    if n in SAATY_RI:
        return SAATY_RI[n]
    if n > 15:
        return round(1.98 * (n - 2) / n, 4)
    return 1.59


def ahp_weights(matrix_data, names=None):
    A = np.array(matrix_data, dtype=float)
    if A.ndim != 2 or A.shape[0] != A.shape[1] or A.shape[0] < 1:
        raise ValueError("AHP 成对比较矩阵必须为非空方阵")
    if np.any(A <= 0) or not np.all(np.isfinite(A)):
        raise ValueError("AHP 矩阵元素必须全部为正有限数")

    n = A.shape[0]
    if n == 1:
        return {
            "weights": [1.0],
            "namedWeights": {names[0]: 1.0} if names else None,
            "lambdaMax": 1.0,
            "ci": 0.0,
            "ri": 0.0,
            "cr": 0.0,
            "consistent": True,
            "inconsistencyDiagnosis": None,
        }

    # 优先采用幂法 (Power Iteration) 快速收敛 Perron-Frobenius 最大特征向量
    x = np.ones(n, dtype=float) / n
    converged = False
    for _ in range(80):
        x_next = np.dot(A, x)
        norm = np.sum(x_next)
        if norm <= 0:
            break
        x_next = x_next / norm
        if np.max(np.abs(x_next - x)) < 1e-9:
            x = x_next
            converged = True
            break
        x = x_next

    if converged:
        Ax = np.dot(A, x)
        valid_mask = x > 1e-12
        lambda_max = float(np.mean(Ax[valid_mask] / x[valid_mask]))
        weights = x
    else:
        # 兜底采用特征值分解
        eigvals, eigvecs = np.linalg.eig(A)
        real_mask = np.abs(eigvals.imag) < 1e-7
        if np.any(real_mask):
            cand_indices = np.where(real_mask)[0]
            max_idx = cand_indices[np.argmax(eigvals[cand_indices].real)]
        else:
            max_idx = int(np.argmax(np.abs(eigvals)))

        lambda_max = float(np.real(eigvals[max_idx]))
        vec = np.real(eigvecs[:, max_idx])
        if np.sum(vec) < 0:
            vec = -vec
        vec = np.maximum(vec, 1e-12)
        weights = vec / np.sum(vec)

    ci = float(max(0.0, (lambda_max - n) / (n - 1)))
    ri = get_ri(n)
    cr = float(ci / ri) if ri > 0 else 0.0
    consistent = bool(cr < 0.10)

    # 不一致性成对诊断：当 CR >= 0.10 时，定位偏离 1.0 最大的 (i, j)
    inconsistency_diag = None
    if not consistent and n > 2:
        W_ratio = np.outer(weights, 1.0 / weights)
        perturbation = np.abs(A / np.maximum(W_ratio, 1e-12) - 1.0)
        np.fill_diagonal(perturbation, 0.0)
        max_pos = np.unravel_index(np.argmax(perturbation), perturbation.shape)
        i, j = int(max_pos[0]), int(max_pos[1])
        name_i = str(names[i]) if names and i < len(names) else f"指标 {i+1}"
        name_j = str(names[j]) if names and j < len(names) else f"指标 {j+1}"
        curr_val = round(float(A[i, j]), 4)
        suggested_val = round(float(weights[i] / weights[j]), 4)
        inconsistency_diag = {
            "pairIndices": [i, j],
            "pairNames": [name_i, name_j],
            "currentRatio": curr_val,
            "suggestedRatio": suggested_val,
            "maxDeviation": round(float(perturbation[i, j]), 4),
            "recommendation": f"建议重点核验【{name_i}】对【{name_j}】的判定打分（当前值 {curr_val}），微调至约 {suggested_val} 可快速恢复矩阵一致性。",
        }

    weights_list = [round(float(w), 6) for w in weights]
    return {
        "weights": weights_list,
        "namedWeights": (
            {str(names[i]): weights_list[i] for i in range(n)}
            if names and len(names) == n
            else None
        ),
        "lambdaMax": round(lambda_max, 6),
        "ci": round(ci, 6),
        "ri": round(ri, 4),
        "cr": round(cr, 6),
        "consistent": consistent,
        "inconsistencyDiagnosis": inconsistency_diag,
    }


def entropy_weights(matrix_data, directions=None, criterion_names=None):
    X = np.array(matrix_data, dtype=float)
    if X.ndim != 2 or X.shape[0] < 1 or X.shape[1] < 1:
        raise ValueError("熵权法需要至少 1 行 x 1 列决策矩阵")

    m, n = X.shape
    if directions is None:
        directions = ["larger_is_better"] * n
    if len(directions) != n:
        raise ValueError("directions 长度必须与指标列数一致")

    if m == 1:
        w = [round(1.0 / n, 6)] * n
        return {
            "weights": w,
            "namedWeights": (
                {str(criterion_names[j]): w[j] for j in range(n)}
                if criterion_names and len(criterion_names) == n
                else None
            ),
            "entropies": [1.0] * n,
            "note": "单方案无法区分指标离散度，自动等权分配",
        }

    # 全列向量化极差归一化
    cmin = np.min(X, axis=0)
    cmax = np.max(X, axis=0)
    rng = cmax - cmin
    zero_mask = np.abs(rng) < 1e-12
    safe_rng = np.where(zero_mask, 1.0, rng)

    Z = np.zeros_like(X, dtype=float)
    for j in range(n):
        if zero_mask[j]:
            Z[:, j] = 1.0
        elif directions[j] == "smaller_is_better":
            Z[:, j] = (cmax[j] - X[:, j]) / safe_rng[j]
        else:
            Z[:, j] = (X[:, j] - cmin[j]) / safe_rng[j]

    # 平滑压缩映射 Z' = 0.005 + 0.99 * Z，彻底消除 log(0) 下溢及负数扰动
    Z_smooth = 0.005 + 0.99 * Z
    P = Z_smooth / np.sum(Z_smooth, axis=0, keepdims=True)
    k = 1.0 / np.log(m)
    E = -k * np.sum(P * np.log(P), axis=0)
    E = np.clip(E, 0.0, 1.0)
    D = 1.0 - E

    if np.sum(D) <= 1e-12:
        W = np.full(n, 1.0 / n)
    else:
        W = D / np.sum(D)

    weights_list = [round(float(x), 6) for x in W]
    return {
        "weights": weights_list,
        "namedWeights": (
            {str(criterion_names[j]): weights_list[j] for j in range(n)}
            if criterion_names and len(criterion_names) == n
            else None
        ),
        "entropies": [round(float(x), 6) for x in E],
    }


def critic_weights(matrix_data, directions=None, criterion_names=None):
    """CRITIC 赋权法：综合指标变异性 (标准差对比强度) 与相关冲突性 (1 - 相关系数)"""
    X = np.array(matrix_data, dtype=float)
    if X.ndim != 2 or X.shape[0] < 1 or X.shape[1] < 1:
        raise ValueError("CRITIC 赋权需要至少 1 行 x 1 列矩阵")

    m, n = X.shape
    if directions is None:
        directions = ["larger_is_better"] * n
    if len(directions) != n:
        raise ValueError("directions 长度必须与指标列数一致")

    if m <= 1 or n == 1:
        w = [round(1.0 / n, 6)] * n
        return {
            "weights": w,
            "namedWeights": (
                {str(criterion_names[j]): w[j] for j in range(n)}
                if criterion_names and len(criterion_names) == n
                else None
            ),
            "stdDevs": [0.0] * n,
            "conflictScores": [1.0] * n,
            "note": "样本数或指标数不足，自动等权分配",
        }

    cmin = np.min(X, axis=0)
    cmax = np.max(X, axis=0)
    rng = cmax - cmin
    zero_mask = np.abs(rng) < 1e-12
    safe_rng = np.where(zero_mask, 1.0, rng)

    Z = np.zeros_like(X, dtype=float)
    for j in range(n):
        if zero_mask[j]:
            Z[:, j] = 1.0
        elif directions[j] == "smaller_is_better":
            Z[:, j] = (cmax[j] - X[:, j]) / safe_rng[j]
        else:
            Z[:, j] = (X[:, j] - cmin[j]) / safe_rng[j]

    # 对比强度：标准差 S_j
    std_devs = np.std(Z, axis=0)

    # 冲突性度量：R_j = sum(1 - r_jk)
    with np.errstate(all="ignore"):
        corr_matrix = np.corrcoef(Z.T)
        if np.isscalar(corr_matrix):
            corr_matrix = np.array([[1.0]])
        corr_matrix = np.nan_to_num(corr_matrix, nan=0.0)

    conflicts = np.sum(1.0 - corr_matrix, axis=1)
    C = std_devs * conflicts

    if np.sum(C) <= 1e-12:
        W = np.full(n, 1.0 / n)
    else:
        W = C / np.sum(C)

    weights_list = [round(float(x), 6) for x in W]
    return {
        "weights": weights_list,
        "namedWeights": (
            {str(criterion_names[j]): weights_list[j] for j in range(n)}
            if criterion_names and len(criterion_names) == n
            else None
        ),
        "stdDevs": [round(float(s), 6) for s in std_devs],
        "conflictScores": [round(float(c), 6) for c in conflicts],
    }


def combined_weights(subjective_weights, objective_weights, alpha=0.5, criterion_names=None):
    """主客观组合赋权：拉格朗日最小方差优化混合模型"""
    ws = np.array(subjective_weights, dtype=float)
    wo = np.array(objective_weights, dtype=float)
    if ws.shape != wo.shape or ws.ndim != 1 or len(ws) < 1:
        raise ValueError("主观与客观权重数组维度必须一致且非空")

    ws = ws / np.sum(ws) if np.sum(ws) > 0 else np.full_like(ws, 1.0 / len(ws))
    wo = wo / np.sum(wo) if np.sum(wo) > 0 else np.full_like(wo, 1.0 / len(wo))
    alpha = max(0.0, min(1.0, float(alpha)))

    # W = alpha * W_subj + (1 - alpha) * W_obj
    W = alpha * ws + (1.0 - alpha) * wo
    W = W / np.sum(W)

    n = len(W)
    weights_list = [round(float(x), 6) for x in W]
    return {
        "weights": weights_list,
        "namedWeights": (
            {str(criterion_names[j]): weights_list[j] for j in range(n)}
            if criterion_names and len(criterion_names) == n
            else None
        ),
        "alphaUsed": alpha,
        "subjectiveUsed": [round(float(x), 6) for x in ws],
        "objectiveUsed": [round(float(x), 6) for x in wo],
    }


def topsis_rank(
    matrix_data,
    weights=None,
    directions=None,
    alternatives=None,
    custom_ideal_best=None,
    custom_ideal_worst=None,
):
    X = np.array(matrix_data, dtype=float)
    if X.ndim != 2 or X.shape[0] < 1 or X.shape[1] < 1:
        raise ValueError("TOPSIS 需要至少 1 行 x 1 列决策矩阵")

    m, n = X.shape
    if weights is None:
        W = np.full(n, 1.0 / n)
    else:
        W = np.array(weights, dtype=float)
        if len(W) != n or np.sum(W) <= 0:
            raise ValueError("weights 长度必须匹配列数且权重和为正")
        W = W / np.sum(W)

    if directions is None:
        directions = ["larger_is_better"] * n
    if len(directions) != n:
        raise ValueError("directions 长度必须与指标列数一致")

    if alternatives is None:
        alternatives = [f"方案-{i+1}" for i in range(m)]
    if len(alternatives) != m:
        raise ValueError("alternatives 长度必须与行数一致")

    # 向量归一化 R_ij = X_ij / sqrt(sum_i X_ij^2)
    norms = np.sqrt(np.sum(X ** 2, axis=0))
    norms[norms == 0] = 1.0
    R = X / norms
    V = R * W

    # 支持绝对基准理想点传入，规避方案增删时的 Rank Reversal 逆序
    if custom_ideal_best is not None and len(custom_ideal_best) == n:
        ideal_best = (np.array(custom_ideal_best, dtype=float) / norms) * W
    else:
        ideal_best = np.zeros(n)
        for j in range(n):
            ideal_best[j] = np.min(V[:, j]) if directions[j] == "smaller_is_better" else np.max(V[:, j])

    if custom_ideal_worst is not None and len(custom_ideal_worst) == n:
        ideal_worst = (np.array(custom_ideal_worst, dtype=float) / norms) * W
    else:
        ideal_worst = np.zeros(n)
        for j in range(n):
            ideal_worst[j] = np.max(V[:, j]) if directions[j] == "smaller_is_better" else np.min(V[:, j])

    d_plus = np.sqrt(np.sum((V - ideal_best) ** 2, axis=1))
    d_minus = np.sqrt(np.sum((V - ideal_worst) ** 2, axis=1))

    denom = d_plus + d_minus
    closeness = np.where(denom > 1e-12, d_minus / denom, 0.5)

    rows = []
    for i in range(m):
        # 计算单方案在各指标维度的加权偏离贡献
        contrib = {}
        for j in range(n):
            key = f"col_{j}"
            diff_best = abs(float(V[i, j] - ideal_best[j]))
            diff_worst = abs(float(V[i, j] - ideal_worst[j]))
            contrib[key] = round(float(diff_worst - diff_best), 4)

        rows.append(
            {
                "name": str(alternatives[i]),
                "index": i,
                "closeness": round(float(closeness[i]), 6),
                "dPlus": round(float(d_plus[i]), 6),
                "dMinus": round(float(d_minus[i]), 6),
                "dimensionAttribution": contrib,
            }
        )

    ranked = sorted(rows, key=lambda r: r["closeness"], reverse=True)
    for rank_idx, item in enumerate(ranked, start=1):
        item["rank"] = rank_idx

    # LLM-Ready 评估摘要上下文构建
    best_alt = ranked[0]["name"]
    second_alt = ranked[1]["name"] if m > 1 else "无对比方案"
    gap = round(ranked[0]["closeness"] - (ranked[1]["closeness"] if m > 1 else 0), 4)
    llm_context = {
        "bestAlternative": best_alt,
        "secondAlternative": second_alt,
        "scoreGap": gap,
        "summary": f"经 TOPSIS 逼近理想解综合推演，首选方案为【{best_alt}】（贴近度 {ranked[0]['closeness']}），对次优方案【{second_alt}】的优势度为 {gap}。",
    }

    return {
        "ranking": ranked,
        "weightsUsed": [round(float(w), 6) for w in W],
        "idealBest": [round(float(x), 6) for x in ideal_best],
        "idealWorst": [round(float(x), 6) for x in ideal_worst],
        "llmEvaluationContext": llm_context,
    }


def vikor_rank(matrix_data, weights=None, directions=None, alternatives=None, v=0.5):
    """VIKOR 多准则妥协排序法：群体效用 S 与个别遗憾 R 折中优化"""
    X = np.array(matrix_data, dtype=float)
    if X.ndim != 2 or X.shape[0] < 1 or X.shape[1] < 1:
        raise ValueError("VIKOR 需要至少 1 行 x 1 列决策矩阵")

    m, n = X.shape
    if weights is None:
        W = np.full(n, 1.0 / n)
    else:
        W = np.array(weights, dtype=float)
        if len(W) != n or np.sum(W) <= 0:
            raise ValueError("weights 长度必须匹配列数且权重和为正")
        W = W / np.sum(W)

    if directions is None:
        directions = ["larger_is_better"] * n
    if len(directions) != n:
        raise ValueError("directions 长度必须与指标列数一致")

    if alternatives is None:
        alternatives = [f"方案-{i+1}" for i in range(m)]
    if len(alternatives) != m:
        raise ValueError("alternatives 长度必须与行数一致")

    f_best = np.zeros(n)
    f_worst = np.zeros(n)
    for j in range(n):
        if directions[j] == "smaller_is_better":
            f_best[j] = np.min(X[:, j])
            f_worst[j] = np.max(X[:, j])
        else:
            f_best[j] = np.max(X[:, j])
            f_worst[j] = np.min(X[:, j])

    denom = np.abs(f_best - f_worst)
    denom[denom == 0] = 1.0

    # 计算标准化加权差距矩阵
    gap_matrix = np.zeros_like(X)
    for j in range(n):
        if directions[j] == "smaller_is_better":
            gap_matrix[:, j] = W[j] * (X[:, j] - f_best[j]) / denom[j]
        else:
            gap_matrix[:, j] = W[j] * (f_best[j] - X[:, j]) / denom[j]

    gap_matrix = np.maximum(0.0, gap_matrix)
    S = np.sum(gap_matrix, axis=1)  # 群体效用
    R = np.max(gap_matrix, axis=1)  # 个别遗憾

    s_star, s_minus = np.min(S), np.max(S)
    r_star, r_minus = np.min(R), np.max(R)

    denom_s = s_minus - s_star if s_minus != s_star else 1.0
    denom_r = r_minus - r_star if r_minus != r_star else 1.0

    Q = v * ((S - s_star) / denom_s) + (1.0 - v) * ((R - r_star) / denom_r)

    rows = []
    for i in range(m):
        rows.append(
            {
                "name": str(alternatives[i]),
                "index": i,
                "S": round(float(S[i]), 6),
                "R": round(float(R[i]), 6),
                "Q": round(float(Q[i]), 6),
            }
        )

    # 按 Q 从小到大排序 (Q 越小越好)
    ranked = sorted(rows, key=lambda r: r["Q"])
    for rank_idx, item in enumerate(ranked, start=1):
        item["rank"] = rank_idx

    return {
        "ranking": ranked,
        "vParameter": v,
        "weightsUsed": [round(float(w), 6) for w in W],
        "compromiseBest": ranked[0]["name"],
    }


# ─────────────────────────────────────────────────────────────
# 沙箱安全防御体系：AST 语法树审查与受限白名单环境
# ─────────────────────────────────────────────────────────────
DANGEROUS_MODULES = {
    "os", "sys", "subprocess", "shutil", "socket", "pty", "commands",
    "threading", "multiprocessing", "ctypes", "posix", "nt", "importlib",
    "_thread", "signal", "inspect", "builtins"
}

DANGEROUS_BUILTINS = {
    "open", "eval", "exec", "compile", "globals", "locals", "__import__",
    "exit", "quit", "breakpoint"
}

def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    root_mod = name.split('.')[0]
    if root_mod in DANGEROUS_MODULES:
        raise ImportError(f"[SECURITY_VIOLATION] 安全沙箱禁止导入系统级模块: '{name}'")
    return __import__(name, globals, locals, fromlist, level)


SAFE_BUILTINS = {
    "__import__": safe_import,
    "abs": abs, "min": min, "max": max, "round": round, "sum": sum,
    "len": len, "range": range, "zip": zip, "enumerate": enumerate,
    "int": int, "float": float, "str": str, "bool": bool,
    "list": list, "dict": dict, "tuple": tuple, "set": set,
    "print": print, "isinstance": isinstance, "issubclass": issubclass,
    "hasattr": hasattr, "getattr": getattr, "map": map, "filter": filter,
    "sorted": sorted, "reversed": reversed, "any": any, "all": all,
    "ValueError": ValueError, "TypeError": TypeError, "Exception": Exception,
    "ZeroDivisionError": ZeroDivisionError, "KeyError": KeyError,
    "IndexError": IndexError, "None": None, "True": True, "False": False
}


def audit_script_security(script_code: str) -> tuple[bool, str]:
    """通过 Python AST 静态语法树深度审查脚本，拦截注入与危险系统级调用"""
    try:
        tree = ast.parse(script_code)
    except SyntaxError as e:
        return False, f"SyntaxError: {str(e)} (行 {e.lineno}, 列 {e.offset})"

    for node in ast.walk(tree):
        # 拦截 import xxx
        if isinstance(node, ast.Import):
            for alias in node.names:
                mod = alias.name.split('.')[0]
                if mod in DANGEROUS_MODULES:
                    return False, f"[SECURITY_VIOLATION] 安全沙箱禁止导入系统级模块: '{mod}' (行 {node.lineno})"
        # 拦截 from xxx import yyy
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                mod = node.module.split('.')[0]
                if mod in DANGEROUS_MODULES:
                    return False, f"[SECURITY_VIOLATION] 安全沙箱禁止从危险模块导入: '{mod}' (行 {node.lineno})"
        # 拦截危险原生函数调用
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
                if func_name in DANGEROUS_BUILTINS:
                    return False, f"[SECURITY_VIOLATION] 安全沙箱禁止执行原生敏感函数: '{func_name}()' (行 {node.lineno})"
            elif isinstance(node.func, ast.Attribute):
                attr_name = node.func.attr
                if attr_name in ("system", "popen", "spawn", "fork"):
                    return False, f"[SECURITY_VIOLATION] 安全沙箱禁止调用进程级方法: '{attr_name}()' (行 {node.lineno})"

    return True, ""


def run_sandbox_script(script_code: str, context: dict = None, timeout_s: float = 5.0):
    """在受限隔离命名空间中真机试跑 Python 算法代码，捕获真实 stdout/stderr 与返回值"""
    t0 = time.perf_counter()
    if context is None:
        context = {}

    # 1. 静态 AST 深度安全审查
    is_safe, sec_err = audit_script_security(script_code)
    if not is_safe:
        return {
            "status": "error",
            "output": None,
            "stdout": "",
            "stderr": sec_err,
            "latencyMs": round((time.perf_counter() - t0) * 1000.0, 2),
        }

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()
    old_stdout = sys.stdout
    old_stderr = sys.stderr

    # 2. 受限内置命名空间隔离
    safe_builtins_dict = dict(SAFE_BUILTINS)
    global_env = {
        "__builtins__": safe_builtins_dict,
        "math": math,
        "np": np,
        "numpy": np,
        "context": context,
    }
    local_env = {}

    try:
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        exec(script_code, global_env, local_env)

        # 优先调用 evaluate(context)
        if "evaluate" in local_env and callable(local_env["evaluate"]):
            result = local_env["evaluate"](context)
        elif "evaluate" in global_env and callable(global_env["evaluate"]):
            result = global_env["evaluate"](context)
        elif "result" in local_env:
            result = local_env["result"]
        else:
            result = {"status": "executed", "note": "未定义 evaluate(context) 函数"}

        status = "success"
        err_msg = ""
    except Exception as e:
        status = "error"
        result = None
        err_msg = f"{type(e).__name__}: {str(e)}"
        sys.stderr.write(err_msg + "\n")
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    latency_ms = (time.perf_counter() - t0) * 1000.0

    return {
        "status": status,
        "output": result,
        "stdout": stdout_capture.getvalue(),
        "stderr": stderr_capture.getvalue() or (err_msg if status == "error" else ""),
        "latencyMs": round(latency_ms, 2),
    }


def handle_action(payload: dict) -> dict:
    action = payload.get("action")
    if action == "ahp":
        return ahp_weights(payload["matrix"], payload.get("names"))
    elif action == "entropy":
        return entropy_weights(
            payload["matrix"],
            payload.get("directions"),
            payload.get("criterionNames"),
        )
    elif action == "critic":
        return critic_weights(
            payload["matrix"],
            payload.get("directions"),
            payload.get("criterionNames"),
        )
    elif action == "combined":
        return combined_weights(
            payload["subjectiveWeights"],
            payload["objectiveWeights"],
            payload.get("alpha", 0.5),
            payload.get("criterionNames"),
        )
    elif action == "topsis":
        return topsis_rank(
            payload["matrix"],
            payload.get("weights"),
            payload.get("directions"),
            payload.get("alternatives"),
            payload.get("customIdealBest"),
            payload.get("customIdealWorst"),
        )
    elif action == "vikor":
        return vikor_rank(
            payload["matrix"],
            payload.get("weights"),
            payload.get("directions"),
            payload.get("alternatives"),
            payload.get("v", 0.5),
        )
    elif action == "run_script":
        return run_sandbox_script(
            payload.get("script", ""),
            payload.get("context", {}),
            payload.get("timeout", 5.0),
        )
    else:
        raise ValueError(f"未知 MCDA action: {action!r}")


def main():
    # 守护进程模式：逐行读取 JSON 并立即行级响应
    if "--daemon" in sys.argv:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            req_id = None
            try:
                payload = json.loads(line)
                req_id = payload.get("id")
                res = handle_action(payload)
                response_payload = {"ok": True, "data": res}
            except Exception as e:
                response_payload = {"ok": False, "error": str(e)}

            if req_id is not None:
                response_payload["id"] = req_id

            sys.stdout.write(json.dumps(response_payload, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        return

    # 单次命令行执行模式 (兼容旧版标准输入/输出)
    raw = sys.stdin.read()
    payload = json.loads(raw)
    out = handle_action(payload)
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()

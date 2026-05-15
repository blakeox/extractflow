from __future__ import annotations

import ast
import math
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from dateutil import parser as date_parser


class FormulaValidationError(Exception):
    pass


class AttrView:
    def __init__(self, value: Any):
        self._value = value

    def __getattr__(self, item: str) -> Any:
        if isinstance(self._value, dict):
            return wrap_value(self._value.get(item))
        raise AttributeError(item)

    def unwrap(self) -> Any:
        return self._value


def wrap_value(value: Any) -> Any:
    if isinstance(value, dict):
        return AttrView({key: wrap_value(val) for key, val in value.items()})
    if isinstance(value, list):
        return [wrap_value(item) for item in value]
    return value


def unwrap_value(value: Any) -> Any:
    if isinstance(value, AttrView):
        return {key: unwrap_value(val) for key, val in value._value.items()}
    if isinstance(value, list):
        return [unwrap_value(item) for item in value]
    return value


def parse_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, AttrView):
        value = value.unwrap()
    if isinstance(value, dict):
        value = value.get("value", value)
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).date()
        except ValueError:
            try:
                return date_parser.parse(value).date()
            except (TypeError, ValueError, OverflowError):
                return None
    return None


def months_between(start: Any, end: Any) -> int | None:
    left = parse_date(start)
    right = parse_date(end)
    if not left or not right:
        return None
    return (right.year - left.year) * 12 + (right.month - left.month)


def days_between(start: Any, end: Any) -> int | None:
    left = parse_date(start)
    right = parse_date(end)
    if not left or not right:
        return None
    return (right - left).days


def years_between(start: Any, end: Any) -> int | None:
    months = months_between(start, end)
    return None if months is None else months // 12


def coalesce(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def avg(values: list[Any]) -> float | None:
    numeric = [value for value in values if isinstance(value, int | float | Decimal)]
    return None if not numeric else float(sum(numeric) / len(numeric))


def count(values: Any) -> int:
    if values is None:
        return 0
    if isinstance(values, list | tuple | dict | str):
        return len(values)
    return 1


def contains(container: Any, item: Any) -> bool:
    if container is None:
        return False
    return item in container


def lookup(mapping: Any, key: Any, default: Any = None) -> Any:
    if isinstance(mapping, dict):
        return mapping.get(key, default)
    return default


def convert_unit(number: Any, from_unit: str, to_unit: str) -> Any:
    if number is None or from_unit == to_unit:
        return number
    conversions = {
        ("days", "months"): lambda n: n / 30,
        ("months", "days"): lambda n: n * 30,
        ("years", "months"): lambda n: n * 12,
        ("months", "years"): lambda n: n / 12,
    }
    converter = conversions.get((from_unit, to_unit))
    if not converter:
        raise FormulaValidationError(f"Unsupported unit conversion: {from_unit} -> {to_unit}")
    return converter(number)


def format_currency(amount: Any, currency: str = "USD") -> str:
    if amount is None:
        return ""
    return f"{currency} {float(amount):,.2f}"


def format_percent(value: Any, decimal_places: int = 2) -> str:
    if value is None:
        return ""
    return f"{float(value):.{decimal_places}f}%"


def iff(condition: Any, when_true: Any, when_false: Any) -> Any:
    return when_true if condition else when_false


ALLOWED_FUNCTIONS = {
    "sum": sum,
    "avg": avg,
    "min": min,
    "max": max,
    "count": count,
    "round": round,
    "floor": math.floor,
    "ceil": math.ceil,
    "coalesce": coalesce,
    "months_between": months_between,
    "days_between": days_between,
    "years_between": years_between,
    "contains": contains,
    "lookup": lookup,
    "convert_unit": convert_unit,
    "format_currency": format_currency,
    "format_percent": format_percent,
    "iff": iff,
}


class SafeEvaluator(ast.NodeVisitor):
    ALLOWED_NODES = (
        ast.Expression,
        ast.BinOp,
        ast.UnaryOp,
        ast.Constant,
        ast.Name,
        ast.Load,
        ast.Call,
        ast.Attribute,
        ast.Compare,
        ast.BoolOp,
        ast.IfExp,
        ast.List,
        ast.Tuple,
    )

    def __init__(self, context: dict[str, Any]):
        self.context = context

    def visit(self, node: ast.AST) -> Any:
        if not isinstance(node, self.ALLOWED_NODES):
            raise FormulaValidationError(f"Unsupported formula syntax: {type(node).__name__}")
        return super().visit(node)

    def visit_Expression(self, node: ast.Expression) -> Any:
        return self.visit(node.body)

    def visit_Constant(self, node: ast.Constant) -> Any:
        return node.value

    def visit_Name(self, node: ast.Name) -> Any:
        if node.id in self.context:
            return self.context[node.id]
        if node.id in ALLOWED_FUNCTIONS:
            return ALLOWED_FUNCTIONS[node.id]
        raise FormulaValidationError(f"Unknown identifier: {node.id}")

    def visit_Attribute(self, node: ast.Attribute) -> Any:
        value = self.visit(node.value)
        if isinstance(value, AttrView):
            return getattr(value, node.attr)
        if isinstance(value, dict):
            return value.get(node.attr)
        return getattr(value, node.attr)

    def visit_List(self, node: ast.List) -> Any:
        return [self.visit(element) for element in node.elts]

    def visit_Tuple(self, node: ast.Tuple) -> Any:
        return tuple(self.visit(element) for element in node.elts)

    def visit_BoolOp(self, node: ast.BoolOp) -> Any:
        values = [self.visit(value) for value in node.values]
        if isinstance(node.op, ast.And):
            return all(values)
        if isinstance(node.op, ast.Or):
            return any(values)
        raise FormulaValidationError("Unsupported boolean operator")

    def visit_Compare(self, node: ast.Compare) -> Any:
        left = self.visit(node.left)
        for op, comparator in zip(node.ops, node.comparators):
            right = self.visit(comparator)
            if isinstance(op, ast.Eq) and not (left == right):
                return False
            if isinstance(op, ast.NotEq) and not (left != right):
                return False
            if isinstance(op, ast.Lt) and not (left < right):
                return False
            if isinstance(op, ast.LtE) and not (left <= right):
                return False
            if isinstance(op, ast.Gt) and not (left > right):
                return False
            if isinstance(op, ast.GtE) and not (left >= right):
                return False
            left = right
        return True

    def visit_IfExp(self, node: ast.IfExp) -> Any:
        return self.visit(node.body) if self.visit(node.test) else self.visit(node.orelse)

    def visit_Call(self, node: ast.Call) -> Any:
        fn = self.visit(node.func)
        args = [self.visit(arg) for arg in node.args]
        kwargs = {kw.arg: self.visit(kw.value) for kw in node.keywords}
        return fn(*args, **kwargs)

    def visit_UnaryOp(self, node: ast.UnaryOp) -> Any:
        operand = self.visit(node.operand)
        if isinstance(node.op, ast.USub):
            return -operand
        if isinstance(node.op, ast.UAdd):
            return +operand
        raise FormulaValidationError("Unsupported unary operator")

    def visit_BinOp(self, node: ast.BinOp) -> Any:
        left = self.visit(node.left)
        right = self.visit(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            if right == 0:
                raise ZeroDivisionError("division by zero")
            return left / right
        if isinstance(node.op, ast.Mod):
            return left % right
        raise FormulaValidationError("Unsupported binary operator")


def normalize_formula(formula: str) -> str:
    return formula.replace("if(", "iff(")


def detect_formula_cycles(calculated_fields: list[Any]) -> None:
    graph = {field.name: field.depends_on for field in calculated_fields}
    visited: set[str] = set()
    active: set[str] = set()

    def visit(node: str) -> None:
        if node in active:
            raise FormulaValidationError(f"Circular dependency detected at {node}")
        if node in visited:
            return
        active.add(node)
        for dep in graph.get(node, []):
            if dep in graph:
                visit(dep)
        active.remove(node)
        visited.add(node)

    for name in graph:
        visit(name)


def topologically_sort_calculated_fields(calculated_fields: list[Any]) -> list[Any]:
    detect_formula_cycles(calculated_fields)
    items = {field.name: field for field in calculated_fields}
    visited: set[str] = set()
    ordered: list[Any] = []

    def visit(name: str) -> None:
        if name in visited:
            return
        field = items[name]
        for dependency in field.depends_on:
            if dependency in items:
                visit(dependency)
        visited.add(name)
        ordered.append(field)

    for field in calculated_fields:
        visit(field.name)

    return ordered


class FormulaEngine:
    def validate_formula(self, formula: str, available_fields: set[str]) -> None:
        normalized = normalize_formula(formula)
        tree = ast.parse(normalized, mode="eval")
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and node.id not in ALLOWED_FUNCTIONS and node.id not in available_fields:
                raise FormulaValidationError(f"Unknown field reference: {node.id}")

    def evaluate(self, formula: str, context: dict[str, Any]) -> Any:
        normalized = normalize_formula(formula)
        wrapped_context = {key: wrap_value(value) for key, value in context.items()}
        tree = ast.parse(normalized, mode="eval")
        evaluator = SafeEvaluator(wrapped_context)
        value = evaluator.visit(tree)
        return unwrap_value(value)

#!/usr/bin/env python3
"""
DentaFlow Pro — Vérificateur Python d'intégrité des schémas, règles Firestore et archives CSV.
Exécutable en autonomie (bibliothèque standard Python 3 uniquement, aucune dépendance pip requise).
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ENTITY_MAP = {
    "staff": ("StaffMember", "isValidStaff"),
    "staffInvites": ("StaffInvite", "isValidStaffInvite"),
    "settings": ("ClinicSettings", "isValidClinicSettings"),
    "patients": ("Patient", "isValidPatient"),
    "appointments": ("Appointment", "isValidAppointment"),
    "bookingRequests": ("BookingRequest", "isValidBookingRequest"),
    "actsCatalog": ("CatalogAct", "isValidCatalogAct"),
    "treatmentPlans": ("TreatmentPlan", "isValidTreatmentPlan"),
    "invoices": ("Invoice", "isValidInvoice"),
    "payments": ("Payment", "isValidPayment"),
    "labOrders": ("LabOrder", "isValidLabOrder"),
    "medicalDocuments": ("MedicalDocument", "isValidMedicalDocument"),
    "recalls": ("Recall", "isValidRecall"),
    "expenses": ("Expense", "isValidExpense"),
    "cashClosures": ("CashClosure", "isValidCashClosure"),
    "inventory": ("InventoryItem", "isValidInventoryItem"),
    "stockMovements": ("StockMovement", "isValidStockMovement"),
    "adminDocuments": ("AdminDocument", "isValidAdminDocument"),
}


def extract_quoted_items(block: str) -> set[str]:
    return set(re.findall(r"['\"]([a-zA-Z0-9_]+)['\"]", block))


def parse_clinic_context_allowed_fields(ts_text: str) -> dict[str, set[str]]:
    match = re.search(
        r"const FIRESTORE_ALLOWED_FIELDS:\s*Record<string,\s*string\[\]>\s*=\s*\{(.*?)\n\};",
        ts_text,
        re.DOTALL,
    )
    if not match:
        raise RuntimeError("FIRESTORE_ALLOWED_FIELDS introuvable dans src/context/ClinicContext.tsx")

    body = match.group(1)
    result: dict[str, set[str]] = {}
    for col_match in re.finditer(r"(\w+)\s*:\s*\[(.*?)\]", body, re.DOTALL):
        col_name = col_match.group(1)
        result[col_name] = extract_quoted_items(col_match.group(2))
    return result


def parse_rules_hasonly_fields(rules_text: str) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for fn_match in re.finditer(
        r"function\s+(isValid\w+)\s*\(data\)\s*\{(.*?)\n\s*\}",
        rules_text,
        re.DOTALL,
    ):
        fn_name = fn_match.group(1)
        fn_body = fn_match.group(2)
        hasonly_match = re.search(r"data\.keys\(\)\.hasOnly\(\[(.*?)\]\)", fn_body, re.DOTALL)
        if hasonly_match:
            result[fn_name] = extract_quoted_items(hasonly_match.group(1))
    return result


def check_schema_synchronicity(errors: list[str]) -> list[str]:
    notes: list[str] = []
    blueprint = json.loads((ROOT / "firebase-blueprint.json").read_text(encoding="utf-8"))
    rules_text = (ROOT / "firestore.rules").read_text(encoding="utf-8")
    clinic_ctx_text = (ROOT / "src/context/ClinicContext.tsx").read_text(encoding="utf-8")

    entities = blueprint.get("entities", {})
    allowed_fields = parse_clinic_context_allowed_fields(clinic_ctx_text)
    rules_fields = parse_rules_hasonly_fields(rules_text)

    for col_name, (entity_name, validator_name) in ENTITY_MAP.items():
        if entity_name not in entities:
            errors.append(f"Entité manquante dans firebase-blueprint.json : {entity_name}")
            continue
        if validator_name not in rules_fields:
            errors.append(f"Validateur manquant dans firestore.rules : {validator_name}")
            continue

        bp_props = set(entities[entity_name].get("properties", {}).keys())
        rule_props = rules_fields[validator_name]

        if bp_props != rule_props:
            only_bp = sorted(bp_props - rule_props)
            only_rules = sorted(rule_props - bp_props)
            errors.append(
                f"Désynchronisation {entity_name}/{validator_name} : "
                f"blueprintOnly={only_bp}, rulesOnly={only_rules}"
            )

        if col_name in allowed_fields:
            client_writable = allowed_fields[col_name]
            expected_writable = bp_props - {"createdAt", "updatedAt"}
            if client_writable != expected_writable:
                extra_client = sorted(client_writable - expected_writable)
                missing_client = sorted(expected_writable - client_writable)
                errors.append(
                    f"Désynchronisation FIRESTORE_ALLOWED_FIELDS[{col_name}] : "
                    f"extra={extra_client}, missing={missing_client}"
                )

    notes.append(f"Schémas synchronisés vérifiés sur {len(ENTITY_MAP)} entités.")
    return notes


def check_firestore_rules_hardening(errors: list[str]) -> list[str]:
    notes: list[str] = []
    rules_text = (ROOT / "firestore.rules").read_text(encoding="utf-8")

    if "rules_version = '2';" not in rules_text:
        errors.append("firestore.rules doit déclarer rules_version = '2';")

    if not re.search(r"match\s+/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;", rules_text):
        errors.append("Filet de sécurité global default-deny manquant dans firestore.rules")

    in_test_connection = False
    for line_no, line in enumerate(rules_text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("match /test/connection"):
            in_test_connection = True
        elif in_test_connection and stripped == "}":
            in_test_connection = False

        if stripped.startswith("allow "):
            if re.search(r":\s*if\s+true\s*;", stripped):
                errors.append(f"firestore.rules:{line_no} contient un accès public `if true;`")
            if not in_test_connection and re.search(r":\s*if\s+isSignedIn\(\)\s*;", stripped):
                errors.append(f"firestore.rules:{line_no} contient un accès générique `if isSignedIn();`")
            if stripped.startswith("allow list:") and re.search(r"resource\.data\.\w+\s+is\s+(bool|string|number)", stripped):
                errors.append(
                    f"firestore.rules:{line_no} contient un prédicat `resource.data.<champ> is <type>` "
                    "bloquant l'analyseur statique des requêtes list"
                )

    notes.append("Audit statique de sécurité Firestore (anti-régression list & default-deny) validé.")
    return notes


def check_csv_archives(errors: list[str]) -> list[str]:
    notes: list[str] = []
    csv_dir = ROOT / "public/assets/cabinet"
    csv_files = sorted(csv_dir.glob("*.csv"))
    if not csv_files:
        errors.append("Aucun fichier CSV d'archive détecté dans public/assets/cabinet/")
        return notes

    total_rows = 0
    for csv_path in csv_files:
        try:
            with csv_path.open("r", encoding="utf-8-sig", newline="") as fh:
                reader = csv.reader(fh)
                rows = [row for row in reader if any(cell.strip() for cell in row)]
        except Exception as exc:
            errors.append(f"Erreur lecture CSV {csv_path.name} : {exc}")
            continue

        if not rows:
            errors.append(f"CSV vide : {csv_path.name}")
            continue

        headers = rows[0]
        if any(not h.strip() for h in headers):
            errors.append(f"En-tête vide détecté dans {csv_path.name}")

        expected_cols = len(headers)
        for idx, row in enumerate(rows[1:], start=2):
            if len(row) != expected_cols:
                errors.append(
                    f"{csv_path.name}: ligne {idx} possède {len(row)} colonnes au lieu de {expected_cols}"
                )
        total_rows += max(0, len(rows) - 1)

    notes.append(f"Intégrité CSV vérifiée ({len(csv_files)} fichiers, {total_rows} enregistrements).")
    return notes


def check_config_and_secrets(errors: list[str]) -> list[str]:
    notes: list[str] = []
    fb_cfg = json.loads((ROOT / "firebase-applet-config.json").read_text(encoding="utf-8"))
    for req_key in ("projectId", "appId", "apiKey", "authDomain", "firestoreDatabaseId"):
        val = str(fb_cfg.get(req_key, "")).strip()
        if not val or "remixed-" in val:
            errors.append(f"firebase-applet-config.json invalide pour '{req_key}'")

    env_example = (ROOT / ".env.example").read_text(encoding="utf-8")
    for secret_pattern in (r"sk-[A-Za-z0-9]{20,}", r"AIza[0-9A-Za-z\-_]{20,}", r"AC[0-9a-f]{32}"):
        if re.search(secret_pattern, env_example):
            errors.append(".env.example semble contenir un vrai secret au lieu d'un placeholder")

    metadata = json.loads((ROOT / "metadata.json").read_text(encoding="utf-8"))
    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    if not metadata.get("name") or "<title>" not in index_html:
        errors.append("metadata.json ou index.html incomplet")

    notes.append("Configuration Firebase, métadonnées et hygiène .env.example validées.")
    return notes


def main() -> int:
    errors: list[str] = []
    notes: list[str] = []

    for check in (
        check_schema_synchronicity,
        check_firestore_rules_hardening,
        check_csv_archives,
        check_config_and_secrets,
    ):
        notes.extend(check(errors))

    for note in notes:
        print(f"[OK] {note}")

    if errors:
        print("\nErreurs d'intégrité détectées :", file=sys.stderr)
        for err in errors:
            print(f" - {err}", file=sys.stderr)
        return 1

    print("\nVérification Python complète : aucune anomalie détectée.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

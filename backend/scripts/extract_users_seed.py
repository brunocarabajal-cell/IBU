#!/usr/bin/env python3
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


LOCATION_ALIASES = {
    "512": ("ADMBASE12", "Administración Base 12"),
    "700": ("ADMCENTRAL", "Administración Central"),
}


PROFILE_DESCRIPTIONS = {
    "Administrativo": "Administrativo con acceso restringido a su ubicación",
    "Gerencia": "Gerencia con acceso restringido a su ubicación",
    "Administrativo Predio": "Administrativo de predio con acceso restringido a sus ubicaciones",
    "Sumador": "Sumador con acceso restringido a sus ubicaciones",
    "Contador": "Contador con acceso restringido a sus ubicaciones",
    "Analista de AAFF": "Analista de Activos Fijos con acceso a todas las ubicaciones",
}


def column_index(cell_ref):
    letters = "".join(char for char in cell_ref if char.isalpha())
    result = 0
    for char in letters:
        result = result * 26 + ord(char.upper()) - 64
    return result - 1


def load_shared_strings(zip_file):
    if "xl/sharedStrings.xml" not in zip_file.namelist():
        return []

    root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    values = []
    for item in root.findall("a:si", NS):
        text = "".join((node.text or "") for node in item.iterfind(".//a:t", NS))
        values.append(text)
    return values


def cell_value(cell, shared_strings):
    value_node = cell.find("a:v", NS)
    if value_node is None:
        return ""

    raw_value = value_node.text or ""
    if cell.attrib.get("t") == "s" and raw_value.isdigit():
        return shared_strings[int(raw_value)]
    return raw_value


def read_sheet_rows(workbook_path, sheet_name):
    with zipfile.ZipFile(workbook_path) as zip_file:
        workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
        relationships = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
        relationship_map = {
            rel.attrib["Id"]: rel.attrib["Target"] for rel in relationships
        }
        shared_strings = load_shared_strings(zip_file)

        target_path = None
        for sheet in workbook.find("a:sheets", NS):
            if sheet.attrib["name"] == sheet_name:
                rel_id = sheet.attrib[
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
                ]
                target_path = relationship_map[rel_id]
                break

        if target_path is None:
            raise ValueError(f"No se encontró la hoja '{sheet_name}'")

        worksheet = ET.fromstring(zip_file.read(f"xl/{target_path}"))
        rows = []
        for row in worksheet.findall(".//a:sheetData/a:row", NS):
            current_row = []
            for cell in row.findall("a:c", NS):
                idx = column_index(cell.attrib["r"])
                while len(current_row) < idx:
                    current_row.append("")
                current_row.append(cell_value(cell, shared_strings))
            rows.append(current_row)
        return rows


def normalize_text(value):
    return str(value).strip() if value not in (None, "") else None


def title_case_name(value):
    text = normalize_text(value)
    if not text:
        return text

    words = text.lower().split()
    capitalized = []
    for word in words:
        pieces = word.split("-")
        cap_pieces = []
        for piece in pieces:
            if not piece:
                cap_pieces.append(piece)
                continue
            cap_pieces.append(piece[:1].upper() + piece[1:])
        capitalized.append("-".join(cap_pieces))
    return " ".join(capitalized)


def normalize_location(raw_code):
    if raw_code is None:
        return None, None

    clean_code = str(raw_code).strip()
    if clean_code in LOCATION_ALIASES:
        return LOCATION_ALIASES[clean_code]

    if clean_code.isdigit():
        number = int(clean_code)
        code = f"SUC {str(number).zfill(2) if number < 100 else number}"
        description = f"Sucursal {number}"
        return code, description

    return clean_code, clean_code


def normalize_profile(raw_position):
    position = (raw_position or "").strip().upper()

    if "ACTIVOS FIJOS" in position:
      return "Analista de AAFF", PROFILE_DESCRIPTIONS["Analista de AAFF"], True

    if "CONTADOR" in position:
      return "Contador", PROFILE_DESCRIPTIONS["Contador"], False

    if "PREDIO" in position:
      return "Administrativo Predio", PROFILE_DESCRIPTIONS["Administrativo Predio"], False

    if "SUMADOR" in position:
      return "Sumador", PROFILE_DESCRIPTIONS["Sumador"], False

    if "GERENCIA" in position:
      return "Gerencia", PROFILE_DESCRIPTIONS["Gerencia"], False

    if "ADMINISTRACION" in position:
      return "Administrativo", PROFILE_DESCRIPTIONS["Administrativo"], False

    return raw_position or "Sin perfil", f"Perfil original: {raw_position or 'Sin perfil'}", False


def build_seed(rows):
    headers = rows[0]
    index_by_header = {name: idx for idx, name in enumerate(headers)}
    data_rows = rows[1:]

    def get(row, header):
        idx = index_by_header.get(header)
        return row[idx] if idx is not None and idx < len(row) else ""

    seed = []
    for row in data_rows:
        legajo = normalize_text(get(row, "Empleado"))
        if not legajo:
            continue

        raw_location = normalize_text(get(row, "Suc."))
        location_code, location_description = normalize_location(raw_location)
        profile, profile_description, full_access = normalize_profile(
            normalize_text(get(row, "Puesto"))
        )

        seed.append(
            {
                "legajo": int(float(legajo)),
                "nombre": title_case_name(get(row, "Apellido y Nombre")),
                "puestoOriginal": normalize_text(get(row, "Puesto")),
                "perfil": profile,
                "perfilDescripcion": profile_description,
                "ubicacionOrigen": raw_location,
                "ubicacionCodigo": location_code,
                "ubicacionDescripcion": location_description,
                "accesoTotalUbicaciones": 1 if full_access else 0,
                "activo": 1,
            }
        )

    return seed


def main():
    if len(sys.argv) != 3:
        print("Uso: extract_users_seed.py <archivo.xlsx> <salida.json>", file=sys.stderr)
        raise SystemExit(1)

    workbook_path = Path(sys.argv[1]).expanduser().resolve()
    output_path = Path(sys.argv[2]).expanduser().resolve()
    rows = read_sheet_rows(workbook_path, "FTE Online")
    seed = build_seed(rows)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(seed, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Seed generado con {len(seed)} usuarios en {output_path}")


if __name__ == "__main__":
    main()

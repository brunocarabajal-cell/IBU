#!/usr/bin/env python3
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def excel_serial_to_iso(value):
    if value in (None, ""):
        return None

    try:
        serial = int(float(value))
    except ValueError:
        return str(value)

    base_date = date(1899, 12, 30)
    return (base_date + timedelta(days=serial)).isoformat()


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
            raise ValueError(f"No se encontro la hoja '{sheet_name}'")

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


def normalize_int(value):
    if value in (None, ""):
        return 0

    try:
        return int(float(value))
    except ValueError:
        return 0


def build_seed(rows):
    headers = rows[0]
    data_rows = rows[1:]
    index_by_header = {name: idx for idx, name in enumerate(headers)}
    carry_fields = {}

    def get(row, header):
        idx = index_by_header.get(header)
        return row[idx] if idx is not None and idx < len(row) else ""

    records = []
    for row in data_rows:
        raw_inventory_number = normalize_text(get(row, "N° de Inventario"))
        raw_location = normalize_text(get(row, "Ubicación"))
        raw_grouping = normalize_text(get(row, "Agrupacion"))
        raw_inventory_date = excel_serial_to_iso(get(row, "Fecha de Inventario"))

        inventory_number = raw_inventory_number or carry_fields.get("inventoryNumber")
        location = raw_location or carry_fields.get("location")
        grouping = raw_grouping or carry_fields.get("grouping")
        inventory_date = raw_inventory_date or carry_fields.get("inventoryDate")

        if not inventory_number:
            continue

        carry_fields.update(
            {
                "inventoryNumber": inventory_number,
                "location": location,
                "grouping": grouping,
                "inventoryDate": inventory_date,
            }
        )

        records.append(
            {
                "inventoryNumber": inventory_number,
                "location": location,
                "grouping": grouping,
                "inventoryDate": inventory_date,
                "classNumber": normalize_text(get(row, "N° Clase")),
                "classDescription": normalize_text(get(row, "Descripcion Clase")),
                "theoreticalStock": normalize_int(get(row, "Stock Teorico")),
                "physicalSuitableStock": normalize_int(get(row, "Stock Fisicos Aptos")),
                "physicalUnsuitableStock": normalize_int(get(row, "Stock Fisicos No Aptos")),
                "difference": normalize_int(get(row, "Diferencia")),
                "status": normalize_text(get(row, "Observacion")),
                "type": normalize_text(get(row, "Tipo")),
                "module": normalize_text(get(row, "Modulo")),
                "calification": normalize_text(get(row, "Calif")),
                "extension": normalize_text(get(row, "Prorroga")),
                "managerAssigned": normalize_text(get(row, "Gerente")),
                "note": normalize_text(get(row, "Observacion Parte")),
                "dropNumber": normalize_text(get(row, "N° de Baja")),
                "administrative": normalize_text(get(row, "Administrativo")),
                "participant1": normalize_text(get(row, "Participante 1")),
                "participant2": normalize_text(get(row, "Participante 2")),
                "managerSignature": normalize_text(get(row, "Gerente")),
            }
        )

    return records


def main():
    if len(sys.argv) != 3:
        print(
            "Uso: extract_inventarios_seed.py <archivo.xlsx> <salida.json>",
            file=sys.stderr,
        )
        raise SystemExit(1)

    workbook_path = Path(sys.argv[1]).expanduser().resolve()
    output_path = Path(sys.argv[2]).expanduser().resolve()

    rows = read_sheet_rows(workbook_path, "Inventario Pasados")
    seed = build_seed(rows)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(seed, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Seed generado con {len(seed)} registros en {output_path}")


if __name__ == "__main__":
    main()

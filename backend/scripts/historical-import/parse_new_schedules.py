import openpyxl, csv, datetime, sys, re
from collections import Counter

SRC_DIR = r"C:\Users\shywh\Desktop\tele2-app"
FILES = [
    "Планы и график ноябрь 2025.xlsx",
    "планы и график Декабрь 2025.xlsx",
    "планы и график январь 2026.xlsx",
    "планы и график МАРТ 2026.xlsx",
]
OUT = "source/t2_new_schedules.csv"
SHEET = "График"

ALIASES = {
    "Степанов Алекскей Юрьевич": "Степанов Алексей Юрьевич",
}

DAY_OFF_CODES = {"вых", "выход", "отпуск", "отпуску", "бол", "больничный"}

TIME_RE = re.compile(r"^(\d{1,2})-(\d{1,2})$")

# legend anchor colors (row4=orange~Калинина 2, row5=blue~Космонавтов 20а), read per-file
ORANGE_ANCHOR = (255, 153, 0)
BLUE_ANCHOR = (201, 218, 248)


def rgb(hexstr):
    if not hexstr or len(hexstr) != 8:
        return None
    return tuple(int(hexstr[i:i + 2], 16) for i in (2, 4, 6))


def dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))


def parse_time(code):
    m = TIME_RE.match(code)
    if not m:
        return None
    h1, h2 = m.group(1), m.group(2)
    return f"{int(h1):02d}:00", f"{int(h2):02d}:00"


def process_file(path, fname):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[SHEET]

    date_row = None
    for r in range(1, 12):
        for c in range(1, 40):
            if isinstance(ws.cell(r, c).value, datetime.datetime):
                date_row = r
                break
        if date_row:
            break
    assert date_row, f"no date row found in {fname}"

    dates = []
    for c in range(1, 45):
        v = ws.cell(date_row, c).value
        if isinstance(v, datetime.datetime):
            dates.append((c, v.date().isoformat()))

    employee_rows = []
    for r in range(date_row + 1, date_row + 40):
        if ws.cell(r, 3).value == "режим":
            employee_rows.append(r)

    # collect all non-black cell colors across all employee/date cells -> pick top 2 as store colors
    color_counts = Counter()
    for r in employee_rows:
        for c, _ in dates:
            cell = ws.cell(r, c)
            if cell.value is None:
                continue
            col = cell.fill.fgColor.rgb if cell.fill and cell.fill.fgColor else None
            if col and col != "00000000":
                color_counts[col] += 1

    top_colors = [c for c, _ in color_counts.most_common(3)]
    store_color_map = {}
    for c in top_colors[:2]:
        r, g, b = rgb(c)
        d_orange = dist((r, g, b), ORANGE_ANCHOR)
        d_blue = dist((r, g, b), BLUE_ANCHOR)
        store_color_map[c] = "kalinina2" if d_orange < d_blue else "kosmonavtov"

    rows = []
    unknown = []
    for r in employee_rows:
        name_raw = ws.cell(r, 1).value
        if not name_raw:
            continue
        name = str(name_raw).split("\n")[0].strip()
        name = ALIASES.get(name, name)
        for c, date_iso in dates:
            cell = ws.cell(r, c)
            code = cell.value
            if code is None:
                continue
            code_str = str(code).strip()
            code_lc = code_str.lower()

            if code_lc in DAY_OFF_CODES:
                rows.append([name, date_iso, "day_off", "", "", "", code_str])
                continue

            fill_color = cell.fill.fgColor.rgb if cell.fill and cell.fill.fgColor else None
            store_id = store_color_map.get(fill_color)

            times = parse_time(code_str)
            if store_id and times:
                start, end = times
                rows.append([name, date_iso, "working", store_id, start, end, code_str])
            else:
                unknown.append((fname, name, date_iso, code_str, fill_color))

    return rows, unknown, store_color_map


all_rows = []
all_unknown = []
for fname in FILES:
    path = f"{SRC_DIR}\\{fname}"
    rows, unknown, store_map = process_file(path, fname)
    print(f"{fname}: {len(rows)} rows, {len(unknown)} unknown, store_color_map={store_map}", file=sys.stderr)
    all_rows.extend(rows)
    all_unknown.extend(unknown)

with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["employee_name", "date", "status", "store_id", "shift_start", "shift_end", "raw_code"])
    w.writerows(all_rows)

print(f"TOTAL: wrote {len(all_rows)} rows, {len(all_unknown)} unknown codes", file=sys.stderr)
if all_unknown:
    for u in all_unknown:
        print(u, file=sys.stderr)

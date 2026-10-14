"""EkCode matching engine (pure Python, no Django imports).

Ported one-to-one from the browser prototype, including its seeded random generator, so
the sample material masters and the matching results are identical in both versions.

Pipeline: normalise text -> extract attributes -> group candidates -> match and score ->
conflict-guarded clustering -> standard description -> UNSPSC class -> national code.
"""
import hashlib
import math
import re
from collections import OrderedDict
from decimal import ROUND_HALF_UP, Decimal

# ---------------------------------------------------------------- helpers (JavaScript-exact)
M32 = 0xFFFFFFFF


def imul(a, b):
    return (a * b) & M32


def mulberry32(seed):
    st = [seed & M32]

    def rnd():
        st[0] = (st[0] + 0x6D2B79F5) & M32
        t = st[0]
        t = imul(t ^ (t >> 15), 1 | t)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296
    return rnd


def jround(x):
    """JavaScript Math.round (half up)."""
    return int(math.floor(x + 0.5))


def js_fixed2(x):
    return float(Decimal(x).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def jsnum(s):
    f = float(s)
    return int(f) if f.is_integer() else f


def uniq(seq):
    return list(OrderedDict.fromkeys(seq))


def most_common(vals):
    counts = OrderedDict()
    for v in vals:
        counts[v] = counts.get(v, 0) + 1
    best, n = None, -1
    for v, c in counts.items():
        if c > n:
            best, n = v, c
    return best


def sha256hex(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def luhn(num):
    d = [int(x) for x in re.sub(r'\D', '', str(num))][::-1]
    s = 0
    for i, x in enumerate(d):
        if i % 2 == 0:
            x *= 2
            if x > 9:
                x -= 9
        s += x
    return (10 - s % 10) % 10


# ---------------------------------------------------------------- reference data
CPSES = [
    {'id': 'REF', 'short': 'Refinery', 'name': 'Refinery CPSE', 'city': 'Chennai', 'erp': 'SAP ECC 6.0', 'color': '#FF7A45'},
    {'id': 'STL', 'short': 'Steel', 'name': 'Steel CPSE', 'city': 'Bhilai', 'erp': 'SAP S/4HANA', 'color': '#4EA8FF'},
    {'id': 'PWR', 'short': 'Power', 'name': 'Power CPSE', 'city': 'Ramagundam', 'erp': 'SAP ECC 6.0', 'color': '#2FD6C3'},
    {'id': 'MIN', 'short': 'Mining', 'name': 'Mining CPSE', 'city': 'Dhanbad', 'erp': 'Oracle EBS', 'color': '#C08BFF'},
]
UPL = {'id': 'UPL', 'short': 'Upload', 'name': 'Your upload', 'city': 'CSV file', 'erp': 'Any ERP extract', 'color': '#E8ECF3'}

CLASSES = OrderedDict([
    ('VGT', {'name': 'Gate valves', 'noun': 'VALVE, GATE', 'group': 'valve', 'type': 'GATE', 'unspsc': '40141600', 'unspscName': 'Valves', 'nat': 'VLV-GAT', 'mtart': 'ERSA'}),
    ('VGL', {'name': 'Globe valves', 'noun': 'VALVE, GLOBE', 'group': 'valve', 'type': 'GLOBE', 'unspsc': '40141600', 'unspscName': 'Valves', 'nat': 'VLV-GLB', 'mtart': 'ERSA'}),
    ('VBL', {'name': 'Ball valves', 'noun': 'VALVE, BALL', 'group': 'valve', 'type': 'BALL', 'unspsc': '40141600', 'unspscName': 'Valves', 'nat': 'VLV-BAL', 'mtart': 'ERSA'}),
    ('PMP', {'name': 'Centrifugal pumps', 'noun': 'PUMP, CENTRIFUGAL', 'group': 'pump', 'unspsc': '40151500', 'unspscName': 'Pumps', 'nat': 'PMP-CEN', 'mtart': 'ERSA'}),
    ('BRG', {'name': 'Bearings', 'noun': 'BEARING', 'group': 'bearing', 'unspsc': '31171500', 'unspscName': 'Bearings', 'nat': 'BRG-ROL', 'mtart': 'ERSA'}),
    ('BLT', {'name': 'Hex bolts', 'noun': 'BOLT, HEX HEAD', 'group': 'bolt', 'unspsc': '31161600', 'unspscName': 'Bolts', 'nat': 'FST-BLT', 'mtart': 'HAWA'}),
    ('NUT', {'name': 'Hex nuts', 'noun': 'NUT, HEX', 'group': 'nut', 'unspsc': '31161700', 'unspscName': 'Nuts', 'nat': 'FST-NUT', 'mtart': 'HAWA'}),
    ('CBL', {'name': 'Power cables', 'noun': 'CABLE, POWER', 'group': 'cable', 'unspsc': '26121600', 'unspscName': 'Electrical cable and accessories', 'nat': 'CBL-PWR', 'mtart': 'HAWA'}),
])
CLS_ORDER = list(CLASSES.keys())


def F(k, label, w, key=0, soft=0, brand=0):
    return {'k': k, 'label': label, 'w': w, 'key': key, 'soft': soft, 'brand': brand}


SCHEMA = {
    'valve': [F('size', 'Size', 3, 1), F('rating', 'Pressure class', 3, 1), F('end', 'End connection', 2, 1), F('material', 'Body material', 2), F('standard', 'Standard', 1, soft=1)],
    'pump': [F('flow', 'Flow', 3, 1), F('head', 'Head', 3, 1), F('power', 'Motor', 2), F('material', 'Casing', 2), F('standard', 'Standard', 1, soft=1)],
    'bearing': [F('designation', 'Designation', 3, 1), F('seal', 'Seal', 2, 1), F('clearance', 'Clearance', 1), F('brand', 'Make', 0, brand=1)],
    'bolt': [F('thread', 'Thread', 3, 1), F('length', 'Length', 3, 1), F('grade', 'Grade', 2, 1), F('finish', 'Finish', 2), F('standard', 'Standard', 1, soft=1)],
    'nut': [F('thread', 'Thread', 3, 1), F('grade', 'Grade', 2, 1), F('finish', 'Finish', 2)],
    'cable': [F('cores', 'Cores', 3, 1), F('csa', 'Size', 3, 1), F('conductor', 'Conductor', 2, 1), F('insulation', 'Insulation', 2), F('armour', 'Armour', 1), F('voltage', 'Voltage', 2, 1)],
}
BLOCK = {'valve': 'size', 'pump': 'flow', 'bearing': 'designation', 'bolt': 'thread', 'nut': 'thread', 'cable': 'csa'}
EQUIV = [('A105', 'A216 WCB'), ('SS316', 'CF8M')]
EQUIV_NOTE = {'A105|A216 WCB': 'A216 WCB is the cast equivalent of forged A105', 'SS316|CF8M': 'CF8M is the cast equivalent of SS 316'}
INCH = {15: '1/2', 20: '3/4', 25: '1', 40: '1-1/2', 50: '2', 80: '3', 100: '4', 150: '6', 200: '8'}
INCH2DN = {v: k for k, v in INCH.items()}
MATN = {'A105': 'ASTM A105', 'A216 WCB': 'ASTM A216 WCB', 'SS316': 'SS 316', 'CF8M': 'ASTM A351 CF8M', 'CS': 'CARBON STEEL', 'CI': 'CAST IRON'}
ENDN = {'RF': 'FLANGED RF', 'BW': 'BUTT WELD', 'SW': 'SOCKET WELD', 'NPT': 'THREADED NPT'}
FINN = {'HDG': 'HOT DIP GALVANISED', 'ZINC': 'ZINC PLATED', 'PLAIN': 'PLAIN'}


def fmt_val(k, v):
    if v is None:
        return '—'
    return {
        'size': lambda: f'DN{v} ({INCH.get(v, "?")} in)', 'rating': lambda: f'Class {v}', 'material': lambda: MATN.get(v, v),
        'end': lambda: ENDN.get(v, v), 'flow': lambda: f'{v} m³/h', 'head': lambda: f'{v} m', 'power': lambda: f'{v} kW',
        'length': lambda: f'{v} mm', 'thread': lambda: f'M{v}', 'csa': lambda: f'{v} sq mm', 'cores': lambda: f'{v} core',
        'voltage': lambda: f'{v} kV', 'finish': lambda: FINN.get(v, v),
        'conductor': lambda: 'Aluminium' if v == 'AL' else 'Copper' if v == 'CU' else v,
    }.get(k, lambda: str(v))()


def js_str(v):
    """String(v) as JavaScript would print a number or string."""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


# ---------------------------------------------------------------- synthetic material masters
class Rand:
    def __init__(self, seed):
        self.R = mulberry32(seed)

    def rnd(self, a, b):
        return a + self.R() * (b - a)

    def rint(self, a, b):
        return int(math.floor(self.rnd(a, b + 1)))

    def pick(self, arr):
        return arr[int(math.floor(self.R() * len(arr)))]

    def chance(self, p):
        return self.R() < p


def build_canon(rg):
    out, seen = [], set()

    def add(cls, a, base):
        key = cls + repr(sorted(a.items()))
        if key in seen:
            return False
        seen.add(key)
        out.append({'cls': cls, 'group': CLASSES[cls]['group'], 'a': a, 'base': base})
        return True

    v_std = {'VGT': lambda r: 'API 602' if r == 800 else 'API 600', 'VGL': lambda r: 'BS 1873', 'VBL': lambda r: 'API 6D'}
    for cls in ('VGT', 'VGL', 'VBL'):
        n, guard = 0, 0
        while n < 17 and guard < 500:
            guard += 1
            size = rg.pick([15, 25, 40, 50, 80, 100, 150, 200])
            small = size <= 40
            rating = rg.pick([800, 800, 150]) if small else rg.pick([150, 150, 300, 600])
            end = rg.pick(['SW', 'NPT', 'SW']) if rating == 800 else rg.pick(['RF', 'RF', 'BW'])
            material = rg.pick(['A105', 'A105', 'A105', 'SS316'])
            a = {'type': CLASSES[cls]['type'], 'size': size, 'rating': rating, 'end': end, 'material': material, 'standard': v_std[cls](rating)}
            base = jround((size * 95 + rating * 9) * (2.6 if material == 'SS316' else 1) * (1.2 if cls == 'VBL' else 1.15 if cls == 'VGL' else 1))
            if add(cls, a, base):
                n += 1
            if rg.chance(.22) and rating != 800:
                add(cls, {**a, 'rating': 300 if rating == 150 else 150}, jround(base * 1.3))
    for flow, head, power in [(25, 32, 5.5), (40, 35, 7.5), (50, 40, 11), (80, 45, 18.5), (100, 50, 22), (150, 60, 37), (200, 70, 55)]:
        for m in ('CI', 'SS316', 'CS'):
            if rg.chance(.55):
                add('PMP', {'flow': flow, 'head': head, 'power': power, 'material': m, 'standard': 'API 610' if m == 'CS' else 'ISO 5199'},
                    jround(power * 21000 * (1.8 if m == 'SS316' else 2.2 if m == 'CS' else 1)))
    for d in (6204, 6205, 6206, 6207, 6208, 6305, 6306, 6308, 6310, 22218, 22220, 22318):
        roller = d > 20000
        for seal in (['OPEN'] if roller else ['2RS', 'ZZ', 'OPEN']):
            if roller or rg.chance(.62):
                clearance = 'C3' if (roller or rg.chance(.35)) else None
                add('BRG', {'designation': d, 'seal': seal, 'clearance': clearance, 'brand': None},
                    18000 + (d % 100) * 900 if roller else 180 + (d % 100) * 38)
    lengths = {12: [50, 60], 16: [60, 80, 100], 20: [80, 100], 24: [100, 120, 150]}
    for t in (12, 16, 20, 24):
        for l in lengths[t]:
            grade = rg.pick(['8.8', '8.8', '10.9', 'B7'])
            finish = rg.pick(['PLAIN', 'HDG']) if grade == 'B7' else rg.pick(['HDG', 'ZINC', 'HDG'])
            add('BLT', {'thread': t, 'length': l, 'grade': grade, 'finish': finish, 'standard': 'ASTM A193' if grade == 'B7' else 'IS 1364'},
                jround(t * l * .045 * (2.4 if grade == 'B7' else 1.5 if grade == '10.9' else 1)))
            if rg.chance(.4):
                add('BLT', {'thread': t, 'length': l, 'grade': '10.9' if grade == '8.8' else '8.8', 'finish': finish, 'standard': 'IS 1364'}, jround(t * l * .05))
    for t in (12, 16, 20, 24):
        for grade, finish in (('8', 'HDG'), ('8', 'ZINC'), ('10', 'HDG'), ('2H', 'PLAIN')):
            if rg.chance(.7):
                add('NUT', {'thread': t, 'grade': grade, 'finish': finish}, jround(t * t * .09 * (2.2 if grade == '2H' else 1)))
    for cores, csa, conductor, insulation, voltage in [('3.5', 95, 'AL', 'XLPE', '1.1'), ('3.5', 150, 'AL', 'XLPE', '1.1'), ('3.5', 185, 'AL', 'XLPE', '1.1'),
                                                       ('3.5', 240, 'AL', 'XLPE', '1.1'), ('3.5', 300, 'AL', 'XLPE', '1.1'), ('4', 6, 'CU', 'PVC', '1.1'),
                                                       ('4', 10, 'CU', 'PVC', '1.1'), ('4', 16, 'CU', 'PVC', '1.1'), ('4', 25, 'CU', 'XLPE', '1.1'),
                                                       ('3', 185, 'AL', 'XLPE', '11'), ('3', 240, 'AL', 'XLPE', '11'), ('3', 300, 'AL', 'XLPE', '11')]:
        add('CBL', {'cores': cores, 'csa': csa, 'conductor': conductor, 'insulation': insulation, 'armour': 'ARMOURED', 'voltage': voltage},
            jround(csa * (14 if conductor == 'CU' else 3.2) * (2.4 if voltage == '11' else 1) + 60))
    return out


def tidy(s):
    return re.sub(r'\s+', ' ', s).strip()


def tidy_c(arr):
    return ','.join(x for x in arr if x)


def tidy_w(arr):
    return ', '.join(x for x in arr if x)


def title(s):
    return s[:1] + s[1:].lower()


MATW = {
    'REF': {'A105': 'A105', 'SS316': 'SS316', 'A216 WCB': 'WCB', 'CF8M': 'CF8M', 'CS': 'CS', 'CI': 'CI'},
    'STL': {'A105': 'A105', 'SS316': 'SS316', 'A216 WCB': 'A216 WCB', 'CF8M': 'CF8M', 'CS': 'CS', 'CI': 'CAST IRON'},
    'PWR': {'A105': 'CARBON STEEL A105', 'SS316': 'SS 316', 'A216 WCB': 'CAST CS WCB', 'CF8M': 'CAST SS CF8M', 'CS': 'CARBON STEEL', 'CI': 'CI'},
    'MIN': {'A105': 'Carbon Steel A105', 'SS316': 'Stainless Steel 316', 'A216 WCB': 'Cast Carbon Steel WCB', 'CF8M': 'Cast Stainless CF8M', 'CS': 'Carbon Steel', 'CI': 'Cast Iron'},
}
ENDW = {'REF': {'RF': 'FLGD RF', 'BW': 'BW', 'SW': 'SW', 'NPT': 'SCRD NPT'}, 'STL': {'RF': 'FLANGED RF', 'BW': 'BUTT WELD', 'SW': 'SOCKET WELD', 'NPT': 'SCREWED NPT'},
        'PWR': {'RF': 'RF FLANGED', 'BW': 'BUTT WELD END', 'SW': 'SOCKET WELD END', 'NPT': 'THREADED NPT'}, 'MIN': {'RF': 'Flanged RF', 'BW': 'Butt Weld', 'SW': 'Socket Weld', 'NPT': 'Threaded NPT'}}
FIN_STL = {'HDG': 'HOT DIP GALV', 'ZINC': 'ZINC PLATED', 'PLAIN': 'BLACK'}
FIN_PWR = {'HDG': 'HDG', 'ZINC': 'ZN', 'PLAIN': 'BLK'}
FIN_MIN = {'HDG': 'Hot Dip Galvanised', 'ZINC': 'Zinc Plated', 'PLAIN': 'Plain'}


def n2s(v):
    return '' if v is None else js_str(v)


def describe(group, style, a):
    g = a.get
    if group == 'valve':
        if style == 'REF':
            return tidy(f"{a['type']} VLV {INCH[a['size']]}\" {MATW['REF'].get(g('material'), '') if g('material') else ''} {str(g('rating')) + '#' if g('rating') else ''} {ENDW['REF'][a['end']]} {g('standard').replace(' ', '', 1) if g('standard') else ''}")
        if style == 'STL':
            return tidy_c(['VALVE', a['type'], f"{a['size']}MM", MATW['STL'].get(g('material')) if g('material') else None, f"CL{g('rating')}" if g('rating') else '', ENDW['STL'][a['end']], g('standard')])
        if style == 'PWR':
            return tidy(f"{ {'GATE': 'GT', 'GLOBE': 'GLB', 'BALL': 'BALL'}[a['type']] } VALVE DN{a['size']} {MATW['PWR'].get(g('material'), '') if g('material') else ''} {str(g('rating')) + 'LB' if g('rating') else ''} {ENDW['PWR'][a['end']]}")
        return tidy_w([f"{title(a['type'])} Valve {INCH[a['size']]} inch", MATW['MIN'].get(g('material')) if g('material') else None, f"Class {g('rating')}" if g('rating') else '', ENDW['MIN'][a['end']], g('standard')])
    if group == 'pump':
        if style == 'REF':
            return tidy(f"PUMP CENTRIFUGAL {n2s(a['flow'])}M3/H {n2s(a['head'])}M {n2s(a['power'])}KW {MATW['REF'][a['material']]} {g('standard').replace(' ', '', 1) if g('standard') else ''}")
        if style == 'STL':
            return tidy_c(['CENT PUMP', f"Q={n2s(a['flow'])} CMH", f"H={n2s(a['head'])}M", f"{n2s(a['power'])} KW", {'CI': 'CAST IRON', 'SS316': 'SS316', 'CS': 'CARBON STEEL'}[a['material']], g('standard')])
        if style == 'PWR':
            return tidy(f"CENTRIFUGAL PMP {n2s(a['flow'])} M3/HR X {n2s(a['head'])} M HEAD {n2s(a['power'])}KW MOTOR { {'CI': 'CI', 'SS316': 'SS316', 'CS': 'CS'}[a['material']] } CASING")
        return tidy_w([f"Centrifugal Pump {n2s(a['flow'])} m3/h @ {n2s(a['head'])} m head", f"{n2s(a['power'])} kW", {'CI': 'Cast Iron', 'SS316': 'Stainless Steel 316', 'CS': 'Carbon Steel'}[a['material']] + ' casing', g('standard')])
    if group == 'bearing':
        d, seal, clr, brand = a['designation'], a['seal'], g('clearance'), a['brand']
        if style == 'REF':
            return tidy(f"BRG {d}{'-' + seal if seal != 'OPEN' else ''} {clr or ''} {brand}")
        if style == 'STL':
            if d > 20000:
                return tidy_c(['BEARING', 'SPHERICAL ROLLER', tidy(f"{d} E {clr or ''}"), brand])
            return tidy_c(['BEARING', 'BALL', f"{d} {seal}", clr, brand])
        if style == 'PWR':
            if d > 20000:
                return tidy(f"SPH ROLLER BRG {d} {clr or ''} {brand}")
            return tidy(f"DGBB {d} { {'2RS': '2RSH', 'ZZ': '2Z', 'OPEN': ''}[seal] } {clr or ''} MAKE {brand}")
        if d > 20000:
            return tidy(f"Spherical Roller Bearing {d}{', ' + clr if clr else ''} ({brand})")
        return tidy(f"Ball Bearing {d}{ {'2RS': '-2RS', 'ZZ': '-ZZ', 'OPEN': ''}[seal] }{', ' + clr if clr else ''} ({brand})")
    if group == 'bolt':
        if style == 'REF':
            return tidy(f"HEX BOLT M{a['thread']}X{a['length']} GR{a['grade']} {g('finish') or ''} {g('standard').replace(' ', '', 1) if g('standard') else ''}")
        if style == 'STL':
            return tidy_c(['BOLT', 'HEX HD', f"M{a['thread']} X {a['length']}MM", a['grade'], FIN_STL.get(g('finish')), g('standard')])
        if style == 'PWR':
            return tidy(f"HHB M{a['thread']}x{a['length']} {a['grade']} {FIN_PWR.get(g('finish'), '') if g('finish') else ''}")
        return tidy_w([f"Hex Head Bolt M{a['thread']} x {a['length']} mm", f"Grade {a['grade']}", FIN_MIN.get(g('finish')), g('standard')])
    if group == 'nut':
        if style == 'REF':
            return tidy(f"HEX NUT M{a['thread']} GR{a['grade']} {g('finish') or ''}")
        if style == 'STL':
            return tidy_c(['NUT', 'HEX', f"M{a['thread']}", f"GR {a['grade']}", FIN_STL.get(g('finish'))])
        if style == 'PWR':
            return tidy(f"HEX NUT M{a['thread']} CL{a['grade']} {FIN_PWR.get(g('finish'), '') if g('finish') else ''}")
        return tidy_w([f"Hex Nut M{a['thread']}", f"Grade {a['grade']}", FIN_MIN.get(g('finish'))])
    # cable
    if style == 'REF':
        return tidy(f"CABLE {a['cores']}C X {a['csa']} SQMM {a['conductor']} {a['insulation']} ARMD {a['voltage']}KV")
    if style == 'STL':
        return tidy_c(['CABLE', 'POWER', f"{a['cores']}CX{a['csa']}SQMM", {'AL': 'ALUMINIUM', 'CU': 'COPPER'}[a['conductor']], a['insulation'], 'ARMOURED', f"{a['voltage']} KV"])
    if style == 'PWR':
        return tidy(f"{a['voltage']}KV {a['cores']} CORE {a['csa']} MM2 { {'AL': 'ALU', 'CU': 'CU'}[a['conductor']] } {a['insulation']} ARM CABLE")
    return tidy_w([f"Power Cable {a['cores']} Core x {a['csa']} sq.mm", {'AL': 'Aluminium', 'CU': 'Copper'}[a['conductor']], a['insulation'], 'Armoured', f"{a['voltage']}kV"])


UOM = {'REF': 'EA', 'STL': 'NO', 'PWR': 'NOS', 'MIN': 'Each'}
UOMC = {'REF': 'M', 'STL': 'KM', 'PWR': 'MTR', 'MIN': 'Meter'}
BRAND = {'REF': 'SKF', 'STL': 'FAG', 'PWR': 'NSK', 'MIN': 'NBC'}
HOLD = {'REF': {'valve': .8, 'pump': .75, 'bearing': .45, 'bolt': .55, 'nut': .5, 'cable': .35},
        'STL': {'valve': .45, 'pump': .5, 'bearing': .8, 'bolt': .75, 'nut': .7, 'cable': .45},
        'PWR': {'valve': .65, 'pump': .55, 'bearing': .5, 'bolt': .55, 'nut': .5, 'cable': .8},
        'MIN': {'valve': .35, 'pump': .45, 'bearing': .75, 'bolt': .6, 'nut': .55, 'cable': .7}}
STOCK = {'valve': (2, 30), 'pump': (1, 3), 'bearing': (8, 90), 'bolt': (150, 1800), 'nut': (200, 2600), 'cable': (400, 5000)}


def gen_records():
    """The four companies' material masters. Deterministic: same output on every run."""
    rg = Rand(26099)
    canon = build_canon(rg)
    recs, used = [], set()

    def codegen(cpse, group):
        if cpse == 'REF':
            return str(10000000 + rg.rint(1000, 899999))
        if cpse == 'STL':
            return 'MT-' + str(rg.rint(100000, 999999))
        if cpse == 'PWR':
            return str(3300000 + rg.rint(1000, 99999))
        return 'M' + {'valve': 'VL', 'pump': 'PM', 'bearing': 'BR', 'bolt': 'FS', 'nut': 'FS', 'cable': 'CB'}[group] + str(rg.rint(10000, 99999))

    def add(cpse, c, ci, style, internal):
        a = dict(c['a'])
        if c['group'] == 'valve':
            if a['material'] == 'A105' and rg.chance(.14):
                a['material'] = 'A216 WCB'
            elif a['material'] == 'SS316' and rg.chance(.16):
                a['material'] = 'CF8M'
            elif a['material'] == 'A105' and style in ('PWR', 'MIN') and rg.chance(.14):
                a['material'] = 'CS'
            if rg.chance(.03):
                a['rating'] = None
        if c['group'] == 'bearing':
            a['brand'] = rg.pick(['SKF', 'NBC']) if style == 'MIN' else BRAND[style]
        if a.get('standard') and rg.chance(.2):
            a['standard'] = None
        if a.get('clearance') and rg.chance(.15):
            a['clearance'] = None
        if a.get('finish') and rg.chance(.07):
            a['finish'] = None
        desc = describe(c['group'], style, a)
        if rg.chance(.05):
            desc = desc.replace('VALVE', 'VAVLE', 1).replace('Valve', 'Vavle', 1).replace('BEARING', 'BEARNG', 1).replace('CABLE', 'CABEL', 1)
        while True:
            code = codegen(cpse, c['group'])
            if code not in used:
                break
        used.add(code)
        cable = c['group'] == 'cable'
        km = cable and cpse == 'STL'
        price = jround(c['base'] * rg.rnd(.9, 1.22) * (1000 if km else 1))
        lo, hi = STOCK[c['group']]
        stock = rg.rint(lo, hi)
        annual = rg.rint(max(1, jround(lo * 1.5)), jround(hi * 1.4))
        if km:
            stock, annual = js_fixed2(stock / 1000), js_fixed2(annual / 1000)
        recs.append({'id': 'R' + str(len(recs) + 1).zfill(4), 'cpse': cpse, 'code': code, 'desc': desc,
                     'uom': UOMC[cpse] if cable else UOM[cpse], 'price': price, 'stock': stock, 'annual': annual,
                     'truth': ci, 'internal': internal})

    for ci, c in enumerate(canon):
        held = 0
        for p in CPSES:
            if not rg.chance(HOLD[p['id']][c['group']]):
                continue
            held += 1
            add(p['id'], c, ci, p['id'], False)
            if rg.chance(.07):
                add(p['id'], c, ci, rg.pick([x for x in CPSES if x['id'] != p['id']])['id'], True)
        if not held:
            p = rg.pick(CPSES)
            add(p['id'], c, ci, p['id'], False)
    return recs


# ---------------------------------------------------------------- the engine
TOK = {'VLV': 'VALVE', 'VAVLE': 'VALVE', 'VALV': 'VALVE', 'GT': 'GATE', 'GLB': 'GLOBE', 'BRG': 'BEARING', 'BEARNG': 'BEARING', 'CABEL': 'CABLE',
       'PMP': 'PUMP', 'CENT': 'CENTRIFUGAL', 'HHB': 'HEX HEAD BOLT', 'DGBB': 'BEARING BALL DEEP GROOVE', 'SPH': 'SPHERICAL', 'FLGD': 'FLANGED',
       'SCRD': 'SCREWED', 'HD': 'HEAD', 'ARMD': 'ARMOURED', 'ARM': 'ARMOURED', 'ALU': 'AL', 'ALUMINIUM': 'AL', 'COPPER': 'CU',
       'GALV': 'GALVANISED', 'BLK': 'BLACK', 'MTR': 'M'}


def expand(raw):
    toks = [t for t in re.split(r'\s+', re.sub(r'[,;|]', ' ', str(raw).upper())) if t]
    return ' '.join(TOK.get(t, t) for t in toks)


def extract(X):
    a, cls = {}, None
    s = re.search
    if s(r'VALVE', X) and s(r'\bGATE\b', X):
        cls = 'VGT'
    elif s(r'VALVE', X) and s(r'GLOBE', X):
        cls = 'VGL'
    elif s(r'VALVE', X) and s(r'\bBALL\b', X):
        cls = 'VBL'
    elif s(r'PUMP', X):
        cls = 'PMP'
    elif s(r'\bBOLT\b', X):
        cls = 'BLT'
    elif s(r'\bNUT\b', X):
        cls = 'NUT'
    elif s(r'CABLE', X):
        cls = 'CBL'
    elif s(r'BEARING', X) or s(r'\b(6[0-3]\d{2}|22[23]\d{2})\b', X):
        cls = 'BRG'
    if not cls:
        return None, a
    g = CLASSES[cls]['group']
    if g == 'valve':
        a['type'] = CLASSES[cls]['type']
        m = s(r'\bDN\s*(\d{2,3})\b', X)
        if m:
            a['size'] = int(m.group(1))
        else:
            m = s(r'\b(\d{2,3})\s*MM\b', X)
            if m:
                a['size'] = int(m.group(1))
            else:
                m = s(r'(\d+-\d/\d|\d/\d|\d+)\s*(?:"|INCH(?:ES)?\b|IN\b)', X)
                if m:
                    a['size'] = INCH2DN.get(m.group(1))
        m = s(r'(?:CLASS|CL)\s*(\d{3,4})\b', X) or s(r'\b(\d{3,4})\s*(?:#|LBS?\b)', X)
        if m:
            a['rating'] = int(m.group(1))
        if s(r'CF8M', X):
            a['material'] = 'CF8M'
        elif s(r'WCB|A216', X):
            a['material'] = 'A216 WCB'
        elif s(r'A\s?105', X):
            a['material'] = 'A105'
        elif s(r'SS\s?316|STAINLESS STEEL 316|\b316\b', X):
            a['material'] = 'SS316'
        elif s(r'CARBON STEEL|\bCS\b', X):
            a['material'] = 'CS'
        if s(r'SOCKET\s*WELD|\bSW\b', X):
            a['end'] = 'SW'
        elif s(r'BUTT\s*WELD|\bBW\b', X):
            a['end'] = 'BW'
        elif s(r'NPT|SCREWED|THREADED', X):
            a['end'] = 'NPT'
        elif s(r'FLANGED|\bRF\b|RAISED FACE', X):
            a['end'] = 'RF'
        m = s(r'API\s?(600|602|6D)\b', X)
        if m:
            a['standard'] = 'API ' + m.group(1)
        elif s(r'BS\s?1873', X):
            a['standard'] = 'BS 1873'
    elif g == 'pump':
        Y = X
        m = s(r'(?:Q\s*=\s*)?(\d+(?:\.\d+)?)\s*(?:M3/HR?|CMH|CUM/HR?)', Y)
        if m:
            a['flow'] = jsnum(m.group(1))
            Y = Y.replace(m.group(0), ' ', 1)
        m = s(r'(\d+(?:\.\d+)?)\s*KW', Y)
        if m:
            a['power'] = jsnum(m.group(1))
            Y = Y.replace(m.group(0), ' ', 1)
        m = s(r'(?:H\s*=\s*|@\s*)?(\d+(?:\.\d+)?)\s*M\b', Y)
        if m:
            a['head'] = jsnum(m.group(1))
        if s(r'SS\s?316|STAINLESS', X):
            a['material'] = 'SS316'
        elif s(r'\bCI\b|CAST IRON', X):
            a['material'] = 'CI'
        elif s(r'CARBON STEEL|\bCS\b', X):
            a['material'] = 'CS'
        if s(r'API\s?610', X):
            a['standard'] = 'API 610'
        elif s(r'ISO\s?5199', X):
            a['standard'] = 'ISO 5199'
    elif g == 'bearing':
        m = s(r'\b(6[0-3]\d{2}|22[23]\d{2})\b', X)
        if m:
            a['designation'] = int(m.group(1))
        if s(r'2RS\w*|\bRS\b', X):
            a['seal'] = '2RS'
        elif s(r'\bZZ\b|\b2Z\b|-ZZ\b|-2Z\b', X):
            a['seal'] = 'ZZ'
        elif s(r'\bOPEN\b', X):
            a['seal'] = 'OPEN'
        if a.get('designation') and not a.get('seal'):
            a['seal'] = 'OPEN'   # an ISO designation without a seal suffix is an open bearing
        if s(r'\bC3\b', X):
            a['clearance'] = 'C3'
        m = s(r'\b(SKF|FAG|NSK|NTN|NBC|TIMKEN)\b', X)
        if m:
            a['brand'] = m.group(1)
    elif g == 'bolt':
        m = s(r'M\s?(\d{2})\s*X\s*(\d{2,3})', X)
        if m:
            a['thread'], a['length'] = int(m.group(1)), int(m.group(2))
        m = s(r'(8\.8|10\.9|B7)\b', X)
        if m:
            a['grade'] = m.group(1)
        if s(r'HOT DIP|HDG|GALVANISED', X):
            a['finish'] = 'HDG'
        elif s(r'ZINC|\bZN\b', X):
            a['finish'] = 'ZINC'
        elif s(r'BLACK|PLAIN', X):
            a['finish'] = 'PLAIN'
        if s(r'IS\s?1364', X):
            a['standard'] = 'IS 1364'
        elif s(r'A193', X):
            a['standard'] = 'ASTM A193'
    elif g == 'nut':
        m = s(r'\bM\s?(\d{2})\b', X)
        if m:
            a['thread'] = int(m.group(1))
        m = s(r'(?:GR(?:ADE)?|CL(?:ASS)?)\s*(2H|10|8)\b', X)
        if m:
            a['grade'] = m.group(1)
        if s(r'HOT DIP|HDG|GALVANISED', X):
            a['finish'] = 'HDG'
        elif s(r'ZINC|\bZN\b', X):
            a['finish'] = 'ZINC'
        elif s(r'BLACK|PLAIN', X):
            a['finish'] = 'PLAIN'
    elif g == 'cable':
        m = s(r'(\d(?:\.\d)?)\s*C(?:ORE)?(?=\s|X|$)', X)
        if m:
            a['cores'] = m.group(1)
        m = s(r'(\d{1,3})\s*(?:SQ\.?\s*MM|SQMM|MM2)', X)
        if m:
            a['csa'] = int(m.group(1))
        if s(r'\bAL\b', X):
            a['conductor'] = 'AL'
        elif s(r'\bCU\b', X):
            a['conductor'] = 'CU'
        if s(r'XLPE', X):
            a['insulation'] = 'XLPE'
        elif s(r'PVC', X):
            a['insulation'] = 'PVC'
        if s(r'UNARMOURED', X):
            a['armour'] = 'UNARMOURED'
        elif s(r'ARMOURED', X):
            a['armour'] = 'ARMOURED'
        m = s(r'(1\.1|3\.3|6\.6|11)\s*KV', X)
        if m:
            a['voltage'] = m.group(1)
    a = {k: v for k, v in a.items() if v is not None}
    return cls, a


def trigrams(s):
    p = f'  {s} '
    return {p[i:i + 3] for i in range(len(p) - 2)}


def dice(A, B):
    n = sum(1 for x in A if x in B)
    return (2 * n) / (len(A) + len(B) or 1)


def is_equiv(x, y):
    return any((x == p and y == q) or (x == q and y == p) for p, q in EQUIV)


def is_partial(x, y, g):
    return g == 'valve' and ((x == 'CS' and y in ('A105', 'A216 WCB')) or (y == 'CS' and x in ('A105', 'A216 WCB')))


VAL = {'same': 1, 'equiv': .92, 'brand': 1, 'partial': .78, 'soft': .8, 'missing': .6, 'conflict': 0}


def compare(r1, r2):
    g = CLASSES[r1['cls']]['group']
    det, num, den = {}, 0.0, 0
    conflict = equiv = near = key_missing = False
    nconf = 0
    for f in SCHEMA[g]:
        v1, v2 = r1['a'].get(f['k']), r2['a'].get(f['k'])
        if v1 is None and v2 is None:
            st = 'none'
        elif f['brand'] and (v1 is None or v2 is None):
            st = 'none'   # the make is not a functional attribute
        elif v1 is None or v2 is None:
            st = 'missing'
        elif js_str(v1) == js_str(v2):
            st = 'same'
        elif f['brand']:
            st = 'brand'
        elif f['k'] == 'material' and is_equiv(v1, v2):
            st = 'equiv'
        elif f['k'] == 'material' and is_partial(v1, v2, g):
            st = 'partial'
        elif f['soft']:
            st = 'soft'
        else:
            st = 'conflict'
        det[f['k']] = st
        if st == 'none':
            continue
        num += f['w'] * VAL[st]
        den += f['w']
        if st == 'conflict':
            conflict = True
            nconf += 1
        elif st in ('equiv', 'brand'):
            equiv = True
        elif st != 'same':
            near = True
        if st == 'missing' and f['key']:
            key_missing = True
    attr = num / den if den else 0
    text = dice(r1['tri'], r2['tri'])
    score = jround(100 * (.8 * attr + .2 * text))
    if conflict:
        score = jround(score * .55)
    typ = 'different' if conflict else 'equivalent' if equiv else 'near' if near else 'duplicate'
    return {'type': typ, 'score': score, 'det': det, 'text': text, 'keyMissing': key_missing, 'nconf': nconf}


def pkey(x, y):
    return f'{x}|{y}' if x < y else f'{y}|{x}'


def prepare(r):
    X = expand(r['desc'])
    cls, a = extract(X)
    norm = re.sub(r'[^A-Z0-9.]+', ' ', X).strip()
    sch = [f for f in SCHEMA[CLASSES[cls]['group']] if not f['brand']] if cls else []
    found = sum(1 for f in sch if a.get(f['k']) is not None)
    return {**r, 'X': X, 'norm': norm, 'tri': trigrams(norm), 'cls': cls, 'a': a, 'dq': jround(100 * found / len(sch)) if cls else 0}


def run(raw, splits=frozenset(), links=()):
    """Match and cluster every record. `splits`: record ids a person removed from matches.
    `links`: record pairs a person joined by hand."""
    recs = [prepare(r) for r in raw]
    by_id = {r['id']: r for r in recs}
    pairs, looks, conflicts = [], [], set()
    compared, blocks_seen = 0, set()
    for cls in CLS_ORDER:
        g = CLASSES[cls]['group']
        bk = BLOCK[g]
        blocks = OrderedDict()
        for r in recs:
            if r['cls'] != cls:
                continue
            k = '?' if r['a'].get(bk) is None else js_str(r['a'][bk])
            blocks.setdefault(k, []).append(r)
        wild = blocks.get('?', [])

        def do_pair(x, y):
            nonlocal compared
            compared += 1
            p = compare(x, y)
            p['a'], p['b'] = x['id'], y['id']
            if p['type'] == 'different':
                conflicts.add(pkey(x['id'], y['id']))
                if p['nconf'] == 1 and p['text'] > .72:
                    looks.append(p)
            elif x['id'] not in splits and y['id'] not in splits:
                pairs.append(p)
        for k, arr in blocks.items():
            blocks_seen.add(cls + k)
            for i in range(len(arr)):
                for j in range(i + 1, len(arr)):
                    do_pair(arr[i], arr[j])
                if k != '?':
                    for w in wild:
                        do_pair(arr[i], w)
    parent = {r['id']: r['id'] for r in recs}
    members = OrderedDict((r['id'], [r['id']]) for r in recs)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def clashes(ca, cb):
        return any(pkey(x, y) in conflicts for x in members[ca] for y in members[cb])

    def join(ca, cb):
        parent[cb] = ca
        members[ca] = members[ca] + members[cb]
        del members[cb]
    for x, y in links:
        if x not in by_id or y not in by_id or x in splits or y in splits:
            continue
        ca, cb = find(x), find(y)
        if ca != cb:
            join(ca, cb)
    pairs.sort(key=lambda p: -p['score'])
    weak, blocked = [], 0
    for p in pairs:
        if p['keyMissing']:
            weak.append(p)
            continue
        ca, cb = find(p['a']), find(p['b'])
        if ca == cb:
            continue
        if clashes(ca, cb):
            blocked += 1
            continue
        join(ca, cb)
    gaps = OrderedDict()
    for p in weak:
        for x, y in ((p['a'], p['b']), (p['b'], p['a'])):
            rx = by_id[x]
            g = CLASSES[rx['cls']]['group']
            if not any(f['key'] and rx['a'].get(f['k']) is None for f in SCHEMA[g]):
                continue
            gaps.setdefault(x, []).append(y)
    ambiguous = {}
    for x, others in gaps.items():
        own = find(x)
        roots = [r for r in uniq(find(o) for o in others) if r != own and not clashes(own, r)]
        if len(roots) == 1:
            join(roots[0], own)
        elif len(roots) > 1:
            ambiguous[x] = [list(members[r]) for r in roots]
    clusters = [build_cluster([by_id[i] for i in ids]) for ids in members.values()]
    clusters.sort(key=lambda c: ((CLS_ORDER.index(c['cls']) if c['cls'] else -1), c['std']))
    serial = {}
    for c in clusters:
        u = CLASSES[c['cls']]['unspsc'] if c['cls'] else '00000000'
        serial[u] = serial.get(u, 0) + 1
        sn = str(serial[u]).zfill(5)
        c['nmc'] = f'NMC-{u}-{sn}-{luhn(u + sn)}'
    by_rec = {}
    for c in clusters:
        for m in c['members']:
            by_rec[m['id']] = c
    seen_pair, lookalikes = set(), []
    for p in looks:   # keep the first pair per material pair, then rank by similarity
        ca, cb = by_rec.get(p['a']), by_rec.get(p['b'])
        if not ca or not cb or ca is cb:
            continue
        k = pkey(ca['id'], cb['id'])
        if k in seen_pair:
            continue
        seen_pair.add(k)
        lookalikes.append({'key': pkey(p['a'], p['b']), 'a': p['a'], 'b': p['b'], 'det': p['det'], 'text': p['text']})
    lookalikes.sort(key=lambda p: -p['text'])
    for x, groups in ambiguous.items():
        c = by_rec.get(x)
        if not c or len(c['members']) != 1:
            continue
        options = uniq(by_rec[ids[0]]['id'] for ids in groups if ids and ids[0] in by_rec)
        if len(options) > 1:
            rx = by_id[x]
            c['hold'] = {'rec': x, 'options': options,
                         'missing': [f['label'].lower() for f in SCHEMA[CLASSES[rx['cls']]['group']] if f['key'] and rx['a'].get(f['k']) is None]}
    return {'recs': recs, 'by_id': by_id, 'clusters': clusters, 'by_rec': by_rec, 'lookalikes': lookalikes,
            'compared': compared, 'blocked': blocked, 'blocks': len(blocks_seen)}


def build_cluster(ms):
    ms = sorted(ms, key=lambda m: (m['cpse'], m['code']))
    cls = ms[0]['cls']
    cid = 'C' + sha256hex('.'.join(sorted(m['id'] for m in ms)))[:10]
    c = {'id': cid, 'cls': cls, 'members': ms, 'type': 'single', 'score': 100, 'golden': {}, 'alts': [], 'brands': [], 'flags': [], 'notes': [], 'hold': None}
    if not cls:
        c.update(type='unclassified', std=ms[0]['desc'].upper(), short=ms[0]['desc'].upper()[:40])
        c['flags'].append('Not recognised. Classify by hand.')
        return c
    g = CLASSES[cls]['group']
    sch = SCHEMA[g]
    if len(ms) > 1:
        min_score, has_eq, has_near = 100, False, False
        for i in range(len(ms)):
            for j in range(i + 1, len(ms)):
                p = compare(ms[i], ms[j])
                min_score = min(min_score, p['score'])
                if p['type'] == 'equivalent':
                    has_eq = True
                elif p['type'] == 'near':
                    has_near = True
        c['score'] = min_score
        c['type'] = 'equivalent' if has_eq else 'near' if has_near else 'duplicate'
    for f in sch:
        vals = [m['a'][f['k']] for m in ms if m['a'].get(f['k']) is not None]
        if f['brand']:
            c['brands'] = uniq(vals)
            continue
        if not vals:
            c['golden'][f['k']] = None
            c['flags'].append(f"{f['label']} not stated in any record")
            continue
        if f['k'] == 'material' and g == 'valve':
            specific = [v for v in vals if v != 'CS']
            pool = specific or vals
            primary = 'A105' if 'A105' in pool else 'SS316' if 'SS316' in pool else most_common(pool)
            c['golden']['material'] = primary
            c['alts'] = [v for v in uniq(pool) if v != primary]
            if 'CS' in vals and specific:
                c['notes'].append('One record says only "carbon steel". The grade comes from the other records.')
            for x in c['alts']:
                n = EQUIV_NOTE.get(f'{primary}|{x}') or EQUIV_NOTE.get(f'{x}|{primary}')
                if n:
                    c['notes'].append(n + '. Both are accepted under this code.')
            continue
        c['golden'][f['k']] = most_common(vals)
        if len(uniq(js_str(v) for v in vals)) > 1:
            c['notes'].append(f"{f['label']} differs between records ({' / '.join(uniq(js_str(v) for v in vals))}). Most common value used; confirm before verifying.")
    if len(ms) > 1:
        miss = uniq(f['label'].lower() for m in ms for f in sch if not f['brand'] and m['a'].get(f['k']) is None and c['golden'].get(f['k']) is not None)
        if miss:
            c['notes'].append(f"Some records leave out {', '.join(miss)}. Filled in from the matching records.")
    if len(c['brands']) > 1:
        c['notes'].append(f"Different makes ({', '.join(c['brands'])}) for the same bearing designation are interchangeable. Listed as approved makes.")
    c['std'] = std_desc(cls, c['golden'], c['alts'], c['brands'])
    c['short'] = short_text(cls, c['golden'])
    return c


def std_desc(cls, g, alts=(), brands=()):
    cl = CLASSES[cls]
    grp = cl['group']
    P = []
    if grp == 'valve':
        P += [f"DN{g['size']} ({INCH.get(g['size'], '?')} IN)" if g.get('size') else 'SIZE NOT STATED',
              f"CLASS {g['rating']}" if g.get('rating') else 'CLASS NOT STATED',
              (MATN[g['material']] + (f" (EQUIV. {', '.join(MATN[x] for x in alts)})" if alts else '')) if g.get('material') else None,
              ENDN[g['end']] if g.get('end') else None, g.get('standard')]
    elif grp == 'pump':
        P += [f"{js_str(g['flow'])} M3/H" if g.get('flow') is not None else 'FLOW NOT STATED', f"{js_str(g['head'])} M HEAD" if g.get('head') else 'HEAD NOT STATED',
              f"{js_str(g['power'])} KW" if g.get('power') else None, f"{MATN[g['material']]} CASING" if g.get('material') else None, g.get('standard')]
    elif grp == 'bearing':
        d = g.get('designation')
        if d is None:
            return 'BEARING: DESIGNATION NOT STATED'
        roller = d > 20000
        seal = g.get('seal')
        return (f"{'BEARING, ROLLER, SPHERICAL' if roller else 'BEARING, BALL, DEEP GROOVE'}: {d}"
                f"{'-' + seal if not roller and seal and seal != 'OPEN' else ''}{' OPEN' if not roller and seal == 'OPEN' else ''}"
                f"{', ' + g['clearance'] + ' CLEARANCE' if g.get('clearance') else ''}{', MAKES: ' + '/'.join(brands) if brands else ''}")
    elif grp == 'bolt':
        P += [f"M{g['thread']} X {g['length']} MM" if g.get('thread') is not None and g.get('length') is not None else 'SIZE NOT STATED',
              f"GRADE {g['grade']}" if g.get('grade') else 'GRADE NOT STATED', FINN[g['finish']] if g.get('finish') else None, g.get('standard')]
    elif grp == 'nut':
        P += [f"M{g['thread']}" if g.get('thread') is not None else 'THREAD NOT STATED', f"GRADE {g['grade']}" if g.get('grade') else 'GRADE NOT STATED',
              FINN[g['finish']] if g.get('finish') else None]
    elif grp == 'cable':
        P += [f"{g['cores']}C X {g['csa']} SQMM" if g.get('cores') is not None and g.get('csa') is not None else 'SIZE NOT STATED',
              'ALUMINIUM' if g.get('conductor') == 'AL' else 'COPPER' if g.get('conductor') == 'CU' else None,
              g.get('insulation'), g.get('armour'), f"{g['voltage']} KV" if g.get('voltage') else None]
    return f"{cl['noun']}: {', '.join(x for x in P if x)}"


def short_text(cls, g):
    grp = CLASSES[cls]['group']
    ms = {'A105': 'A105', 'A216 WCB': 'WCB', 'SS316': 'SS316', 'CF8M': 'CF8M', 'CS': 'CS', 'CI': 'CI'}
    q = lambda k: js_str(g[k]) if g.get(k) is not None else '?'
    if grp == 'valve':
        s = f"{CLASSES[cls]['type']} VLV DN{g.get('size') or '?'} CL{g.get('rating') or '?'} {ms.get(g.get('material'), '')} {g.get('end') or ''} {g['standard'].replace(' ', '', 1) if g.get('standard') else ''}"
    elif grp == 'pump':
        s = f"PUMP CENT {q('flow')}M3H {q('head')}M {q('power')}KW {ms.get(g.get('material'), '')}"
    elif grp == 'bearing':
        d = g.get('designation')
        s = f"BRG {q('designation')}{'-' + g['seal'] if g.get('seal') and g['seal'] != 'OPEN' and d is not None and d < 20000 else ''} {g.get('clearance') or ''}"
    elif grp == 'bolt':
        s = f"BOLT HEX M{q('thread')}X{q('length')} {g.get('grade') or ''} {g.get('finish') or ''}"
    elif grp == 'nut':
        s = f"NUT HEX M{q('thread')} GR{g.get('grade') or '?'} {g.get('finish') or ''}"
    else:
        s = f"CBL {q('cores')}CX{q('csa')} {g.get('conductor') or ''} {g.get('insulation') or ''} ARM {g.get('voltage') or '?'}KV"
    return tidy(s)[:40]


def accuracy(result):
    gen = [r for r in result['recs'] if r.get('truth') is not None]
    by_rec = result['by_rec']
    tp = fp = fn = 0
    for i in range(len(gen)):
        for j in range(i + 1, len(gen)):
            same = gen[i]['truth'] == gen[j]['truth']
            pred = by_rec[gen[i]['id']] is by_rec[gen[j]['id']]
            if same and pred:
                tp += 1
            elif pred:
                fp += 1
            elif same:
                fn += 1
    return {'precision': tp / (tp + fp or 1), 'recall': tp / (tp + fn or 1), 'tp': tp, 'fp': fp, 'fn': fn}


def analyze_part(desc, clusters):
    """Check a part: read one description and find national materials it already matches."""
    X = expand(desc)
    cls, a = extract(X)
    if not cls:
        return {'cls': None}
    norm = re.sub(r'[^A-Z0-9.]+', ' ', X).strip()
    tmp = {'id': 'TMP', 'cls': cls, 'a': a, 'tri': trigrams(norm)}
    sch = SCHEMA[CLASSES[cls]['group']]
    fields = [f for f in sch if not f['brand']]
    found = sum(1 for f in fields if a.get(f['k']) is not None)
    rank = {'duplicate': 0, 'equivalent': 1, 'near': 2}
    matches = []
    for c in clusters:
        if c['cls'] != cls:
            continue
        best = None
        for m in c['members']:
            p = compare(tmp, m)
            if p['type'] != 'different' and (best is None or p['score'] > best['score']):
                best = p
        if best:
            matches.append({'cid': c['id'], 'type': best['type'], 'score': best['score'], 'keyMissing': best['keyMissing']})
    matches.sort(key=lambda x: (rank[x['type']], -x['score']))
    golden = {k: v for k, v in a.items() if k not in ('brand', 'type')}
    return {'cls': cls, 'a': a, 'dq': jround(100 * found / len(fields)),
            'missingKey': [f['k'] for f in fields if f['key'] and a.get(f['k']) is None],
            'std': std_desc(cls, golden, [], [a['brand']] if a.get('brand') else []), 'matches': matches[:5]}

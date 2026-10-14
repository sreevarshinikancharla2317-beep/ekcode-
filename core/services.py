"""EkCode services: run the engine against the database, keep the audit chain, build what the browser needs."""
import hashlib
import json
import time

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from . import engine as E
from .models import (AuditEntry, CodeRequest, Company, Decision, EngineState, Link, LookalikeConfirm, Material,
                     Prevented, Record, Split, StdOverride)

DEMO_PASSWORD = "EkCode@2026"
DEMO_USERS = [
    ("maker", "Priya", "Menon", "priya.menon@cpcl.example", "maker", "Chennai Petroleum Corporation (demo)", "4521", "PM", "#FFB547"),
    ("checker", "R.", "Iyer", "r.iyer@cpcl.example", "checker", "Chennai Petroleum Corporation (demo)", "7788", "RI", "#9BE36B"),
    ("auditor", "Anita", "Rao", "anita.rao@audit.example", "auditor", "Internal audit (demo)", "3310", "AR", "#7CC4FF"),
]
SOURCE_ORDER = {"seed": 0, "upload": 1, "request": 2}


def now_ms():
    return int(time.time() * 1000)


# ---------------------------------------------------------------- engine <-> database
def engine_state():
    st, _ = EngineState.objects.get_or_create(pk=1)
    return st


def engine_input():
    recs = sorted(Record.objects.all(), key=lambda r: (SOURCE_ORDER[r.source], r.seq))
    return [{"id": r.rid, "cpse": r.company_id, "code": r.code, "desc": r.desc, "uom": r.uom, "price": r.price, "stock": r.stock,
             "annual": r.annual, "truth": r.truth, "internal": r.internal} for r in recs]


@transaction.atomic
def recompute():
    """Run the matching engine over every record and store the national materials it finds."""
    st = EngineState.objects.select_for_update().get_or_create(pk=1)[0]
    t0 = time.perf_counter()
    splits = set(Split.objects.values_list("record_id", flat=True))
    links = list(Link.objects.order_by("id").values_list("a_id", "b_id"))
    res = E.run(engine_input(), splits=splits, links=links)
    acc = E.accuracy(res)
    Material.objects.all().delete()
    Material.objects.bulk_create([Material(
        cid=c["id"], nmc=c["nmc"], cls=c["cls"] or "", type=c["type"], score=c["score"], std=c["std"][:300], short=c["short"],
        golden=c["golden"], alts=c["alts"], brands=c["brands"], flags=c["flags"], notes=c["notes"], hold=c["hold"],
        members=[m["id"] for m in c["members"]], position=i) for i, c in enumerate(res["clusters"])])
    by_id = {r.rid: r for r in Record.objects.all()}
    changed = []
    for r in res["recs"]:
        rec = by_id[r["id"]]
        rec.cls, rec.attrs, rec.dq, rec.material = r["cls"] or "", r["a"], r["dq"], res["by_rec"][r["id"]]["id"]
        changed.append(rec)
    Record.objects.bulk_update(changed, ["cls", "attrs", "dq", "material"], batch_size=500)
    st.version += 1
    st.compared, st.blocks, st.blocked = res["compared"], res["blocks"], res["blocked"]
    st.acc = {k: acc[k] for k in ("precision", "recall", "tp", "fp", "fn")}
    st.lookalikes = res["lookalikes"]
    st.ms = round((time.perf_counter() - t0) * 1000, 1)
    st.save()
    return st


# ---------------------------------------------------------------- audit chain
def _chain_hash(prev, e):
    payload = json.dumps([e["n"], e["t"], e["actor"], e["role"], e["action"], e["obj"], e["detail"]], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(f"{prev}|{payload}".encode("utf-8")).hexdigest()


@transaction.atomic
def audit(user, action, obj="", detail=""):
    """Append to the hash chain. `user` is a User, or None for the engine itself."""
    last = AuditEntry.objects.select_for_update().order_by("-n").first()
    prev = last.hash if last else "GENESIS"
    if user is None:
        actor, role = "EkCode AI engine", "system"
    else:
        actor, role = user.display_name, user.role
    e = {"n": (last.n + 1) if last else 1, "t": now_ms(), "actor": actor, "role": role, "action": action, "obj": str(obj)[:120], "detail": str(detail)}
    e["hash"] = _chain_hash(prev, e)
    return AuditEntry.objects.create(prev=prev, **e)


def verify_chain():
    prev = "GENESIS"
    n = 0
    for e in AuditEntry.objects.order_by("n"):
        d = {"n": e.n, "t": e.t, "actor": e.actor, "role": e.role, "action": e.action, "obj": e.obj, "detail": e.detail}
        if e.prev != prev or _chain_hash(prev, d) != e.hash:
            return {"ok": False, "at": e.n}
        prev, n = e.hash, n + 1
    return {"ok": True, "n": n}


# ---------------------------------------------------------------- seed and reset
@transaction.atomic
def seed(force=False):
    for i, c in enumerate(E.CPSES + [E.UPL]):
        Company.objects.update_or_create(code=c["id"], defaults={"name": c["name"], "short": c["short"], "city": c["city"],
                                                                 "erp": c["erp"], "color": c["color"], "order": i})
    User = get_user_model()
    for uname, first, last, email, role, org, mob, init, color in DEMO_USERS:
        u, created = User.objects.get_or_create(username=uname, defaults={"email": email})
        u.first_name, u.last_name, u.email, u.role, u.org, u.mobile_last4, u.initials, u.color = first, last, email, role, org, mob, init, color
        if created or force:
            u.set_password(DEMO_PASSWORD)
        u.save()
    if force or not Record.objects.filter(source="seed").exists():
        Record.objects.all().delete()
        Record.objects.bulk_create([Record(rid=r["id"], company_id=r["cpse"], code=r["code"], desc=r["desc"], uom=r["uom"], price=r["price"],
                                           stock=r["stock"], annual=r["annual"], truth=r["truth"], internal=r["internal"], source="seed", seq=i)
                                    for i, r in enumerate(E.gen_records())])
        recompute()
    engine_state()


@transaction.atomic
def reset_demo(user):
    for model in (Decision, StdOverride, Split, Link, LookalikeConfirm, Prevented, AuditEntry):
        model.objects.all().delete()
    CodeRequest.objects.all().delete()
    Record.objects.exclude(source="seed").delete()
    st = engine_state()
    st.harmonized = False
    st.save(update_fields=["harmonized"])
    recompute()
    audit(user, "Reset the demo", "All data", "Approvals, requests, uploads and the previous audit trail cleared")


# ---------------------------------------------------------------- status and state for the browser
def status_of(m, decisions):
    d = decisions.get(m.cid)
    if d:
        return d.status
    if m.hold:
        return "hold"
    return "proposed" if len(m.members) > 1 else "auto"


def record_json(r):
    cable = r.cls == "CBL"
    km = r.uom.upper() == "KM"
    unit = r.price / 1000 if km else r.price
    qty = r.stock * 1000 if km else r.stock
    annual = r.annual * 1000 if km else r.annual
    return {"id": r.rid, "cpse": r.company_id, "code": r.code, "desc": r.desc, "uom": r.uom, "cls": r.cls or None, "a": r.attrs, "dq": r.dq,
            "baseUom": "M" if cable else "EA", "unitPrice": unit, "qty": qty, "annualQty": annual, "stockValue": unit * qty, "source": r.source}


def material_json(m):
    return {"id": m.cid, "nmc": m.nmc, "cls": m.cls or None, "type": m.type, "score": m.score, "std": m.std, "short": m.short, "golden": m.golden,
            "alts": m.alts, "brands": m.brands, "flags": m.flags, "notes": m.notes, "hold": m.hold, "members": m.members}


def meta():
    return {"companies": [{"id": c.code, "name": c.name, "short": c.short, "city": c.city, "erp": c.erp, "color": c.color} for c in Company.objects.all()],
            "classes": E.CLASSES, "clsOrder": E.CLS_ORDER, "schema": E.SCHEMA, "equiv": E.EQUIV, "equivNote": E.EQUIV_NOTE}


def build_state(user):
    st = engine_state()
    facts = {"records": Record.objects.count(), "materials": Material.objects.count(), "precision": st.acc.get("precision", 0)}
    if not user or not user.is_authenticated:
        return {"me": None, "facts": facts, "demoOtp": True}
    decisions = {d.cid: d for d in Decision.objects.select_related("approved_by", "verified_by")}
    dec_json = {cid: {"s": d.status, "approvedBy": d.approved_by.display_name if d.approved_by else "", "approvedAt": d.approved_at.timestamp() * 1000 if d.approved_at else None,
                      "verifiedBy": d.verified_by.display_name if d.verified_by else "", "verifiedAt": d.verified_at.timestamp() * 1000 if d.verified_at else None,
                      "note": d.note} for cid, d in decisions.items()}
    return {
        "me": user.as_json(), "facts": facts, "meta": meta(), "harmonized": st.harmonized, "version": st.version,
        "records": [record_json(r) for r in Record.objects.all()],
        "materials": [material_json(m) for m in Material.objects.all()],
        "lookalikes": st.lookalikes, "acc": st.acc, "compared": st.compared, "blocks": st.blocks, "blocked": st.blocked, "ms": st.ms,
        "decisions": dec_json, "std": {o.cid: o.text for o in StdOverride.objects.all()},
        "confirmed": list(LookalikeConfirm.objects.values_list("key", flat=True)),
        "requests": [{"id": q.rid, "desc": q.desc, "cpse": q.company_id, "uom": q.uom, "by": q.by.display_name if q.by else "", "at": q.at.timestamp() * 1000,
                      "reason": q.reason, "status": q.status, "rejectReason": q.reject_reason} for q in CodeRequest.objects.select_related("by")],
        "prevented": Prevented.objects.count(),
        "uploads": Record.objects.filter(source="upload").count(),
        "audit": [{"n": e.n, "t": e.t, "actor": e.actor, "role": e.role, "action": e.action, "obj": e.obj, "detail": e.detail, "prev": e.prev, "hash": e.hash}
                  for e in AuditEntry.objects.order_by("n")],
    }


# ---------------------------------------------------------------- analytics shared by the exports
def snapshot():
    """Materials with their member records, as plain dicts (same numbers the browser shows)."""
    recs = {r.rid: record_json(r) for r in Record.objects.all()}
    decisions = {d.cid: d for d in Decision.objects.all()}
    stds = {o.cid: o.text for o in StdOverride.objects.all()}
    out = []
    for m in Material.objects.all():
        d = material_json(m)
        d["members"] = [recs[i] for i in m.members if i in recs]
        d["status"] = status_of(m, decisions)
        d["stdEff"] = stds.get(m.cid, m.std)
        out.append(d)
    return out


STATUS_LABEL = {"proposed": "To approve", "approved": "Approved, to verify", "verified": "Verified, code active", "auto": "New code", "hold": "Needs a person"}
MAPST = {"verified": "Ready to load", "approved": "Waiting for checker", "proposed": "Waiting for approval", "hold": "Held for a person", "auto": "New code"}


def mapping_rows(mats, company="ALL"):
    rows = []
    for c in mats:
        by = {}
        for m in c["members"]:
            by.setdefault(m["cpse"], []).append(m)
        for lst in by.values():
            lst.sort(key=lambda m: -m["stockValue"])
            for i, m in enumerate(lst):
                action = ("Keep as primary" if i == 0 else f"Retire, move stock to {lst[0]['code']}") if len(lst) > 1 else "Map as alias"
                rows.append({"m": m, "c": c, "action": action})
    rows.sort(key=lambda x: (x["m"]["cpse"], x["m"]["code"]))
    return [x for x in rows if company in ("ALL", "", None) or x["m"]["cpse"] == company]


def savings_rows(mats, disc):
    rows = []
    for c in mats:
        priced = [m for m in c["members"] if m["unitPrice"] > 0 and m["annualQty"] > 0]
        cps = E.uniq(m["cpse"] for m in priced)
        if len(cps) < 2:
            continue
        qty = sum(m["annualQty"] for m in priced)
        spend = sum(m["annualQty"] * m["unitPrice"] for m in priced)
        min_p = min(m["unitPrice"] for m in priced)
        best = next(m for m in priced if m["unitPrice"] == min_p)
        at_best = qty * min_p
        rows.append({"c": c, "priced": priced, "cps": cps, "qty": qty, "spend": spend, "minP": min_p, "best": best,
                     "saveBest": spend - at_best, "savePool": spend - at_best * (1 - disc / 100), "unit": "m" if priced[0]["baseUom"] == "M" else "ea"})
    rows.sort(key=lambda x: -x["savePool"])
    return rows


def enrichment(mats):
    out = []
    for c in mats:
        if len(c["members"]) < 2 or not c["cls"]:
            continue
        for m in c["members"]:
            for f in E.SCHEMA[E.CLASSES[c["cls"]]["group"]]:
                if not f["brand"] and m["a"].get(f["k"]) is None and c["golden"].get(f["k"]) is not None:
                    out.append({"m": m, "c": c, "f": f, "value": c["golden"][f["k"]]})
    return out


def inr(v):
    v = E.jround(v)
    if v >= 1e7:
        return f"₹{v / 1e7:.2f} crore"
    if v >= 1e5:
        return f"₹{v / 1e5:.2f} lakh"
    return "₹" + format_in(v)


def format_in(n):
    s = str(int(n))
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail


def tender_text(x, disc):
    g = E.CLASSES[x["c"]["cls"]]
    companies = {c.code: c for c in Company.objects.all()}
    lines = []
    for cp in x["cps"]:
        ms = [m for m in x["priced"] if m["cpse"] == cp]
        q = sum(m["annualQty"] for m in ms)
        lines.append(f"  {companies[cp].name}, {companies[cp].city}: {format_in(E.jround(q))} {x['unit']} a year (pays {inr(ms[0]['unitPrice'])}/{x['unit']} under code {ms[0]['code']})")
    best = companies[x["best"]["cpse"]]
    return "\n".join([
        "DRAFT JOINT TENDER BRIEF, generated by EkCode for discussion", "",
        f"Item              {x['c']['nmc']}", f"Specification     {x['c']['stdEff']}", f"SAP short text    {x['c']['short']}",
        f"UNSPSC class      {g['unspsc']} {g['unspscName']}", f"Combined demand   {format_in(E.jround(x['qty']))} {x['unit']} a year", "", "Consignees", *lines, "",
        f"Benchmark         {inr(x['minP'])}/{x['unit']}, the lowest price already paid ({best.name})",
        f"Current spend     {inr(x['spend'])} a year",
        f"Saving at benchmark               {inr(x['saveBest'])} a year",
        f"Saving with {disc}% pooled discount     {inr(x['savePool'])} a year (assumption)", "",
        "Suggested terms to discuss: technically compliant bids against the national specification,",
        "evaluation on landed cost per consignee, and a rate contract so each company orders against it.",
        "Confirm quantities with each company before issue."])


def api_sample(rec, c):
    g = E.CLASSES.get(c["cls"] or "", {})
    return json.dumps({"request": f"GET /api/v1/nmc/lookup?company={rec['cpse']}&code={rec['code']}", "response": {
        "nmc": c["nmc"], "status": "active" if c["status"] == "verified" else "provisional", "standard_description": c["stdEff"], "short_text": c["short"],
        "national_class": g.get("nat"), "unspsc": g.get("unspsc"), "base_uom": rec["baseUom"],
        "aliases": [{"company": m["cpse"], "code": m["code"], "uom": m["uom"]} for m in c["members"]]}}, indent=2, ensure_ascii=False)

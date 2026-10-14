"""EkCode REST API. Every change is permission-checked on the server and written to the audit chain."""
import csv
import io
import re

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import engine as E
from . import services as S
from .models import (AuditEntry, CodeRequest, Company, Decision, LookalikeConfirm, Material, Prevented, Record, Split, Link,
                     StdOverride)

TYPE_LABEL = {"duplicate": "Exact duplicate", "near": "Near-duplicate", "equivalent": "Equivalent"}


def deny(msg, status=403):
    return Response({"error": msg}, status=status)


def need(request, *roles):
    """None when allowed, otherwise the error response."""
    r = getattr(request.user, "role", None)
    if r in roles:
        return None
    if r == "auditor":
        return deny("The auditor account is read-only.")
    who = {"maker": "the maker", "checker": "the checker"}
    return deny(f"Only {' or '.join(who.get(x, x) for x in roles)} can do this.")


def done(request, toast=None, **extra):
    return Response({"ok": True, "toast": toast, "state": S.build_state(request.user), **extra})


def materials_with_status():
    decisions = {d.cid: d for d in Decision.objects.all()}
    return decisions, list(Material.objects.all())


def std_of(m):
    o = StdOverride.objects.filter(cid=m.cid).first()
    return o.text if o else m.std


def codes_of(m):
    recs = {r.rid: r for r in Record.objects.filter(rid__in=m.members)}
    return ", ".join(f"{recs[i].company_id} {recs[i].code}" for i in m.members if i in recs)


class StateView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(S.build_state(request.user))


class RunView(APIView):
    def post(self, request):
        if (err := need(request, "maker", "checker")):
            return err
        st = S.engine_state()
        if st.harmonized:
            return done(request)
        st.harmonized = True
        st.save(update_fields=["harmonized"])
        counts = ", ".join(f"{c.code} {c.records.count()}" for c in Company.objects.exclude(code="UPL"))
        S.audit(None, "Ingested material masters", f"{Company.objects.exclude(code='UPL').count()} companies", f"{counts} records ({Record.objects.filter(source='seed').count()} total)")
        mats = Material.objects.all()
        multi = sum(1 for m in mats if len(m.members) > 1)
        holds = sum(1 for m in mats if m.hold)
        S.audit(None, "Ran AI harmonization", f"{mats.count()} materials",
                f"{multi} duplicate sets, {len(st.lookalikes)} look-alikes kept apart, {holds} held for a person. "
                f"Precision {st.acc.get('precision', 0) * 100:.1f}%, recall {st.acc.get('recall', 0) * 100:.1f}% on the sample answer key.")
        return done(request, f"{Record.objects.count()} records fused into {mats.count()} materials.")


class MaterialAction(APIView):
    @transaction.atomic
    def post(self, request, cid, action):
        m = get_object_or_404(Material, cid=cid)
        decisions = {d.cid: d for d in Decision.objects.filter(cid=cid)}
        st = S.status_of(m, decisions)
        u = request.user
        if action == "approve":
            if (err := need(request, "maker")):
                return err
            if st != "proposed":
                return deny("This match is not waiting for approval.", 409)
            Decision.objects.update_or_create(cid=cid, defaults={"status": "approved", "approved_by": u, "approved_at": timezone.now(), "note": ""})
            S.audit(u, "Approved match", m.nmc, f"{std_of(m)} | {codes_of(m)}")
            return done(request, f"Approved {m.nmc}. It now waits for the checker.")
        if action == "reject":
            if (err := need(request, "maker")):
                return err
            if st != "proposed":
                return deny("Only a match waiting for approval can be rejected.", 409)
            for rid in m.members:
                Split.objects.get_or_create(record_id=rid)
            Decision.objects.filter(cid=cid).delete()
            S.audit(u, "Rejected match", m.nmc, codes_of(m))
            S.recompute()
            return done(request, "Match rejected. Each record keeps its own code.")
        if action == "verify":
            if (err := need(request, "checker")):
                return err
            if st != "approved":
                return deny("Only an approved match can be verified.", 409)
            d = decisions[cid]
            if d.approved_by_id == u.id:
                return deny("The person who approved a match cannot also verify it.", 409)
            d.status, d.verified_by, d.verified_at = "verified", u, timezone.now()
            d.save()
            S.audit(u, "Verified and activated code", m.nmc, std_of(m))
            return done(request, f"{m.nmc} is active.")
        if action == "sendback":
            if (err := need(request, "checker")):
                return err
            if st != "approved":
                return deny("Only an approved match can be sent back.", 409)
            why = (request.data.get("note") or "").strip()[:300] or "No reason given"
            Decision.objects.filter(cid=cid).update(status="proposed", note=why, verified_by=None, verified_at=None)
            S.audit(u, "Sent back to maker", m.nmc, why)
            return done(request, "Sent back to the maker.")
        if action == "edit":
            if (err := need(request, "maker")):
                return err
            if st not in ("proposed", "auto"):
                return deny("The description can only change before approval.", 409)
            txt = re.sub(r"\s+", " ", (request.data.get("text") or "").strip().upper())[:300]
            if len(txt) < 8:
                return deny("Write the full standard description.", 400)
            old = std_of(m)
            if txt != old:
                StdOverride.objects.update_or_create(cid=cid, defaults={"text": txt, "by": u})
                S.audit(u, "Edited standard description", m.nmc, f"{old} → {txt}")
            return done(request, "Description saved and logged.")
        return deny("Unknown action.", 404)


class BulkApprove(APIView):
    @transaction.atomic
    def post(self, request):
        if (err := need(request, "maker")):
            return err
        decisions, mats = materials_with_status()
        pick = [m for m in mats if S.status_of(m, decisions) == "proposed" and m.type == "duplicate" and m.score >= 85]
        now = timezone.now()
        for m in pick:
            Decision.objects.update_or_create(cid=m.cid, defaults={"status": "approved", "approved_by": request.user, "approved_at": now, "note": ""})
        S.audit(request.user, "Approved exact duplicates in bulk", f"{len(pick)} matches", ", ".join(m.nmc for m in pick))
        return done(request, f"Approved {len(pick)} exact duplicates. They now wait for the checker.")


class SplitView(APIView):
    @transaction.atomic
    def post(self, request, rid):
        if (err := need(request, "maker")):
            return err
        r = get_object_or_404(Record, rid=rid)
        m = get_object_or_404(Material, cid=r.material)
        decisions = {d.cid: d for d in Decision.objects.filter(cid=m.cid)}
        if len(m.members) < 2 or S.status_of(m, decisions) != "proposed":
            return deny("Records can only be removed from a match waiting for approval.", 409)
        rest = next(i for i in m.members if i != rid)
        Split.objects.get_or_create(record=r)
        S.audit(request.user, "Removed record from match", m.nmc, f"{r.company_id} {r.code}: {r.desc}")
        S.recompute()
        return done(request, f"{r.code} now has its own code.", focus=Record.objects.get(rid=rest).material)


class AttachView(APIView):
    @transaction.atomic
    def post(self, request, rid):
        if (err := need(request, "maker")):
            return err
        r = get_object_or_404(Record, rid=rid)
        target = get_object_or_404(Material, cid=request.data.get("target", ""))
        own = get_object_or_404(Material, cid=r.material)
        if not own.hold or target.cid not in own.hold.get("options", []):
            return deny("That record is not waiting to be attached to this material.", 409)
        Link.objects.create(a=r, b_id=target.members[0])
        S.audit(request.user, "Attached held record", target.nmc, f"{r.company_id} {r.code}: {r.desc}")
        S.recompute()
        return done(request, f"Attached {r.code}. The material is back in the approval queue.", focus=Record.objects.get(rid=rid).material)


class ConfirmLookalike(APIView):
    def post(self, request):
        if (err := need(request, "maker")):
            return err
        key = request.data.get("key", "")
        look = next((l for l in S.engine_state().lookalikes if l["key"] == key), None)
        if not look:
            return deny("Unknown look-alike pair.", 404)
        recs = {r.rid: r for r in Record.objects.filter(rid__in=[look["a"], look["b"]])}
        LookalikeConfirm.objects.get_or_create(key=key, defaults={"by": request.user})
        S.audit(request.user, "Confirmed look-alikes are different", f"{recs[look['a']].code} / {recs[look['b']].code}",
                f"{recs[look['a']].desc} | {recs[look['b']].desc}")
        return done(request, "Confirmed. They keep separate codes.")


# ---------------------------------------------------------------- check a part and new-code requests
_PREP = {"version": -1, "clusters": []}


def engine_clusters():
    """Materials with prepared member records, cached per engine version (Check a part runs on every keystroke)."""
    st = S.engine_state()
    if _PREP["version"] != st.version:
        recs = {r.rid: r for r in Record.objects.all()}
        clusters = []
        for m in Material.objects.all():
            members = [E.prepare({"id": i, "cpse": recs[i].company_id, "code": recs[i].code, "desc": recs[i].desc}) for i in m.members if i in recs]
            clusters.append({"id": m.cid, "cls": m.cls or None, "members": members})
        _PREP.update(version=st.version, clusters=clusters)
    return _PREP["clusters"]


def analyze(desc):
    an = E.analyze_part(desc, engine_clusters())
    if not an["cls"]:
        return an
    mats = {m.cid: m for m in Material.objects.filter(cid__in=[x["cid"] for x in an["matches"]])}
    decisions = {d.cid: d for d in Decision.objects.filter(cid__in=list(mats))}
    stds = {o.cid: o.text for o in StdOverride.objects.filter(cid__in=list(mats))}
    recs = {r.rid: r.company_id for r in Record.objects.filter(material__in=list(mats))}
    for x in an["matches"]:
        m = mats[x["cid"]]
        x.update(nmc=m.nmc, std=stds.get(m.cid, m.std), status=S.status_of(m, decisions), companies=E.uniq(recs.get(i) for i in m.members if i in recs))
    an["exact"] = [x for x in an["matches"] if x["type"] == "duplicate" and not x["keyMissing"]]
    return an


class CheckView(APIView):
    def post(self, request):
        desc = (request.data.get("desc") or "").strip()[:300]
        if len(desc) < 3:
            return Response({"cls": None, "empty": True})
        return Response(analyze(desc))


class ReuseView(APIView):
    def post(self, request):
        if (err := need(request, "maker", "checker")):
            return err
        m = get_object_or_404(Material, cid=request.data.get("cid", ""))
        company = get_object_or_404(Company, code=request.data.get("company", "REF"))
        desc = (request.data.get("desc") or "").strip()[:300]
        Prevented.objects.create(by=request.user, nmc=m.nmc, desc=desc, company=company)
        S.audit(request.user, "Reused an existing code", m.nmc, f'{company.code}: "{desc}" (no new code created)')
        return done(request, f"No duplicate created. {company.short} will use {m.nmc}.")


class RequestCreate(APIView):
    def post(self, request):
        if (err := need(request, "maker", "checker")):
            return err
        desc = (request.data.get("desc") or "").strip()[:300]
        if len(desc) < 3:
            return deny("Describe the part first.", 400)
        company = get_object_or_404(Company, code=request.data.get("company", "REF"))
        uom = (request.data.get("uom") or "EA")[:6]
        reason = (request.data.get("reason") or "").strip()[:300]
        an = analyze(desc)
        if an["cls"] and an.get("exact"):
            return deny(f"This part already exists as {an['exact'][0]['nmc']}. Use that code.", 409)
        if an["cls"] and (an["matches"] or an["missingKey"]) and len(reason) < 5:
            return deny("Add a short reason: similar materials already exist or a key attribute is missing.", 400)
        rid = f"REQ-{CodeRequest.objects.count() + 1:04d}"
        CodeRequest.objects.create(rid=rid, desc=desc, company=company, uom=uom, by=request.user, reason=reason)
        S.audit(request.user, "Requested a new code", rid, f'{company.code}: "{desc}"' + (f" | reason: {reason}" if reason else ""))
        return done(request, f"Request {rid} sent to the maker.")


class RequestAction(APIView):
    @transaction.atomic
    def post(self, request, rid, action):
        if (err := need(request, "maker")):
            return err
        q = get_object_or_404(CodeRequest, rid=rid)
        if q.status != "requested":
            return deny("This request is already closed.", 409)
        if action == "approve":
            n = Record.objects.filter(source="request").count() + 1
            seq = (Record.objects.order_by("-seq").values_list("seq", flat=True).first() or 0) + 1
            rec = Record.objects.create(rid=f"N{n:04d}", company=q.company, code=q.rid, desc=q.desc, uom=q.uom, source="request", seq=seq)
            S.recompute()
            rec.refresh_from_db()
            m = Material.objects.get(cid=rec.material)
            if len(m.members) == 1 and not m.hold:
                Decision.objects.update_or_create(cid=m.cid, defaults={"status": "approved", "approved_by": request.user, "approved_at": timezone.now()})
            q.status, q.record = "approved", rec
            q.save()
            S.audit(request.user, "Approved a new-code request", m.nmc, f'{q.rid}: "{q.desc}"')
            return done(request, f"{m.nmc} created. It now waits for the checker.", focus=m.cid)
        if action == "reject":
            why = (request.data.get("reason") or "").strip()[:300] or "No reason given"
            q.status, q.reject_reason = "rejected", why
            q.save()
            S.audit(request.user, "Rejected a new-code request", q.rid, why)
            return done(request, f"{q.rid} rejected.")
        if action == "reuse":
            m = get_object_or_404(Material, cid=request.data.get("cid", ""))
            q.status, q.reject_reason = "rejected", f"Existing code {m.nmc} used instead"
            q.save()
            Prevented.objects.create(by=request.user, nmc=m.nmc, desc=q.desc, company=q.company)
            S.audit(request.user, "Reused an existing code", m.nmc, f'{q.rid} closed: "{q.desc}" maps to the existing material')
            return done(request, f"{q.rid} closed. {m.nmc} is used instead.")
        return deny("Unknown action.", 404)


# ---------------------------------------------------------------- uploads, reset, audit
def _num(v):
    try:
        return float(re.sub(r"[^\d.]", "", str(v or "")) or 0)
    except ValueError:
        return 0.0


class UploadView(APIView):
    def post(self, request):
        if (err := need(request, "maker")):
            return err
        f = request.FILES.get("file")
        if not f or not f.name.lower().endswith(".csv"):
            return deny("Choose a .csv file. The template shows the columns.", 400)
        if f.size > 2 * 1024 * 1024:
            return deny("That file is over 2 MB. Split it into smaller extracts.", 400)
        text = f.read().decode("utf-8-sig", errors="replace")
        rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
        if len(rows) < 2:
            return deny("That file has no data rows. Use the CSV template.", 400)
        head = [h.strip().lower() for h in rows[0]]

        def col(names):
            return next((i for i, h in enumerate(head) if any(h == n or n in h for n in names)), -1)
        ci = {"code": col(["code", "matnr", "material", "item"]), "desc": col(["description", "desc", "maktx", "text"]),
              "uom": col(["uom", "unit", "meins"]), "price": col(["price", "rate", "cost"]), "stock": col(["stock", "qty", "quantity"])}
        if ci["desc"] < 0:
            return deny("No description column found. Use the CSV template.", 400)
        cell = lambda r, k: (r[ci[k]].strip() if ci[k] >= 0 and ci[k] < len(r) else "")
        start = Record.objects.filter(source="upload").count()
        seq = (Record.objects.order_by("-seq").values_list("seq", flat=True).first() or 0) + 1
        new = []
        for i, r in enumerate(rows[1:501]):
            desc = cell(r, "desc")
            if not desc:
                continue
            n = start + len(new) + 1
            new.append(Record(rid=f"U{n:04d}", company_id="UPL", code=(cell(r, "code") or f"ROW-{n}")[:40], desc=desc[:300], uom=(cell(r, "uom") or "EA")[:12],
                              price=_num(cell(r, "price")), stock=_num(cell(r, "stock")), source="upload", seq=seq + i))
        if not new:
            return deny("No rows with a description.", 400)
        with transaction.atomic():
            Record.objects.bulk_create(new)
            S.recompute()
        mats = {m.cid: m for m in Material.objects.all()}
        fresh = Record.objects.filter(rid__in=[r.rid for r in new])
        matched = sum(1 for r in fresh if len(mats[r.material].members) > 1)
        unrec = sum(1 for r in fresh if not r.cls)
        S.audit(request.user, "Uploaded extract", f.name[:120], f"{len(new)} records, {matched} matched existing materials, {unrec} not recognised")
        return done(request, f"Added {len(new)} records. {matched} matched materials the four companies already hold." + (f" {unrec} not recognised." if unrec else ""))

    def delete(self, request):
        if (err := need(request, "maker")):
            return err
        n = Record.objects.filter(source="upload").count()
        with transaction.atomic():
            Record.objects.filter(source="upload").delete()
            S.recompute()
        S.audit(request.user, "Removed uploaded records", "Your upload", f"{n} records")
        return done(request, "Uploaded records removed.")


class ResetView(APIView):
    def post(self, request):
        if (err := need(request, "maker", "checker")):
            return err
        S.reset_demo(request.user)
        return done(request, "Demo reset. Approvals, requests, uploads and the audit trail are cleared.")


class AuditVerify(APIView):
    def get(self, request):
        return Response(S.verify_chain())


# ---------------------------------------------------------------- exports (downloaded as files)
def file_response(name, body, ctype):
    resp = HttpResponse(body, content_type=ctype)
    resp["Content-Disposition"] = f'attachment; filename="{name}"'
    return resp


def to_csv(rows):
    buf = io.StringIO()
    csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n").writerows(rows)
    return buf.getvalue()


class Export(APIView):
    def get(self, request, kind, arg=None):
        mats = S.snapshot()
        q = request.GET
        if kind == "catalogue":
            text, cls, st = (q.get("q") or "").strip().upper(), q.get("cls") or "", q.get("st") or ""
            toks = [t for t in text.split() if t]
            rows = [c for c in mats if (not cls or c["cls"] == cls) and (not st or c["status"] == st) and
                    all(t in " ".join([c["nmc"], c["stdEff"], c["short"]] + [m["code"] + " " + m["desc"].upper() for m in c["members"]]) for t in toks)]
            return file_response("ekcode-national-catalogue.csv", to_csv([["nmc", "standard_description", "sap_short_text", "national_class", "unspsc", "unspsc_name", "status", "companies", "legacy_codes"]] + [
                [c["nmc"], c["stdEff"], c["short"], E.CLASSES.get(c["cls"] or "", {}).get("nat", ""), E.CLASSES.get(c["cls"] or "", {}).get("unspsc", ""),
                 E.CLASSES.get(c["cls"] or "", {}).get("unspscName", ""), S.STATUS_LABEL[c["status"]], " ".join(E.uniq(m["cpse"] for m in c["members"])),
                 " ".join(f"{m['cpse']}:{m['code']}" for m in c["members"])] for c in rows]), "text/csv")
        if kind == "mapping":
            company = q.get("company") or "ALL"
            rows = S.mapping_rows(mats, company)
            return file_response(f"ekcode-mapping-{company.lower()}.csv", to_csv([["company", "legacy_code", "legacy_description", "uom", "nmc", "standard_description", "action", "status"]] + [
                [x["m"]["cpse"], x["m"]["code"], x["m"]["desc"], x["m"]["uom"], x["c"]["nmc"], x["c"]["stdEff"], x["action"], S.MAPST[x["c"]["status"]]] for x in rows]), "text/csv")
        if kind == "sap":
            company = q.get("company") or "ALL"
            rows = [x for x in S.mapping_rows(mats, company) if x["c"]["status"] == "verified"]
            lines = ["# EkCode SAP load file: verified national codes only", "# COMPANY|MATNR|MTART|MATKL|MEINS|MAKTX|ZZNMC|UNSPSC|ACTION"]
            for x in rows:
                g = E.CLASSES.get(x["c"]["cls"] or "", {})
                lines.append("|".join([x["m"]["cpse"], x["m"]["code"], g.get("mtart", "ERSA"), g.get("nat", "UNCL"), x["m"]["baseUom"], x["c"]["short"], x["c"]["nmc"], g.get("unspsc", ""), x["action"]]))
            if not rows:
                lines.append("# No verified codes yet. The checker verifies codes in Review.")
            return file_response("ekcode-sap-load-file.txt", "\r\n".join(lines), "text/plain; charset=utf-8")
        if kind == "api":
            for c in mats:
                for m in c["members"]:
                    if m["id"] == arg:
                        return file_response(f"ekcode-api-{m['code']}.json", S.api_sample(m, c), "application/json")
            return deny("Unknown record.", 404)
        if kind == "audit":
            return file_response("ekcode-audit-trail.csv", to_csv([["n", "time", "person", "role", "action", "item", "detail", "prev_hash", "hash"]] + [
                [e.n, timezone.datetime.fromtimestamp(e.t / 1000, tz=timezone.get_current_timezone()).isoformat(), e.actor, e.role, e.action, e.obj, e.detail, e.prev, e.hash]
                for e in AuditEntry.objects.order_by("n")]), "text/csv")
        if kind == "enrichment":
            return file_response("ekcode-enrichment-suggestions.csv", to_csv([["company", "legacy_code", "description", "attribute", "suggested_value", "source_nmc"]] + [
                [x["m"]["cpse"], x["m"]["code"], x["m"]["desc"], x["f"]["label"], E.fmt_val(x["f"]["k"], x["value"]), x["c"]["nmc"]] for x in S.enrichment(mats)]), "text/csv")
        disc = max(0, min(15, int(_num(q.get("disc")) or 0)))
        if kind == "savings":
            return file_response("ekcode-savings-opportunities.csv", to_csv([["nmc", "material", "companies", "yearly_qty", "unit", "lowest_price", "lowest_price_company",
                                                                             "current_yearly_spend", "saving_at_lowest_price", f"saving_with_{disc}pct_pooled_discount"]] + [
                [x["c"]["nmc"], x["c"]["stdEff"], " ".join(x["cps"]), E.jround(x["qty"]), x["unit"], f"{x['minP']:.2f}", x["best"]["cpse"], E.jround(x["spend"]),
                 E.jround(x["saveBest"]), E.jround(x["savePool"])] for x in S.savings_rows(mats, disc)]), "text/csv")
        if kind == "tender":
            x = next((y for y in S.savings_rows(mats, disc) if y["c"]["id"] == arg), None)
            if not x:
                return deny("No pooled-buying opportunity for that material.", 404)
            return file_response(f"ekcode-tender-{x['c']['nmc']}.txt", S.tender_text(x, disc), "text/plain; charset=utf-8")
        return deny("Unknown export.", 404)

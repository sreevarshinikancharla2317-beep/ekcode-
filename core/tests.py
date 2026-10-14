"""EkCode backend tests: engine, sign-in, roles, workflow, requests, uploads, audit chain, exports."""
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from . import engine as E
from . import services as S
from .models import AuditEntry, Decision, Material, Record

PW = S.DEMO_PASSWORD
EMAIL = {"maker": "priya.menon@cpcl.example", "checker": "r.iyer@cpcl.example", "auditor": "anita.rao@audit.example"}


class EngineTests(TestCase):
    def test_sample_data_and_accuracy(self):
        recs = E.gen_records()
        self.assertEqual(len(recs), 327)
        res = E.run(recs)
        acc = E.accuracy(res)
        self.assertEqual(len(res["clusters"]), 127)
        self.assertEqual(acc["fp"], 0)            # never merges two different parts
        self.assertGreater(acc["recall"], .99)

    def test_extraction_reads_abbreviations_and_units(self):
        cls, a = E.extract(E.expand('GT VLV 2" CS 150# FLGD RF'))
        self.assertEqual(cls, "VGT")
        self.assertEqual((a["size"], a["rating"], a["end"], a["material"]), (50, 150, "RF", "CS"))
        cls, a = E.extract(E.expand("BEARING,BALL,6205 ZZ,FAG"))
        self.assertEqual((cls, a["designation"], a["seal"], a["brand"]), ("BRG", 6205, "ZZ", "FAG"))

    def test_conflicting_class_is_never_merged(self):
        mk = lambda i, d: E.prepare({"id": i, "cpse": "REF", "code": i, "desc": d})
        p = E.compare(mk("a", "GATE VALVE DN50 CLASS 150 A105 RF"), mk("b", "GATE VALVE DN50 CLASS 300 A105 RF"))
        self.assertEqual(p["type"], "different")

    def test_equivalent_materials(self):
        mk = lambda i, d: E.prepare({"id": i, "cpse": "REF", "code": i, "desc": d})
        p = E.compare(mk("a", "GATE VALVE DN50 CLASS 150 A105 RF"), mk("b", "GATE VALVE DN50 CLASS 150 WCB RF"))
        self.assertEqual(p["type"], "equivalent")


class ApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        S.seed(force=True)

    def client_for(self, role):
        c = APIClient()
        r = c.post("/api/auth/login/", {"email": EMAIL[role], "pw": PW}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        r = c.post("/api/auth/otp/", {"code": r.json()["demoCode"]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        return c

    def run_harmonization(self, c):
        self.assertEqual(c.post("/api/run/").status_code, 200)

    # ---- sign-in
    def test_anonymous_state_has_no_data(self):
        r = APIClient().get("/api/state/").json()
        self.assertIsNone(r["me"])
        self.assertNotIn("records", r)

    def test_lockout_after_five_wrong_passwords(self):
        c = APIClient()
        for _ in range(4):
            self.assertEqual(c.post("/api/auth/login/", {"email": EMAIL["maker"], "pw": "wrong-pass"}, format="json").status_code, 400)
        self.assertEqual(c.post("/api/auth/login/", {"email": EMAIL["maker"], "pw": "wrong-pass"}, format="json").status_code, 423)
        self.assertEqual(c.post("/api/auth/login/", {"email": EMAIL["maker"], "pw": PW}, format="json").status_code, 423)

    def test_wrong_code_three_times_restarts(self):
        c = APIClient()
        c.post("/api/auth/login/", {"email": EMAIL["checker"], "pw": PW}, format="json")
        for _ in range(2):
            self.assertEqual(c.post("/api/auth/otp/", {"code": "000000"}, format="json").status_code, 400)
        r = c.post("/api/auth/otp/", {"code": "000000"}, format="json")
        self.assertTrue(r.json().get("restart"))
        self.assertIsNone(c.get("/api/state/").json()["me"])

    def test_sign_in_is_audited(self):
        self.client_for("maker")
        self.assertTrue(AuditEntry.objects.filter(action="Signed in").exists())

    # ---- roles and maker-checker
    def test_maker_approves_checker_verifies(self):
        maker, checker = self.client_for("maker"), self.client_for("checker")
        self.run_harmonization(maker)
        m = next(x for x in Material.objects.all() if len(x.members) > 1)
        self.assertEqual(checker.post(f"/api/materials/{m.cid}/approve/").status_code, 403)
        self.assertEqual(maker.post(f"/api/materials/{m.cid}/verify/").status_code, 403)
        self.assertEqual(maker.post(f"/api/materials/{m.cid}/approve/").status_code, 200)
        self.assertEqual(checker.post(f"/api/materials/{m.cid}/verify/").status_code, 200)
        self.assertEqual(Decision.objects.get(cid=m.cid).status, "verified")

    def test_auditor_is_read_only(self):
        a = self.client_for("auditor")
        m = next(x for x in Material.objects.all() if len(x.members) > 1)
        for url in ("/api/run/", f"/api/materials/{m.cid}/approve/", "/api/reset/", "/api/materials/bulk-approve/"):
            self.assertEqual(a.post(url).status_code, 403, url)
        self.assertEqual(a.get("/api/state/").status_code, 200)
        self.assertEqual(a.get("/api/export/catalogue/").status_code, 200)

    def test_split_and_reject_recompute(self):
        maker = self.client_for("maker")
        self.run_harmonization(maker)
        before = Material.objects.count()
        m = next(x for x in Material.objects.all() if len(x.members) >= 3)
        r = maker.post(f"/api/records/{m.members[0]}/split/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Material.objects.count(), before + 1)
        m2 = Material.objects.get(cid=r.json()["focus"])
        self.assertEqual(maker.post(f"/api/materials/{m2.cid}/reject/").status_code, 200)
        self.assertEqual(Material.objects.count(), before + len(m.members) - 1)

    def test_held_record_can_be_attached(self):
        maker = self.client_for("maker")
        held = Material.objects.exclude(hold=None).first()
        self.assertIsNotNone(held)
        r = maker.post(f"/api/records/{held.hold['rec']}/attach/", {"target": held.hold["options"][0]}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertGreater(len(Material.objects.get(cid=r.json()["focus"]).members), 1)

    # ---- check a part and requests
    def test_check_finds_existing_code(self):
        maker = self.client_for("maker")
        m = next(x for x in Material.objects.all() if x.cls == "VGT" and len(x.members) >= 3 and all(x.golden.get(k) for k in ("size", "rating", "material", "end", "standard")))
        g = m.golden
        desc = f"{E.INCH[g['size']]} inch gate valve {g['material']} class {g['rating']} {E.ENDN[g['end']].lower()} {g['standard']}"
        an = maker.post("/api/check/", {"desc": desc}, format="json").json()
        self.assertEqual(an["exact"][0]["cid"], m.cid)
        r = maker.post("/api/requests/", {"desc": desc, "company": "REF"}, format="json")
        self.assertEqual(r.status_code, 409)   # cannot request a duplicate of an existing code

    def test_new_code_request_lifecycle(self):
        maker, checker = self.client_for("maker"), self.client_for("checker")
        r = checker.post("/api/requests/", {"desc": "Butterfly valve 12 inch rubber lined", "company": "PWR", "uom": "EA"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        r = maker.post("/api/requests/REQ-0001/approve/")
        self.assertEqual(r.status_code, 200)
        cid = r.json()["focus"]
        self.assertEqual(Decision.objects.get(cid=cid).status, "approved")
        self.assertEqual(checker.post(f"/api/materials/{cid}/verify/").status_code, 200)

    # ---- uploads, audit, exports, reset
    def test_csv_upload_matches_and_can_be_removed(self):
        maker = self.client_for("maker")
        rec = Record.objects.filter(source="seed").first()
        f = SimpleUploadedFile("extract.csv", f"code,description,uom,price,stock\nX-1,\"{rec.desc}\",EA,100,2\nX-2,Office chair,EA,9000,1\n".encode(), content_type="text/csv")
        r = maker.post("/api/uploads/", {"file": f}, format="multipart")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn("1 matched", r.json()["toast"])
        self.assertEqual(maker.delete("/api/uploads/").status_code, 200)
        self.assertFalse(Record.objects.filter(source="upload").exists())

    def test_audit_chain_detects_tampering(self):
        maker = self.client_for("maker")
        self.run_harmonization(maker)
        self.assertTrue(maker.get("/api/audit/verify/").json()["ok"])
        e = AuditEntry.objects.order_by("n")[1]
        e.detail = "edited after the fact"
        e.save()
        self.assertFalse(maker.get("/api/audit/verify/").json()["ok"])

    def test_exports(self):
        maker = self.client_for("maker")
        self.run_harmonization(maker)
        rid = Record.objects.first().rid
        for url, ctype in (("/api/export/catalogue/", "text/csv"), ("/api/export/mapping/?company=REF", "text/csv"), ("/api/export/sap/", "text/plain"),
                           (f"/api/export/api/{rid}/", "application/json"), ("/api/export/audit/", "text/csv"), ("/api/export/enrichment/", "text/csv"),
                           ("/api/export/savings/?disc=5", "text/csv")):
            r = maker.get(url)
            self.assertEqual(r.status_code, 200, url)
            self.assertIn(ctype, r["Content-Type"])
            self.assertIn("attachment", r["Content-Disposition"])

    def test_reset_clears_decisions(self):
        maker = self.client_for("maker")
        self.run_harmonization(maker)
        maker.post("/api/materials/bulk-approve/")
        self.assertTrue(Decision.objects.exists())
        self.assertEqual(maker.post("/api/reset/").status_code, 200)
        self.assertFalse(Decision.objects.exists())
        self.assertEqual(AuditEntry.objects.count(), 1)

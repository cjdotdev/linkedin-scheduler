"""Tests for scripts/publish.py: a fake clock, a fake LinkedIn API and a throwaway copy of the project.

    python3 -m unittest discover tests
"""
import datetime as dt
import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "publish.py"


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "scripts").mkdir()
        (self.root / "posts" / "texts").mkdir(parents=True)
        (self.root / "posts" / "images").mkdir()
        (self.root / "posts" / "images" / "pic.png").write_bytes(b"x" * 100)
        shutil.copy(SCRIPT, self.root / "scripts")
        (self.root / ".env").write_text("LINKEDIN_ACCESS_TOKEN=fake\nLINKEDIN_PERSON_URN=urn:li:person:T\n")
        spec = importlib.util.spec_from_file_location("publish", self.root / "scripts" / "publish.py")
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.clock = dt.datetime(2026, 10, 26, 9, 0)
        self.m.now = lambda: self.clock
        self.posts, self.comments, self.fail = 0, 0, None
        self.m.request = self.fake_request
        self.m.upload_media = self.fake_upload

    def tearDown(self):
        shutil.rmtree(self.root)

    # Fakes -----------------------------------------------------------------------------------------
    def fake_request(self, method, url, token, body=None, data=None, headers=None):
        if url.endswith("/ugcPosts"):
            if self.fail in ("4xx", "5xx"):
                code, self.fail = (422 if self.fail == "4xx" else 504), None
                raise self.m.ApiError(code, f"fake {code}")
            if self.fail == "network":
                self.fail = None
                raise OSError("fake connection reset")
            self.posts += 1
            return 201, {"X-RestLi-Id": f"urn:li:share:{self.posts}"}, None
        if url.endswith("/comments"):
            self.comments += 1
        return 201, {}, None

    def fake_upload(self, path, token, author):
        if self.fail == "upload":
            self.fail = None
            raise OSError("fake network unreachable")
        return "image", "urn:li:digitalmediaAsset:X"

    # Helpers ---------------------------------------------------------------------------------------
    def post(self, name, date="2026-10-26", time=None, text=None, **extra):
        lines = ["---", f"date: {date}", "status: ready"]
        lines += [f"time: {time}"] if time else []
        lines += [f"{key}: {value}" for key, value in extra.items()]
        lines += ["---", text or f"Text of {name}."]
        (self.root / "posts" / "texts" / f"{name}.md").write_text("\n".join(lines) + "\n")

    def run_at(self, hour, minute=0, day=None):
        self.clock = self.clock.replace(hour=hour, minute=minute, **({"day": day} if day else {}))
        before = self.posts
        try:
            self.m.main()
        except SystemExit:
            pass
        return self.posts - before

    def status(self, name):
        for folder in ("texts", "posted"):
            f = self.root / "posts" / folder / f"{name}.md"
            if f.exists():
                line = next(l for l in f.read_text().splitlines() if l.startswith("status:"))
                return f"{folder}:{line.split(':', 1)[1].strip()}"
        return None

    # Tests -----------------------------------------------------------------------------------------
    def test_publishes_once_and_moves_the_file(self):
        self.post("a")
        self.assertEqual(self.run_at(9), 1)
        self.assertEqual(self.status("a"), "posted:posted")
        self.assertEqual(self.run_at(13), 0)

    def test_nothing_before_its_time(self):
        self.post("a")
        self.assertEqual(self.run_at(8), 0)
        self.assertEqual(self.status("a"), "texts:ready")

    def test_missed_morning_goes_out_at_the_next_run(self):
        self.post("a")
        self.assertEqual(self.run_at(13), 1)

    def test_one_post_per_run_earliest_slot_first(self):
        self.post("late", time="13:00")
        self.post("early", time="09:00")
        self.assertEqual(self.run_at(13), 1)
        self.assertEqual(self.status("early"), "posted:posted")
        self.assertEqual(self.status("late"), "texts:ready")
        self.assertEqual(self.run_at(18), 1)
        self.assertEqual(self.status("late"), "posted:posted")

    def test_past_day_is_never_sent_late(self):
        self.post("old", date="2026-10-23")
        self.assertEqual(self.run_at(9), 0)
        self.assertEqual(self.status("old"), "texts:ready")

    def test_same_text_is_refused(self):
        self.post("a", text="Same text.")
        self.post("b", text="Same   text.")
        self.assertEqual(self.run_at(9), 1)
        self.assertEqual(self.run_at(13), 0)
        self.assertEqual(self.status("b"), "texts:ready")

    def test_upload_failure_goes_back_to_ready_and_is_retried(self):
        self.post("a", media="images/pic.png")
        self.fail = "upload"
        self.assertEqual(self.run_at(9), 0)
        self.assertEqual(self.status("a"), "texts:ready")
        self.assertEqual(self.run_at(13), 1)

    def test_refusal_4xx_goes_back_to_ready(self):
        self.post("a")
        self.fail = "4xx"
        self.assertEqual(self.run_at(9), 0)
        self.assertEqual(self.status("a"), "texts:ready")
        self.assertEqual(self.run_at(13), 1)

    def test_unknown_outcome_is_never_retried(self):
        for failure in ("5xx", "network"):
            with self.subTest(failure=failure):
                name = f"a-{failure}"
                self.post(name, date=f"2026-10-{27 if failure == '5xx' else 28}")
                self.fail = failure
                day = 27 if failure == "5xx" else 28
                self.assertEqual(self.run_at(9, day=day), 0)
                self.assertEqual(self.status(name), "texts:publishing")
                self.assertEqual(self.run_at(13, day=day), 0)

    def test_first_comment_follows_the_post(self):
        self.post("a", first_comment="The link: https://example.com")
        self.run_at(9)
        self.assertEqual(self.comments, 1)

    def test_dry_run_sends_nothing(self):
        self.post("a")
        import sys
        argv, sys.argv = sys.argv, ["publish.py", "--dry-run"]
        try:
            self.assertEqual(self.run_at(9), 0)
        finally:
            sys.argv = argv
        self.assertEqual(self.status("a"), "texts:ready")

    def test_refusal_is_retried_at_the_next_try_of_the_slot(self):
        self.post("a")
        self.fail = "4xx"
        self.assertEqual(self.run_at(9, 0), 0)
        self.assertEqual(self.run_at(9, 2), 1)
        self.assertEqual(self.run_at(9, 4), 0)

    def test_due_check_is_quiet_and_sends_nothing(self):
        import sys
        self.post("a", time="13:00")
        argv, sys.argv = sys.argv, ["publish.py", "--due"]
        try:
            codes = []
            for hour in (9, 13):
                self.clock = self.clock.replace(hour=hour)
                with self.assertRaises(SystemExit) as exit_:
                    self.m.main()
                codes.append(exit_.exception.code)
        finally:
            sys.argv = argv
        self.assertEqual(codes, [1, 0])
        self.assertEqual(self.posts, 0)
        self.assertEqual(self.status("a"), "texts:ready")
        self.assertFalse(self.m.LOG.exists())

    def test_bold_hook(self):
        self.assertEqual(self.m.linkedin_text("**Hé 1**"), "𝗛𝗲́ 𝟭")


if __name__ == "__main__":
    unittest.main()

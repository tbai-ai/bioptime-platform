#!/usr/bin/env python3
"""Unit tests for the options of tools/visual_baseline.py (Python 3.9, stdlib only, no browser).

    python3 -I tools/test_visual_baseline.py

A real capture (Chrome, a server) is not started here: --cdp-port, --work and --offline are checked for their
defaults and wiring (Chrome's command line is recorded instead of started), the offline font answers through
check_site's helper, and compare --only on small PNG sets.
"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import visual_baseline as vb               # noqa: E402

FONTS_URL = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'


def png(path, w, h, rgb):
    wr = vb.PngWriter(path, w, h)
    for _ in range(h):
        wr.add(bytes(rgb) * w)
    wr.close()


class CaptureOptions(unittest.TestCase):
    def test_defaults_are_unchanged(self):
        a = vb.build_parser().parse_args(['capture', '--out', '/tmp/x'])
        self.assertEqual(a.cdp_port, 9361)
        self.assertEqual(a.work, os.path.join(vb.PLATFORM, '.local', 'visual-baseline'))
        self.assertFalse(a.offline)
        self.assertEqual((vb.PORT_CDP, vb.WORK), (9361, os.path.join(vb.PLATFORM, '.local', 'visual-baseline')))

    def test_own_port_work_and_offline(self):
        a = vb.build_parser().parse_args(['capture', '--out', '/tmp/x', '--cdp-port', '9462', '--work', '/tmp/vb-work', '--offline'])
        self.assertEqual((a.cdp_port, a.work, a.offline), (9462, '/tmp/vb-work', True))

    def test_driver_takes_the_port_and_work_folder(self):
        old = (vb.PORT_CDP, vb.WORK)
        try:
            vb.PORT_CDP, vb.WORK = 9462, '/tmp/vb-work-test'
            cs = vb.load_driver()
            self.assertEqual((cs.PORT_CDP, cs.OUT), (9462, '/tmp/vb-work-test'))
            self.assertFalse(cs.OFFLINE)                 # check_site's own offline mode stays off; the capturer answers
        finally:
            vb.PORT_CDP, vb.WORK = old


class Launched(Exception):
    pass


class OfflineChrome(unittest.TestCase):
    """capture --offline starts Chrome with its own traffic off; only loopback and BASE's host resolve"""

    def setUp(self):
        self.cs = vb.load_driver()
        self.saved = (vb.BASE, self.cs.NO_NETWORK, self.cs.NO_NETWORK_HOSTS, self.cs.subprocess.Popen)
        self.launched = []

        def fake_popen(cmd, **kw):            # records the command line instead of starting Chrome
            self.launched.append(cmd)
            raise Launched()
        self.cs.subprocess.Popen = fake_popen

    def tearDown(self):
        vb.BASE, self.cs.NO_NETWORK, self.cs.NO_NETWORK_HOSTS, self.cs.subprocess.Popen = self.saved

    def launch(self, base, offline):
        vb.BASE = base
        with self.assertRaises(Launched):
            vb.make_browser(self.cs, None, offline=offline)
        return self.launched[-1]

    def test_online_capture_keeps_the_old_command_line(self):
        cmd = self.launch('http://localhost:3000', False)
        self.assertFalse(any(a.startswith(('--disable-background-networking', '--disable-component-update', '--no-proxy-server', '--host-resolver-rules')) for a in cmd))
        self.assertEqual((self.cs.NO_NETWORK, self.cs.NO_NETWORK_HOSTS), (False, ()))

    def test_offline_capture_switches_off_chromes_own_traffic(self):
        cmd = self.launch('http://localhost:5860', True)
        self.assertEqual(cmd[-5:-1], ['--disable-background-networking', '--disable-component-update', '--no-proxy-server',
                                      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1 , EXCLUDE *.localhost'])
        self.assertTrue(self.cs.NO_NETWORK)

    def test_a_non_loopback_base_stays_resolvable(self):
        cmd = self.launch('http://staging.example.test:5860', True)
        self.assertTrue(cmd[-2].endswith('EXCLUDE *.localhost , EXCLUDE staging.example.test'), cmd[-2])


@unittest.skipUnless(os.path.isdir(vb.FONTS_DIR), 'self-hosted fonts not found')
class OfflineFonts(unittest.TestCase):
    def test_fonts_from_the_dashboard_copies_and_nothing_else(self):
        cs = vb.load_driver()
        css, ctype = cs.offline_answer(FONTS_URL, fonts_dir=vb.FONTS_DIR, scripts=False)
        self.assertEqual(ctype, 'text/css; charset=utf-8')
        self.assertEqual(css.count(b'@font-face'), 32)
        body, ctype = cs.offline_answer(cs.OFFLINE_FONT_URL + 'montserrat-latin.woff2', fonts_dir=vb.FONTS_DIR, scripts=False)
        with open(os.path.join(vb.FONTS_DIR, 'montserrat-latin.woff2'), 'rb') as f:
            self.assertEqual(body, f.read())
        for url in ('https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js',
                    'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js', 'https://example.com/a.png'):
            self.assertIsNone(cs.offline_answer(url, fonts_dir=vb.FONTS_DIR, scripts=False), url)


class OnlyFilter(unittest.TestCase):
    def test_capture_and_compare_share_the_globs(self):
        run = vb.Run(None, '/tmp/x', ['website', 'admin/theme'])
        self.assertTrue(callable(getattr(vb.Run, 'shoot', None)))
        self.assertTrue(run.wanted('website', 'home'))
        self.assertTrue(run.wanted('admin', 'theme'))
        self.assertFalse(run.wanted('admin', 'audit'))
        self.assertTrue(vb.Run(None, '/tmp/x', None).wanted('coach', 'today'))
        self.assertTrue(vb.matches_only(['web*'], 'website', 'faq'))
        self.assertFalse(vb.matches_only(['signin'], 'website', 'login'))


class CompareOnly(unittest.TestCase):
    def run_compare(self, base, new, out, *extra):
        args = vb.build_parser().parse_args(['compare', '--base', base, '--new', new, '--out', out] + list(extra))
        with redirect_stdout(io.StringIO()):
            code = vb.compare(args)
        with open(os.path.join(out, 'summary.json'), encoding='utf-8') as f:
            return code, json.load(f)

    def test_only_limits_the_compare_to_matching_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            base, new = os.path.join(tmp, 'base'), os.path.join(tmp, 'new')
            png(os.path.join(base, 'website', 'home@390.png'), 6, 4, (10, 20, 30))
            png(os.path.join(new, 'website', 'home@390.png'), 6, 4, (10, 20, 30))
            png(os.path.join(base, 'admin', 'audit@390.png'), 6, 4, (1, 2, 3))      # not in the website-only capture
            code, s = self.run_compare(base, new, os.path.join(tmp, 'all'))
            self.assertEqual((code, s['compared'], s['missing_in_new']), (1, 2, ['admin/audit@390.png']))
            code, s = self.run_compare(base, new, os.path.join(tmp, 'web'), '--only', 'website')
            self.assertEqual((code, s['compared'], s['identical'], s['missing_in_new'], s['only']), (0, 1, 1, [], 'website'))
            code, s = self.run_compare(base, new, os.path.join(tmp, 'page'), '--only', 'website/home,admin/nothing')
            self.assertEqual((code, s['compared']), (0, 1))
            code, s = self.run_compare(base, new, os.path.join(tmp, 'none'), '--only', 'coach')
            self.assertEqual((code, s['compared']), (1, 0))                       # nothing to compare is a failure, as before

    def test_only_still_flags_a_changed_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            base, new = os.path.join(tmp, 'base'), os.path.join(tmp, 'new')
            png(os.path.join(base, 'website', 'home@390.png'), 6, 4, (10, 20, 30))
            png(os.path.join(new, 'website', 'home@390.png'), 6, 4, (200, 20, 30))
            code, s = self.run_compare(base, new, os.path.join(tmp, 'web'), '--only', 'website')
            self.assertEqual((code, s['over_threshold']), (1, 1))


if __name__ == '__main__':
    unittest.main(verbosity=2)

"""Release planning must never turn partial, missing or changed evidence green."""
import copy
import importlib.util
import sys
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('ci_release', Path(__file__).parents[1] / 'tools/ci-release.py')
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class ReleasePlanning(unittest.TestCase):
    def test_docs_do_not_start_browsers_upgrades_or_connector_installations(self):
        plan = ci.make_plan(['README.md', 'docs/DATA_COMPATIBILITY.md', 'connector/INSTALL.md'])
        self.assertEqual(plan['tier'], 'light')
        self.assertFalse(any(plan[key] for key in ['package', 'browser', 'upgrade', 'connector']))

    def test_known_page_styles_run_related_pages_and_shared_ui(self):
        plan = ci.make_plan(['extension/composer-page.css'])
        self.assertEqual(plan['tier'], 'targeted')
        self.assertIn('composer_video_dialogue_e2e.py', plan['scripts'])
        self.assertIn('composer_library_host_e2e.py', plan['scripts'])
        self.assertIn('ui_foundation_e2e.py', plan['scripts'])
        self.assertNotIn('x_large_media_save_e2e.py', plan['scripts'])
        self.assertFalse(plan['upgrade'])

    def test_shared_data_media_dependencies_versions_and_unknown_paths_run_every_scenario(self):
        for path in ['extension/background.js', 'extension/page-session-media.js', 'extension/zip.js',
                     'extension/library-storage.js', 'extension/manifest.json', 'package-lock.json',
                     'test/e2e_support.py', '.github/workflows/release-safety.yml',
                     'extension/new-feature.js', 'new-configuration.json']:
            with self.subTest(path=path):
                plan = ci.make_plan([path])
                self.assertEqual(plan['tier'], 'full')
                self.assertEqual(plan['scripts'], ci.SCRIPTS)
                self.assertIn('x_large_media_save_e2e.py', plan['scripts'])
                self.assertTrue(plan['upgrade'] and plan['connector'])

    def test_registered_browser_test_is_targeted_but_helpers_are_full(self):
        plan = ci.make_plan(['test/x_large_media_save_e2e.py'])
        self.assertEqual(plan['scripts'], ['x_large_media_save_e2e.py'])
        self.assertEqual(plan['shards'], 1)
        self.assertEqual(ci.make_plan(['test/fixtures/changed.mp4'])['tier'], 'full')

    def test_connector_only_changes_check_all_connector_platforms_without_full_browser_suite(self):
        plan = ci.make_plan(['connector/mcp.mjs'])
        self.assertEqual(plan['tier'], 'targeted')
        self.assertTrue(plan['connector'] and plan['package'])
        self.assertFalse(plan['browser'] or plan['upgrade'])

    def test_mixed_change_cannot_be_downgraded_by_docs_or_a_style_change(self):
        self.assertEqual(ci.make_plan(['README.md', 'extension/library.css', 'extension/media-store.js'])['tier'], 'full')
        self.assertEqual(ci.make_plan([], force_full=True)['scripts'], ci.SCRIPTS)

    def test_shards_partition_every_registered_scenario_exactly_once(self):
        plan = ci.make_plan([], force_full=True, shards=4)
        chunks = [plan['scripts'][i::plan['shards']] for i in range(plan['shards'])]
        self.assertEqual(sorted(sum(chunks, [])), sorted(ci.SCRIPTS))
        self.assertEqual(len(sum(chunks, [])), len(set(sum(chunks, []))))


class EvidenceGate(unittest.TestCase):
    def setUp(self):
        self.plan = ci.make_plan([], force_full=True, shards=4)
        self.package = {'tree': 'current-tree', 'version': '1.25.0', 'extensionId': 'fixed-id',
                        'archives': {'extension.zip': 'complete-sha'}}
        self.reports = []
        for index in range(self.plan['shards']):
            scripts = self.plan['scripts'][index::self.plan['shards']]
            url = 'chrome-extension://fixed-id/'
            self.reports.append({'shard': index, 'scripts': scripts, 'package': self.package,
                                 'status': 'passed', 'results': [{'script': s, 'returncode': 0} for s in scripts],
                                 'preflight': {'extensionId': 'fixed-id', 'manifestVersion': '1.25.0',
                                  'serviceWorker': url + 'background.js', 'pageErrors': [],
                                  'pages': [url + n for n in ['collector.html', 'library.html', 'composer.html']]}})
        self.jobs = {name: {'result': 'success'} for name in ['plan', 'source-contracts', 'package',
                      'browser-shards', 'linux-upgrade', 'windows-portability', 'connector-platforms']}

    def test_complete_same_package_evidence_passes(self):
        ci.validate_jobs(self.plan, self.jobs)
        ci.validate_reports(self.plan, self.package, self.reports)

    def test_missing_duplicate_or_failed_shards_block_release(self):
        for mutate in [lambda r: r.pop(), lambda r: r.__setitem__(1, r[0]),
                       lambda r: r[0].update(status='failed'),
                       lambda r: r[0]['results'][0].update(returncode=1),
                       lambda r: r[0]['results'].pop()]:
            reports = copy.deepcopy(self.reports)
            mutate(reports)
            with self.assertRaises(ValueError):
                ci.validate_reports(self.plan, self.package, reports)

    def test_replaced_package_source_or_preflight_identity_blocks_release(self):
        for mutate in [lambda r: r[0]['package'].update(tree='other-source'),
                       lambda r: r[0]['package']['archives'].update({'extension.zip': 'other-bytes'}),
                       lambda r: r[0]['preflight'].update(extensionId='other-id'),
                       lambda r: r[0]['preflight'].update(pageErrors=['runtime exception'])]:
            reports = copy.deepcopy(self.reports)
            mutate(reports)
            with self.assertRaises(ValueError):
                ci.validate_reports(self.plan, self.package, reports)

    def test_failure_cancellation_and_skipped_required_jobs_block_release(self):
        for name in self.jobs:
            for state in ['failure', 'cancelled', 'skipped']:
                jobs = copy.deepcopy(self.jobs)
                jobs[name]['result'] = state
                with self.assertRaises(ValueError):
                    ci.validate_jobs(self.plan, jobs)

    def test_documentation_gate_requires_real_plan_and_source_success(self):
        plan = ci.make_plan(['README.md'])
        jobs = {name: {'result': 'success' if name in ['plan', 'source-contracts'] else 'skipped'} for name in self.jobs}
        ci.validate_jobs(plan, jobs)
        jobs['source-contracts']['result'] = 'failure'
        with self.assertRaises(ValueError):
            ci.validate_jobs(plan, jobs)

    def test_partial_evidence_cannot_be_called_a_full_release(self):
        plan = copy.deepcopy(self.plan)
        plan['scripts'] = plan['scripts'][:-1]
        with self.assertRaises(ValueError):
            ci.validate_jobs(plan, self.jobs)


if __name__ == '__main__':
    unittest.main()

"""Risk-based CI planning and verification of one immutable packaged runtime."""
import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'test'))
from run_e2e import SCRIPTS

# Only established page-local presentation files qualify for targeted browser
# coverage. Shared logic, storage, media, dependencies and unknown paths are full.
PAGE_SCOPES = {
    'library': ('library', 'detail', 'video_detail', 'project', 'sharing', 'undo',
                'case_', 'manager', 'material_management', 'settings', 'selection_video'),
    'composer': ('composer', 'compatible_composer', 'creative', 'ai_', 'zhipu'),
    'skills': ('skill', 'creative_skill', 'curated_skill'),
    'curated': ('curated',),
}
PAGE_FILES = {
    'extension/library.html': 'library', 'extension/library.css': 'library',
    'extension/library-layout.css': 'library',
    'extension/composer.html': 'composer', 'extension/composer-page.css': 'composer',
    'extension/skills.html': 'skills', 'extension/skills-page.css': 'skills',
    'extension/curated.html': 'curated', 'extension/curated.css': 'curated',
}
SHARED_UI_SCRIPTS = {'frontend_compact_surfaces_e2e.py', 'ui_foundation_e2e.py',
                     'ui_regressions_e2e.py', 'brand_i18n_e2e.py', 'english_interaction_states_e2e.py'}


def make_plan(paths, force_full=False, shards=4):
    if not isinstance(shards, int) or shards < 1:
        raise ValueError('Browser shard count must be a positive integer')
    if len(SCRIPTS) != len(set(SCRIPTS)):
        raise ValueError('Browser registry contains duplicate scripts')
    selected, scopes = set(), set()
    full, connector = force_full, False
    for path in paths:
        file = Path(path)
        if file.suffix == '.md' and (file.parent == Path('.') or
                path.startswith(('docs/', 'store/', 'connector/'))):
            continue
        if path in {'LICENSE', 'NOTICE'}:
            continue
        if path.startswith('connector/'):
            scopes.add('connector')
            connector = True
        elif path in PAGE_FILES:
            area = PAGE_FILES[path]
            scopes.add(area)
            selected.update(script for script in SCRIPTS
                            if script.startswith(PAGE_SCOPES[area]) or script in SHARED_UI_SCRIPTS)
        elif path.startswith('test/') and file.name.endswith('.test.js'):
            scopes.add('source-tests')
        elif path == f'test/{file.name}' and file.name in SCRIPTS:
            scopes.add('browser-tests')
            selected.add(file.name)
        else:
            full = True
    tier = 'full' if full else 'targeted' if scopes else 'light'
    scripts = list(SCRIPTS) if full else [script for script in SCRIPTS if script in selected]
    count = min(shards, len(scripts)) if scripts else 0
    return {'tier': tier, 'changedFiles': sorted(set(paths)), 'scripts': scripts,
            'shards': count, 'matrix': {'include': [{'shard': index} for index in range(count)]},
            'package': bool(scripts) or connector or full, 'browser': bool(scripts),
            'upgrade': full, 'connector': connector or full, 'forceFull': force_full}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode().strip()


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def digest(path):
    with Path(path).open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def archives():
    version = json.loads((ROOT / 'extension/manifest.json').read_text())['version']
    return [f'PromptDirector-{version}.zip', f'store/PromptDirector-{version}-Chrome-Web-Store.zip',
            f'PromptDirector-{version}-Agent-Connector.zip']


def checked_zip(path):
    archive = zipfile.ZipFile(path)
    names = archive.namelist()
    if len(names) != len(set(names)) or any(name.startswith('/') or name[1:2] == ':' or '\\' in name or
            '..' in Path(name).parts for name in names) or archive.testzip() is not None:
        archive.close()
        raise ValueError('Invalid archive paths, duplicate files or corrupt ZIP')
    return archive


def bundle_metadata(directory):
    directory = Path(directory)
    manifest = json.loads((ROOT / 'extension/manifest.json').read_text())
    names = archives()
    for index, name in enumerate(names):
        with checked_zip(directory / name) as archive:
            if index < 2:
                packaged = json.loads(archive.read('manifest.json'))
                expected = manifest if index == 0 else {k: v for k, v in manifest.items() if k != 'key'}
                if packaged != expected:
                    raise ValueError('Packaged manifest differs from the checked-out source/channel')
                if ('local-extension-upgrade.js' in archive.namelist()) != (index == 0):
                    raise ValueError('Incorrect upgrade capability for package channel')
            else:
                if any('node_modules' in Path(name).parts or archive.read(name) != (ROOT / name).read_bytes()
                       for name in archive.namelist()):
                    raise ValueError('Connector archive differs from source or includes installed dependencies')
    public = directory / 'github' / manifest['version']
    if digest(public / names[0]) != digest(directory / names[0]):
        raise ValueError('Public release copy differs from the tested fixed-ID package')
    if (public / 'SHA256SUMS').read_text().split() != [digest(directory / names[0]), names[0]]:
        raise ValueError('Public release checksum does not match')
    key_hash = hashlib.sha256(base64.b64decode(manifest['key'])).hexdigest()[:32]
    extension_id = ''.join(chr(ord('a') + int(char, 16)) for char in key_hash)
    return {'tree': git('rev-parse', 'HEAD^{tree}'), 'version': manifest['version'],
            'extensionId': extension_id, 'archives': {name: digest(directory / name) for name in names}}


def verify_bundle(directory):
    actual = bundle_metadata(directory)
    expected = json.loads((Path(directory) / 'ci-package.json').read_text())
    if actual != expected:
        raise ValueError('Package bytes or source tree changed after build')
    return actual


def validate_reports(plan, metadata, reports):
    if len(reports) != plan['shards']:
        raise ValueError('Missing browser shard receipt')
    indexes = [report['shard'] for report in reports]
    if sorted(indexes) != list(range(plan['shards'])):
        raise ValueError('Duplicate or unexpected browser shard')
    completed = []
    for report in reports:
        expected = plan['scripts'][report['shard']::plan['shards']]
        if report['package'] != metadata or report['scripts'] != expected:
            raise ValueError('Shard tested a different package or script selection')
        if report['status'] != 'passed' or [r['script'] for r in report['results']] != expected:
            raise ValueError('Shard failed or omitted a planned scenario')
        if any(result['returncode'] != 0 for result in report['results']):
            raise ValueError('Browser scenario failed')
        facts = report['preflight']
        extension_url = f"chrome-extension://{metadata['extensionId']}/"
        if (facts['extensionId'] != metadata['extensionId'] or facts['manifestVersion'] != metadata['version']
                or facts['serviceWorker'] != extension_url + 'background.js'
                or facts['pages'] != [extension_url + name for name in ['collector.html', 'library.html', 'composer.html']]
                or facts['pageErrors']):
            raise ValueError('Packaged browser preflight identity/pages/errors mismatch')
        completed.extend(expected)
    if sorted(completed) != sorted(plan['scripts']) or len(completed) != len(set(completed)):
        raise ValueError('Browser coverage is incomplete or duplicated')


def validate_jobs(plan, jobs):
    if plan['tier'] == 'full' and plan['scripts'] != SCRIPTS:
        raise ValueError('Full release evidence requires the complete browser registry')
    expected = {'plan': True, 'source-contracts': True, 'package': plan['package'],
                'browser-shards': plan['browser'], 'linux-upgrade': plan['upgrade'],
                'windows-portability': plan['upgrade'], 'connector-platforms': plan['connector']}
    for name, required in expected.items():
        result = jobs.get(name, {}).get('result')
        if result != ('success' if required else 'skipped'):
            raise ValueError(f'{name}: expected {"success" if required else "skipped"}, got {result}')


def run_browser(plan, shard, directory, evidence):
    metadata = verify_bundle(directory)
    if not 0 <= shard < plan['shards']:
        raise ValueError('Unexpected browser shard index')
    scripts = plan['scripts'][shard::plan['shards']]
    evidence = Path(evidence).resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pd-ci-package-') as temporary:
        with checked_zip(Path(directory) / archives()[0]) as archive:
            archive.extractall(temporary)
        env = {**os.environ, 'PROMPTDIRECTOR_E2E_EXTENSION_DIR': temporary,
               'PROMPTDIRECTOR_LAB_EVIDENCE_DIR': str(evidence),
               'PROMPTDIRECTOR_E2E_EXPECTED_EXTENSION_ID': metadata['extensionId'],
               'PROMPTDIRECTOR_E2E_EXPECTED_VERSION': metadata['version'],
               'PROMPTDIRECTOR_E2E_BLOCK_EXTERNAL_NETWORK': '1'}
        subprocess.run([sys.executable, 'test/local_extension_lab_e2e.py'], cwd=ROOT, env=env, check=True)
        result_file = evidence / 'results.json'
        run = subprocess.run([sys.executable, 'test/run_e2e.py', '--scripts', *scripts,
                              '--report', str(result_file)], cwd=ROOT, env=env)
        report = {'shard': shard, 'scripts': scripts, 'package': metadata,
                  'status': 'passed' if run.returncode == 0 else 'failed',
                  'preflight': json.loads((evidence / 'preflight.json').read_text()),
                  'results': json.loads(result_file.read_text())}
        write_json(evidence / f'shard-{shard}.json', report)
        if run.returncode:
            raise ValueError('Browser shard failed; receipt retained')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'seal', 'verify', 'browser', 'gate'])
    parser.add_argument('--base')
    parser.add_argument('--full', action='store_true')
    parser.add_argument('--shards', type=int, default=4)
    parser.add_argument('--shard', type=int)
    parser.add_argument('--directory', default='dist')
    parser.add_argument('--evidence', default='dist/ci-browser')
    args = parser.parse_args()
    if args.action == 'plan':
        if not args.base and not args.full:
            parser.error('A real comparison base or explicit full validation is required')
        paths = subprocess.check_output(['git', 'diff', '--name-only', '--no-renames', '-z',
                                         args.base, 'HEAD'], cwd=ROOT).decode().split('\0')[:-1] if args.base else []
        plan = make_plan(paths, args.full, args.shards)
        output = {'plan': json.dumps(plan, separators=(',', ':')), 'tier': plan['tier'],
                  'matrix': json.dumps(plan['matrix'], separators=(',', ':')),
                  **{key: str(plan[key]).lower() for key in ['package', 'browser', 'upgrade', 'connector']}}
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as file:
                for key, value in output.items():
                    file.write(f'{key}={value}\n')
        print(json.dumps(plan, indent=2))
    elif args.action == 'seal':
        write_json(Path(args.directory) / 'ci-package.json', bundle_metadata(args.directory))
    elif args.action == 'verify':
        print(json.dumps(verify_bundle(args.directory), indent=2))
    else:
        plan = json.loads(os.environ['CI_PLAN'])
        if args.action == 'browser':
            run_browser(plan, args.shard, args.directory, args.evidence)
        else:
            validate_jobs(plan, json.loads(os.environ['CI_NEEDS']))
            metadata = verify_bundle(args.directory) if plan['package'] else None
            if plan['browser']:
                reports = [json.loads(path.read_text()) for path in Path(args.evidence).rglob('shard-*.json')]
                validate_reports(plan, metadata, reports)
            receipt = {'tier': plan['tier'], 'status': 'passed', 'package': metadata,
                       'scripts': plan['scripts'], 'fullReleaseEvidence': plan['tier'] == 'full',
                       'runId': os.environ.get('GITHUB_RUN_ID'), 'sourceTree': git('rev-parse', 'HEAD^{tree}')}
            write_json(Path(args.directory) / 'ci-validation.json', receipt)
            print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()

"""Developer experiment, not an installed dependency of QuoDex.

Uses the user's installed Antigravity 2.35.1 runtime and its ordinary account
storage. Emits quota fields only. Does not read another process's credentials.
Run: python verify-official-runtime.py --samples 2 --interval 120
"""

import argparse
import http.client
import json
import os
from pathlib import Path
import queue
import re
import shutil
import ssl
import struct
import subprocess
import threading
import time
import uuid


def read_archive_file(archive, name):
    with archive.open('rb') as source:
        prefix = source.read(16)
        header_size = struct.unpack_from('<I', prefix, 12)[0]
        if header_size > 8 * 1024 * 1024:
            raise ValueError('QGM-240: archive header exceeds limit')
        entry = json.loads(source.read(header_size))
        for part in name.split('/'):
            entry = entry['files'][part]
        if entry['size'] > 1024 * 1024 or entry.get('unpacked'):
            raise ValueError('QGM-240: unexpected archive entry')
        source.seek(8 + struct.unpack_from('<I', prefix, 4)[0] + int(entry['offset']))
        return source.read(entry['size']).decode('utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--samples', type=int, choices=range(1, 11), default=1)
    parser.add_argument('--interval', type=float, default=120)
    args = parser.parse_args()
    if not 1 <= args.interval <= 3600:
        parser.error('interval must be between 1 and 3600 seconds')

    install = Path(os.environ['LOCALAPPDATA']) / 'Programs/Antigravity/resources'
    archive = install / 'app.asar'
    version = json.loads(read_archive_file(archive, 'package.json'))['version']
    certificate_module = read_archive_file(archive, 'dist/actuator/pinnedLsCert.js')
    certificates = re.findall(
        r'-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----',
        certificate_module,
    )
    if not certificates:
        raise ValueError('QGM-241: installed runtime certificate is missing')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_verify_locations(cadata='\n'.join(certificates))

    directory_name = 'quodex-quota-probe-' + uuid.uuid4().hex
    session = str(uuid.uuid4())
    environment = dict(os.environ)
    environment['ANTIGRAVITY_SERVER_CSRF_TOKEN'] = session
    environment['AGY_REQUIRE_AUTHENTICATED_UI_BOOTSTRAP'] = '1'
    # --headless selects CLI file authentication and cannot reuse Desktop login.
    command = [
        str(install / 'bin/language_server.exe'), '--standalone',
        '--override_ide_name', 'antigravity', '--subclient_type', 'hub',
        '--override_ide_version', version, '--override_user_agent_name', 'antigravity',
        '--https_server_port', '0', '--app_data_dir', directory_name,
        '--api_server_url', 'https://generativelanguage.googleapis.com',
        '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
        '--disable_telemetry',
    ]
    process = subprocess.Popen(
        command, env=environment, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    ports = queue.Queue(maxsize=1)

    def drain():
        # Discard runtime logs: they can contain sign-in URLs and account details.
        for raw in iter(process.stdout.readline, b''):
            match = re.search(rb'random port at (\d+) for HTTPS', raw)
            if match:
                try:
                    ports.put_nowait(int(match[1]))
                except queue.Full:
                    pass

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    try:
        try:
            port = ports.get(timeout=20)
        except queue.Empty:
            raise TimeoutError('QGM-242: official runtime did not start') from None

        def request(method, body):
            if process.poll() is not None:
                raise RuntimeError('QGM-243: official runtime exited')
            connection = http.client.HTTPSConnection(
                '127.0.0.1', port, context=context, timeout=20,
            )
            try:
                connection.request(
                    'POST', '/exa.language_server_pb.LanguageServerService/' + method,
                    json.dumps(body), {
                        'Content-Type': 'application/json',
                        'Connect-Protocol-Version': '1',
                        'x-codeium-csrf-token': session,
                    },
                )
                response = connection.getresponse()
                if response.status != 200:
                    raise RuntimeError(f'QGM-244: {method} HTTP {response.status}')
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError('QGM-245: response exceeds limit')
                return json.loads(raw)
            finally:
                connection.close()

        first_identity = None
        for index in range(args.samples):
            if index:
                time.sleep(args.interval)
            before = request('GetUserStatus', {}).get('userStatus', {}).get('email')
            quota = request('RetrieveUserQuotaSummary', {'forceRefresh': True})
            after = request('GetUserStatus', {}).get('userStatus', {}).get('email')
            if index == 0:
                first_identity = before
            if not before or before != after or after != first_identity:
                raise RuntimeError('QGM-246: account is missing or changed during sampling')
            buckets = [
                {key: bucket[key] for key in (
                    'bucketId', 'window', 'remainingFraction', 'resetTime', 'disabled',
                ) if key in bucket}
                for group in quota.get('response', {}).get('groups', [])
                for bucket in group.get('buckets', [])
            ]
            required = {'gemini-5h', 'gemini-weekly', '3p-5h', '3p-weekly'}
            if {bucket.get('bucketId') for bucket in buckets} != required or any(
                isinstance(bucket.get('remainingFraction'), bool)
                or not isinstance(bucket.get('remainingFraction'), (int, float))
                or not 0 <= bucket['remainingFraction'] <= 1
                or bucket.get('disabled') is True for bucket in buckets
            ):
                raise ValueError('QGM-247: expected four active quota buckets')
            print(json.dumps({
                'stage': 'quota', 'version': version, 'sample': index + 1,
                'sampledAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'sameAccount': True, 'tls': 'installed-certificate-and-hostname-verified',
                'buckets': buckets,
            }), flush=True)
    finally:
        # Only this experiment's child is stopped; the user's Desktop stays open.
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=5)
        reader.join(timeout=2)
        root = (Path.home() / '.gemini').resolve()
        temporary = (root / directory_name).resolve()
        if temporary.parent != root or temporary.name != directory_name:
            raise ValueError('QGM-248: temporary data path escaped its expected root')
        if temporary.is_dir():
            shutil.rmtree(temporary)
        print(json.dumps({
            'stage': 'cleanup', 'ownProcessExited': process.poll() is not None,
            'temporaryDataRemoved': not temporary.exists(),
        }), flush=True)


if __name__ == '__main__':
    main()

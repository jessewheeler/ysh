import os
import socket
import subprocess
import time
import urllib.request
import urllib.error


class ServerManager:
    """Manages a Node.js test server instance for Robot Framework E2E tests."""

    ROBOT_LIBRARY_SCOPE = 'SUITE'

    def __init__(self, project_root):
        self.project_root = project_root
        self.process = None
        self.port = None

    def _find_free_port(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', 0))
            return s.getsockname()[1]

    def start_server(self):
        """Start the Node.js server on a random free port. Returns base URL."""
        self.port = self._find_free_port()
        base_url = f'http://localhost:{self.port}'

        env = os.environ.copy()
        env['PORT'] = str(self.port)
        env['SESSION_SECRET'] = 'robot-test-secret'
        env['STRIPE_SECRET_KEY'] = 'sk_test_fake_key_for_robot_tests'
        env['STRIPE_WEBHOOK_SECRET'] = 'whsec_fake_key_for_robot_tests'
        env['SENDGRID_API_KEY'] = 'SG.fake_key_for_robot_tests'
        env['FROM_EMAIL'] = 'test@example.com'
        env['BASE_URL'] = base_url
        env['NODE_ENV'] = 'test'

        self.process = subprocess.Popen(
            ['node', 'server.js'],
            cwd=self.project_root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        # Poll until server responds or timeout
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                resp = urllib.request.urlopen(base_url, timeout=2)
                if resp.status == 200:
                    return base_url
            except (urllib.error.URLError, ConnectionRefusedError, OSError):
                pass
            # Check if process died
            if self.process.poll() is not None:
                stdout = self.process.stdout.read().decode('utf-8', errors='replace')
                stderr = self.process.stderr.read().decode('utf-8', errors='replace')
                raise RuntimeError(
                    f'Server process exited with code {self.process.returncode}\n'
                    f'stdout: {stdout}\nstderr: {stderr}'
                )
            time.sleep(0.5)

        raise RuntimeError(f'Server did not respond within 30s on port {self.port}')

    def stop_server(self):
        """Stop the server process."""
        if self.process is None:
            return
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.process = None

    def get_base_url(self):
        """Return the base URL of the running server."""
        return f'http://localhost:{self.port}'

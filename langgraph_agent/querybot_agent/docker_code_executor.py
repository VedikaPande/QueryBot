"""
Docker Code Executor Module - Executes Python code in Docker containers for complete isolation.

This module provides a secure way to execute Python code for chart generation
in completely isolated Docker containers, providing maximum security and isolation.
"""

import subprocess
import tempfile
import os
import uuid
from typing import Dict, Any, Optional
from pathlib import Path


class DockerCodeExecutor:
    """Executes Python code in isolated Docker containers."""

    def __init__(self,
                 image_name: str = "querybot-chart-executor",
                 timeout: int = 60,
                 container_prefix: str = "querybot-chart"):
        """
        Initialize the Docker code executor.

        Args:
            image_name (str): Name of the Docker image to use
            timeout (int): Timeout in seconds for code execution
            container_prefix (str): Prefix for container names
        """
        self.image_name = image_name
        self.timeout = timeout
        self.container_prefix = container_prefix
        self.required_packages = [
            'pandas', 'numpy', 'matplotlib', 'seaborn'
        ]

        # Ensure Docker is available
        self._validate_docker()

    def _validate_docker(self):
        """Validate that Docker is available and running."""
        try:
            result = subprocess.run(
                ['docker', '--version'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode != 0:
                raise RuntimeError("Docker is not available")
        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            raise RuntimeError(f"Docker validation failed: {e}")

    def build_image(self, force_rebuild: bool = False) -> bool:
        """
        Build the Docker image for code execution.

        Args:
            force_rebuild (bool): Whether to force rebuild the image

        Returns:
            bool: True if image was built successfully
        """
        try:
            # Check if image already exists
            if not force_rebuild:
                result = subprocess.run(
                    ['docker', 'images', '-q', self.image_name],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                if result.stdout.strip():
                    return True  # Image already exists

            # Build the image
            dockerfile_path = Path(__file__).parent / "Dockerfile.chart-executor"
            if not dockerfile_path.exists():
                raise FileNotFoundError(f"Dockerfile not found at {dockerfile_path}")

            build_cmd = [
                'docker', 'build',
                '-f', str(dockerfile_path),
                '-t', self.image_name,
                str(dockerfile_path.parent)
            ]

            result = subprocess.run(
                build_cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minutes for building
            )

            if result.returncode != 0:
                raise RuntimeError(f"Docker build failed: {result.stderr}")

            return True

        except Exception as e:
            print(f"Error building Docker image: {e}")
            return False

    def run(self, code: str, output_dir: Optional[str] = None) -> str:
        """
        Execute Python code in a Docker container.

        Args:
            code (str): Python code to execute
            output_dir (str): Directory to mount for output files

        Returns:
            str: Execution result or error message
        """
        container_name = f"{self.container_prefix}-{uuid.uuid4().hex[:8]}"

        try:
            # Create temporary directory for code and output
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)

                # Write code to temporary file
                code_file = temp_path / "script.py"
                code_file.write_text(self._wrap_code(code))

                # Create output directory
                output_path = temp_path / "output"
                output_path.mkdir(exist_ok=True)

                # If specific output directory is provided, use it
                if output_dir:
                    output_mount = f"{os.path.abspath(output_dir)}:/app/output"
                else:
                    output_mount = f"{output_path}:/app/output"

                # Run Docker container
                docker_cmd = [
                    'docker', 'run',
                    '--rm',  # Remove container after execution
                    '--name', container_name,
                    '--network', 'none',  # No network access for security
                    '--memory', '512m',  # Memory limit
                    '--cpus', '1.0',  # CPU limit
                    '--user', 'appuser',  # Run as non-root user
                    '-v', f"{code_file}:/app/script.py:ro",  # Mount code file (read-only)
                    '-v', output_mount,  # Mount output directory
                    '--workdir', '/app',
                    self.image_name,
                    'python', 'script.py'
                ]

                # Execute with timeout
                result = subprocess.run(
                    docker_cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout,
                    encoding='utf-8',
                    errors='replace'  # Replace problematic characters instead of failing
                )

                # Process results
                if result.returncode == 0:
                    output = result.stdout.strip()
                    if result.stderr:
                        output += f"\nWarnings: {result.stderr.strip()}"
                    return output if output else "Code executed successfully in Docker container"
                else:
                    error_msg = result.stderr.strip() or "Unknown error occurred in Docker container"
                    return f"Docker execution error: {error_msg}"

        except subprocess.TimeoutExpired:
            # Clean up timed-out container
            self._cleanup_container(container_name)
            return f"Error: Code execution timed out after {self.timeout} seconds in Docker container"
        except Exception as e:
            self._cleanup_container(container_name)
            return f"Error: Docker execution failed - {str(e)}"

    def _cleanup_container(self, container_name: str):
        """Clean up a Docker container."""
        try:
            subprocess.run(
                ['docker', 'rm', '-f', container_name],
                capture_output=True,
                timeout=10
            )
        except Exception:
            pass  # Ignore cleanup errors

    def _wrap_code(self, code: str) -> str:
        """
        Wrap user code with necessary imports and error handling.

        Args:
            code (str): User's Python code

        Returns:
            str: Wrapped code with error handling
        """
        # Don't wrap if code is already properly structured
        if code.strip().startswith('import') and 'try:' not in code:
            # Simple execution without extra wrapping for well-formed code
            return f"""
import sys
import os

# Ensure output directory exists
os.makedirs('/app/output', exist_ok=True)

{code}

print("Code executed successfully in Docker container")
"""

        # Full wrapper for complex code
        wrapper = f"""
import sys
import traceback
import warnings
import os

# Suppress warnings for cleaner output
warnings.filterwarnings('ignore')

# Ensure output directory exists
os.makedirs('/app/output', exist_ok=True)

try:
    # User's code starts here
{self._indent_code(code)}

    # If we reach here, execution was successful
    print("Code executed successfully in Docker container")

except ImportError as e:
    print(f"Import Error: {{e}}")
    print("Required packages: {', '.join(self.required_packages)}")
    sys.exit(1)

except Exception as e:
    print(f"Execution Error: {{e}}")
    traceback.print_exc()
    sys.exit(1)
"""
        return wrapper

    def _indent_code(self, code: str) -> str:
        """
        Indent code by four spaces so it nests inside the try/except wrapper.

        Note the newline escaping: this previously split on the two-character
        sequence backslash-n rather than an actual newline, so the whole program
        was treated as one line and the wrapper produced a syntax error every
        time it was used.
        """
        return '\n'.join('    ' + line for line in code.split('\n'))

    def validate_environment(self) -> Dict[str, Any]:
        """
        Validate that Docker and the required image are available.

        Returns:
            dict: Validation results
        """
        results = {
            'docker_available': False,
            'image_exists': False,
            'all_ready': False,
            'errors': []
        }

        try:
            # Check Docker
            result = subprocess.run(
                ['docker', '--version'],
                capture_output=True,
                text=True,
                timeout=10
            )
            results['docker_available'] = result.returncode == 0

            if results['docker_available']:
                # Check image
                result = subprocess.run(
                    ['docker', 'images', '-q', self.image_name],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                results['image_exists'] = bool(result.stdout.strip())

                results['all_ready'] = results['docker_available'] and results['image_exists']

        except Exception as e:
            results['errors'].append(str(e))

        return results


class DockerPythonREPL:
    """
    A Docker-based replacement for PythonREPL that uses Docker containers.

    This class provides the same interface as PythonREPL but executes code
    in completely isolated Docker containers for maximum security.
    """

    def __init__(self,
                 image_name: str = "querybot-chart-executor",
                 timeout: int = 60):
        """
        Initialize the Docker Python REPL.

        Args:
            image_name (str): Name of the Docker image to use
            timeout (int): Timeout in seconds for code execution
        """
        self.executor = DockerCodeExecutor(image_name=image_name, timeout=timeout)
        self.globals = {}  # Not used in Docker mode, kept for compatibility

    def run(self, code: str, output_dir: Optional[str] = None) -> str:
        """
        Execute Python code in a Docker container.

        Args:
            code (str): Python code to execute
            output_dir (str): Directory to mount for output files

        Returns:
            str: Execution result
        """
        return self.executor.run(code, output_dir)

    def build_image(self, force_rebuild: bool = False) -> bool:
        """
        Build the Docker image for code execution.

        Args:
            force_rebuild (bool): Whether to force rebuild the image

        Returns:
            bool: True if image was built successfully
        """
        return self.executor.build_image(force_rebuild)

    def validate_installation(self) -> bool:
        """
        Validate that Docker and the required image are available.

        Returns:
            bool: True if everything is ready
        """
        validation = self.executor.validate_environment()

        if not validation['all_ready']:
            print("Docker environment validation:")
            print(f"  Docker available: {validation['docker_available']}")
            print(f"  Image exists: {validation['image_exists']}")
            if validation['errors']:
                print(f"  Errors: {validation['errors']}")

            if validation['docker_available'] and not validation['image_exists']:
                print("  Run build_image() to create the required Docker image")

        return validation['all_ready']
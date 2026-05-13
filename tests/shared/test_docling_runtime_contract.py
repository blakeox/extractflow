from __future__ import annotations

from pathlib import Path

DOCLING_ENV_VARS = (
    "EXTRACTFLOW_USE_DOCLING",
    "DOCLING_PREWARM",
    "DOCLING_PDF_OCR_RETRY",
    "DOCLING_IMAGE_OCR",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def extract_worker_environment_keys(compose_name: str) -> set[str]:
    compose_lines = (repo_root() / compose_name).read_text(encoding="utf-8").splitlines()
    in_worker = False
    in_environment = False
    environment_keys: set[str] = set()

    for line in compose_lines:
        if not in_worker:
            if line == "  worker:":
                in_worker = True
            continue

        if line.startswith("  ") and not line.startswith("    "):
            break

        if not in_environment:
            if line == "    environment:":
                in_environment = True
            continue

        if line.startswith("    ") and not line.startswith("      "):
            break
        if not line.startswith("      "):
            continue

        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        environment_keys.add(stripped.split(":", maxsplit=1)[0])

    return environment_keys


def test_both_compose_files_expose_docling_worker_env_vars() -> None:
    for compose_name in ("docker-compose.yml", "docker-compose.desktop.yml"):
        worker_environment_keys = extract_worker_environment_keys(compose_name)
        for env_var in DOCLING_ENV_VARS:
            assert env_var in worker_environment_keys, f"{compose_name} worker config is missing {env_var}"


def test_readme_and_env_example_document_docling_runtime_controls() -> None:
    readme_text = (repo_root() / "README.md").read_text(encoding="utf-8")
    env_example_text = (repo_root() / ".env.example").read_text(encoding="utf-8")

    for env_var in DOCLING_ENV_VARS:
        assert env_var in readme_text, f"README.md is missing {env_var}"
        assert env_var in env_example_text, f".env.example is missing {env_var}"


def test_worker_runtime_includes_image_ocr_dependencies() -> None:
    requirements_text = (repo_root() / "worker" / "requirements.txt").read_text(encoding="utf-8")
    dockerfile_text = (repo_root() / "worker" / "Dockerfile").read_text(encoding="utf-8")

    assert "onnxruntime==" in requirements_text, "worker/requirements.txt is missing onnxruntime for image OCR"
    assert "libglib2.0-0" in dockerfile_text, "worker/Dockerfile is missing libglib2.0-0 for RapidOCR/OpenCV"

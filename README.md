<picture align="center">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/droidrun/mobilerun/main/static/mobilerun-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/droidrun/mobilerun/main/static/mobilerun.png">
  <img src="https://raw.githubusercontent.com/droidrun/mobilerun/main/static/mobilerun.png" alt="Mobilerun" width="full">
</picture>

<h1 align="center">Mobilerun examples</h1>

<p align="center">
  <strong>Production-minded examples for building with the Mobilerun API.</strong><br>
  Small, runnable integrations with security assumptions and setup steps included.
</p>

<div align="center">

<a href="https://docs.mobilerun.ai">📕 Documentation</a>
·
<a href="https://cloud.mobilerun.ai">☁️ Mobilerun Cloud</a>
·
<a href="https://github.com/droidrun/mobilerun-react">📱 @mobilerun/react</a>

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776ab?logo=python&logoColor=white&style=flat-square)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)
[![Discord](https://img.shields.io/discord/1360219330318696488?color=white&label=Discord&logo=discord&logoColor=white&style=flat-square)](https://discord.gg/ZZbKEZZkwK)

</div>

---

## ✨ Examples

| Language | Example | What it demonstrates |
| --- | --- | --- |
| TypeScript | [Embedded task runner](examples/typescript/task-runner/) | Server-side SDK calls, a live `@mobilerun/react` device stream, status polling, and cancellation |
| Python | [Signed webhook receiver with file download](examples/python/webhook-file-receiver/) | HMAC verification, replay protection, secure SDK downloads, and atomic file storage |

Each example is self-contained, runnable, and documents the decisions you
should revisit before taking it to production.

## 🚀 Quick start

### TypeScript task runner

```bash
cd examples/typescript/task-runner
bun install
cp .env.example .env
bun run dev
```

Open the [task runner guide](examples/typescript/task-runner/README.md) for its
server-only API key model and verification commands.

### Python webhook receiver

The Python examples install the focused
[`mobilerun-sdk`](https://pypi.org/project/mobilerun-sdk/) directly from PyPI.
Install the dependencies and run the test suite from this repository:

```bash
uv sync
uv run python -m unittest discover \
  -s examples/python/webhook-file-receiver/tests \
  -p 'test_*.py' -v
```

Then open the [webhook receiver guide](examples/python/webhook-file-receiver/README.md)
for configuration and local run instructions.

## 📂 Repository layout

```text
examples/
├── python/
│   └── webhook-file-receiver/
└── typescript/
    └── task-runner/
skills/
└── mobilerun-webhooks/
```

## 🔗 Related projects

- [`@mobilerun/react`](https://github.com/droidrun/mobilerun-react) — embed a live,
  controllable Mobilerun device in any React app. Also available
  [on npm](https://www.npmjs.com/package/@mobilerun/react).
- [`mobilerun`](https://github.com/droidrun/mobilerun) — the open-source mobile
  automation framework.

## License

Licensed under the [Apache License 2.0](LICENSE).

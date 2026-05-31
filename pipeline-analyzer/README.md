# AI Secure DevOps Pipeline Analyzer

A static browser app for student project ZIP reviews. Students drop a ZIP, the app extracts safe text files in the browser, detects the stack, runs simulated DevSecOps pipeline checks, and produces a scored fix report.

## Features

- Drag-and-drop ZIP upload with JSZip.
- Automatic project detection for Python, Node, Java, Go, Ruby, Docker, and CI signals.
- Static pipeline stages:
  - Install: dependency manifests, lockfiles, pinned versions, risky install scripts.
  - Test: missing tests, thin test shape, skipped tests, placeholder assertions.
  - Security: hardcoded secrets, `.env` commits, missing `.gitignore` protections.
  - Quality: Python and JavaScript maintainability checks.
  - Docker: Dockerfile, `.dockerignore`, Jenkinsfile, and GitHub Actions checks.
  - Report: severity-sorted fixes and score out of 100.
- Copyable fixes per issue and copyable full report.
- Optional Anthropic API review with a bring-your-own-key field.

## Run Locally

Because the app uses ES modules, serve the folder instead of opening `index.html` from `file://`.

```bash
cd pipeline-analyzer
python -m http.server 8080
```

Open:

```text
http://localhost:8080
```

## Deploy

This is a static app. Deploy the `pipeline-analyzer` folder to GitHub Pages, Netlify, Vercel, or any static web host.

## AI Mode

The Anthropic key is optional. Static checks work without it.

When a key is entered, the app sends the top 20 most relevant project files directly from the browser to the Claude Messages API and merges AI findings with static findings. The default model field is editable.

For classroom or public deployments, prefer a small backend proxy so students do not paste long-lived production keys into a browser page.

## Scoring

```text
score = 100
score -= critical issues * 15
score -= high issues     * 8
score -= medium issues   * 4
score -= low issues      * 1
score = max(0, score)
```

Bands:

```text
90-100  Excellent
70-89   Good
50-69   Needs work
0-49    Critical issues
```

## File Structure

```text
pipeline-analyzer/
|-- index.html
|-- css/
|   `-- style.css
|-- js/
|   |-- uploader.js
|   |-- analyzers/
|   |   |-- common.js
|   |   |-- deps.js
|   |   |-- tests.js
|   |   |-- secrets.js
|   |   |-- quality.js
|   |   `-- docker.js
|   |-- ai.js
|   |-- pipeline.js
|   `-- report.js
`-- README.md
```

## Notes

- Large binary files, dependency folders, virtual environments, build outputs, and git metadata are skipped.
- The analyzer is intentionally conservative. It is a teaching tool that points students toward reviewable fixes rather than claiming perfect vulnerability detection.
- The Demo button loads a deliberately flawed mini project so the full pipeline can be tested without a ZIP.

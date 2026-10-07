---
name: cutting-a-release
description: Version and publish a release. Use when choosing a version number, deciding between MAJOR/MINOR/PATCH, naming a prerelease or build-metadata identifier, writing release notes, or tagging a release. Covers Semantic Versioning and the pre-tag checklist.
---

# Cutting a Release

> Creating a tag, merging, or publishing requires **explicit user approval** every
> time — see the git-workflow rule. This skill describes how to do it once approved.

## Semantic Versioning
`MAJOR.MINOR.PATCH`

| Bump | When |
|---|---|
| `MAJOR` | Breaking change |
| `MINOR` | Backward-compatible feature |
| `PATCH` | Backward-compatible fix |

## Prerelease and build metadata
- Prerelease identifiers for non-final versions: `1.4.0-alpha.1`, `1.4.0-rc.1`.
- Build metadata for traceability only: `1.4.0+build.20260607`.

## Before tagging
1. Tests and every critical validation step pass.
2. Release notes summarize user-visible changes and call out any breaking behavior.
3. The user has explicitly approved the tag.

Only then create the tag.

# Consumer Library Reference (non-normative)

Trivial helper functions that consumers may implement inline. Not shipped by nexus-core.

## verifyBodyHash

Verifies that a body.md file's content matches the hash recorded in manifest.json.

```
function verifyBodyHash(rawBody: string, expectedHash: string): boolean {
  const computed = "sha256:" + sha256(rawBody);
  return computed === expectedHash;
}
```

Usage: read `expectedHash` from `manifest.json` at runtime (e.g. `manifest.agents[agentId].body_hash`). Do not hardcode expected hashes — they change with every content update.

## verifyManifestVersion

Verifies that the installed manifest version satisfies a semver range.

```
function verifyManifestVersion(manifestVersion: string, expectedRange: string): boolean {
  return semver.satisfies(manifestVersion, expectedRange);
}
```

Usage: read `manifestVersion` from `manifest.json` (e.g. `manifest.version`). Pass your consumer's supported range as `expectedRange` (e.g. `"^0.2.0"`).

#!/usr/bin/env bats

# Tests for scripts/dependabot/verify-dependabot-coverage. Each fixture test builds
# a tiny repo tree + dependabot config under $BATS_TEST_TMPDIR and points the
# checker at it with --root/--config.

setup() {
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  cd "$REPO_ROOT"
  ROOT="$BATS_TEST_TMPDIR/repo"
  CFG="$BATS_TEST_TMPDIR/dependabot.yml"
  mkdir -p "$ROOT"
}

# _file PATH [CONTENT] — create a file under the fixture root.
_file() {
  mkdir -p "$(dirname "$ROOT/$1")"
  printf '%s\n' "${2:-}" > "$ROOT/$1"
}

_check() {
  run scripts/dependabot/verify-dependabot-coverage --root "$ROOT" --config "$CFG"
}

@test "passes on the real committed config" {
  run scripts/dependabot/verify-dependabot-coverage
  [ "$status" -eq 0 ]
}

@test "uncovered lockfile fails" {
  _file packages/foo/package-lock.json '{}'
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: npm
    directory: /packages/bar
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"packages/foo/package-lock.json"* ]]
  [[ "$output" == *"npm"* ]]
}

@test "wrong ecosystem fails" {
  _file svc/uv.lock 'version = 1'
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: pip
    directory: /svc
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"uv"* ]]
}

@test "directories list and trailing slash match" {
  _file a/Gemfile.lock ''
  _file b/Gemfile.lock ''
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: bundler
    directories: ["/a/", "/b"]
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 0 ]
}

@test "missing cooldown fails" {
  _file a/Gemfile.lock ''
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: bundler
    directory: /a
    schedule: {interval: weekly}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"cooldown"* ]]
}

@test "cooldown below 3 days fails" {
  _file a/Gemfile.lock ''
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: bundler
    directory: /a
    schedule: {interval: weekly}
    cooldown: {default-days: 2}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"cooldown"* ]]
}

@test "semver cooldown on github-actions fails (Dependabot rejects the whole file)" {
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: {interval: weekly}
    cooldown: {default-days: 5, semver-major-days: 14}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"github-actions"*"semver-major-days"* ]]
}

@test "private gem source without registry fails" {
  _file app/Gemfile.lock ''
  _file app/Gemfile 'source "https://rubygems.org"
source "https://enterprise.contribsys.com/" do
  gem "sidekiq-ent"
end'
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: bundler
    directory: /app
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"enterprise.contribsys.com"* ]]
}

@test "private gem source with registry passes" {
  _file app/Gemfile.lock ''
  _file app/Gemfile 'source "https://rubygems.org"
source "https://enterprise.contribsys.com/" do
  gem "sidekiq-ent"
end'
  cat > "$CFG" <<'YAML'
version: 2
registries:
  sidekiq-enterprise:
    type: rubygems-server
    url: https://enterprise.contribsys.com
    token: ${{secrets.X}}
updates:
  - package-ecosystem: bundler
    directory: /app
    registries: [sidekiq-enterprise]
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 0 ]
}

@test "registry defined but not listed on the entry fails" {
  _file app/Gemfile.lock ''
  _file app/Gemfile 'source "https://enterprise.contribsys.com/" do
end'
  cat > "$CFG" <<'YAML'
version: 2
registries:
  sidekiq-enterprise:
    type: rubygems-server
    url: https://enterprise.contribsys.com
    token: ${{secrets.X}}
updates:
  - package-ecosystem: bundler
    directory: /app
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"enterprise.contribsys.com"* ]]
}

@test "node_modules and Dockerfiles are ignored" {
  _file x/node_modules/y/package-lock.json '{}'
  _file docker/Dockerfile 'FROM scratch'
  cat > "$CFG" <<'YAML'
version: 2
updates: []
YAML
  _check
  [ "$status" -eq 0 ]
}

@test "requirements.txt next to uv.lock is not separately required" {
  _file svc/uv.lock 'version = 1'
  _file svc/requirements.txt 'requests==2.0'
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: uv
    directory: /svc
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 0 ]
}

@test "requirements.txt without uv.lock needs pip" {
  _file smoke/requirements.txt 'requests==2.0'
  cat > "$CFG" <<'YAML'
version: 2
updates: []
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"smoke/requirements.txt"* ]]
  [[ "$output" == *"pip"* ]]
}

# --- openclaw-specific rules -----------------------------------------------

@test "Swift package and Gradle settings need entries" {
  _file apps/mac/Package.resolved '{}'
  _file apps/kit/Package.swift '// swift-tools-version:6.0'
  _file apps/android/settings.gradle.kts ''
  _file apps/android/app/build.gradle.kts ''
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: swift
    directories: ["/apps/mac"]
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"apps/kit/Package.swift is not covered"*"swift"* ]]
  [[ "$output" == *"apps/android/settings.gradle.kts is not covered"*"gradle"* ]]
  [[ "$output" != *"apps/mac/"* ]]
  [[ "$output" == *"apps/android/app/build.gradle.kts is not covered"*"Gradle project root"* ]]
}

@test "npm-shrinkwrap.json in a pnpm repo is covered by the root npm entry" {
  _file pnpm-lock.yaml 'lockfileVersion: 9.0'
  _file extensions/a/npm-shrinkwrap.json '{}'
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 0 ]
}

@test "npm-shrinkwrap.json without pnpm needs its own npm entry" {
  _file pkg/npm-shrinkwrap.json '{}'
  cat > "$CFG" <<'YAML'
version: 2
updates: []
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"pkg/npm-shrinkwrap.json is not covered"* ]]
}

@test "semver cooldown on docker fails (Dependabot rejects the whole file)" {
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: docker
    directory: /
    schedule: {interval: weekly}
    cooldown: {default-days: 5, semver-major-days: 14}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"docker entry / sets cooldown.semver-major-days"* ]]
}

# _alerts_fixture — a pnpm repo whose overrides pin tinypool 2.1.0 (vulnerable),
# zod@4 4.6.7 (outside the zod alert's range) and an npm: alias.
_alerts_fixture() {
  _file pnpm-lock.yaml 'lockfileVersion: 9.0'
  _file pnpm-workspace.yaml 'minimumReleaseAge: 7200
overrides:
  tinypool: 2.1.0
  "zod@4": 4.6.7
  "parent>@a2ui/web_core": "npm:@a2ui/web_core@0.10.0"
  ranged: ^1.0.0'
  _file package.json '{"pnpm": {"overrides": {"axios": "1.19.0"}}}'
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  ALERTS="$BATS_TEST_TMPDIR/alerts.json"
  # Two arrays back to back, like `gh api --paginate`.
  cat > "$ALERTS" <<'JSON'
[{"number": 263, "state": "open",
  "dependency": {"package": {"ecosystem": "npm", "name": "tinypool"}},
  "security_advisory": {"ghsa_id": "GHSA-5gmw-xhrv-c9v3"},
  "security_vulnerability": {"vulnerable_version_range": "<= 2.1.0", "first_patched_version": {"identifier": "2.1.1"}}},
 {"number": 285, "state": "open",
  "dependency": {"package": {"ecosystem": "npm", "name": "zod"}},
  "security_advisory": {"ghsa_id": "GHSA-mrhx-c7xc-m3w5"},
  "security_vulnerability": {"vulnerable_version_range": "< 4.6.6", "first_patched_version": {"identifier": "4.6.6"}}}]
[{"number": 257, "state": "open",
  "dependency": {"package": {"ecosystem": "npm", "name": "@a2ui/web_core"}},
  "security_advisory": {"ghsa_id": "GHSA-72qq-p3r5-f7wq"},
  "security_vulnerability": {"vulnerable_version_range": ">= 0.9.0, < 0.10.2", "first_patched_version": {"identifier": "0.10.2"}}},
 {"number": 300, "state": "open",
  "dependency": {"package": {"ecosystem": "npm", "name": "axios"}},
  "security_advisory": {"ghsa_id": "GHSA-xxxx"},
  "security_vulnerability": {"vulnerable_version_range": "< 1.20.0", "first_patched_version": {"identifier": "1.20.0"}}},
 {"number": 301, "state": "open",
  "dependency": {"package": {"ecosystem": "npm", "name": "ranged"}},
  "security_advisory": {"ghsa_id": "GHSA-yyyy"},
  "security_vulnerability": {"vulnerable_version_range": "< 9.0.0", "first_patched_version": null}}]
JSON
}

@test "override pinning a version with an open alert fails (--alerts)" {
  _alerts_fixture
  run scripts/dependabot/verify-dependabot-coverage --root "$ROOT" --config "$CFG" --alerts "$ALERTS"
  [ "$status" -eq 1 ]
  [[ "$output" == *'override "tinypool": 2.1.0 pins tinypool inside open alert #263'*"fixed in 2.1.1"* ]]
  [[ "$output" == *'override "parent>@a2ui/web_core": 0.10.0 pins @a2ui/web_core inside open alert #257'* ]]
  [[ "$output" == *'override "axios": 1.19.0 pins axios inside open alert #300'* ]]
  [[ "$output" != *"zod"* ]]
  [[ "$output" != *"ranged"* ]]
  [[ "$output" == *"3 violation(s)"* ]]
}

@test "override at the patched version passes (--alerts)" {
  _alerts_fixture
  _file pnpm-workspace.yaml 'minimumReleaseAge: 7200
overrides:
  tinypool: 2.2.0
  "zod@4": 4.6.7'
  _file package.json '{}'
  run scripts/dependabot/verify-dependabot-coverage --root "$ROOT" --config "$CFG" --alerts "$ALERTS"
  [ "$status" -eq 0 ]
}

@test "dismissed or non-npm alerts are ignored (--alerts)" {
  _alerts_fixture
  _file package.json '{}'
  _file pnpm-workspace.yaml 'minimumReleaseAge: 7200
overrides:
  tinypool: 2.1.0'
  cat > "$ALERTS" <<'JSON'
[{"number": 1, "state": "dismissed",
  "dependency": {"package": {"ecosystem": "npm", "name": "tinypool"}},
  "security_advisory": {"ghsa_id": "GHSA-1"},
  "security_vulnerability": {"vulnerable_version_range": "<= 2.1.0", "first_patched_version": {"identifier": "2.1.1"}}},
 {"number": 2, "state": "open",
  "dependency": {"package": {"ecosystem": "pip", "name": "tinypool"}},
  "security_advisory": {"ghsa_id": "GHSA-2"},
  "security_vulnerability": {"vulnerable_version_range": "<= 2.1.0", "first_patched_version": {"identifier": "2.1.1"}}}]
JSON
  run scripts/dependabot/verify-dependabot-coverage --root "$ROOT" --config "$CFG" --alerts "$ALERTS"
  [ "$status" -eq 0 ]
}

@test "missing --alerts file exits 2" {
  run scripts/dependabot/verify-dependabot-coverage --alerts "$BATS_TEST_TMPDIR/nope.json"
  [ "$status" -eq 2 ]
}

@test "override key with a range operator is parsed (--alerts)" {
  _alerts_fixture
  _file package.json '{}'
  _file pnpm-workspace.yaml 'minimumReleaseAge: 7200
overrides:
  "tinypool@>=2": 2.1.0
  "x@1>tinypool@^2 || >1": 2.1.0'
  run scripts/dependabot/verify-dependabot-coverage --root "$ROOT" --config "$CFG" --alerts "$ALERTS"
  [ "$status" -eq 1 ]
  [[ "$output" == *'override "tinypool@>=2": 2.1.0 pins tinypool'* ]]
  [[ "$output" == *'override "x@1>tinypool@^2 || >1": 2.1.0 pins tinypool'* ]]
}

@test "alert without a version range is skipped, not fatal (--alerts)" {
  _alerts_fixture
  _file package.json '{}'
  _file pnpm-workspace.yaml 'minimumReleaseAge: 7200
overrides:
  tinypool: 2.1.0'
  echo '[{"number": 9, "state": "open", "dependency": {"package": {"ecosystem": "npm", "name": "tinypool"}}, "security_vulnerability": null}]' > "$ALERTS"
  run scripts/dependabot/verify-dependabot-coverage --root "$ROOT" --config "$CFG" --alerts "$ALERTS"
  [ "$status" -eq 0 ]
}

@test "unreadable alerts JSON fails closed (--alerts)" {
  _alerts_fixture
  echo 'not json' > "$ALERTS"
  run scripts/dependabot/verify-dependabot-coverage --root "$ROOT" --config "$CFG" --alerts "$ALERTS"
  [ "$status" -ne 0 ]
  [[ "$output" != *"dependabot-coverage: OK"* ]]
}

@test "alert range this check cannot parse is reported, not guessed (--alerts)" {
  _alerts_fixture
  _file package.json '{}'
  _file pnpm-workspace.yaml 'minimumReleaseAge: 7200
overrides:
  tinypool: 2.1.0'
  echo '[{"number": 7, "state": "open", "dependency": {"package": {"ecosystem": "npm", "name": "tinypool"}}, "security_advisory": {"ghsa_id": "GHSA-z"}, "security_vulnerability": {"vulnerable_version_range": ">=1.0.0 <3.0.0 || 4.x"}}]' > "$ALERTS"
  run scripts/dependabot/verify-dependabot-coverage --root "$ROOT" --config "$CFG" --alerts "$ALERTS"
  [ "$status" -eq 1 ]
  [[ "$output" == *'override "tinypool": 2.1.0 pins tinypool, and open alert #7 (GHSA-z) has a range this check cannot parse'* ]]
}

@test "go.mod needs a gomod entry for its directory" {
  _file tools/i18n/go.mod 'module example.com/i18n'
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: gomod
    directory: /tools
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"tools/i18n/go.mod is not covered: add a 'gomod' update entry for directory '/tools/i18n'"* ]]
  sed -i.bak 's#directory: /tools#directory: /tools/i18n#' "$CFG"
  _check
  [ "$status" -eq 0 ]
}

@test "semver cooldown shorter than default-days fails" {
  _file a/go.mod 'module a'
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: gomod
    directory: /a
    schedule: {interval: weekly}
    cooldown: {default-days: 5, semver-major-days: 2}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *'sets cooldown.semver-major-days=2, shorter than default-days=5'* ]]
}

@test "pnpm minimumReleaseAge below 3 days (or missing) fails" {
  _file pnpm-workspace.yaml 'minimumReleaseAge: 2880'
  cat > "$CFG" <<'YAML'
version: 2
updates: []
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"minimumReleaseAge is '2880'; it needs >= 4320"* ]]
  _file pnpm-workspace.yaml 'packages: [.]'
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"minimumReleaseAge is '0'"* ]]
}

@test "the real config keeps a 14-day major cooldown wherever it's supported" {
  run yq -o=json '.updates' .github/dependabot.yml
  [ "$status" -eq 0 ]
  run jq -r '.[] | select(.["package-ecosystem"] != "github-actions" and .["package-ecosystem"] != "docker")
    | select((.cooldown["default-days"] // 0) < 5 or (.cooldown["semver-major-days"] // 0) < 14)
    | .["package-ecosystem"]' <<<"$output"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "pyproject.toml with dependencies needs pip; tool-config-only is ignored" {
  _file svc/pyproject.toml '[project]
name = "svc"
dependencies = ["httpx>=0.28"]'
  _file skills/pyproject.toml '[tool.ruff]
line-length = 100'
  cat > "$CFG" <<'YAML'
version: 2
updates: []
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"svc/pyproject.toml is not covered: add a 'pip' update entry"* ]]
  [[ "$output" != *"skills/pyproject.toml"* ]]
}

@test "Gradle build files are covered by the project root's gradle entry" {
  _file apps/android/settings.gradle.kts ''
  _file apps/android/app/build.gradle.kts ''
  _file apps/android/gradle/libs.versions.toml ''
  _file tools/lone/build.gradle ''
  cat > "$CFG" <<'YAML'
version: 2
updates:
  - package-ecosystem: gradle
    directory: /apps/android
    schedule: {interval: weekly}
    cooldown: {default-days: 5}
YAML
  _check
  [ "$status" -eq 1 ]
  [[ "$output" == *"tools/lone/build.gradle is not covered"* ]]
  [[ "$output" != *"apps/android/app"* ]]
  [[ "$output" != *"libs.versions.toml"* ]]
  [[ "$output" == *"1 violation(s)"* ]]
}

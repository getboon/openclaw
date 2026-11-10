#!/usr/bin/env bats

# Tests for scripts/dependabot/dependabot-merge-decision: the rules that decide
# whether a Dependabot PR may auto-merge.

setup() {
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  cd "$REPO_ROOT"
  FILES="$BATS_TEST_TMPDIR/files.txt"
  DIFF="$BATS_TEST_TMPDIR/diff.txt"
  printf 'packages/boon-core/package-lock.json\n' > "$FILES"
  printf '%s\n' '-      "version": "1.0.0",' '+      "version": "1.0.1",' > "$DIFF"
}

_decide() {
  run scripts/dependabot/dependabot-merge-decision --update-type "$1" --kill-switch "$2" --files "$FILES" --diff "$DIFF" --foreign-commits "${3:-0}"
}

# _source_line LOCKFILE LINE — one added line in the given lockfile; assert skip.
_assert_source_blocked() {
  printf '%s\n' "$1" > "$FILES"
  printf '%s\n' "$2" > "$DIFF"
  _decide version-update:semver-patch on
  [[ "$output" == "skip: new package source"* ]]
}

@test "patch with lockfile only → merge" {
  _decide version-update:semver-patch on
  [ "$status" -eq 0 ]
  [ "$output" = "merge" ]
}

@test "github-actions workflow bump → skip (Actions run in CI with secrets; human review)" {
  printf '.github/workflows/x.yml\n' > "$FILES"
  _decide version-update:semver-minor on
  [ "$output" = "skip: GitHub Actions change .github/workflows/x.yml needs a human" ]
}

@test "composite action bump → skip" {
  printf '.github/actions/setup/action.yml\n' > "$FILES"
  _decide version-update:semver-patch on
  [ "$output" = "skip: GitHub Actions change .github/actions/setup/action.yml needs a human" ]
}

@test "kill switch unset → no merge" {
  _decide version-update:semver-patch ""
  [ "$status" -eq 0 ]
  [ "$output" = "skip: kill switch off" ]
}

@test "kill switch ON (wrong case) → no merge" {
  _decide version-update:semver-patch ON
  [ "$output" = "skip: kill switch off" ]
}

@test "major → skip" {
  _decide version-update:semver-major on
  [ "$output" = "skip: update type version-update:semver-major" ]
}

@test "major in group blocks" {
  printf '%s\n' packages/boon-core/package-lock.json packages/boon-core/package.json packages/boon-ui/package-lock.json > "$FILES"
  _decide version-update:semver-major on
  [ "$output" = "skip: update type version-update:semver-major" ]
}

@test "empty update type → skip" {
  _decide "" on
  [ "$output" = "skip: update type " ]
}

@test "non-dependency file blocks" {
  printf '%s\n' packages/boon-core/Gemfile.lock app/models/x.rb > "$FILES"
  _decide version-update:semver-patch on
  [ "$output" = "skip: non-dependency file app/models/x.rb" ]
}

@test "new npm registry host blocks" {
  printf '%s\n' '+      "resolved": "https://evil.example.com/a/-/a-1.0.0.tgz",' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new package source https://evil.example.com/a/-/a-1.0.0.tgz" ]
}

@test "default npm registry host is allowed" {
  printf '%s\n' '+      "resolved": "https://registry.npmjs.org/a/-/a-1.0.1.tgz",' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "merge" ]
}

@test "new gem remote blocks" {
  printf 'packages/boon-core/Gemfile.lock\n' > "$FILES"
  printf '%s\n' '+  remote: https://gems.evil.example/' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new package source https://gems.evil.example/" ]
}

@test "rubygems.org remote is allowed" {
  printf 'packages/boon-core/Gemfile.lock\n' > "$FILES"
  printf '%s\n' '+  remote: https://rubygems.org/' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "merge" ]
}

@test "new uv registry blocks" {
  printf 'packages/takeoff-service/uv.lock\n' > "$FILES"
  printf '%s\n' '+source = { registry = "https://pypi.evil.example/simple" }' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new package source https://pypi.evil.example/simple" ]
}

@test "removed lines are ignored" {
  printf 'packages/boon-core/Gemfile.lock\n' > "$FILES"
  printf '%s\n' '-  remote: https://old.example/' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "merge" ]
}

@test "diff file headers are not treated as added lines" {
  printf 'packages/boon-core/Gemfile.lock\n' > "$FILES"
  printf '%s\n' '--- a/packages/boon-core/Gemfile.lock' '+++ b/packages/boon-core/Gemfile.lock' '+    rack (3.1.2)' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "merge" ]
}

@test "npm git+ssh source blocks" {
  _assert_source_blocked package-lock.json '+      "resolved": "git+ssh://git@github.com/evil/x.git#abc",'
}

@test "npm git+https source blocks" {
  _assert_source_blocked package-lock.json '+      "resolved": "git+https://github.com/evil/x.git#abc",'
}

@test "npm file: source blocks" {
  _assert_source_blocked package-lock.json '+      "resolved": "file:../evil",'
}

@test "Gemfile.lock ssh git remote blocks" {
  _assert_source_blocked Gemfile.lock '+  remote: git@github.com:evil/x.git'
}

@test "uv git source blocks" {
  _assert_source_blocked uv.lock '+source = { git = "https://github.com/evil/x?rev=1#abc" }'
}

@test "uv url source blocks" {
  _assert_source_blocked uv.lock '+source = { url = "https://evil.example/x.whl" }'
}

@test "pnpm tarball source blocks" {
  _assert_source_blocked pnpm-lock.yaml '+    resolution: {tarball: https://evil.example/x.tgz}'
}

@test "yarn resolved source blocks" {
  _assert_source_blocked yarn.lock '+  resolved "https://evil.example/x.tgz#abc"'
}

@test "yarn default registry is allowed" {
  printf 'yarn.lock\n' > "$FILES"
  printf '%s\n' '+  resolved "https://registry.yarnpkg.com/a/-/a-1.0.1.tgz#abc"' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "merge" ]
}

@test "uv default registry is allowed" {
  printf 'uv.lock\n' > "$FILES"
  printf '%s\n' '+source = { registry = "https://pypi.org/simple" }' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "merge" ]
}

@test "a non-Dependabot or unverified commit blocks" {
  _decide version-update:semver-patch on 1
  [ "$output" = "skip: non-Dependabot or unverified commit on the branch" ]
}

@test "bad args → exit 2" {
  run scripts/dependabot/dependabot-merge-decision --update-type version-update:semver-patch
  [ "$status" -eq 2 ]
}

# --- openclaw-specific rules -----------------------------------------------

@test "pnpm-workspace.yaml change blocks (allowBuilds, overrides, minimumReleaseAge)" {
  printf '%s\n' package.json pnpm-lock.yaml pnpm-workspace.yaml > "$FILES"
  _decide version-update:semver-patch on
  [ "$output" = "skip: non-dependency file pnpm-workspace.yaml" ]
}

@test "Dockerfile change blocks (base images need a human)" {
  printf 'Dockerfile\n' > "$FILES"
  _decide version-update:semver-patch on
  [ "$output" = "skip: non-dependency file Dockerfile" ]
}

@test "Gradle wrapper and settings changes block" {
  printf 'apps/android/gradle/wrapper/gradle-wrapper.properties\n' > "$FILES"
  _decide version-update:semver-patch on
  [ "$output" = "skip: non-dependency file apps/android/gradle/wrapper/gradle-wrapper.properties" ]
  printf 'apps/android/settings.gradle.kts\n' > "$FILES"
  _decide version-update:semver-patch on
  [ "$output" = "skip: non-dependency file apps/android/settings.gradle.kts" ]
}

@test "pnpm workspace bump with package.json + lockfile + shrinkwrap → merge" {
  printf '%s\n' package.json extensions/matrix/package.json extensions/matrix/npm-shrinkwrap.json pnpm-lock.yaml > "$FILES"
  printf '%s\n' \
    '--- a/extensions/matrix/package.json' '+++ b/extensions/matrix/package.json' \
    '-    "music-metadata": "11.12.3",' '+    "music-metadata": "11.16.0",' \
    '--- a/extensions/matrix/npm-shrinkwrap.json' '+++ b/extensions/matrix/npm-shrinkwrap.json' \
    '-      "resolved": "https://registry.npmjs.org/music-metadata/-/music-metadata-11.12.3.tgz",' \
    '+      "resolved": "https://registry.npmjs.org/music-metadata/-/music-metadata-11.16.0.tgz",' \
    '--- a/pnpm-lock.yaml' '+++ b/pnpm-lock.yaml' \
    '-  music-metadata@11.12.3:' '+  music-metadata@11.16.0:' \
    '+    resolution: {integrity: sha512-abc}' \
    '+  strtok3@10.0.0:' > "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "merge" ]
}

@test "new direct npm dependency in package.json blocks" {
  printf '%s\n' package.json pnpm-lock.yaml > "$FILES"
  printf '%s\n' '--- a/package.json' '+++ b/package.json' \
    '-    "zod": "4.6.7",' '+    "zod": "4.6.8",' '+    "left-pad": "1.3.0",' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new dependency left-pad in package.json" ]
}

@test "same dependency name in another package.json is still new" {
  printf '%s\n' package.json ui/package.json > "$FILES"
  printf '%s\n' '--- a/package.json' '+++ b/package.json' '-    "zod": "4.6.7",' '+    "zod": "4.6.8",' \
    '--- a/ui/package.json' '+++ b/ui/package.json' '+    "zod": "4.6.8",' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new dependency zod in ui/package.json" ]
}

@test "pnpm git source blocks" {
  _assert_source_blocked pnpm-lock.yaml '+    resolution: {commit: abc123, repo: https://github.com/evil/x, type: git}'
}

@test "swift version bump of an existing package → merge" {
  printf '%s\n' apps/macos/Package.swift apps/macos/Package.resolved > "$FILES"
  printf '%s\n' '--- a/apps/macos/Package.swift' '+++ b/apps/macos/Package.swift' \
    '-        .package(url: "https://github.com/apple/swift-log.git", from: "1.10.1"),' \
    '+        .package(url: "https://github.com/apple/swift-log.git", from: "1.11.0"),' \
    '--- a/apps/macos/Package.resolved' '+++ b/apps/macos/Package.resolved' \
    '-        "revision" : "aaa",' '+        "revision" : "bbb",' \
    '-        "version" : "1.10.1"' '+        "version" : "1.11.0"' > "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "merge" ]
}

@test "new swift package location blocks" {
  printf 'apps/macos/Package.resolved\n' > "$FILES"
  printf '%s\n' '+++ b/apps/macos/Package.resolved' '+      "location" : "https://github.com/evil/x.git",' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new package source https://github.com/evil/x.git" ]
}

@test "swift package moved to a new URL blocks" {
  printf 'apps/macos/Package.swift\n' > "$FILES"
  printf '%s\n' '+++ b/apps/macos/Package.swift' \
    '-        .package(url: "https://github.com/apple/swift-log.git", from: "1.10.1"),' \
    '+        .package(url: "https://github.com/evil/swift-log.git", from: "1.11.0"),' > "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "skip: new package source https://github.com/evil/swift-log.git" ]
}

@test "gomod version bump → merge; new module blocks" {
  printf '%s\n' scripts/docs-i18n/go.mod scripts/docs-i18n/go.sum > "$FILES"
  printf '%s\n' '+++ b/scripts/docs-i18n/go.mod' '-	golang.org/x/net v0.55.0' '+	golang.org/x/net v0.56.0' > "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "merge" ]
  printf '%s\n' '+	github.com/evil/x v1.0.0' >> "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "skip: new dependency github.com/evil/x in scripts/docs-i18n/go.mod" ]
}

@test "gradle catalog version bump → merge; new catalog entry blocks" {
  printf 'apps/android/gradle/libs.versions.toml\n' > "$FILES"
  printf '%s\n' '+++ b/apps/android/gradle/libs.versions.toml' '-androidx-core = "1.18.0"' '+androidx-core = "1.18.1"' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "merge" ]
  printf '%s\n' '+evil-lib = { module = "com.evil:lib", version = "1.0.0" }' >> "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new dependency evil-lib@com.evil:lib in apps/android/gradle/libs.versions.toml" ]
}

@test "gradle build file: coordinate bump → merge; new coordinate or repository blocks" {
  printf 'apps/android/app/build.gradle.kts\n' > "$FILES"
  printf '%s\n' '+++ b/apps/android/app/build.gradle.kts' \
    '-    implementation("com.squareup.okhttp3:okhttp:5.1.0")' '+    implementation("com.squareup.okhttp3:okhttp:5.2.0")' > "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "merge" ]
  printf '%s\n' '+    implementation("com.evil:lib:1.0.0")' >> "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "skip: new dependency com.evil:lib in apps/android/app/build.gradle.kts" ]
  printf '%s\n' '+++ b/apps/android/app/build.gradle.kts' '+    maven { url = uri("https://maven.evil.example/") }' > "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "skip: new package source https://maven.evil.example/" ]
}

@test "uv git source is refused even when the diff also removes it" {
  printf 'uv.lock\n' > "$FILES"
  printf '%s\n' '-source = { git = "https://github.com/x/y?rev=1#abc" }' '+source = { git = "https://github.com/x/y?rev=1#abc" }' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new package source git=https://github.com/x/y?rev=1#abc" ]
}

@test "new go.mod // indirect require (go mod tidy) is allowed" {
  printf '%s\n' scripts/docs-i18n/go.mod scripts/docs-i18n/go.sum > "$FILES"
  printf '%s\n' '+++ b/scripts/docs-i18n/go.mod' '-	golang.org/x/net v0.55.0' '+	golang.org/x/net v0.56.0' \
    '+	golang.org/x/text v0.30.0 // indirect' > "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "merge" ]
}

@test "pnpm directory source blocks" {
  _assert_source_blocked pnpm-lock.yaml '+    resolution: {directory: ../evil, type: directory}'
}

@test "a deleted file's removed keys are not credited to the previous file" {
  printf '%s\n' package.json ui/package.json > "$FILES"
  printf '%s\n' '--- a/package.json' '+++ b/package.json' '+    "left-pad": "1.3.0",' \
    '--- a/ui/package.json' '+++ /dev/null' '-    "left-pad": "1.3.0",' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new dependency left-pad in package.json" ]
}

@test "a header path with a trailing tab still names the file" {
  printf 'my app/package.json\n' > "$FILES"
  printf '%s\n' '--- a/my app/package.json' "+++ b/my app/package.json	" '+    "left-pad": "1.3.0",' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new dependency left-pad in my app/package.json" ]
}

# _spec_change SPEC — package.json changes an existing dependency to SPEC.
_spec_change() {
  printf '%s\n' package.json pnpm-lock.yaml > "$FILES"
  printf '%s\n' '--- a/package.json' '+++ b/package.json' \
    '-    "zod": "4.6.7",' "+    \"zod\": \"$1\"," > "$DIFF"
  _decide version-update:semver-patch on
}

@test "package.json dependency switched to a git/URL/file/GitHub source blocks" {
  for spec in "git+https://github.com/evil/zod.git#v4" "git@github.com:evil/zod.git" \
    "https://evil.example/zod.tgz" "file:../evil" "link:../evil" "github:evil/zod" "evil/zod#main"; do
    _spec_change "$spec"
    [ "$output" = "skip: new package source $spec" ]
  done
}

@test "package.json registry versions, ranges, dist-tags and npm: aliases pass" {
  for spec in "4.6.8" "^4.6.8" ">=4.6.8 <5" "latest" "npm:zod@4.6.8"; do
    _spec_change "$spec"
    [ "$output" = "merge" ]
  done
}

@test "an unchanged non-registry specifier on a moved line passes" {
  printf '%s\n' package.json > "$FILES"
  printf '%s\n' '+++ b/package.json' '-    "x": "github:org/x",' '+    "x": "github:org/x",' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "merge" ]
}

@test "gradle catalog alias pointed at another module blocks" {
  printf 'apps/android/gradle/libs.versions.toml\n' > "$FILES"
  printf '%s\n' '+++ b/apps/android/gradle/libs.versions.toml' \
    '-okhttp = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }' \
    '+okhttp = { module = "com.evil:okhttp", version.ref = "okhttp" }' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new dependency okhttp@com.evil:okhttp in apps/android/gradle/libs.versions.toml" ]
}

@test "gradle catalog version change with group/name form passes" {
  printf 'apps/android/gradle/libs.versions.toml\n' > "$FILES"
  printf '%s\n' '+++ b/apps/android/gradle/libs.versions.toml' \
    '-okhttp = { group = "com.squareup.okhttp3", name = "okhttp", version = "5.1.0" }' \
    '+okhttp = { group = "com.squareup.okhttp3", name = "okhttp", version = "5.2.0" }' > "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "merge" ]
}

@test "new gem in Gemfile blocks; version change passes" {
  printf '%s\n' Gemfile Gemfile.lock > "$FILES"
  printf '%s\n' '+++ b/Gemfile' "-gem 'rack', '~> 3.1.0'" "+gem 'rack', '~> 3.1.2'" > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "merge" ]
  printf '%s\n' '+gem "evil"' >> "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new dependency evil in Gemfile" ]
}

@test "new package in requirements.txt blocks; version change passes" {
  printf 'requirements.txt\n' > "$FILES"
  printf '%s\n' '+++ b/requirements.txt' '-requests==2.32.3' '+requests==2.32.4' > "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "merge" ]
  printf '%s\n' '+evil-pkg[extra]>=1.0' >> "$DIFF"
  _decide version-update:semver-patch on
  [ "$output" = "skip: new dependency evil-pkg in requirements.txt" ]
}

@test "new dependency in pyproject.toml blocks (PEP 621 and Poetry); version change passes" {
  printf 'pyproject.toml\n' > "$FILES"
  printf '%s\n' '+++ b/pyproject.toml' '-  "httpx>=0.27.0",' '+  "httpx>=0.28.1",' > "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "merge" ]
  printf '%s\n' '+  "evil>=1.0",' >> "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "skip: new dependency evil in pyproject.toml" ]
  printf '%s\n' '+++ b/pyproject.toml' '+evil = "^1.0"' > "$DIFF"
  _decide version-update:semver-minor on
  [ "$output" = "skip: new dependency evil in pyproject.toml" ]
}

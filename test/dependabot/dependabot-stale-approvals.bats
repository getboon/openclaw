#!/usr/bin/env bats

# Tests for scripts/dependabot/dependabot-stale-approvals (ENG-22470, ported from boon ENG-22137): which approvals were
# given to an older commit and must be dismissed before auto-merge is re-enabled.
# main does not dismiss stale approvals itself, so without this an approval of
# an earlier head would still count for a newer one.

setup() {
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  cd "$REPO_ROOT"
  REVIEWS="$BATS_TEST_TMPDIR/reviews.json"
}

_stale() {
  run scripts/dependabot/dependabot-stale-approvals --reviews "$REVIEWS" --head "${1:-head1}"
}

@test "approval of an older commit is stale" {
  echo '[{"id":11,"state":"APPROVED","commit_id":"old1"}]' > "$REVIEWS"
  _stale
  [ "$status" -eq 0 ]
  [ "$output" = "11" ]
}

@test "approval of the current head is kept" {
  echo '[{"id":12,"state":"APPROVED","commit_id":"head1"}]' > "$REVIEWS"
  _stale
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "comments and already-dismissed reviews are ignored" {
  echo '[{"id":13,"state":"COMMENTED","commit_id":"old1"},{"id":14,"state":"DISMISSED","commit_id":"old1"},{"id":15,"state":"CHANGES_REQUESTED","commit_id":"old1"}]' > "$REVIEWS"
  _stale
  [ -z "$output" ]
}

@test "paginated output (several concatenated arrays) is read in full" {
  printf '%s\n' '[{"id":21,"state":"APPROVED","commit_id":"old1"}]' '[{"id":22,"state":"APPROVED","commit_id":"head1"},{"id":23,"state":"APPROVED","commit_id":"old2"}]' > "$REVIEWS"
  _stale
  [ "$output" = "$(printf '21\n23')" ]
}

@test "no reviews → nothing to dismiss" {
  echo '[]' > "$REVIEWS"
  _stale
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "unreadable reviews JSON → non-zero exit (fails closed)" {
  echo 'not json' > "$REVIEWS"
  _stale
  [ "$status" -ne 0 ]
}

@test "bad args → exit 2" {
  run scripts/dependabot/dependabot-stale-approvals --head head1
  [ "$status" -eq 2 ]
}

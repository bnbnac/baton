#!/bin/bash
set -eu
id="$1"
delay="${2:-1}"
limit="${3:-0}"
printf -v payload '%1008s' ''
payload=${payload// /x}
n=0
tick=0
emit() { n=$((n+1)); printf 'SOAK:%s:%08d:%s\n' "$id" "$n" "$payload"; }
while (( limit == 0 || tick < limit )); do
  sleep "$delay"
  tick=$((tick+1))
  emit
  if (( tick % 30 == 0 )); then
    for j in 1 2 3 4; do emit; done
  fi
done

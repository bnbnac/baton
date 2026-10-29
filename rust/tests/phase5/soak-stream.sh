#!/bin/bash
set -eu
id="$1"
printf -v payload '%1008s' ''
payload=${payload// /x}
n=0
while true; do
  n=$((n+1))
  printf 'SOAK:%s:%08d:%s\n' "$id" "$n" "$payload"
  if (( n % 30 == 0 )); then
    for j in 1 2 3 4; do
      n=$((n+1))
      printf 'SOAK:%s:%08d:%s\n' "$id" "$n" "$payload"
    done
  fi
  sleep 1
done

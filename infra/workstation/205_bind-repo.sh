#!/bin/bash
# Cloud Workstations startup hook (runs before the Secret Manager hooks).
# The persistent disk only mounts at /home; everything else resets on
# restart. The repo therefore lives at /home/user/repos and is bind-mounted
# to the same absolute path as on the Mac so Claude Code's path-keyed
# project state (memory, session history) matches across machines.

STORE=/home/user/repos/Lingual-Project
MOUNT=/Users/new/Documents/GitHub/Lingual-U/Lingual-Project

mkdir -p "$STORE"
chown user:user /home/user/repos "$STORE"

mkdir -p "$MOUNT"
mountpoint -q "$MOUNT" || mount --bind "$STORE" "$MOUNT"
chown user:user /Users /Users/new /Users/new/Documents /Users/new/Documents/GitHub /Users/new/Documents/GitHub/Lingual-U

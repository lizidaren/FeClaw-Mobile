#!/bin/bash
cd /home/lch/Projects/FeClaw-Mobile
claude --print --permission-mode bypassPermissions \
  "Read /home/lch/Projects/FeClaw-Mobile/claude-work/backend-connect.md and execute ALL tasks. Run npx tsc --noEmit. Write result to /home/lch/Projects/FeClaw-Mobile/claude-work/backend-connect-result.md"

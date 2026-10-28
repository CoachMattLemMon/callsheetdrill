# Call Sheet Drill

High school situational play-calling game. Two-minute, red zone and 3rd/4th down drives, graded on win chance under NFHS clock rules. Player mode puts a QB at the line; coach mode gives the whole call sheet plus clock and kicking decisions.

Play it: https://coachmattlemmon.github.io/callsheetdrill/

Coaches load their own call sheet in **Team setup**, then share it with their staff using the playbook code. Everything is saved on each person's own device; the site collects no data.

## Booth Log

Game-day and film charting at https://coachmattlemmon.github.io/callsheetdrill/logger/

Talk each snap into the phone's keyboard dictation, say "new play" between plays, and tap **Log drive**. Booth Log reads down and distance, field position, formation, play, coverage, pressure, result and defender notes with no AI service and no account, and builds tendency tables by situation and formation family. Pick **Scout film** when charting an opponent's defense against another team.

**Send to drill** saves that opponent's tendencies on the device; in Call Sheet Drill, **Team setup → Opponent tendencies** makes the defense play like them. Booth Log also recognizes the plays and formations from your Call Sheet Drill call sheet on the same device.

## Updating
Edit `index.html` or `logger/index.html`, then bump `VERSION` in `sw.js` (csd-v1 → csd-v2) so installed copies update.

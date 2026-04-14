---
name: midnight-archive
description: 強制封存當前 Claude session（由午夜 cron 觸發）。通知 Discord、暫停接收訊息、對 tmux session 送出 !archive，並在背景自動恢復 Discord 存取。
disable-model-invocation: false
context: fork
allowed-tools: Bash mcp__plugin_discord_discord__reply
---

## 參數

- `$ARGUMENTS`：tmux target（預設 `assistant:0.0`）

## 執行步驟

依序完成以下步驟，不要省略。

### 步驟 1：通知 Discord

使用 `mcp__plugin_discord_discord__reply` 發送至頻道 `1486128557444042883`：

```
⏰ UTC 23:50 — 即將自動封存當前會話，Discord 暫時停止接收訊息。
```

### 步驟 2：暫停 Discord 接收

使用 Bash 將 `~/.claude/channels/discord/access.json` 的 `allowFrom` 清空：

```bash
ACCESS_FILE="$HOME/.claude/channels/discord/access.json"
if [ -f "$ACCESS_FILE" ]; then
  cp "$ACCESS_FILE" "${ACCESS_FILE}.bak"
  python3 -c "
import json, sys
path = sys.argv[1]
d = json.load(open(path))
d['allowFrom'] = []
json.dump(d, open(path, 'w'), indent=2)
" "$ACCESS_FILE"
  echo "Discord incoming blocked"
fi
```

### 步驟 3：送出 !archive 到 tmux session

```bash
TMUX_TARGET="${ARGUMENTS:-assistant:0.0}"
tmux send-keys -t "$TMUX_TARGET" "!archive" Enter
echo "Sent !archive to $TMUX_TARGET"
```

### 步驟 4：背景恢復 Discord 存取

在背景等待 120 秒後還原 access.json（足夠讓 archive + Claude 重啟完成）：

```bash
ACCESS_FILE="$HOME/.claude/channels/discord/access.json"
(
  sleep 120
  cp "${ACCESS_FILE}.bak" "$ACCESS_FILE"
  echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Discord access restored" >> /tmp/midnight-archive.log
) &
disown
echo "Restore scheduled in 120s"
```

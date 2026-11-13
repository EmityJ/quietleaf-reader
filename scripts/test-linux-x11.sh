#!/bin/bash
set -eu
cd -- "$(dirname "$0")/.."

# 独立虚拟显示器只用于回归测试，不连接或更改用户桌面的窗口管理器。
if [ "${QUIETLEAF_XVFB_READY:-}" != 1 ]; then
    exec xvfb-run -a -s '-screen 0 1280x900x24' env QUIETLEAF_XVFB_READY=1 bash "$0" "$@"
fi

mkdir -p .test-data
openbox --sm-disable >".test-data/x11-openbox-$$.log" 2>&1 &
window_manager_pid=$!
xcompmgr -c >".test-data/x11-compositor-$$.log" 2>&1 &
compositor_pid=$!
cleanup() {
    kill "$compositor_pid" "$window_manager_pid" 2>/dev/null || true
}
trap cleanup EXIT

for attempt in $(seq 1 50); do
    if xprop -root _NET_SUPPORTED | grep -q _NET_WM_WINDOW_OPACITY; then
        break
    fi
    sleep 0.1
done
node scripts/smoke-linux-x11.mjs "$@"

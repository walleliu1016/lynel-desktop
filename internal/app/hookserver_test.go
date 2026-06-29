package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSessionStartScriptWin_ReadsStdinDirectly(t *testing.T) {
	script := sessionStartScriptWin("http://localhost:9999/hook")
	assert.Contains(t, script, "[System.Console]::In.ReadToEnd()", "script should read stdin directly")
	assert.NotContains(t, script, "if ([Console]::IsInputRedirected)", "old gating check removed")
}

// TestSessionStartScriptWin_ForwardsStdinToHook 启动一个本地 HTTP server，
// 然后调用生成的 PowerShell SessionStart 脚本，验证 stdin 中的 JSON 能被
// 正确 POST 到 hook server。这是 Windows 上 CreateSession 能否拿到真实
// session_id 的关键路径。
func TestSessionStartScriptWin_ForwardsStdinToHook(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only: PowerShell integration")
	}

	received := make(chan string, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/hook", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received <- string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"continue":true,"suppressOutput":true}`))
	})

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	defer func() { _ = srv.Close() }()

	hookURL := fmt.Sprintf("http://%s/hook", ln.Addr().String())
	script := sessionStartScriptWin(hookURL)

	tmpDir := t.TempDir()
	scriptPath := filepath.Join(tmpDir, "session-start.ps1")
	require.NoError(t, os.WriteFile(scriptPath, []byte(script), 0o644))

	inputJSON := `{"hook_event_name":"SessionStart","session_id":"550e8400-e29b-41d4-a716-446655440000"}`

	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ". "+scriptPath)
	stdin, err := cmd.StdinPipe()
	require.NoError(t, err)
	require.NoError(t, cmd.Start())
	_, _ = io.WriteString(stdin, inputJSON)
	_ = stdin.Close()

	var body string
	select {
	case body = <-received:
	case <-time.After(10 * time.Second):
		t.Fatal("timeout waiting for hook POST")
	}

	require.NoError(t, cmd.Wait())

	body = strings.TrimSpace(body)
	var evt map[string]any
	require.NoError(t, json.Unmarshal([]byte(body), &evt))
	assert.Equal(t, "SessionStart", evt["hook_event_name"])
	assert.Equal(t, "550e8400-e29b-41d4-a716-446655440000", evt["session_id"])
}

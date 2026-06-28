package jsonl

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
)

type SessionMeta struct {
	ID          string `json:"id"`
	WorkDir     string `json:"workdir"`
	MTime       int64  `json:"mtime"`
	MsgCount    int    `json:"msg_count"`
	FirstPrompt string `json:"first_prompt"`
	Size        int64  `json:"size"`
}

var (
	rootMu sync.RWMutex
	root   = defaultRoot()
)

func defaultRoot() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude", "projects")
}

func SetRoot(p string) {
	rootMu.Lock()
	defer rootMu.Unlock()
	root = p
}

func Root() string {
	rootMu.RLock()
	defer rootMu.RUnlock()
	return root
}

func ScanAll() ([]SessionMeta, error) {
	r := Root()
	entries, err := os.ReadDir(r)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var metas []SessionMeta
	for _, proj := range entries {
		if !proj.IsDir() {
			continue
		}
		projDir := filepath.Join(r, proj.Name())
		files, err := os.ReadDir(projDir)
		if err != nil {
			continue
		}
		workDir := decodeProjectDirName(proj.Name())
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
				continue
			}
			info, err := f.Info()
			if err != nil {
				continue
			}
			id := strings.TrimSuffix(f.Name(), ".jsonl")
			fp, mc := scanFileMeta(filepath.Join(projDir, f.Name()))
			metas = append(metas, SessionMeta{
				ID:          id,
				WorkDir:     workDir,
				MTime:       info.ModTime().Unix(),
				MsgCount:    mc,
				FirstPrompt: fp,
				Size:        info.Size(),
			})
		}
	}
	return metas, nil
}

// decodeProjectDirName converts e.g. "-Users-akke-foo" to "/Users/akke/foo"
func decodeProjectDirName(name string) string {
	parts := strings.Split(name, "-")
	if len(parts) == 0 {
		return name
	}
	// Drop leading empty (from initial "-")
	if parts[0] == "" {
		parts = parts[1:]
	}
	return "/" + strings.Join(parts, "/")
}

// scanFileMeta reads a jsonl file and returns its first user prompt
// and total line count. Returns empty strings / zero on any error.
func scanFileMeta(path string) (firstPrompt string, msgCount int) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0
	}
	defer f.Close()

	type rawLine struct {
		Type    string          `json:"type"`
		Message json.RawMessage `json:"message"`
	}
	type msg struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}

	var count int
	var found bool
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		count++
		if found {
			continue
		}
		var rl rawLine
		if json.Unmarshal(scanner.Bytes(), &rl) != nil {
			continue
		}
		var m msg
		if json.Unmarshal(rl.Message, &m) != nil {
			continue
		}
		if m.Role == "user" && m.Content != "" {
			firstPrompt = m.Content
			found = true
		}
	}
	return firstPrompt, count
}

// Watch creates a fsnotify watcher for the given session jsonl.
// Caller must close the returned watcher.
func Watch(path string) (*fsnotify.Watcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := w.Add(path); err != nil {
		w.Close()
		return nil, err
	}
	return w, nil
}

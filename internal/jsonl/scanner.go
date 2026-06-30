package jsonl

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
)

type SessionMeta struct {
	ID          string `json:"id"`
	WorkDir     string `json:"workdir"`
	Project     string `json:"project"`
	MTime       int64  `json:"mtime"`
	MsgCount    int    `json:"msg_count"`
	FirstPrompt string `json:"first_prompt"`
	AITitle     string `json:"ai_title"`
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
			fp, at, cwd, mc := scanFileMeta(filepath.Join(projDir, f.Name()))
			if cwd != "" {
				workDir = cwd
			}
			metas = append(metas, SessionMeta{
				ID:          id,
				WorkDir:     workDir,
				Project:     projectName(workDir),
				MTime:       info.ModTime().Unix(),
				MsgCount:    mc,
				FirstPrompt: fp,
				AITitle:     at,
				Size:        info.Size(),
			})
		}
	}
	// 最近活跃的会话排在最前，便于用户找到当前关心的会话；ID 作为稳定次排序。
	sort.Slice(metas, func(i, j int) bool {
		if metas[i].MTime != metas[j].MTime {
			return metas[i].MTime > metas[j].MTime
		}
		return metas[i].ID < metas[j].ID
	})
	return metas, nil
}

// decodeProjectDirName converts a project directory name back to the
// original workdir. On Unix "-Users-akke-foo" becomes "/Users/akke/foo"; on
// Windows "C--Users-akke-foo" becomes "C:\Users\akke\foo".
// projectName returns the last segment of a workdir path, e.g.
// "/Users/akke/foo" -> "foo", "D:\\work" -> "work", "/" -> "/".
func projectName(workDir string) string {
	if workDir == "" || workDir == "/" {
		return workDir
	}
	// Normalize Windows separators before using the cross-platform Base.
	clean := strings.ReplaceAll(workDir, "\\", "/")
	base := filepath.Base(clean)
	if base == "." || base == "/" {
		return workDir
	}
	return base
}

func decodeProjectDirName(name string) string {
	// Windows drive letter: "C--xxx" -> "C:\xxx"
	if len(name) >= 3 && name[1] == '-' && name[2] == '-' &&
		name[0] >= 'A' && name[0] <= 'Z' {
		rest := strings.ReplaceAll(name[3:], "-", `\`)
		return string(name[0]) + ":\\" + rest
	}

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

// scanFileMeta reads a jsonl file and returns its first user prompt,
// ai_title (if any), working directory (when recorded by Claude), and total line count.
func scanFileMeta(path string) (firstPrompt, aiTitle, cwd string, msgCount int) {
	f, err := os.Open(path)
	if err != nil {
		return "", "", "", 0
	}
	defer f.Close()

	type rawLine struct {
		Type    string          `json:"type"`
		Message json.RawMessage `json:"message"`
		AITitle string          `json:"ai_title"`
		Cwd     string          `json:"cwd"`
	}

	var count int
	var foundUser bool
	var foundTitle bool
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		count++
		if foundUser && foundTitle && cwd != "" {
			continue
		}
		var rl rawLine
		if json.Unmarshal(scanner.Bytes(), &rl) != nil {
			continue
		}
		if cwd == "" && rl.Cwd != "" {
			cwd = rl.Cwd
		}
		if !foundTitle && rl.AITitle != "" {
			aiTitle = rl.AITitle
			foundTitle = true
		}
		if !foundUser {
			var m Message
			if json.Unmarshal(rl.Message, &m) != nil {
				continue
			}
			if m.Role == "user" {
				t := m.ContentText()
				if t != "" {
					firstPrompt = t
					foundUser = true
				}
			}
		}
	}
	return firstPrompt, aiTitle, cwd, count
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

// WatchProjects watches the entire projects root (recursively) and invokes
// onChange on any jsonl file create/write/remove/rename event. The caller
// must close the returned watcher to stop it.
//
// New subdirectories under the root are added to the watch on the fly so
// sessions created in a fresh project still trigger refreshes.
//
// onChange is called from a single goroutine, serialized.
func WatchProjects(onChange func()) (*fsnotify.Watcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	r := Root()
	if _, err := os.Stat(r); err != nil {
		// root doesn't exist yet — return watcher anyway so caller can keep it
		return w, nil
	}
	if err := addRecursive(w, r); err != nil {
		w.Close()
		return nil, err
	}
	go func() {
		for {
			select {
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				if !isProjectJSONLEvent(ev) {
					continue
				}
				// If a new project subdir appeared, attach a watch to it.
				if ev.Op&fsnotify.Create != 0 {
					if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
						_ = addRecursive(w, ev.Name)
					}
				}
				if onChange != nil {
					onChange()
				}
			case <-w.Errors:
				// swallow errors; nothing actionable here
			}
		}
	}()
	return w, nil
}

func addRecursive(w *fsnotify.Watcher, root string) error {
	if err := w.Add(root); err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		_ = addRecursive(w, filepath.Join(root, e.Name()))
	}
	return nil
}

func isProjectJSONLEvent(ev fsnotify.Event) bool {
	if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
		return false
	}
	// 任何 .jsonl 改动；目录创建走 addRecursive
	return strings.HasSuffix(ev.Name, ".jsonl") || ev.Op&fsnotify.Create != 0
}

// Package auth provides local password authentication with lockout.
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	maxAttempts   = 3
	lockoutWindow = 5 * time.Minute
)

var (
	ErrLocked   = errors.New("auth: locked out")
	ErrWrongPwd = errors.New("auth: wrong password")
)

type file struct {
	Hash        string    `json:"hash"`
	Salt        string    `json:"salt"`
	Attempts    int       `json:"attempts"`
	LockedUntil time.Time `json:"locked_until"`
}

type Auth struct {
	mu sync.Mutex
	f  file
}

var (
	pathMu sync.RWMutex
	path   = defaultPath()
)

func defaultPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".ease-ui", "auth.json")
}

func SetPath(p string) {
	pathMu.Lock()
	defer pathMu.Unlock()
	path = p
}

func Path() string {
	pathMu.RLock()
	defer pathMu.RUnlock()
	return path
}

func Exists() bool {
	_, err := os.Stat(Path())
	return err == nil
}

func New() (*Auth, error) {
	a := &Auth{}
	data, err := os.ReadFile(Path())
	if err != nil {
		if os.IsNotExist(err) {
			return a, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, &a.f); err != nil {
		return nil, err
	}
	return a, nil
}

func (a *Auth) save() error {
	p := Path()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(a.f, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (a *Auth) SetPassword(pw string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	a.f = file{
		Hash: hex.EncodeToString(hash),
		Salt: hex.EncodeToString(salt),
	}
	return a.save()
}

func (a *Auth) Verify(pw string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if time.Now().Before(a.f.LockedUntil) {
		return ErrLocked
	}

	hash, err := hex.DecodeString(a.f.Hash)
	if err != nil {
		return err
	}
	if err := bcrypt.CompareHashAndPassword(hash, []byte(pw)); err == nil {
		a.f.Attempts = 0
		a.f.LockedUntil = time.Time{}
		_ = a.save()
		return nil
	}

	a.f.Attempts++
	if a.f.Attempts >= maxAttempts {
		a.f.LockedUntil = time.Now().Add(lockoutWindow)
	}
	_ = a.save()
	return ErrWrongPwd
}

func (a *Auth) LockoutState() (int, time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.f.Attempts, a.f.LockedUntil
}

func (a *Auth) Clear() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.f = file{}
	return os.Remove(Path())
}

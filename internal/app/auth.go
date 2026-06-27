package app

import (
	"time"

	"github.com/akke/ease-ui/internal/auth"
)

// IsInitialized returns true if auth.json exists.
func (a *App) IsInitialized() bool {
	return auth.Exists()
}

// Verify checks the password. Returns nil on success, ErrWrongPwd on
// failure, or ErrLocked if currently locked.
func (a *App) Verify(password string) error {
	return a.auth.Verify(password)
}

// LockoutState returns (consecutive failed attempts, time until unlock).
func (a *App) LockoutState() (int, time.Time) {
	return a.auth.LockoutState()
}

// SetPassword replaces the password (used by the init CLI).
func (a *App) SetPassword(newPassword string) error {
	return a.auth.SetPassword(newPassword)
}

// ClearPassword removes auth.json (used by "清除账户密码" button in settings).
func (a *App) ClearPassword() error {
	return a.auth.Clear()
}

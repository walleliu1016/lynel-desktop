// Package log provides leveled file logging with rotation.
package log

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"gopkg.in/natefinch/lumberjack.v2"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

type Logger struct {
	dir      string
	mu       sync.Mutex
	level    Level
	infoOut  io.WriteCloser
	warnOut  io.WriteCloser
	errorOut io.WriteCloser
	prefix   string
}

func New(dir, prefix string) (*Logger, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	rot := func(name string) io.WriteCloser {
		return &lumberjack.Logger{
			Filename:   filepath.Join(dir, name),
			MaxSize:    10, // MB
			MaxBackups: 3,
			MaxAge:     7, // days
			Compress:   false,
		}
	}
	return &Logger{
		dir:      dir,
		level:    LevelInfo,
		infoOut:  rot("info.log"),
		warnOut:  rot("warn.log"),
		errorOut: rot("error.log"),
		prefix:   prefix,
	}, nil
}

func (l *Logger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	var firstErr error
	for _, w := range []io.WriteCloser{l.infoOut, l.warnOut, l.errorOut} {
		if err := w.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (l *Logger) write(level Level, w io.Writer, msg string) {
	if level < l.level {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	ts := time.Now().Format("2006-01-02T15:04:05.000Z07:00")
	levelStr := [...]string{"DEBUG", "INFO", "WARN", "ERROR"}[level]
	line := fmt.Sprintf("%s [%s] %s: %s\n", ts, levelStr, l.prefix, msg)
	_, _ = w.Write([]byte(line))
}

func (l *Logger) Debug(msg string) { l.write(LevelDebug, l.infoOut, msg) }
func (l *Logger) Info(msg string)  { l.write(LevelInfo, l.infoOut, msg) }
func (l *Logger) Warn(msg string)  { l.write(LevelWarn, l.warnOut, msg) }
func (l *Logger) Error(msg string) { l.write(LevelError, l.errorOut, msg) }

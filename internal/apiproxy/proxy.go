package apiproxy

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Proxy is a transparent HTTP reverse proxy bound to a single session.
type Proxy struct {
	mu        sync.Mutex
	provider  Provider
	store     *Store
	sessionID string
	workDir   string
	server    *http.Server
	listener  net.Listener
}

// NewProxy creates a proxy for the given provider, store, and session.
func NewProxy(provider Provider, store *Store, sessionID, workDir string) *Proxy {
	return &Proxy{
		provider:  provider,
		store:     store,
		sessionID: sessionID,
		workDir:   workDir,
	}
}

// Start listens on 127.0.0.1:0 and returns the assigned port.
func (p *Proxy) Start() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	p.listener = l

	mux := http.NewServeMux()
	mux.HandleFunc("/", p.handle)
	p.server = &http.Server{Handler: mux}

	go func() {
		if err := p.server.Serve(l); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "apiproxy: server error: %v\n", err)
		}
	}()

	return l.Addr().(*net.TCPAddr).Port, nil
}

// Stop shuts down the proxy server.
func (p *Proxy) Stop() error {
	if p.server == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return p.server.Shutdown(ctx)
}

// Port returns the listening port (0 if not started).
func (p *Proxy) Port() int {
	if p.listener == nil {
		return 0
	}
	return p.listener.Addr().(*net.TCPAddr).Port
}

// URL returns the proxy URL for setting the agent's BASE_URL.
func (p *Proxy) URL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", p.Port())
}

// Env returns the key/value pair to inject into the agent process.
func (p *Proxy) Env() (string, string) {
	return p.provider.EnvVar, p.URL()
}

// SetSessionID updates the session ID used for persistence. If no phases have
// been written yet, this is cheap; if a file already exists under the old ID,
// it is renamed to the new ID.
func (p *Proxy) SetSessionID(sessionID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.sessionID == sessionID {
		return
	}
	oldPath := p.store.phasePath(p.sessionID, p.workDir)
	p.sessionID = sessionID
	newPath := p.store.phasePath(p.sessionID, p.workDir)
	if _, err := os.Stat(oldPath); err == nil {
		_ = os.Rename(oldPath, newPath)
	}
}

func (p *Proxy) handle(w http.ResponseWriter, r *http.Request) {
	callID := uuid.New().String()

	p.mu.Lock()
	sessionID := p.sessionID
	workDir := p.workDir
	provider := p.provider
	p.mu.Unlock()

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	_ = r.Body.Close()

	reqBody, prompt, tools, toolResults, parseErr := p.parseRequest(body)
	if parseErr == nil {
		if !IsToolResultOnly(reqBody) {
			p.store.WritePrompt(sessionID, workDir, callID, provider.Name, reqBody.Model, prompt, tools)
		}
		if len(toolResults) > 0 {
			p.store.WriteToolResults(sessionID, workDir, callID, provider.Name, toolResults)
		}
	}

	upstreamURL, err := url.Parse(provider.Upstream)
	if err != nil {
		http.Error(w, "bad upstream", http.StatusInternalServerError)
		p.store.WriteError(sessionID, workDir, callID, provider.Name, err.Error())
		return
	}

	// Build upstream request.
	upstreamReq, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL.String()+r.URL.Path, strings.NewReader(string(body)))
	if err != nil {
		http.Error(w, "bad request", http.StatusInternalServerError)
		p.store.WriteError(sessionID, workDir, callID, provider.Name, err.Error())
		return
	}

	// Copy headers, stripping compression and internal markers.
	for k, vv := range r.Header {
		if strings.EqualFold(k, "Accept-Encoding") || strings.HasPrefix(k, "X-Ease-") {
			continue
		}
		for _, v := range vv {
			upstreamReq.Header.Add(k, v)
		}
	}
	upstreamReq.Host = upstreamURL.Host
	upstreamReq.ContentLength = int64(len(body))

	resp, err := http.DefaultTransport.RoundTrip(upstreamReq)
	if err != nil {
		http.Error(w, "upstream error", http.StatusBadGateway)
		p.store.WriteError(sessionID, workDir, callID, provider.Name, err.Error())
		return
	}
	defer resp.Body.Close()

	// Copy response headers.
	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)

	// Stream response back while capturing for phase extraction.
	var captured strings.Builder
	buf := make([]byte, 4096)
	flusher, _ := w.(http.Flusher)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			_, _ = w.Write(buf[:n])
			captured.Write(buf[:n])
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			break
		}
	}

	// Persist response phases after the full stream is captured.
	if provider.Format == "anthropic" {
		summary := ReassembleAnthropicResponse(captured.String())
		p.store.WriteResponse(sessionID, workDir, callID, provider.Name, "", summary)
	}
}

func (p *Proxy) parseRequest(body []byte) (AnthropicRequestBody, string, []string, []ToolResultPhase, error) {
	reqBody, err := ParseAnthropicRequestBody(body)
	if err != nil {
		return AnthropicRequestBody{}, "", nil, nil, err
	}
	prompt := ExtractPrompt(reqBody)
	tools := ExtractTools(reqBody)
	toolResults := ExtractToolResults(reqBody)
	return reqBody, prompt, tools, toolResults, nil
}



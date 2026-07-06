package app

import (
	"fmt"
	"os"

	"github.com/akke/ease-ui/internal/apiproxy"
)

// ensureAPIProxy 返回指定 session 已启动的 API 代理；如不存在则新建并启动。
func (a *App) ensureAPIProxy(sessionID, workDir string) (*apiproxy.Proxy, error) {
	a.appMu.Lock()
	defer a.appMu.Unlock()
	if p := a.proxies[sessionID]; p != nil {
		return p, nil
	}
	p := apiproxy.NewProxy(apiproxy.Providers["claude"], a.apiStore, sessionID, workDir)
	if _, err := p.Start(); err != nil {
		return nil, fmt.Errorf("apiproxy start: %w", err)
	}
	a.proxies[sessionID] = p
	return p, nil
}

// startPendingAPIProxy 为尚未知道真实 session ID 的 ModeAuto 进程启动代理。
// 代理按临时 token 注册，待 SessionStart hook 返回真实 ID 后再迁移。
func (a *App) startPendingAPIProxy(token, workDir string) (*apiproxy.Proxy, error) {
	p := apiproxy.NewProxy(apiproxy.Providers["claude"], a.apiStore, token, workDir)
	if _, err := p.Start(); err != nil {
		return nil, fmt.Errorf("apiproxy start: %w", err)
	}
	a.appMu.Lock()
	a.pendingProxies[token] = p
	a.appMu.Unlock()
	return p, nil
}

// resolvePendingAPIProxy 把临时 token 代理迁移到真实 session ID 下。
func (a *App) resolvePendingAPIProxy(token, realID string) {
	a.appMu.Lock()
	p := a.pendingProxies[token]
	if p != nil {
		delete(a.pendingProxies, token)
		a.proxies[realID] = p
	}
	a.appMu.Unlock()
	if p != nil {
		p.SetSessionID(realID)
	}
}

// stopAPIProxy 停止并移除指定 session 或临时 token 的代理。
func (a *App) stopAPIProxy(key string) {
	a.appMu.Lock()
	p := a.proxies[key]
	delete(a.proxies, key)
	if p == nil {
		p = a.pendingProxies[key]
		delete(a.pendingProxies, key)
	}
	a.appMu.Unlock()
	if p != nil {
		_ = p.Stop()
	}
}

// stopAllAPIProxies 停止所有运行中的代理。
func (a *App) stopAllAPIProxies() {
	a.appMu.Lock()
	all := make([]*apiproxy.Proxy, 0, len(a.proxies)+len(a.pendingProxies))
	for _, p := range a.proxies {
		all = append(all, p)
	}
	for _, p := range a.pendingProxies {
		all = append(all, p)
	}
	a.proxies = map[string]*apiproxy.Proxy{}
	a.pendingProxies = map[string]*apiproxy.Proxy{}
	a.appMu.Unlock()
	for _, p := range all {
		_ = p.Stop()
	}
}

// proxyEnvPair 返回需要注入 PTY 进程的 ANTHROPIC_BASE_URL 环境变量。
func proxyEnvPair(proxy *apiproxy.Proxy) string {
	key, val := proxy.Env()
	return fmt.Sprintf("%s=%s", key, val)
}

// apiProxyEnvOrLog 确保 session 的代理已启动并返回对应的环境变量；失败时只打日志，不阻塞 PTY。
func (a *App) apiProxyEnvOrLog(sessionID, workDir string) []string {
	proxy, err := a.ensureAPIProxy(sessionID, workDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ease-ui: apiproxy disabled for %s: %v\n", sessionID, err)
		return nil
	}
	return []string{proxyEnvPair(proxy)}
}

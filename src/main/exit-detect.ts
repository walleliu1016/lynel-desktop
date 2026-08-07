/** claude 终端里的"退出"命令集合。用户敲其中任意一个并按 Enter，
 *  claude 内部就把该 session 标记为终止，后续 `--resume` 必失败。
 *  严格匹配（不忽略大小写）：避免正常文本里出现 "exit" 字样被误判。
 *  `/q` 不在列：claude 不支持，且与"问问题"语义容易冲突。 */
const EXIT_COMMANDS = new Set(['/exit', 'exit', '/quit', 'quit']);
// /clear：claude 会清空会话并生成新的 sessionId（新 jsonl），需要把当前 PTY 迁移到新会话
const CLEAR_COMMANDS = new Set(['/clear']);
// /resume：claude 终端内切回某个历史会话（其 jsonl 已存在，但被重新写入），
// 需要把当前 PTY 迁移到 resume 目标会话，否则 Lynel 的 session map / 左侧列表停留在旧 id
const RESUME_COMMANDS = new Set(['/resume']);

/** ANSI 转义解析阶段：
 *  0=正常 | 1=刚收到 ESC（等类型字符）| 2=CSI 内（\x1b[）| 3=DCS 内（\x1bP）
 *  | 4=OSC 内（\x1b]）| 5=SS3 内（\x1bO）| 6=DCS/OSC 内收到 ESC 等 ST（\x1b\\） */
export type EscapePhase = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 把 PTY 收到的一批字节按"当前行"维度消化，识别退出命令。
 *  - \r / \n：行结束，检查 trim 后的内容是否匹配 EXIT_COMMANDS / CLEAR_COMMANDS / RESUME_COMMANDS
 *  - \x7f / \b：退格，删一个字
 *  - \x03 (Ctrl+C)：清空当前行（claude 自己也清）
 *  - \x15 (Ctrl+U)：清空当前行（kill）
 *  - \x17 (Ctrl+W)：删一个词（按空白切）
 *  - ANSI 转义序列（CSI/DCS/OSC/SS3，xterm 功能键 / 握手协议）：整体跳过，不污染行内容
 *  - 其他控制字符：忽略（不影响行内容）
 *  - 可打印字符 / Tab：累加到行尾
 *  返回 { line, detected, clearDetected, resumeDetected, inEscape }：line 是消化完所有字节后的"当前行"，
 *  detected 表示是否触发退出命令，clearDetected 表示是否触发 /clear，
 *  resumeDetected 表示是否触发 /resume，
 *  inEscape 是转义序列跨批次时的中间状态（供下次调用传入）。 */
export function consumeInputForExitDetect(
  prevLine: string,
  data: string,
  inEscape: EscapePhase = 0,
): { line: string; detected: boolean; clearDetected: boolean; resumeDetected: boolean; inEscape: EscapePhase } {
  let line = prevLine;
  let detected = false;
  let clearDetected = false;
  let resumeDetected = false;
  let esc = inEscape;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (esc === 0) {
      if (ch === '\x1b') {
        esc = 1;
      } else if (ch === '\r' || ch === '\n') {
        if (EXIT_COMMANDS.has(line.trim())) detected = true;
        if (CLEAR_COMMANDS.has(line.trim())) clearDetected = true;
        if (RESUME_COMMANDS.has(line.trim())) resumeDetected = true;
        line = '';
      } else if (ch === '\x7f' || ch === '\b') {
        line = line.slice(0, -1);
      } else if (ch === '\x03' || ch === '\x15') {
        line = '';  // Ctrl+C / Ctrl+U 全清
      } else if (ch === '\x17') {
        // Ctrl+W：删到上一个空白之后
        line = line.replace(/\S+\s*$/, '');
      } else {
        const code = ch.charCodeAt(0);
        if (code >= 32 || ch === '\t') line += ch;
      }
    } else if (esc === 1) {
      // ESC 后的第一个字符决定序列类型
      if (ch === '[') esc = 2;        // CSI
      else if (ch === ']') esc = 4;   // OSC
      else if (ch === 'P') esc = 3;   // DCS
      else if (ch === 'O') esc = 5;   // SS3
      else if (ch === '\\') esc = 0;  // ESC \（空转义）
      else esc = 0;                   // 单字符转义序列，直接结束
    } else if (esc === 2) {
      // CSI：最终字节 0x40-0x7E 结束序列；参数/中间字节继续跳过
      const code = ch.charCodeAt(0);
      if (code >= 0x40 && code <= 0x7e) esc = 0;
    } else if (esc === 3 || esc === 4) {
      // DCS / OSC：跳过直到 ST（\x1b\\）或 BEL（OSC 专用）
      if (ch === '\x1b') esc = 6;
      else if (esc === 4 && ch === '\x07') esc = 0; // OSC 用 BEL 终止
    } else if (esc === 5) {
      // SS3：单个最终字节，跳过后结束
      esc = 0;
    } else if (esc === 6) {
      // ESC 之后：是 \ 则是 ST 结束；否则当作新的单字符转义序列处理
      esc = ch === '\\' ? 0 : 0;
    }
  }
  return { line, detected, clearDetected, resumeDetected, inEscape: esc };
}

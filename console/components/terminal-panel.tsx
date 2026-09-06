"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type TerminalHandle = { write: (data: string) => void; clear: () => void };

export const TerminalPanel = forwardRef<TerminalHandle, {
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}>(function TerminalPanel({ onInput, onResize }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useImperativeHandle(ref, () => ({
    write: (data) => terminalRef.current?.write(data),
    clear: () => terminalRef.current?.clear(),
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;
    const fit = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      fontSize: 12,
      lineHeight: 1.38,
      scrollback: 8_000,
      allowTransparency: true,
      theme: {
        background: "#191d1b", foreground: "#dfe5df", cursor: "#85ad97",
        selectionBackground: "#3c5c4c", black: "#252a27", brightBlack: "#606963",
        green: "#79a48d", brightGreen: "#9ac1ab", yellow: "#c6ad75", brightYellow: "#d8c48e",
        blue: "#87a7b4", brightBlue: "#a4c2cc", red: "#c77f79", brightRed: "#dc9892",
        white: "#dfe5df", brightWhite: "#f5f8f5",
      },
    });
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    const inputDisposable = terminal.onData(onInput);
    const resize = () => { fit.fit(); onResize(terminal.cols, terminal.rows); };
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);
    requestAnimationFrame(resize);
    terminal.focus();
    return () => { observer.disconnect(); inputDisposable.dispose(); terminal.dispose(); terminalRef.current = null; };
  }, [onInput, onResize]);

  return <div ref={containerRef} className="h-[calc(100%-48px)] min-h-[492px] w-full" aria-label="Terminal Claude Code" />;
});

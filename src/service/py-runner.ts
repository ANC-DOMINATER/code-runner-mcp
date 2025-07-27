import type { PyodideInterface } from "pyodide";
import { getPyodide, getPip, loadDeps, makeStream } from "../tool/py.ts";

// const EXEC_TIMEOUT = 1000;
const EXEC_TIMEOUT = 1000 * 60 * 3; // 3 minutes for heavy imports like pandas

// Cache pyodide instance
queueMicrotask(() => {
  getPyodide();
  getPip();
});

const encoder = new TextEncoder();

/**
 * Options for running Python code
 */
export interface RunPyOptions {
  /** Directory to mount Node.js file system to */
  nodeFSMountPoint?: string;
}

/**
 * Run arbitrary Python code (Pyodide) and **stream** its stdout / stderr.
 *
 * Optional `abortSignal` will interrupt execution via Pyodide's interrupt
 * buffer and close the resulting stream.
 */
export async function runPy(
  code: string,
  options?: RunPyOptions,
  abortSignal?: AbortSignal
): Promise<ReadableStream<Uint8Array>>;
export async function runPy(
  code: string,
  abortSignal?: AbortSignal
): Promise<ReadableStream<Uint8Array>>;
export async function runPy(
  code: string,
  optionsOrAbortSignal?: RunPyOptions | AbortSignal,
  abortSignal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  // Handle overloaded parameters
  let options: RunPyOptions | undefined;
  let signal: AbortSignal | undefined;
  
  if (optionsOrAbortSignal instanceof AbortSignal) {
    signal = optionsOrAbortSignal;
  } else {
    options = optionsOrAbortSignal;
    signal = abortSignal;
  }

  const pyodide = await getPyodide();

  // Set up file system if options provided
  if (options) {
    setupPyodideFileSystem(pyodide, options);
  }

  // Load packages
  await loadDeps(code);

  // Interrupt buffer to be set when aborting
  const interruptBuffer = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  );

  pyodide.setInterruptBuffer(interruptBuffer);

  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let streamClosed = false;

  const push =
    (prefix: string) =>
    (data: string): void => {
      try {
        if (!streamClosed) {
          controller.enqueue(encoder.encode(prefix + data));
        }
      } catch (err) {
        // Stream is already closed or errored, ignore
        console.warn("[py] Stream already closed, ignoring output:", err instanceof Error ? err.message : String(err));
      }
    };

  // Build the stream with proper abort behaviour
  const stream = makeStream(
    signal,
    (ctrl) => {
      console.log("[start][py] streaming & timeout");
      const timeout = setTimeout(() => {
        console.log(`[err][py] timeout`);
        if (!streamClosed) {
          try {
            controller.enqueue(encoder.encode("[err][py] timeout"));
            controller.close();
            streamClosed = true;
            // Clear handlers to prevent further writes
            pyodide.setStdout({});
            pyodide.setStderr({});
          } catch (err) {
            console.warn("[py] Error closing stream on timeout:", err instanceof Error ? err.message : String(err));
          }
        }
        interruptBuffer[0] = 3;
      }, EXEC_TIMEOUT);

      controller = ctrl;
      pyodide.setStdout({ batched: push("") });
      pyodide.setStderr({ batched: push("[stderr] ") });

      // Defer execution so that `start()` returns immediately
      queueMicrotask(async () => {
        try {
          // If an abort happened before execution – don't run
          if (signal?.aborted) return;
          
          await pyodide.runPythonAsync(code);
          clearTimeout(timeout);
          if (!streamClosed) {
            controller.close();
            streamClosed = true;
            // Clear handlers to prevent further writes
            pyodide.setStdout({});
            pyodide.setStderr({});
          }
        } catch (err) {
          clearTimeout(timeout);
          if (!streamClosed) {
            controller.error(err);
            streamClosed = true;
            // Clear handlers to prevent further writes
            pyodide.setStdout({});
            pyodide.setStderr({});
          }
        }
      });
    },
    () => {
      streamClosed = true;
      interruptBuffer[0] = 2;
      // Clear handlers to prevent further writes
      pyodide.setStdout({});
      pyodide.setStderr({});
    }
  );

  return stream;
}

/**
 * Set up Pyodide file system based on options
 */
function setupPyodideFileSystem(pyodide: PyodideInterface, options: RunPyOptions) {
  // Mount Node.js file system if requested
  if (options.nodeFSMountPoint) {
    try {
      pyodide.FS.mkdirTree(options.nodeFSMountPoint);
      pyodide.FS.mount(pyodide.FS.filesystems.NODEFS, { root: "." }, options.nodeFSMountPoint);
      console.log(`[py] Mounted Node.js FS at ${options.nodeFSMountPoint}`);
    } catch (err) {
      console.warn(`[py] Failed to mount Node.js FS:`, err);
    }
  }
}

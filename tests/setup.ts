// Test setup and utilities
export { assertEquals, assertExists, assertRejects, assertStringIncludes } from "jsr:@std/assert";

// Helper to create a timeout-based abort signal for testing
export function createTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

// Helper to read a ReadableStream to completion
export async function readStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let result = "";
  
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  
  return result;
}

// Helper to read a stream with a timeout
export function readStreamWithTimeout(
  stream: ReadableStream<Uint8Array>, 
  timeoutMs: number = 5000
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Stream read timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  
  return Promise.race([
    readStreamToString(stream),
    timeoutPromise
  ]);
}

// Mock environment variables for testing
export function withEnv<T>(envVars: Record<string, string>, fn: () => T): T {
  const originalEnv = { ...Deno.env.toObject() };
  
  // Set test environment variables
  for (const [key, value] of Object.entries(envVars)) {
    Deno.env.set(key, value);
  }
  
  try {
    return fn();
  } finally {
    // Restore original environment
    for (const key of Object.keys(envVars)) {
      if (originalEnv[key] !== undefined) {
        Deno.env.set(key, originalEnv[key]);
      } else {
        Deno.env.delete(key);
      }
    }
  }
}

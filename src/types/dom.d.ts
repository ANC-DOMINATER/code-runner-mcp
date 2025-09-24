// Type declarations for DOM APIs that might be missing in Deno
declare global {
  interface FileList {
    readonly length: number;
    item(index: number): File | null;
    [index: number]: File;
  }
  
  interface HTMLElement {
    // Basic HTMLElement interface
  }
  
  interface CanvasRenderingContext2D {
    // Basic 2D context interface
  }
  
  interface WebGLRenderingContext {
    // Basic WebGL context interface
  }
  
  interface HTMLCanvasElement extends HTMLElement {
    width: number;
    height: number;
    getContext(contextId: "2d"): CanvasRenderingContext2D | null;
    getContext(contextId: "webgl" | "experimental-webgl"): WebGLRenderingContext | null;
    getContext(contextId: string): CanvasRenderingContext2D | WebGLRenderingContext | null;
  }
  
  interface FileSystemDirectoryHandle {
    readonly kind: "directory";
    readonly name: string;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  }
  
  interface FileSystemFileHandle {
    readonly kind: "file";
    readonly name: string;
    getFile(): Promise<File>;
  }
}

export {};